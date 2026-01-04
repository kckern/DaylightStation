const normalizeLabel = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

import getLogger from '../../lib/logging/Logger.js';

const normalizeLabelList = (labels) => {
  if (!Array.isArray(labels)) return [];
  return labels
    .map(normalizeLabel)
    .filter(Boolean);
};

const normalizeZoneId = (value) => {
  if (!value) return null;
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
};

const normalizeName = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const scoreRequirement = (req, { zoneRankMap } = {}) => {
  const rankMap = zoneRankMap || {};
  const zoneId = normalizeZoneId(req?.zone || req?.zoneLabel);
  const zoneRank = zoneId != null && Number.isFinite(rankMap[zoneId]) ? rankMap[zoneId] : null;
  const targetHeartRate = Number.isFinite(req?.targetHeartRate)
    ? req.targetHeartRate
    : (Number.isFinite(req?.threshold) ? req.threshold : null);
  return {
    zoneRank,
    targetHeartRate
  };
};

export const RequirementSeverity = {
  UNKNOWN: -1
};

// Returns 1 if a is stricter than b, -1 if looser, 0 if equivalent
export const compareSeverity = (a, b, options = {}) => {
  const aScore = scoreRequirement(a, options);
  const bScore = scoreRequirement(b, options);

  if (aScore.zoneRank != null || bScore.zoneRank != null) {
    if (aScore.zoneRank == null) return -1;
    if (bScore.zoneRank == null) return 1;
    if (aScore.zoneRank === bScore.zoneRank) return 0;
    return aScore.zoneRank > bScore.zoneRank ? 1 : -1;
  }

  if (aScore.targetHeartRate != null || bScore.targetHeartRate != null) {
    if (aScore.targetHeartRate == null) return -1;
    if (bScore.targetHeartRate == null) return 1;
    if (aScore.targetHeartRate === bScore.targetHeartRate) return 0;
    return aScore.targetHeartRate > bScore.targetHeartRate ? 1 : -1;
  }

  return 0;
};

const buildRequirementKey = (req) => {
  const zoneId = normalizeZoneId(req?.zone || req?.zoneLabel) || 'zone';
  const selection = req?.selectionLabel || '';
  const rule = req?.ruleLabel || req?.rule || '';
  const requiredCount = Number.isFinite(req?.requiredCount) ? req.requiredCount : '';
  return `${zoneId}|${selection}|${rule}|${requiredCount}`;
};

export const normalizeRequirements = (rawReqs, comparator = compareSeverity, options = {}) => {
  const list = Array.isArray(rawReqs) ? rawReqs.filter(Boolean) : [];
  const perParticipant = new Map();

  list.forEach((req, index) => {
    const missing = Array.isArray(req?.missingUsers) ? req.missingUsers.filter(Boolean) : [];
    if (!missing.length) return;

    missing.forEach((name) => {
      const key = normalizeName(name);
      if (!key) return;
      const existing = perParticipant.get(key);
      const incoming = {
        req,
        participantName: name,
        updatedAt: Number.isFinite(req?.updatedAt) ? req.updatedAt : null,
        index
      };
      if (!existing) {
        perParticipant.set(key, incoming);
        return;
      }
      const cmp = comparator(req, existing.req, options);
      if (cmp > 0) {
        perParticipant.set(key, incoming);
        return;
      }
      if (cmp === 0) {
        const hasIncomingUpdated = Number.isFinite(incoming.updatedAt);
        const hasExistingUpdated = Number.isFinite(existing.updatedAt);
        if (hasIncomingUpdated && hasExistingUpdated) {
          if (incoming.updatedAt > existing.updatedAt) {
            perParticipant.set(key, incoming);
            return;
          }
        } else if (hasIncomingUpdated && !hasExistingUpdated) {
          perParticipant.set(key, incoming);
          return;
        } else if (!hasIncomingUpdated && !hasExistingUpdated && incoming.index > existing.index) {
          perParticipant.set(key, incoming);
        }
      }
    });
  });

  const grouped = new Map();
  perParticipant.forEach(({ req, participantName }) => {
    const key = buildRequirementKey(req);
    const existing = grouped.get(key);
    const missingUsers = participantName ? [participantName] : [];
    if (existing) {
      const mergedMissing = Array.isArray(existing.missingUsers) ? existing.missingUsers : [];
      if (participantName && !mergedMissing.includes(participantName)) {
        mergedMissing.push(participantName);
      }
      grouped.set(key, { ...existing, missingUsers: mergedMissing });
    } else {
      const base = { ...req, missingUsers };
      grouped.set(key, base);
    }
  });

  return Array.from(grouped.values());
};

export class GovernanceEngine {
  constructor(session = null) {
    this.session = session;  // Reference to FitnessSession for direct roster access
    this.config = {};
    this.policies = [];
    this.media = null;
    this.phase = 'init'; // init, green, yellow, red
    this.pulse = 0;
    
    this.meta = {
      satisfiedOnce: false,
      deadline: null,
      gracePeriodTotal: null
    };

    this.challengeState = {
      activePolicyId: null,
      activePolicyName: null,
      selectionCursor: {},
      activeChallenge: null,
      nextChallengeAt: null,
      nextChallengeRemainingMs: null,
      nextChallenge: null,
      videoLocked: false,
      forceStartRequest: null,
      selectionRandomBag: {},
      challengeHistory: []
    };

    this.requirementSummary = {
      policyId: null,
      targetUserCount: null,
      requirements: [],
      activeCount: 0
    };

    this.timers = {
      governance: null,
      challenge: null
    };

    this.callbacks = {
      onPhaseChange: null,
      onPulse: null
    };

    this._governedLabelSet = new Set();
    this._governedTypeSet = new Set();
    this._latestInputs = {
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: {},
      zoneInfoMap: {},
      totalCount: 0
    };
    this._lastEvaluationTs = null;
  }

