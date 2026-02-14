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
  const noParticipantReqs = []; // Requirements without specific missing users (e.g. pre-populated)

  list.forEach((req, index) => {
    const missing = Array.isArray(req?.missingUsers) ? req.missingUsers.filter(Boolean) : [];
    if (!missing.length) {
      // Pass through requirements with no missingUsers (governance pending/pre-populated state)
      noParticipantReqs.push(req);
      return;
    }

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

  // Include requirements without specific participants (only if no participant-specific ones exist)
  if (grouped.size === 0 && noParticipantReqs.length > 0) {
    noParticipantReqs.forEach((req) => {
      const key = buildRequirementKey(req);
      if (!grouped.has(key)) {
        grouped.set(key, { ...req });
      }
    });
  }

  return Array.from(grouped.values());
};

export class GovernanceEngine {
  constructor(session = null) {
    this.session = session;  // Reference to FitnessSession for direct roster access
    this.config = {};
    this.policies = [];
    this.media = null;
    this.phase = 'pending'; // pending, unlocked, warning, locked
    this.pulse = 0;
    this._zoneChangeDebounceTimer = null;

    // Hysteresis: require satisfaction for minimum duration before unlocking
    // This prevents rapid phase cycling when HR hovers around threshold
    this._hysteresisMs = 500;

    this.meta = {
      satisfiedOnce: false,
      satisfiedSince: null,  // Timestamp when requirements first became satisfied
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

    // Production logging: track zone changes and warning duration
    this._previousUserZoneMap = {};
    this._warningStartTime = null;
    this._lockStartTime = null;

    // Expose governance state globally for cross-component correlation
    this._updateGlobalState();

    // Timer pause state for playback stall coordination
    this._timersPaused = false;
    this._pausedAt = null;
    this._remainingMs = null;
  }

  /**
   * Get zone info with normalized key lookup
   * @param {string} zoneId - Raw zone ID (will be normalized)
   * @returns {Object|null} Zone info object or null
   */
  _getZoneInfo(zoneId) {
    if (!zoneId) return null;
    const normalized = normalizeZoneId(zoneId);
    return this._latestInputs?.zoneInfoMap?.[normalized] || null;
  }

  /**
   * Get zone rank with normalized key lookup
   * @param {string} zoneId - Raw zone ID (will be normalized)
   * @returns {number|null} Zone rank or null
   */
  _getZoneRank(zoneId) {
    if (!zoneId) return null;
    const normalized = normalizeZoneId(zoneId);
    const rank = this._latestInputs?.zoneRankMap?.[normalized];
    return Number.isFinite(rank) ? rank : null;
  }

  /**
   * Update global window state for cross-component logging correlation
   * Uses getters for warningDuration/lockDuration so they're calculated fresh when accessed
   */
  _updateGlobalState() {
    if (typeof window !== 'undefined') {
      const self = this;
      window.__fitnessGovernance = {
        phase: this.phase,
        // Use getter so duration is calculated at access time, not at update time
        get warningDuration() {
          return self._warningStartTime ? Date.now() - self._warningStartTime : 0;
        },
        get lockDuration() {
          return self._lockStartTime ? Date.now() - self._lockStartTime : 0;
        },
        activeChallenge: this.challengeState?.activeChallenge?.id || null,
        videoLocked: this.challengeState?.videoLocked
          || (this._mediaIsGoverned() && this.phase !== 'unlocked' && this.phase !== 'warning'),
        mediaId: this.media?.id || null,
        // Expose internal state for test diagnostics
        satisfiedOnce: this.meta?.satisfiedOnce || false,
        userZoneMap: { ...(this._latestInputs?.userZoneMap || {}) },
        activeParticipants: [...(this._latestInputs?.activeParticipants || [])],
        zoneRankMap: { ...(this._latestInputs?.zoneRankMap || {}) }
      };
    }
  }

  /**
   * Detect and log zone changes for participants
   */
  _logZoneChanges(userZoneMap, zoneInfoMap) {
    const logger = getLogger();
    const now = Date.now();
    let hasZoneChange = false;

    for (const [userId, newZone] of Object.entries(userZoneMap)) {
      const prevZone = this._previousUserZoneMap[userId];
      if (prevZone !== newZone && prevZone !== undefined) {
        hasZoneChange = true;
        // Get roster entry for HR data
        const rosterEntry = this.session?.roster?.find(
          e => (e.id || e.profileId) === userId
        );
        const hr = Number.isFinite(rosterEntry?.heartRate) ? rosterEntry.heartRate : null;
        const hrPercent = Number.isFinite(rosterEntry?.hrPercent) ? rosterEntry.hrPercent : null;

        logger.sampled('governance.user_zone_change', {
          oderId: userId,
          odeName: rosterEntry?.name || rosterEntry?.displayName || userId,
          fromZone: prevZone || 'none',
          toZone: newZone || 'none',
          fromZoneLabel: this._getZoneInfo(prevZone)?.name || prevZone,
          toZoneLabel: this._getZoneInfo(newZone)?.name || newZone,
          hr,
          hrPercent,
          governancePhase: this.phase,
          mediaId: this.media?.id
        }, { maxPerMinute: 30 });

        // Trigger reactive evaluation for faster zone change response
        this.notifyZoneChange(userId, { fromZone: prevZone, toZone: newZone });
      }
    }

    // Update previous map
    this._previousUserZoneMap = { ...userZoneMap };
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
    const zoneInfo = this._getZoneInfo(activeChallenge.zone);
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
    const userZoneMap = { ...(payload.userZoneMap || {}) };
    const zoneInfoMap = { ...(payload.zoneInfoMap || {}) };

    // Log zone changes before updating latestInputs
    this._logZoneChanges(userZoneMap, zoneInfoMap);

    this._latestInputs = {
      activeParticipants,
      userZoneMap,
      zoneRankMap: { ...(payload.zoneRankMap || {}) },
      zoneInfoMap,
      totalCount: Number.isFinite(payload.totalCount) ? payload.totalCount : activeParticipants.length
    };
    this._lastEvaluationTs = Date.now();

    // Update global state on each evaluation
    this._updateGlobalState();
  }

  configure(config, policies, { subscribeToAppEvent } = {}) {
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

    // Seed _latestInputs with zone maps from config param or session snapshot
    // This ensures fallbacks work even on first evaluate() call
    // Must happen BEFORE initial evaluation so zone labels are available
    const zoneConfigSource = config.zoneConfig || this.session?.snapshot?.zoneConfig || [];
    if (zoneConfigSource.length > 0) {
      const zoneRankMap = {};
      const zoneInfoMap = {};
      zoneConfigSource.forEach((z, idx) => {
        if (!z || z.id == null) return;
        const zid = normalizeZoneId(z.id);
        if (!zid) return;
        zoneRankMap[zid] = idx;
        zoneInfoMap[zid] = {
          id: zid,
          name: z.name || String(z.id),
          color: z.color || null
        };
      });
      this._latestInputs.zoneRankMap = zoneRankMap;
      this._latestInputs.zoneInfoMap = zoneInfoMap;

      getLogger().debug('governance.configure.seeded_zone_maps', {
        zoneCount: zoneConfigSource.length,
        zoneIds: Object.keys(zoneInfoMap),
        source: config.zoneConfig ? 'config_param' : 'snapshot'
      });
    }

    // Setup playback event subscription for timer coordination
    if (subscribeToAppEvent) {
      this._setupPlaybackSubscription(subscribeToAppEvent);
    }

    // Initial evaluation from current state
    this.evaluate();
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
    this._invalidateStateCache();
    // Re-evaluate when governed media is set so phase transitions from null→pending
    if (media && this._mediaIsGoverned()) {
      this._triggerPulse();
    }
  }

  setCallbacks({ onPhaseChange, onPulse }) {
    this.callbacks.onPhaseChange = onPhaseChange;
    this.callbacks.onPulse = onPulse;
  }

  _setPhase(newPhase) {
    if (this.phase !== newPhase) {
      const oldPhase = this.phase;
      const now = Date.now();
      this.phase = newPhase;
      this._invalidateStateCache(); // Invalidate cache on phase change

      // Track warning/lock timing for production correlation
      if (newPhase === 'warning' && oldPhase !== 'warning') {
        this._warningStartTime = now;
      } else if (newPhase !== 'warning') {
        this._warningStartTime = null;
      }

      if (newPhase === 'locked' && oldPhase !== 'locked') {
        this._lockStartTime = now;
      } else if (newPhase !== 'locked') {
        this._lockStartTime = null;
      }

      const logger = getLogger();

      // Skip logging for null-to-null (no-op) transitions
      if (oldPhase !== null || newPhase !== null) {
        // Include requirement summary for debugging lock screen label issues
        const firstReq = this.requirementSummary?.requirements?.[0];
        logger.sampled('governance.phase_change', {
          from: oldPhase,
          to: newPhase,
          mediaId: this.media?.id,
          deadline: this.meta?.deadline,
          satisfiedOnce: this.meta?.satisfiedOnce,
          requirementCount: this.requirementSummary?.requirements?.length || 0,
          firstRequirement: firstReq ? {
            zone: firstReq.zone,
            zoneLabel: firstReq.zoneLabel,
            satisfied: firstReq.satisfied
          } : null
        }, { maxPerMinute: 30 });
      }

      // Enhanced production logging for specific transitions
      if (newPhase === 'warning' && oldPhase !== 'warning') {
        const participantsBelowThreshold = this._getParticipantsBelowThreshold();
        logger.info('governance.warning_started', {
          mediaId: this.media?.id,
          deadline: this.meta?.deadline,
          gracePeriodTotal: this.meta?.gracePeriodTotal,
          participantsBelowThreshold,
          participantCount: this._latestInputs.activeParticipants?.length || 0,
          requirements: this.requirementSummary?.requirements?.slice(0, 5) // Limit for log size
        });
      }

      if (newPhase === 'locked') {
        const timeSinceWarning = oldPhase === 'warning' && this._warningStartTime
          ? now - this._warningStartTime
          : null;
        logger.info('governance.lock_triggered', {
          mediaId: this.media?.id,
          reason: this.challengeState?.activeChallenge?.status === 'failed' ? 'challenge_failed' : 'requirements_not_met',
          timeSinceWarningMs: timeSinceWarning,
          participantStates: this._getParticipantStates(),
          challengeActive: !!this.challengeState?.activeChallenge,
          challengeId: this.challengeState?.activeChallenge?.id || null
        });
      }

      // Update global state for cross-component correlation
      this._updateGlobalState();

      if (this.callbacks.onPhaseChange) {
        this.callbacks.onPhaseChange(newPhase);
      }
    }
  }

  /**
   * Get participants below threshold for warning logging
   */
  _getParticipantsBelowThreshold() {
    const requirements = this.requirementSummary?.requirements || [];
    const below = [];
    for (const req of requirements) {
      if (Array.isArray(req.missingUsers)) {
        below.push(...req.missingUsers.map(name => ({
          name,
          zone: req.zone || req.zoneLabel,
          required: req.requiredCount
        })));
      }
    }
    return below.slice(0, 10); // Limit for log size
  }

  /**
   * Get participant states for lock logging
   */
  _getParticipantStates() {
    const userZoneMap = this._latestInputs.userZoneMap || {};
    const zoneInfoMap = this._latestInputs.zoneInfoMap || {};
    const states = [];
    for (const [userId, zoneId] of Object.entries(userZoneMap)) {
      const rosterEntry = this.session?.roster?.find(
        e => (e.id || e.profileId) === userId
      );
      states.push({
        id: userId,
        name: rosterEntry?.name || rosterEntry?.displayName || userId,
        zone: zoneId,
        zoneLabel: this._getZoneInfo(zoneId)?.name || zoneId,
        hr: Number.isFinite(rosterEntry?.heartRate) ? rosterEntry.heartRate : null
      });
    }
    return states.slice(0, 10); // Limit for log size
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

  /**
   * @deprecated Governance is now tick-driven via ZoneProfileStore.
   * This method exists only for backwards compatibility if called directly.
   */
  _evaluateFromTreasureBox() {
    this.evaluate();
  }

  /**
   * Notify governance of a zone change for immediate evaluation.
   * Debounces rapid changes to prevent thrashing.
   *
   * @param {string} userId - User whose zone changed
   * @param {Object} change - { fromZone, toZone }
   */
  notifyZoneChange(userId, change = {}) {
    const { fromZone, toZone } = change;

    getLogger().debug('governance.zone_change_notification', {
      userId,
      fromZone,
      toZone,
      currentPhase: this.phase
    });

    if (this._zoneChangeDebounceTimer) {
      clearTimeout(this._zoneChangeDebounceTimer);
    }

    this._zoneChangeDebounceTimer = setTimeout(() => {
      this._zoneChangeDebounceTimer = null;
      this.evaluate();
    }, 100);
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

  /**
   * Pause governance timers during playback stalls.
   * Preserves remaining time so countdown can resume accurately.
   */
  _pauseTimers() {
    if (this._timersPaused) return;
    this._timersPaused = true;
    this._pausedAt = Date.now();

    if (this.meta?.deadline) {
      this._remainingMs = Math.max(0, this.meta.deadline - Date.now());
    }

    getLogger().info('governance.timers_paused', {
      phase: this.phase,
      remainingMs: this._remainingMs,
      mediaId: this.media?.id
    });
  }

  /**
   * Resume governance timers after playback recovers.
   * Restores deadline based on preserved remaining time.
   */
  _resumeTimers() {
    if (!this._timersPaused) return;
    this._timersPaused = false;

    if (this._remainingMs > 0 && this.meta) {
      this.meta.deadline = Date.now() + this._remainingMs;
    }

    const pauseDuration = this._pausedAt ? Date.now() - this._pausedAt : 0;
    this._pausedAt = null;

    getLogger().info('governance.timers_resumed', {
      phase: this.phase,
      newDeadline: this.meta?.deadline,
      pauseDurationMs: pauseDuration,
      mediaId: this.media?.id
    });
  }

  /**
   * Subscribe to playback events for timer coordination.
   * Call during configure() when subscribeToAppEvent is available.
   */
  _setupPlaybackSubscription(subscribeToAppEvent) {
    if (!subscribeToAppEvent || typeof subscribeToAppEvent !== 'function') {
      return;
    }

    // Clean up any existing subscriptions
    this._cleanupPlaybackSubscription();

    this._unsubscribeStalled = subscribeToAppEvent('playback:stalled', () => {
      this._pauseTimers();
    });

    this._unsubscribeRecovered = subscribeToAppEvent('playback:recovered', () => {
      this._resumeTimers();
    });

    getLogger().debug('governance.playback_subscription_setup');
  }

  /**
   * Clean up playback event subscriptions.
   */
  _cleanupPlaybackSubscription() {
    if (typeof this._unsubscribeStalled === 'function') {
      this._unsubscribeStalled();
      this._unsubscribeStalled = null;
    }
    if (typeof this._unsubscribeRecovered === 'function') {
      this._unsubscribeRecovered();
      this._unsubscribeRecovered = null;
    }
  }

  reset() {
    this._clearTimers();
    this._cleanupPlaybackSubscription();
    if (this._zoneChangeDebounceTimer) {
      clearTimeout(this._zoneChangeDebounceTimer);
      this._zoneChangeDebounceTimer = null;
    }
    this.meta = {
      satisfiedOnce: false,
      satisfiedSince: null,
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
    this._setPhase('pending');
    this._latestInputs = {
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: {},
      zoneInfoMap: {},
      totalCount: 0
    };
    this._lastEvaluationTs = null;
    this._timersPaused = false;
    this._pausedAt = null;
    this._remainingMs = null;

    // State caching for performance - throttle recomputation to 200ms
    this._stateCache = null;
    this._stateCacheTs = 0;
    this._stateCacheThrottleMs = 200;
    this._stateVersion = 0; // Incremented on evaluate() to invalidate cache
    this._stateCacheVersion = -1; // Track which version the cache represents
  }

  /**
   * Reset to idle state (null phase) without double phase transitions.
   * Use this instead of reset() + _setPhase(null) to avoid triggering
   * two separate phase change callbacks.
   *
   * Note: Preserves zoneRankMap and zoneInfoMap that were seeded during configure()
   * to ensure zone label fallbacks work even when no media/participants are present.
   */
  _resetToIdle() {
    this._clearTimers();
    this._cleanupPlaybackSubscription();
    if (this._zoneChangeDebounceTimer) {
      clearTimeout(this._zoneChangeDebounceTimer);
      this._zoneChangeDebounceTimer = null;
    }
    this.meta = {
      satisfiedOnce: false,
      satisfiedSince: null,
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
    // Preserve zone maps that were seeded during configure()
    const preservedZoneRankMap = this._latestInputs?.zoneRankMap || {};
    const preservedZoneInfoMap = this._latestInputs?.zoneInfoMap || {};
    this._latestInputs = {
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: preservedZoneRankMap,
      zoneInfoMap: preservedZoneInfoMap,
      totalCount: 0
    };
    this._lastEvaluationTs = null;
    this._timersPaused = false;
    this._pausedAt = null;
    this._remainingMs = null;
    this._stateCache = null;
    this._stateCacheTs = 0;
    this._stateCacheThrottleMs = 200;
    this._stateVersion = 0;
    this._stateCacheVersion = -1;

    // Only set phase if actually changing to avoid unnecessary callbacks
    if (this.phase !== null) {
      this._setPhase(null);
    }
  }

  /**
   * Full cleanup for component unmount.
   */
  destroy() {
    this.reset();
    this._cleanupPlaybackSubscription();
  }

  get state() {
    return this._getCachedState();
  }

  /**
   * Returns cached state if still valid, otherwise recomputes.
   * Cache is invalidated after throttle period OR when evaluate() is called.
   */
  _getCachedState() {
    const now = Date.now();
    const cacheAge = now - this._stateCacheTs;
    const watcherCount = Array.isArray(this._latestInputs.activeParticipants)
      ? this._latestInputs.activeParticipants.length
      : 0;
    const cachedWatcherCount = Array.isArray(this._stateCache?.watchers)
      ? this._stateCache.watchers.length
      : 0;
    if (watcherCount !== cachedWatcherCount) {
      this._stateVersion += 1; // Invalidate cache when watcher count changes
    }

    const cacheValid = this._stateCache
      && cacheAge < this._stateCacheThrottleMs
      && this._stateCacheVersion === this._stateVersion;
    
    if (cacheValid) {
      // Components now compute countdown from deadline timestamp themselves
      return this._stateCache;
    }
    
    // Recompute and cache
    this._stateCache = this._composeState();
    this._stateCacheTs = now;
    this._stateCacheVersion = this._stateVersion;
    return this._stateCache;
  }

  /**
   * Invalidate state cache - call this when significant state changes occur
   */
  _invalidateStateCache() {
    this._stateVersion++;
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
          zoneLabel: challengeSnapshot.zoneLabel || challengeSnapshot.zone || null,
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
          severity: this._getZoneRank(challengeSnapshot.zone)
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
      severity: entry.severity != null ? entry.severity : this._getZoneRank(entry.targetZoneId)
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
      deadline: this.meta?.deadline || null,
      gracePeriodTotal,
      videoLocked: !!(this.challengeState && this.challengeState.videoLocked)
        || (this._mediaIsGoverned() && this.phase !== 'unlocked' && this.phase !== 'warning'),
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
    // Skip evaluation while timers are paused (playback stalled)
    if (this._timersPaused) {
      getLogger().debug('governance.evaluate.skipped_paused', { phase: this.phase });
      return;
    }

    const now = Date.now();
    const hasGovernanceRules = (this._governedLabelSet.size + this._governedTypeSet.size) > 0;

    // If no data passed in, read participant list from session.roster
    // Zone data comes exclusively from ZoneProfileStore (below)
    if (!activeParticipants && this.session?.roster) {
      const roster = this.session.roster || [];
      activeParticipants = roster
        .filter((entry) => entry.isActive !== false && (entry.id || entry.profileId))
        .map((entry) => entry.id || entry.profileId);

      userZoneMap = {};
      totalCount = activeParticipants.length;
    }

    // BUGFIX: Fall back to previous zoneRankMap/zoneInfoMap when not provided
    // This fixes internal _triggerPulse() calls which don't pass these maps
    let usedZoneRankMapFallback = false;
    let usedZoneInfoMapFallback = false;
    if (!zoneRankMap && this._latestInputs?.zoneRankMap) {
      zoneRankMap = this._latestInputs.zoneRankMap;
      usedZoneRankMapFallback = true;
    }
    if (!zoneInfoMap && this._latestInputs?.zoneInfoMap) {
      zoneInfoMap = this._latestInputs.zoneInfoMap;
      usedZoneInfoMapFallback = true;
    }
    // DIAGNOSTIC: Log when fallback is used (helps diagnose race conditions)
    if (usedZoneRankMapFallback || usedZoneInfoMapFallback) {
      getLogger().debug('governance.evaluate.used_cached_zone_maps', {
        usedZoneRankMapFallback,
        usedZoneInfoMapFallback,
        cachedZoneRankMapSize: Object.keys(zoneRankMap || {}).length,
        cachedZoneInfoMapSize: Object.keys(zoneInfoMap || {}).length
      });
    }

    // Ensure defaults (these now only apply if _latestInputs also didn't have them)
    activeParticipants = activeParticipants || [];
    userZoneMap = userZoneMap || {};
    zoneRankMap = zoneRankMap || {};
    zoneInfoMap = zoneInfoMap || {};
    totalCount = totalCount || activeParticipants.length;

    // DIAGNOSTIC: Warn if zoneRankMap is empty but we have participants
    // This was the exact bug condition - zones not configured, causing false warnings
    if (activeParticipants.length > 0 && Object.keys(zoneRankMap).length === 0) {
      getLogger().warn('governance.evaluate.empty_zoneRankMap', {
        activeParticipantCount: activeParticipants.length,
        phase: this.phase,
        hasGovernanceRules,
        usedZoneRankMapFallback: usedZoneRankMapFallback || false
      });
    }

    // Populate userZoneMap exclusively from ZoneProfileStore (synchronously synced on every HR update)
    if (this.session?.zoneProfileStore) {
      activeParticipants.forEach((participantId) => {
        const profile = this.session.zoneProfileStore.getProfile(participantId);
        if (profile?.currentZoneId) {
          userZoneMap[participantId] = profile.currentZoneId.toLowerCase();
        } else if (participantId) {
          getLogger().debug('governance.evaluate.no_zone_profile', {
            participantId,
            hasProfile: !!profile,
            currentZoneId: profile?.currentZoneId ?? null
          });
        }
      });
    }

    // Capture zone maps early so _getZoneRank()/_getZoneInfo() work during evaluation
    // (Previously stored only after evaluation, causing first-call misses)
    if (zoneRankMap && Object.keys(zoneRankMap).length > 0) {
      this._latestInputs.zoneRankMap = zoneRankMap;
    }
    if (zoneInfoMap && Object.keys(zoneInfoMap).length > 0) {
      this._latestInputs.zoneInfoMap = zoneInfoMap;
    }

    // 1. Check if media is governed
    if (!this.media || !this.media.id || !hasGovernanceRules) {
      getLogger().warn('governance.evaluate.no_media_or_rules', {
        hasMedia: !!(this.media && this.media.id),
        hasGovernanceRules
      });
      this._resetToIdle();
      return;
    }

    const hasGovernedMedia = this._mediaIsGoverned();
    if (!hasGovernedMedia) {
      getLogger().warn('governance.evaluate.media_not_governed', {
        mediaId: this.media?.id
      });
      this._resetToIdle();
      return;
    }

    // 2. Check participants
    if (activeParticipants.length === 0) {
      getLogger().warn('governance.evaluate.no_participants');

      // DIAGNOSTIC: Log if zone maps are empty when pre-populating
      const zoneInfoMapSize = Object.keys(zoneInfoMap || {}).length;
      const zoneRankMapSize = Object.keys(zoneRankMap || {}).length;
      if (zoneInfoMapSize === 0 || zoneRankMapSize === 0) {
        getLogger().warn('governance.evaluate.empty_zone_maps_on_prepopulate', {
          zoneInfoMapSize,
          zoneRankMapSize,
          hasSessionSnapshot: !!this.session?.snapshot?.zoneConfig,
          snapshotZoneCount: this.session?.snapshot?.zoneConfig?.length || 0
        });
      }

      // Don't call reset() here - it clears satisfiedOnce which breaks grace period logic.
      // If user had satisfied requirements before, we want to preserve that so the
      // grace period countdown can continue when participants return with low HR.
      
      // FIX: Pre-populate requirements from policy even without participants.
      // This ensures lock screen shows proper zone labels (e.g., "Active") immediately,
      // rather than falling back to "Target zone" for ~2 seconds until HR data arrives.
      const activePolicy = this._chooseActivePolicy(0);
      if (activePolicy) {
        const baseRequirement = activePolicy.baseRequirement || {};
        const prePopulatedRequirements = this._buildRequirementShell(
          baseRequirement,
          zoneRankMap || {},
          zoneInfoMap || {}
        );

        // Log what we pre-populated for debugging
        if (prePopulatedRequirements.length > 0) {
          const firstReq = prePopulatedRequirements[0];
          getLogger().debug('governance.evaluate.prepopulated_requirements', {
            count: prePopulatedRequirements.length,
            firstZone: firstReq?.zone,
            firstZoneLabel: firstReq?.zoneLabel,
            hasProperLabel: firstReq?.zoneLabel !== firstReq?.zone
          });
        }

        this.requirementSummary = {
          policyId: activePolicy.id,
          targetUserCount: activePolicy.minParticipants,
          requirements: prePopulatedRequirements,
          activeCount: 0
        };
      }
      
      this._clearTimers();
      this._setPhase('pending');
      // Capture latest inputs so UI (watchers) reflects the current empty state
      this._latestInputs = {
        activeParticipants: [],
        userZoneMap: userZoneMap || {},
        zoneRankMap: zoneRankMap || {},
        zoneInfoMap: zoneInfoMap || {},
        totalCount: totalCount || 0
      };
      this._invalidateStateCache();
      // Note: No polling needed here - governance is now reactive via TreasureBox callback.
      // When a participant starts exercising, TreasureBox notifies us immediately.
      return;
    }

    // 3. Choose Policy
    const activePolicy = this._chooseActivePolicy(totalCount);
    if (!activePolicy) {
      this.reset();
      this._setPhase('pending');
      return;
    }

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
      this.meta.satisfiedSince = null;
      this._setPhase('locked');
    } else if (allSatisfied) {
      // Hysteresis: require satisfaction to persist for minimum duration
      // This prevents rapid phase cycling when HR hovers around threshold
      if (!this.meta.satisfiedSince) {
        this.meta.satisfiedSince = now;
      }
      const satisfiedDuration = now - this.meta.satisfiedSince;
      if (satisfiedDuration >= this._hysteresisMs) {
        // Satisfied long enough - transition to unlocked
        this.meta.satisfiedOnce = true;
        this.meta.deadline = null;
        this.meta.gracePeriodTotal = null;
        this._setPhase('unlocked');
      } else {
        // Not satisfied long enough yet - stay in current phase, schedule re-check
        const remainingHysteresis = this._hysteresisMs - satisfiedDuration;
        if (this.timers.governance) clearTimeout(this.timers.governance);
        this.timers.governance = setTimeout(() => this._triggerPulse(), remainingHysteresis);
        // Don't change phase yet - keep warning/pending until hysteresis passes
      }
    } else if (!this.meta.satisfiedOnce) {
      // Not satisfied - reset hysteresis tracking
      this.meta.satisfiedSince = null;
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('pending');
    } else {
      // Grace period logic - requirements not satisfied, reset hysteresis
      this.meta.satisfiedSince = null;
      let graceSeconds = baseGraceSeconds;
      if (!Number.isFinite(graceSeconds) || graceSeconds <= 0) {
        if (this.timers.governance) clearTimeout(this.timers.governance);
        this.meta.deadline = null;
        this.meta.gracePeriodTotal = null;
        this._setPhase('locked');
      } else {
        if (!Number.isFinite(this.meta.deadline) && this.phase !== 'locked') {
          this.meta.deadline = now + graceSeconds * 1000;
          this.meta.gracePeriodTotal = graceSeconds;
        }
        
        if (!Number.isFinite(this.meta.deadline)) {
           if (this.timers.governance) clearTimeout(this.timers.governance);
           this.meta.gracePeriodTotal = null;
           this._setPhase('locked');
        } else {
          const remainingMs = this.meta.deadline - now;
          if (remainingMs <= 0) {
            if (this.timers.governance) clearTimeout(this.timers.governance);
            this.meta.deadline = null;
            this.meta.gracePeriodTotal = null;
            this._setPhase('locked');
          } else {
            if (this.timers.governance) clearTimeout(this.timers.governance);
            this.timers.governance = setTimeout(() => this._triggerPulse(), remainingMs);
            this._setPhase('warning');
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
    
    // Invalidate state cache after evaluation completes
    this._invalidateStateCache();
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

  /**
   * Build requirement structure from policy config WITHOUT participant data.
   * Used to pre-populate lock screen with proper zone labels before HR arrives.
   * 
   * @param {Object} requirementMap - Policy's baseRequirement map (zone -> rule)
   * @param {Object} zoneRankMap - Map of zoneId -> rank
   * @param {Object} zoneInfoMap - Map of zoneId -> zone metadata (name, color, etc.)
   * @returns {Array} - Array of requirement objects with zone labels but no participant data
   */
  _buildRequirementShell(requirementMap, zoneRankMap, zoneInfoMap) {
    if (!requirementMap || typeof requirementMap !== 'object') {
      return [];
    }
    const entries = Object.entries(requirementMap).filter(([key]) => key !== 'grace_period_seconds');
    if (!entries.length) {
      return [];
    }

    return entries.map(([zoneKey, rule]) => {
      const zoneId = zoneKey ? String(zoneKey).toLowerCase() : null;
      if (!zoneId) return null;

      const requiredRank = this._getZoneRank(zoneId);
      const zoneInfo = this._getZoneInfo(zoneId);

      return {
        zone: zoneId,
        zoneLabel: zoneInfo?.name || zoneId,
        targetZoneId: zoneId,
        participantKey: null,
        severity: Number.isFinite(requiredRank) ? requiredRank : null,
        rule,
        ruleLabel: this._describeRule(rule, 0),
        requiredCount: null, // Unknown until we have participant count
        actualCount: 0,
        metUsers: [],
        missingUsers: [], // Empty - no participants to be missing yet
        satisfied: false
      };
    }).filter(Boolean);
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
    // BUG FIX: If we have requirement entries but produced no summaries, zoneRankMap may be
    // incomplete (race condition). Treat as unsatisfied to prevent accidentally clearing
    // an active grace period countdown.
    if (entries.length > 0 && summaries.length === 0) {
      return { summaries: [], allSatisfied: false };
    }
    return { summaries, allSatisfied };
  }

  _evaluateZoneRequirement(zoneKey, rule, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount) {
    const zoneId = zoneKey ? String(zoneKey).toLowerCase() : null;
    if (!zoneId) return null;
    const requiredRank = this._getZoneRank(zoneId);
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
      const participantRank = this._getZoneRank(participantZoneId) ?? 0;
      if (participantRank >= requiredRank) {
        metUsers.push(participantId);
      }
    });

    const requiredCount = this._normalizeRequiredCount(rule, totalCount, activeParticipants);
    const satisfied = metUsers.length >= requiredCount;
    // Missing users should only list non-exempt users, unless satisfied is true (then who cares)
    // But conceptually, an exempt user can be missing but not cause failure.
    // However, if we fail, we only want to "blame" non-exempt users.
    const exemptUsers = (this.config.exemptions || []).map(u => normalizeName(u));
    const missingUsers = activeParticipants.filter((participantId) => 
      !metUsers.includes(participantId) && !exemptUsers.includes(normalizeName(participantId))
    );
    const zoneInfo = this._getZoneInfo(zoneId);

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

  _normalizeRequiredCount(rule, totalCount, activeParticipants = []) {
    // If exemptions are configured, filter the active participants (who are subject to counts)
    let effectiveCount = totalCount;
    if (this.config.exemptions && Array.isArray(this.config.exemptions) && activeParticipants.length > 0) {
      // Exempt users do not count towards the denominator (total number of people required)
      const exemptUsers = this.config.exemptions.map(u => normalizeName(u));
      const subjectParticipants = activeParticipants.filter(p => !exemptUsers.includes(normalizeName(p)));
      effectiveCount = subjectParticipants.length;
    }

    if (typeof rule === 'number' && Number.isFinite(rule)) {
      return Math.min(Math.max(0, Math.round(rule)), effectiveCount);
    }
    if (typeof rule === 'string') {
      const normalized = rule.toLowerCase().trim();
      if (normalized === 'all') return effectiveCount;
      if (normalized === 'majority' || normalized === 'most') {
        return Math.max(1, Math.ceil(effectiveCount * 0.5));
      }
      if (normalized === 'some') {
        return Math.max(1, Math.ceil(effectiveCount * 0.3));
      }
      if (normalized === 'any') {
        return 1;
      }
      const numeric = Number(rule);
      if (Number.isFinite(numeric)) {
        return Math.min(Math.max(0, Math.round(numeric)), effectiveCount);
      }
    }
    return effectiveCount;
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
      const requiredCount = this._normalizeRequiredCount(payload.selection.rule, totalCount, activeParticipants);
      
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
      // Challenges can only trigger in unlocked phase - they pause during warning
      const canTriggerChallenge = this.phase === 'unlocked';

      if (!Number.isFinite(targetTs)) {
        this.challengeState.nextChallenge = null;
        return false;
      }

      if (targetTs <= now && !canTriggerChallenge) {
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
        preview = payload ? assignNextChallengePreview(now, payload) : null;
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
        : this._normalizeRequiredCount(preview.rule, totalCount, activeParticipants);

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
      
      getLogger().info('governance.challenge.started', {
        id: this.challengeState.activeChallenge.id,
        policyId: activePolicy.id,
        zone: this.challengeState.activeChallenge.zone,
        selectionLabel: this.challengeState.activeChallenge.selectionLabel,
        requiredCount: this.challengeState.activeChallenge.requiredCount,
        timeLimitSeconds: this.challengeState.activeChallenge.timeLimitSeconds,
        forced
      });

      this._schedulePulse(Math.max(50, expiresAt - startedAt));
      return true;
    };

    const buildChallengeSummary = (challenge) => {
        if (!challenge) return null;
        const zoneId = challenge.zone;
        const zoneInfo = this._getZoneInfo(zoneId);
        const requiredRank = this._getZoneRank(zoneId) ?? 0;

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
          const pRank = this._getZoneRank(pZone) ?? 0;
          if (pRank >= requiredRank) metUsers.push(participantId);
        });

        // Recompute requiredCount from current roster (not frozen value)
        const liveRequiredCount = this._normalizeRequiredCount(challenge.rule, totalCount, activeParticipants);
        const satisfied = metUsers.length >= liveRequiredCount;

        // Filter exempt users from missingUsers (same logic as _evaluateZoneRequirement)
        const exemptUsers = (this.config.exemptions || []).map(u => normalizeName(u));
        const missingUsers = activeParticipants.filter((participantId) =>
          !metUsers.includes(participantId) && !exemptUsers.includes(normalizeName(participantId))
        );

        return {
            satisfied,
            metUsers,
            missingUsers,
            actualCount: metUsers.length,
            requiredCount: liveRequiredCount,
            zoneLabel: zoneInfo?.name || zoneId
        };
    };

    // --- Main Logic ---
    const isGreenPhase = this.phase === 'unlocked';
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

            getLogger().info('governance.challenge.completed', {
              id: challenge.id,
              zone: challenge.zone,
              durationMs: now - challenge.startedAt,
              participants: activeParticipants.map(uid => ({ userId: uid, zone: userZoneMap[uid] || null }))
            });

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
            
            getLogger().info('governance.challenge.failed', {
              id: challenge.id,
              zone: challenge.zone,
              requiredCount: challenge.requiredCount,
              actualCount: challenge.summary?.actualCount,
              missingUsers: challenge.summary?.missingUsers
            });

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
            this._setPhase('locked');
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
              
              getLogger().info('governance.challenge.recovered', {
                id: challenge.id,
                zone: challenge.zone,
                durationMs: now - challenge.startedAt,
                participants: activeParticipants.map(uid => ({ userId: uid, zone: userZoneMap[uid] || null }))
              });

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

    // Challenges can only trigger in unlocked phase - they pause during warning
    const canTriggerChallenge = isGreenPhase;

    if (!canTriggerChallenge && !shouldForceStart) {
      if (Number.isFinite(this.challengeState.nextChallengeAt)) {
        this.challengeState.nextChallengeRemainingMs = Math.max(0, this.challengeState.nextChallengeAt - now);
        this.challengeState.nextChallengeAt = null;
      }
      this._schedulePulse(null);
      return;
    }

    if (shouldForceStart) {
      const started = startChallenge({ previewOverride: forcePreviewPayload, forced: true });
      if (!started && !canTriggerChallenge) {
        this._schedulePulse(1000);
      }
      return;
    }
    
    // If we are here, we can trigger challenges (unlocked phase) and no active challenge
    if (this.challengeState.nextChallengeAt == null) {
        // Check if we have a paused countdown to resume or trigger
        if (Number.isFinite(this.challengeState.nextChallengeRemainingMs)) {
            if (this.challengeState.nextChallengeRemainingMs > 0) {
                // Resume paused countdown
                this.challengeState.nextChallengeAt = now + this.challengeState.nextChallengeRemainingMs;
                this.challengeState.nextChallengeRemainingMs = null;
                this._schedulePulse(Math.max(50, this.challengeState.nextChallengeAt - now));
            } else {
                // Countdown expired during warning phase - trigger now
                this.challengeState.nextChallengeRemainingMs = null;
                if (!startChallenge()) {
                    const delay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
                    queueNextChallenge(delay);
                }
            }
        } else {
            // Schedule a new challenge
            const delay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
            queueNextChallenge(delay);
        }
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