  _buildChallengeSnapshot(now) {
    const state = this.challengeState || {};
    const activeChallenge = state.activeChallenge;
    if (!activeChallenge) return null;

    const expiresAt = Number.isFinite(activeChallenge.expiresAt) ? activeChallenge.expiresAt : null;
    const startedAt = Number.isFinite(activeChallenge.startedAt) ? activeChallenge.startedAt : null;
    const remainingSeconds = expiresAt != null
      ? Math.max(0, Math.round((expiresAt - now) / 1000))
      : null;
    let totalSeconds = null;
    if (Number.isFinite(activeChallenge.timeLimitSeconds)) {
      totalSeconds = Math.max(1, Math.round(activeChallenge.timeLimitSeconds));
    } else if (expiresAt != null && startedAt != null) {
      totalSeconds = Math.max(1, Math.round((expiresAt - startedAt) / 1000));
    }

    const summary = activeChallenge.summary || null;
    const zoneInfoMap = this._latestInputs.zoneInfoMap || {};
    const zoneInfo = activeChallenge.zone ? zoneInfoMap[activeChallenge.zone] : null;
    const zoneLabel = (summary && summary.zoneLabel)
      || (zoneInfo && zoneInfo.name)
      || activeChallenge.zone
      || null;

    return {
      id: activeChallenge.id,
      status: activeChallenge.status,
      zone: activeChallenge.zone,
      zoneLabel,
      requiredCount: activeChallenge.requiredCount,
      actualCount: summary && summary.actualCount != null ? summary.actualCount : null,
      metUsers: Array.isArray(summary && summary.metUsers) ? [...summary.metUsers] : [],
      missingUsers: Array.isArray(summary && summary.missingUsers) ? [...summary.missingUsers] : [],
      remainingSeconds,
      totalSeconds,
      startedAt,
      expiresAt,
      selectionLabel: activeChallenge.selectionLabel || null,
      paused: Boolean(activeChallenge.pausedAt)
    };
  }

  _buildNextChallengeSnapshot(now) {
    const state = this.challengeState || {};
    const nextChallenge = state.nextChallenge;
    if (!nextChallenge) return null;

    let remainingSeconds = null;
    if (Number.isFinite(state.nextChallengeAt)) {
      remainingSeconds = Math.max(0, Math.round((state.nextChallengeAt - now) / 1000));
    } else if (Number.isFinite(state.nextChallengeRemainingMs)) {
      remainingSeconds = Math.max(0, Math.round(state.nextChallengeRemainingMs / 1000));
    }

    const normalizedTimeLimit = Number.isFinite(nextChallenge.timeLimitSeconds)
      ? Math.max(1, Math.round(nextChallenge.timeLimitSeconds))
      : null;

    return {
      ...nextChallenge,
      remainingSeconds,
      timeLimitSeconds: normalizedTimeLimit
    };
  }

  _getGracePeriodTotalSeconds() {
    if (this.meta && Number.isFinite(this.meta.gracePeriodTotal)) {
      return this.meta.gracePeriodTotal;
    }
    if (this.config && Number.isFinite(this.config.grace_period_seconds)) {
      return this.config.grace_period_seconds;
    }
    return null;
  }

  _mediaHasGovernedLabel() {
    if (!this.media || !this.media.id || !this._governedLabelSet.size) {
      return false;
    }
    const labels = Array.isArray(this.media.labels) ? this.media.labels : [];
    return labels.some((label) => this._governedLabelSet.has(normalizeLabel(label)));
  }

  _mediaHasGovernedType() {
    if (!this.media || !this.media.id || !this._governedTypeSet.size) {
      return false;
    }
    const mediaType = typeof this.media.type === 'string' ? normalizeLabel(this.media.type) : '';
    if (!mediaType) return false;
    return this._governedTypeSet.has(mediaType);
  }

  _mediaIsGoverned() {
    return this._mediaHasGovernedLabel() || this._mediaHasGovernedType();
  }

  _captureLatestInputs(payload) {
    if (!payload) return;
    const activeParticipants = Array.isArray(payload.activeParticipants)
      ? Array.from(new Set(payload.activeParticipants))
      : [];
    this._latestInputs = {
      activeParticipants,
      userZoneMap: { ...(payload.userZoneMap || {}) },
      zoneRankMap: { ...(payload.zoneRankMap || {}) },
      zoneInfoMap: { ...(payload.zoneInfoMap || {}) },
      totalCount: Number.isFinite(payload.totalCount) ? payload.totalCount : activeParticipants.length
    };
    this._lastEvaluationTs = Date.now();
  }

  configure(config, policies) {
    this.config = config || {};
    if (Array.isArray(policies) && policies.length > 0) {
      this.policies = policies;
    } else if (this.config.policies) {
      this.policies = this._normalizePolicies(this.config.policies);
    } else {
      this.policies = [];
    }
    const governedLabelSource = this.config && Array.isArray(this.config.governed_labels)
      ? this.config.governed_labels
      : [];
    this._governedLabelSet = new Set(normalizeLabelList(governedLabelSource));
    const governedTypeSource = this.config && Array.isArray(this.config.governed_types)
      ? this.config.governed_types
      : [];
    this._governedTypeSet = new Set(normalizeLabelList(governedTypeSource));

    // Start self-evaluation pulse
    this._schedulePulse(1000);
  }

  _normalizePolicies(policiesRaw) {
    if (!policiesRaw || typeof policiesRaw !== 'object') return [];

    const normalized = [];
    Object.entries(policiesRaw).forEach(([policyId, policyValue]) => {
      if (!policyValue || typeof policyValue !== 'object') return;

      const baseRequirementArray = Array.isArray(policyValue.base_requirement)
        ? policyValue.base_requirement
        : [];
      const baseRequirement = baseRequirementArray.reduce((acc, entry) => {
        if (entry && typeof entry === 'object') {
          Object.entries(entry).forEach(([key, value]) => {
            acc[key] = value;
          });
        }
        return acc;
      }, {});

      const minParticipants = Number.isFinite(policyValue.min_participants)
        ? Number(policyValue.min_participants)
        : Number.isFinite(policyValue.minParticipants)
          ? Number(policyValue.minParticipants)
          : null;

      const challengesRaw = Array.isArray(policyValue.challenges) ? policyValue.challenges : [];
      const challenges = challengesRaw
        .map((challengeValue, index) => {
          if (!challengeValue || typeof challengeValue !== 'object') return null;

          const intervalRaw = challengeValue.interval;
          let minIntervalSeconds;
          let maxIntervalSeconds;
          if (Array.isArray(intervalRaw) && intervalRaw.length >= 2) {
            minIntervalSeconds = Number(intervalRaw[0]);
            maxIntervalSeconds = Number(intervalRaw[1]);
          } else if (Number.isFinite(intervalRaw)) {
            minIntervalSeconds = Number(intervalRaw);
            maxIntervalSeconds = Number(intervalRaw);
          }

          if (!Number.isFinite(minIntervalSeconds) || minIntervalSeconds <= 0) {
            minIntervalSeconds = 180;
          }
          if (!Number.isFinite(maxIntervalSeconds) || maxIntervalSeconds <= 0) {
            maxIntervalSeconds = minIntervalSeconds;
          }
          if (maxIntervalSeconds < minIntervalSeconds) {
            const temp = maxIntervalSeconds;
            maxIntervalSeconds = minIntervalSeconds;
            minIntervalSeconds = temp;
          }

          const selectionList = Array.isArray(challengeValue.selections) ? challengeValue.selections : [];
          const selections = selectionList
            .map((selectionValue, selectionIndex) => {
              if (!selectionValue || typeof selectionValue !== 'object') return null;
              const zone = selectionValue.zone || selectionValue.zoneId || selectionValue.zone_id;
              if (!zone) return null;

              const rule = selectionValue.min_participants ?? selectionValue.minParticipants ?? selectionValue.rule ?? 'all';
              const timeAllowed = Number(selectionValue.time_allowed ?? selectionValue.timeAllowed);
              if (!Number.isFinite(timeAllowed) || timeAllowed <= 0) return null;

              const weight = Number(selectionValue.weight ?? 1);

              return {
                id: `${policyId}_${index}_${selectionIndex}`,
                zone: String(zone),
                rule,
                timeAllowedSeconds: Math.max(1, Math.round(timeAllowed)),
                weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
                label: selectionValue.label || selectionValue.name || null
              };
            })
            .filter(Boolean);

          if (!selections.length) return null;

          const challengeMinParticipants = Number(challengeValue.minParticipants ?? challengeValue.min_participants);

          return {
            id: `${policyId}_challenge_${index}`,
            intervalRangeSeconds: [Math.round(minIntervalSeconds), Math.round(maxIntervalSeconds)],
            minParticipants: Number.isFinite(challengeMinParticipants) && challengeMinParticipants >= 0
              ? challengeMinParticipants
              : null,
            selectionType: typeof challengeValue.selection_type === 'string'
              ? challengeValue.selection_type.toLowerCase()
              : 'random',
            selections
          };
        })
        .filter(Boolean);

      normalized.push({
        id: policyId,
        name: policyValue.name || policyId,
        minParticipants,
        baseRequirement,
        challenges
      });
    });

    return normalized;
  }

  setMedia(media) {
    this.media = media;
  }

  setCallbacks({ onPhaseChange, onPulse }) {
    this.callbacks.onPhaseChange = onPhaseChange;
    this.callbacks.onPulse = onPulse;
  }

  _setPhase(newPhase) {
    if (this.phase !== newPhase) {
      this.phase = newPhase;
      if (this.callbacks.onPhaseChange) {
        this.callbacks.onPhaseChange(newPhase);
      }
    }
  }

  _triggerPulse() {
    this.pulse += 1;

    // SIMPLIFIED: Self-evaluate on each pulse using session.roster
    if (this.session?.roster) {
      this.evaluate();  // No params needed - reads from session.roster directly
    }

    if (this.callbacks.onPulse) {
      this.callbacks.onPulse(this.pulse);
    }
  }

  _schedulePulse(delayMs) {
    if (this.timers.challenge) {
      clearTimeout(this.timers.challenge);
      this.timers.challenge = null;
    }
    if (delayMs === null) return;
    const safeDelay = Math.max(50, delayMs);
    this.timers.challenge = setTimeout(() => this._triggerPulse(), safeDelay);
  }

  _clearTimers() {
    if (this.timers.governance) {
      clearTimeout(this.timers.governance);
      this.timers.governance = null;
    }
    if (this.timers.challenge) {
      clearTimeout(this.timers.challenge);
      this.timers.challenge = null;
    }
  }

  reset() {
    this._clearTimers();
    this.meta = {
      satisfiedOnce: false,
      deadline: null,
      gracePeriodTotal: null
    };
    this.challengeState = {
      activePolicyId: null,
      activePolicyName: null,
      selectionCursor: {},
      activeChallenge: null,
      nextChallengeAt: null,
      nextChallengeRemainingMs: null,
      nextChallenge: null,
      videoLocked: false,
      forceStartRequest: null,
      selectionRandomBag: {},
      challengeHistory: []
    };
    this.requirementSummary = {
      policyId: null,
      targetUserCount: null,
      requirements: [],
      activeCount: 0
    };
    this._setPhase('init');
    this._latestInputs = {
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: {},
      zoneInfoMap: {},
      totalCount: 0
    };
    this._lastEvaluationTs = null;
  }

  get state() {
    return this._composeState();
  }

  _composeState() {
    const now = Date.now();
    const summary = this.requirementSummary || {};
    const watchers = Array.isArray(this._latestInputs.activeParticipants)
      ? [...this._latestInputs.activeParticipants]
      : [];
    const countdownSecondsRemaining = this.meta && Number.isFinite(this.meta.deadline)
      ? Math.max(0, Math.round((this.meta.deadline - now) / 1000))
      : null;
    const gracePeriodTotal = this._getGracePeriodTotalSeconds();
    const challengeSnapshot = this._buildChallengeSnapshot(now);
    const nextChallengeSnapshot = this._buildNextChallengeSnapshot(now);

    const unsatisfied = Array.isArray(summary.requirements)
      ? summary.requirements.filter((rule) => rule && !rule.satisfied)
      : [];
    const combinedRequirements = (() => {
      const list = [...unsatisfied];
      if (challengeSnapshot && challengeSnapshot.status === 'pending') {
        const challengeRequirement = {
          zone: challengeSnapshot.zone || challengeSnapshot.zoneLabel,
          targetZoneId: challengeSnapshot.zone || challengeSnapshot.zoneLabel || null,
          zoneLabel: challengeSnapshot.zoneLabel || challengeSnapshot.zone || 'Target zone',
          rule: challengeSnapshot.rule ?? null,
          ruleLabel: challengeSnapshot.selectionLabel || challengeSnapshot.rule || 'Challenge requirement',
          satisfied: false,
          missingUsers: Array.isArray(challengeSnapshot.missingUsers)
            ? challengeSnapshot.missingUsers.filter(Boolean)
            : [],
          metUsers: Array.isArray(challengeSnapshot.metUsers)
            ? challengeSnapshot.metUsers.filter(Boolean)
            : [],
          requiredCount: Number.isFinite(challengeSnapshot.requiredCount) ? challengeSnapshot.requiredCount : null,
          actualCount: Number.isFinite(challengeSnapshot.actualCount) ? challengeSnapshot.actualCount : null,
          selectionLabel: challengeSnapshot.selectionLabel || '',
          participantKey: null,
          severity: (() => {
            const zoneId = challengeSnapshot.zone || null;
            const rankMap = this._latestInputs.zoneRankMap || {};
            return zoneId && Number.isFinite(rankMap[zoneId]) ? rankMap[zoneId] : null;
          })()
        };
        list.unshift(challengeRequirement);
      }
      return list;
    })();

    const lockRowsNormalized = normalizeRequirements(
      combinedRequirements,
      (a, b) => compareSeverity(a, b, { zoneRankMap: this._latestInputs.zoneRankMap || {} }),
      { zoneRankMap: this._latestInputs.zoneRankMap || {} }
    ).map((entry) => ({
      ...entry,
      participantKey: entry.participantKey || null,
      targetZoneId: entry.targetZoneId || entry.zone || null,
      severity: entry.severity != null ? entry.severity : (entry.targetZoneId && Number.isFinite((this._latestInputs.zoneRankMap || {})[entry.targetZoneId])
        ? (this._latestInputs.zoneRankMap || {})[entry.targetZoneId]
        : null)
    }));

    const enforceOneRowPerParticipant = (rows) => {
      const seen = new Map();
      const deduped = [];
      const dropped = [];
      rows.forEach((row) => {
        const missing = Array.isArray(row.missingUsers) ? row.missingUsers : [];
        const remaining = [];
        missing.forEach((name) => {
          const key = normalizeName(name);
          if (!key) return;
          if (seen.has(key)) {
            dropped.push({ participant: key, kept: seen.get(key), dropped: row.targetZoneId || row.zone || null });
            return;
          }
          seen.set(key, row.targetZoneId || row.zone || null);
          remaining.push(name);
        });
        if (remaining.length) {
          deduped.push({ ...row, missingUsers: remaining });
        }
      });
      if (dropped.length) {
        getLogger().warn('governance.dropped_duplicate_requirements', { dropped });
      }
      return deduped;
    };

    const lockRows = enforceOneRowPerParticipant(lockRowsNormalized);

    return {
      isGoverned: this._mediaIsGoverned(),
      status: this.phase || 'idle',
      labels: Array.isArray(this.media && this.media.labels) ? [...this.media.labels] : [],
      requirements: summary.requirements || [],
      lockRows,
      zoneRankMap: { ...(this._latestInputs.zoneRankMap || {}) },
      targetUserCount: summary.targetUserCount != null ? summary.targetUserCount : null,
      policyId: summary.policyId || null,
      policyName: this.challengeState?.activePolicyName || summary.policyId || null,
      activeUserCount: summary.activeCount != null ? summary.activeCount : 0,
      watchers,
      countdownSecondsRemaining,
      countdownSecondsTotal: gracePeriodTotal,
      gracePeriodTotal,
      videoLocked: !!(this.challengeState && this.challengeState.videoLocked),
      challengePaused: challengeSnapshot ? Boolean(challengeSnapshot.paused) : false,
      challenge: challengeSnapshot,
      challengeHistory: Array.isArray(this.challengeState?.challengeHistory)
        ? [...this.challengeState.challengeHistory]
        : [],
      challengeCountdownSeconds: challengeSnapshot ? challengeSnapshot.remainingSeconds : null,
      challengeCountdownTotal: challengeSnapshot ? challengeSnapshot.totalSeconds : null,
      nextChallenge: nextChallengeSnapshot
    };
  }

  // Main evaluation loop, called periodically or on data change
  /**
   * Evaluate governance rules against current session state.
   * 
   * @param {Object} params
   * @param {string[]} params.activeParticipants - Array of userIds (stable, lowercase)
   * @param {Record<string, string>} params.userZoneMap - Map userId -> zoneId
   * @param {Record<string, number>} params.zoneRankMap - Map zoneId -> rank (higher is more intense)
   * @param {Record<string, Object>} params.zoneInfoMap - Map zoneId -> zone metadata
   * @param {number} params.totalCount - Total number of active participants
   */
  evaluate({ activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount } = {}) {
    const now = Date.now();
    const hasGovernanceRules = (this._governedLabelSet.size + this._governedTypeSet.size) > 0;

    // SIMPLIFIED: If no data passed in, read directly from session.roster
    getLogger().error('🔍 GOVERNANCE_DEBUG', {
      hasSession: !!this.session,
      hasRoster: !!this.session?.roster,
      rosterLength: this.session?.roster?.length || 0,
      rosterSample: this.session?.roster?.[0]
    });

    if (!activeParticipants && this.session?.roster) {
      const roster = this.session.roster || [];
      activeParticipants = roster
        .filter((entry) => entry.isActive !== false && (entry.id || entry.profileId))
        .map((entry) => entry.id || entry.profileId);

      userZoneMap = {};
      roster.forEach((entry) => {
        const participantId = entry.id || entry.profileId;
        if (participantId) {
          userZoneMap[participantId] = entry.zoneId || null;
        }
      });

      totalCount = activeParticipants.length;

      getLogger().error('governance.evaluate.built_from_roster', {
        participantCount: activeParticipants.length,
        participants: activeParticipants
      });
    }

    // Ensure defaults
    activeParticipants = activeParticipants || [];
    userZoneMap = userZoneMap || {};
    zoneRankMap = zoneRankMap || {};
    zoneInfoMap = zoneInfoMap || {};
    totalCount = totalCount || activeParticipants.length;

    // Phase 4: Debug logging for governance evaluation
    getLogger().warn('governance.evaluate.called', {
      hasMedia: !!(this.media && this.media.id),
      mediaId: this.media?.id,
      hasGovernanceRules,
      governedLabelSetSize: this._governedLabelSet.size,
      governedTypeSetSize: this._governedTypeSet.size,
      activeParticipantsCount: activeParticipants.length,
      activeParticipants,
      userZoneMapKeys: Object.keys(userZoneMap),
      userZoneMap,
      totalCount
    });

    // 1. Check if media is governed
    if (!this.media || !this.media.id || !hasGovernanceRules) {
      getLogger().warn('governance.evaluate.no_media_or_rules', {
        hasMedia: !!(this.media && this.media.id),
        hasGovernanceRules
      });
      this.reset();
      this._setPhase(null);
      return;
    }

    const hasGovernedMedia = this._mediaIsGoverned();
    if (!hasGovernedMedia) {
      getLogger().warn('governance.evaluate.media_not_governed', {
        mediaId: this.media?.id
      });
      this.reset();
      this._setPhase(null);
      return;
    }

    // 2. Check participants
    if (activeParticipants.length === 0) {
      getLogger().warn('governance.evaluate.no_participants');
      this.reset(); // Or keep history? Context cleared history on empty participants
      this._setPhase('init');
      this._schedulePulse(1000); // Ensure UI keeps checking even if engine is reset
      return;
    }

    // 3. Choose Policy
    const activePolicy = this._chooseActivePolicy(totalCount);
    if (!activePolicy) {
      this.reset();
      this._setPhase('init');
      return;
    }

    getLogger().error('🔧 POLICY_CHOSEN', {
      policyId: activePolicy.id,
      policyName: activePolicy.name,
      baseRequirement: activePolicy.baseRequirement,
      minParticipants: activePolicy.minParticipants
    });

    // 4. Update Challenge State Context
    if (this.challengeState.activePolicyId !== activePolicy.id) {
      this._clearTimers(); // Clear challenge timer specifically?
      this.challengeState.activePolicyId = activePolicy.id;
      this.challengeState.activePolicyName = activePolicy.name || activePolicy.id;
      this.challengeState.selectionCursor = {};
      this.challengeState.activeChallenge = null;
      this.challengeState.nextChallengeAt = null;
      this.challengeState.nextChallengeRemainingMs = null;
      this.challengeState.nextChallenge = null;
      this.challengeState.videoLocked = false;
    }

    // 5. Evaluate Base Requirements
    const baseRequirement = activePolicy.baseRequirement || {};
    const { summaries, allSatisfied } = this._evaluateRequirementSet(baseRequirement, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

    getLogger().error('🔧 REQUIREMENTS_EVALUATED', {
      allSatisfied,
      summaries,
      baseRequirement
    });

    this.requirementSummary = {
      policyId: activePolicy.id,
      targetUserCount: activePolicy.minParticipants,
      requirements: summaries,
      activeCount: activeParticipants.length
    };

    // 6. Determine Phase
    const challengeForcesRed = this.challengeState.activeChallenge && this.challengeState.activeChallenge.status === 'failed';
    const defaultGrace = this.config.grace_period_seconds || 0;
    const baseGraceSeconds = Number.isFinite(baseRequirement.grace_period_seconds) ? baseRequirement.grace_period_seconds : defaultGrace;

    if (challengeForcesRed) {
      if (this.timers.governance) clearTimeout(this.timers.governance);
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('red');
    } else if (allSatisfied) {
      this.meta.satisfiedOnce = true;
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('green');
    } else if (!this.meta.satisfiedOnce) {
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('init');
    } else {
      // Grace period logic
      let graceSeconds = baseGraceSeconds;
      if (!Number.isFinite(graceSeconds) || graceSeconds <= 0) {
        if (this.timers.governance) clearTimeout(this.timers.governance);
        this.meta.deadline = null;
        this.meta.gracePeriodTotal = null;
        this._setPhase('red');
      } else {
        if (!Number.isFinite(this.meta.deadline) && this.phase !== 'red') {
          this.meta.deadline = now + graceSeconds * 1000;
          this.meta.gracePeriodTotal = graceSeconds;
        }
        
        if (!Number.isFinite(this.meta.deadline)) {
           if (this.timers.governance) clearTimeout(this.timers.governance);
           this.meta.gracePeriodTotal = null;
           this._setPhase('red');
        } else {
          const remainingMs = this.meta.deadline - now;
          if (remainingMs <= 0) {
            if (this.timers.governance) clearTimeout(this.timers.governance);
            this.meta.deadline = null;
            this.meta.gracePeriodTotal = null;
            this._setPhase('red');
          } else {
            if (this.timers.governance) clearTimeout(this.timers.governance);
            this.timers.governance = setTimeout(() => this._triggerPulse(), remainingMs);
            this._setPhase('yellow');
          }
        }
      }
    }

    // 7. Handle Challenges
    this._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

    this._captureLatestInputs({
      activeParticipants,
      userZoneMap,
      zoneRankMap,
      zoneInfoMap,
      totalCount
    });
  }

  _chooseActivePolicy(totalCount) {
    if (!this.policies.length) return null;
    let fallback = this.policies[0];
    let chosen = null;
    this.policies.forEach((policy) => {
      const threshold = Number.isFinite(policy.minParticipants) ? policy.minParticipants : 0;
      if (threshold <= totalCount) {
        if (!chosen || threshold > (Number.isFinite(chosen.minParticipants) ? chosen.minParticipants : -1)) {
          chosen = policy;
        }
      }
      if (!fallback) {
        fallback = policy;
      } else {
        const fallbackThreshold = Number.isFinite(fallback.minParticipants) ? fallback.minParticipants : Infinity;
        if (Number.isFinite(policy.minParticipants) && policy.minParticipants < fallbackThreshold) {
          fallback = policy;
        }
      }
    });
    return chosen || fallback;
  }

  _evaluateRequirementSet(requirementMap, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount) {
    if (!requirementMap || typeof requirementMap !== 'object') {
      // No requirements defined - cannot satisfy what doesn't exist
      return { summaries: [], allSatisfied: false };
    }
    const entries = Object.entries(requirementMap).filter(([key]) => key !== 'grace_period_seconds');
    if (!entries.length) {
      // Only grace_period_seconds present, no actual zone requirements - treat as unsatisfied
      // to prevent resetting during an active grace period countdown
      return { summaries: [], allSatisfied: false };
    }
    const summaries = [];
    let allSatisfied = true;
    entries.forEach(([zoneKey, rule]) => {
      const summary = this._evaluateZoneRequirement(zoneKey, rule, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);
      if (summary) {
        summaries.push(summary);
        if (!summary.satisfied) {
          allSatisfied = false;
        }
      }
    });
    return { summaries, allSatisfied };
  }

  _evaluateZoneRequirement(zoneKey, rule, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount) {
    const zoneId = zoneKey ? String(zoneKey).toLowerCase() : null;
    if (!zoneId) return null;
    const requiredRank = zoneRankMap[zoneId];
    if (!Number.isFinite(requiredRank)) return null;

    const metUsers = [];
    activeParticipants.forEach((participantId) => {
      const participantZoneId = userZoneMap[participantId];
      if (!participantZoneId) {
        getLogger().warn('participant.zone.lookup_failed', {
          key: participantId,
          availableKeys: Object.keys(userZoneMap),
          caller: 'GovernanceEngine._evaluateZoneRequirement'
        });
      }
      const participantRank = participantZoneId && Number.isFinite(zoneRankMap[participantZoneId])
        ? zoneRankMap[participantZoneId]
        : 0;
      if (participantRank >= requiredRank) {
        metUsers.push(participantId);
      }
    });

    const requiredCount = this._normalizeRequiredCount(rule, totalCount);
    const satisfied = metUsers.length >= requiredCount;
    const missingUsers = activeParticipants.filter((participantId) => !metUsers.includes(participantId));
    const zoneInfo = zoneInfoMap[zoneId];

    return {
      zone: zoneId,
      zoneLabel: zoneInfo?.name || zoneId,
      targetZoneId: zoneId,
      participantKey: null,
      severity: requiredRank,
      rule,
      ruleLabel: this._describeRule(rule, requiredCount),
      requiredCount,
      actualCount: metUsers.length,
      metUsers,
      missingUsers,
      satisfied
    };
  }

  _normalizeRequiredCount(rule, totalCount) {
    if (typeof rule === 'number' && Number.isFinite(rule)) {
      return Math.min(Math.max(0, Math.round(rule)), totalCount);
    }
    if (typeof rule === 'string') {
      const normalized = rule.toLowerCase().trim();
      if (normalized === 'all') return totalCount;
      if (normalized === 'majority' || normalized === 'most') {
        return Math.max(1, Math.ceil(totalCount * 0.5));
      }
      if (normalized === 'some') {
        return Math.max(1, Math.ceil(totalCount * 0.3));
      }
      if (normalized === 'any') {
        return 1;
      }
      const numeric = Number(rule);
      if (Number.isFinite(numeric)) {
        return Math.min(Math.max(0, Math.round(numeric)), totalCount);
      }
    }
    return totalCount;
  }

  _describeRule(rule, requiredCount) {
    if (typeof rule === 'number' && Number.isFinite(rule)) {
      return `${requiredCount} participant${requiredCount === 1 ? '' : 's'}`;
    }
    if (typeof rule === 'string') {
      const normalized = rule.toLowerCase().trim();
      switch (normalized) {
        case 'all': return 'All participants';
        case 'majority': return `Majority (${requiredCount})`;
        case 'most': return `Most (${requiredCount})`;
        case 'some': return `Some (${requiredCount})`;
        case 'any': return 'Any participant';
        default: break;
      }
    }
    return `${requiredCount} participant${requiredCount === 1 ? '' : 's'}`;
  }

  _pickIntervalMs(rangeSeconds) {
    if (!Array.isArray(rangeSeconds) || rangeSeconds.length < 2) return 180000;
    const min = rangeSeconds[0];
    const max = rangeSeconds[1];
    const randomSeconds = Math.floor(Math.random() * (max - min + 1)) + min;
    return randomSeconds * 1000;
  }

  _evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount) {
    const now = Date.now();
    const challengeConfig = Array.isArray(activePolicy.challenges) && activePolicy.challenges.length
      ? activePolicy.challenges[0]
      : null;

    if (!challengeConfig) {
      this.challengeState.activeChallenge = null;
      this.challengeState.nextChallenge = null;
      this.challengeState.nextChallengeAt = null;
      this.challengeState.nextChallengeRemainingMs = null;
      return;
    }

    const chooseSelectionPayload = () => {
      if (!challengeConfig.selections || !challengeConfig.selections.length) return null;
      let selection = null;
      let cursorIndex = null;

      if (challengeConfig.selectionType === 'cyclic') {
        const cursor = this.challengeState.selectionCursor[challengeConfig.id] || 0;
        selection = challengeConfig.selections[cursor % challengeConfig.selections.length];
        cursorIndex = (cursor + 1) % challengeConfig.selections.length;
      } else {
        // Random weighted
        let bag = this.challengeState.selectionRandomBag[challengeConfig.id];
        if (!Array.isArray(bag) || bag.length === 0) {
          bag = [];
          challengeConfig.selections.forEach((sel, idx) => {
            const weight = sel.weight || 1;
            for (let i = 0; i < weight; i++) bag.push(idx);
          });
          // Shuffle
          for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
          }
        }
        const idx = bag.pop();
        this.challengeState.selectionRandomBag[challengeConfig.id] = bag;
        selection = challengeConfig.selections[idx];
      }

      if (!selection) return null;
      return { selection, cursorIndex };
    };

    const assignNextChallengePreview = (scheduledForTs, payload) => {
      const challengeZone = payload.selection.zone ? String(payload.selection.zone).toLowerCase() : null;
      const timeLimitSeconds = payload.selection.timeAllowedSeconds;
      const requiredCount = this._normalizeRequiredCount(payload.selection.rule, totalCount);
      
      this.challengeState.nextChallenge = {
        configId: challengeConfig.id,
        selectionId: payload.selection.id,
        selectionLabel: payload.selection.label || null,
        zone: challengeZone,
        rule: payload.selection.rule,
        requiredCount,
        timeLimitSeconds,
        cursorIndex: payload.cursorIndex ?? null,
        scheduledFor: scheduledForTs
      };
      return this.challengeState.nextChallenge;
    };

    const ensureNextChallengePreview = ({ scheduledFor } = {}) => {
      const baseTarget = Number.isFinite(scheduledFor)
        ? scheduledFor
        : Number.isFinite(this.challengeState.nextChallengeAt)
          ? this.challengeState.nextChallengeAt
          : Number.isFinite(this.challengeState.nextChallengeRemainingMs)
            ? now + this.challengeState.nextChallengeRemainingMs
            : null;
      const targetTs = Number.isFinite(baseTarget) ? baseTarget : null;
      const isGreenPhase = this.phase === 'green';
      
      if (!Number.isFinite(targetTs)) {
        this.challengeState.nextChallenge = null;
        return false;
      }

      if (targetTs <= now && !isGreenPhase) {
        this.challengeState.nextChallenge = null;
        return false;
      }

      const existing = this.challengeState.nextChallenge;
      if (
        existing &&
        existing.configId === challengeConfig.id &&
        Math.abs((existing.scheduledFor ?? targetTs) - targetTs) < 5 &&
        Number.isFinite(existing.requiredCount) &&
        existing.requiredCount > 0 &&
        existing.requiredCount <= totalCount
      ) {
        return true;
      }

      const payload = chooseSelectionPayload();
      if (!payload) {
        this.challengeState.nextChallenge = null;
        return false;
      }

      assignNextChallengePreview(targetTs, payload);
      return true;
    };

    const queueNextChallenge = (delayMs) => {
      const normalizedDelay = Number.isFinite(delayMs) && delayMs > 0 ? Math.max(50, Math.round(delayMs)) : 1000;
      const scheduledFor = now + normalizedDelay;
      this.challengeState.nextChallengeAt = scheduledFor;
      this.challengeState.nextChallengeRemainingMs = normalizedDelay;
      if (!ensureNextChallengePreview({ scheduledFor })) {
        this.challengeState.nextChallengeAt = null;
        this.challengeState.nextChallengeRemainingMs = null;
        this._schedulePulse(null);
        return false;
      }
      this._schedulePulse(Math.max(50, scheduledFor - now));
      return true;
    };

    const startChallenge = (options = {}) => {
      const { previewOverride = null, forced = false } = options;

      let preview = null;
      if (previewOverride) {
        preview = assignNextChallengePreview(now, previewOverride);
      } else if (this.challengeState.nextChallenge && this.challengeState.nextChallenge.configId === challengeConfig.id) {
        preview = this.challengeState.nextChallenge;
      } else {
        const payload = chooseSelectionPayload();
        preview = assignNextChallengePreview(now, payload);
      }

      if (!preview) {
        this.challengeState.forceStartRequest = null;
        this._schedulePulse(null);
        return false;
      }

      const timeLimitSeconds = Number.isFinite(preview.timeLimitSeconds) && preview.timeLimitSeconds > 0
        ? Math.round(preview.timeLimitSeconds)
        : 60;
      const startedAt = now;
      const expiresAt = startedAt + timeLimitSeconds * 1000;
      const requiredCount = Number.isFinite(preview.requiredCount) && preview.requiredCount > 0
        ? preview.requiredCount
        : this._normalizeRequiredCount(preview.rule, totalCount);

      this.challengeState.activeChallenge = {
        id: `${challengeConfig.id}_${startedAt}`,
        policyId: activePolicy.id,
        policyName: this.challengeState.activePolicyName,
        configId: challengeConfig.id,
        selectionId: preview.selectionId,
        selectionLabel: preview.selectionLabel || null,
        zone: preview.zone,
        rule: preview.rule,
        requiredCount,
        timeLimitSeconds,
        startedAt,
        expiresAt,
        status: 'pending',
        historyRecorded: false,
        summary: null,
        pausedAt: null,
        pausedRemainingMs: null
      };
      this.challengeState.nextChallenge = null;
      this.challengeState.nextChallengeAt = null;
      this.challengeState.nextChallengeRemainingMs = null;
      this.challengeState.videoLocked = false;

      if (challengeConfig.selectionType === 'cyclic' && Number.isInteger(preview.cursorIndex)) {
        this.challengeState.selectionCursor[challengeConfig.id] = preview.cursorIndex;
      }

      this.challengeState.forceStartRequest = null;
      this._schedulePulse(Math.max(50, expiresAt - startedAt));
      return true;
    };

    const buildChallengeSummary = (challenge) => {
        if (!challenge) return null;
        const zoneId = challenge.zone;
        const zoneInfo = zoneInfoMap[zoneId];
        const requiredRank = zoneRankMap[zoneId] || 0;
        
        const metUsers = [];
      activeParticipants.forEach((participantId) => {
        const pZone = userZoneMap[participantId];
        if (!pZone) {
          getLogger().warn('participant.zone.lookup_failed', {
          key: participantId,
          availableKeys: Object.keys(userZoneMap),
          caller: 'GovernanceEngine.buildChallengeSummary'
          });
        }
            const pRank = pZone && Number.isFinite(zoneRankMap[pZone]) ? zoneRankMap[pZone] : 0;
        if (pRank >= requiredRank) metUsers.push(participantId);
        });
        
        const satisfied = metUsers.length >= challenge.requiredCount;
      const missingUsers = activeParticipants.filter((participantId) => !metUsers.includes(participantId));
        
        return {
            satisfied,
            metUsers,
            missingUsers,
            actualCount: metUsers.length,
            zoneLabel: zoneInfo?.name || zoneId
        };
    };

    // --- Main Logic ---
    const isGreenPhase = this.phase === 'green';
    const forceStartRequest = this.challengeState.forceStartRequest;

    if (this.challengeState.activeChallenge) {
      if (forceStartRequest) {
        this.challengeState.activeChallenge = null;
        this.challengeState.videoLocked = false;
      } else {
        const challenge = this.challengeState.activeChallenge;
        if (challenge.status === 'pending') {
          if (!isGreenPhase) {
            if (!challenge.pausedAt) {
              challenge.pausedAt = now;
              challenge.pausedRemainingMs = Math.max(0, challenge.expiresAt - now);
            }
            challenge.summary = buildChallengeSummary(challenge);
            this._schedulePulse(500);
            return;
          }

          if (challenge.pausedAt) {
            const resumeRemainingMs = Number.isFinite(challenge.pausedRemainingMs)
              ? Math.max(0, challenge.pausedRemainingMs)
              : Math.max(0, challenge.expiresAt - challenge.pausedAt);
            challenge.expiresAt = now + resumeRemainingMs;
            challenge.pausedAt = null;
            challenge.pausedRemainingMs = null;
          }

          challenge.summary = buildChallengeSummary(challenge);

          if (challenge.summary?.satisfied) {
            challenge.status = 'success';
            challenge.completedAt = now;
            challenge.pausedAt = null;
            challenge.pausedRemainingMs = null;
            challenge.summary = buildChallengeSummary(challenge);
            if (!challenge.historyRecorded) {
              this.challengeState.challengeHistory.push({
                id: challenge.id,
                status: 'success',
                zone: challenge.zone,
                zoneLabel: challenge.summary?.zoneLabel || null,
                rule: challenge.rule,
                requiredCount: challenge.requiredCount,
                startedAt: challenge.startedAt,
                completedAt: challenge.completedAt,
                selectionLabel: challenge.selectionLabel || null
              });
              if (this.challengeState.challengeHistory.length > 20) {
                this.challengeState.challengeHistory.splice(0, this.challengeState.challengeHistory.length - 20);
              }
              challenge.historyRecorded = true;
            }
            this.challengeState.videoLocked = false;
            const nextDelay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
            queueNextChallenge(nextDelay);
            this._schedulePulse(50);
            return;
          } else if (now >= challenge.expiresAt) {
            challenge.status = 'failed';
            challenge.completedAt = null;
            challenge.pausedAt = null;
            challenge.pausedRemainingMs = null;
            challenge.summary = buildChallengeSummary(challenge);
            this.challengeState.videoLocked = true;
            this.challengeState.nextChallenge = null;
            this.challengeState.nextChallengeAt = null;
            this.challengeState.nextChallengeRemainingMs = null;
            if (this.timers.governance) {
              clearTimeout(this.timers.governance);
              this.timers.governance = null;
            }
            this.meta.deadline = null;
            this.meta.gracePeriodTotal = null;
            this._setPhase('red');
            this._schedulePulse(500);
            return;
          } else {
            this._schedulePulse(Math.max(50, challenge.expiresAt - now));
            return;
          }
        } else {
          // Challenge is success or failed
          challenge.pausedAt = null;
          challenge.pausedRemainingMs = null;
          challenge.summary = buildChallengeSummary(challenge);

          if (challenge.status === 'success') {
            const completedAt = challenge.completedAt || now;
            const remainingFlash = Math.max(0, 2000 - (now - completedAt));
            if (remainingFlash > 0) {
              this._schedulePulse(Math.max(50, remainingFlash));
            } else {
              this.challengeState.activeChallenge = null;
              this._schedulePulse(50);
            }
            return;
          }

          if (challenge.status === 'failed') {
            if (challenge.summary?.satisfied) {
              challenge.status = 'success';
              challenge.completedAt = now;
              challenge.summary = buildChallengeSummary(challenge);
              this.challengeState.videoLocked = false;
              if (!challenge.historyRecorded) {
                this.challengeState.challengeHistory.push({
                  id: challenge.id,
                  status: 'success',
                  zone: challenge.zone,
                  zoneLabel: challenge.summary?.zoneLabel || null,
                  rule: challenge.rule,
                  requiredCount: challenge.requiredCount,
                  startedAt: challenge.startedAt,
                  completedAt: challenge.completedAt,
                  selectionLabel: challenge.selectionLabel || null
                });
                if (this.challengeState.challengeHistory.length > 20) {
                  this.challengeState.challengeHistory.splice(0, this.challengeState.challengeHistory.length - 20);
                }
                challenge.historyRecorded = true;
              }
              const nextDelay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
              queueNextChallenge(nextDelay);
              this._schedulePulse(50);
            } else {
              this.challengeState.videoLocked = true;
              this._schedulePulse(500);
            }
            return;
          }

          if (this.challengeState.nextChallengeAt != null) {
            ensureNextChallengePreview({});
            if (now >= this.challengeState.nextChallengeAt) {
              this.challengeState.activeChallenge = null;
              this.challengeState.nextChallengeAt = null;
              if (!startChallenge()) {
                const fallbackDelay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
                queueNextChallenge(fallbackDelay);
              }
            } else {
              this._schedulePulse(Math.max(50, this.challengeState.nextChallengeAt - now));
            }
          } else {
            this.challengeState.activeChallenge = null;
            this._schedulePulse(null);
          }
        }
        return;
      }
    }

    const shouldForceStart = Boolean(forceStartRequest);
    const forcePreviewPayload = shouldForceStart && forceStartRequest?.payload && typeof forceStartRequest.payload === 'object'
      ? { ...forceStartRequest.payload }
      : null;

    if (!isGreenPhase && !shouldForceStart) {
      if (Number.isFinite(this.challengeState.nextChallengeAt)) {
        this.challengeState.nextChallengeRemainingMs = Math.max(0, this.challengeState.nextChallengeAt - now);
        this.challengeState.nextChallengeAt = null;
      }
      this._schedulePulse(null);
      return;
    }

    if (shouldForceStart) {
      const started = startChallenge({ previewOverride: forcePreviewPayload, forced: true });
      if (!started && !isGreenPhase) {
        this._schedulePulse(1000);
      }
      return;
    }
    
    // If we are here, we are in green phase and no active challenge
    if (this.challengeState.nextChallengeAt == null) {
        const delay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
        queueNextChallenge(delay);
    } else {
        ensureNextChallengePreview({});
        if (now >= this.challengeState.nextChallengeAt) {
            if (!startChallenge()) {
                const delay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
                queueNextChallenge(delay);
            }
        } else {
            this._schedulePulse(Math.max(50, this.challengeState.nextChallengeAt - now));
        }
    }

  }
  
  // Public method to trigger a challenge manually
  triggerChallenge(payload) {
      this.challengeState.forceStartRequest = {
          requestedAt: Date.now(),
          payload: payload ? { ...payload } : null
      };
      this._triggerPulse();
  }
}
