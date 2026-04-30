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

// Cycle challenge config helpers (Task 5) ----------------------------------------
// normalizeCycleRange: scalar N -> [N, N], array [a, b] -> [min(a,b), max(a,b)] (finite only), else defaultRange.
const normalizeCycleRange = (value, defaultRange) => {
  if (Array.isArray(value) && value.length >= 2) {
    const a = Number(value[0]);
    const b = Number(value[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return [Math.min(a, b), Math.max(a, b)];
    }
  }
  if (Number.isFinite(Number(value))) {
    const n = Number(value);
    return [n, n];
  }
  return [defaultRange[0], defaultRange[1]];
};

// parseCycleExplicitPhases: snake_case array -> camelCase array; null if not array/empty.
// Drops phases where any numeric field is NaN/non-finite (e.g., `{}` or `{ hi_rpm: 'garbage' }`).
const parseCycleExplicitPhases = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const mapped = arr
    .map((phase) => {
      if (!phase || typeof phase !== 'object') return null;
      return {
        hiRpm: Number(phase.hi_rpm ?? phase.hiRpm),
        loRpm: Number(phase.lo_rpm ?? phase.loRpm),
        rampSeconds: Number(phase.ramp_seconds ?? phase.rampSeconds),
        maintainSeconds: Number(phase.maintain_seconds ?? phase.maintainSeconds)
      };
    })
    .filter(Boolean)
    .filter((p) =>
      Number.isFinite(p.hiRpm)
      && Number.isFinite(p.loRpm)
      && Number.isFinite(p.rampSeconds)
      && Number.isFinite(p.maintainSeconds)
    );
  return mapped.length ? mapped : null;
};

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
  constructor(session = null, options = {}) {
    // Injectable clock and RNG for deterministic testing.
    // Defaults preserve existing behavior (Date.now / Math.random).
    this._now = typeof options.now === 'function' ? options.now : () => Date.now();
    this._random = typeof options.random === 'function' ? options.random : () => Math.random();

    this.session = session;  // Reference to FitnessSession for direct roster access
    this.config = {};
    this.policies = [];
    this.media = null;
    this.phase = 'pending'; // pending, unlocked, warning, locked
    this.pulse = 0;
    this._zoneChangeDebounceTimer = null;

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

    // Per-user cooldown map for cycle challenges. Keys are user IDs; values are
    // expiry timestamps (ms). A user is ineligible to be picked as rider until
    // their stored expiry has passed. Populated on challenge completion/failure.
    this._cycleCooldowns = {};

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
      onPulse: null,
      onStateChange: null
    };

    this._governedLabelSet = new Set();
    this._governedTypeSet = new Set();
    this._latestInputs = {
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: {},
      zoneInfoMap: {},
      totalCount: 0,
      equipmentCadenceMap: {}
    };
    this._lastEvaluationTs = null;

    // Production logging: track zone changes and warning duration
    this._previousUserZoneMap = {};
    this._warningStartTime = null;
    this._lockStartTime = null;
    this._warningCooldownUntil = null;

    // Expose governance state globally for cross-component correlation
    this._updateGlobalState();

    // Timer pause state for playback stall coordination
    this._timersPaused = false;
    this._pausedAt = null;
    this._remainingMs = null;

    // Debounce flag for _invalidateStateCache microtask batching
    this._stateChangePending = false;

    this._lastCycleSig = null;
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
   * Get eligible users (whitelist) for a piece of equipment from the session catalog.
   * Used to determine which participants are allowed to ride a given cycle.
   * @param {string} equipmentId - Equipment identifier (e.g. 'cycle_ace')
   * @returns {string[]} Copy of the eligible_users array, or [] if not found/no list
   */
  _getEligibleUsers(equipmentId) {
    if (!equipmentId) return [];
    const catalog = this.session?._deviceRouter?.getEquipmentCatalog?.() || [];
    const entry = catalog.find(e => e.id === equipmentId);
    if (!entry || !Array.isArray(entry.eligible_users)) return [];
    return [...entry.eligible_users];
  }

  /**
   * Check if a challenge zone is achievable given current participant HR.
   * Used to prevent starting structurally impossible challenges.
   * @param {string} targetZone - Zone the challenge requires
   * @param {string|number} rule - 'all', 'majority', 'any', or a number
   * @param {string[]} activeParticipants - Participant IDs
   * @returns {{feasible: boolean, reason?: string, suggestedZone?: string}}
   */
  _checkChallengeFeasibility(targetZone, rule, activeParticipants) {
    if (!targetZone) return { feasible: true };
    // No participants = challenge is meaningless (don't silently pass through)
    if (!activeParticipants?.length) {
      return { feasible: false, reason: 'No active participants to evaluate' };
    }

    const FEASIBILITY_MARGIN_BPM = 20;
    if (!this.session) return { feasible: true };

    let achievableCount = 0;
    let unresolvedCount = 0;
    for (const pid of activeParticipants) {
      // Use FitnessSession's canonical resolution interface (not direct ZoneProfileStore)
      const profile = this.session.getParticipantProfile?.(pid)
        ?? this.session.zoneProfileStore?.getProfile(pid)
        ?? null;
      if (!profile) {
        // Unresolved participant = NOT achievable (don't assume they can reach the zone)
        unresolvedCount++;
        continue;
      }
      const hr = profile.heartRate ?? 0;
      // Find the min threshold for the target zone from the profile's zone config
      const targetZoneConfig = (profile.zoneConfig || []).find(
        z => normalizeZoneId(z.id || z.name) === normalizeZoneId(targetZone)
      );
      const targetMin = targetZoneConfig?.min ?? null;
      if (targetMin == null) continue; // No zone config for this zone = can't determine, skip
      if ((targetMin - hr) <= FEASIBILITY_MARGIN_BPM) achievableCount++;
    }

    if (unresolvedCount > 0) {
      getLogger().warn('governance.feasibility.unresolved_participants', {
        targetZone, unresolvedCount, total: activeParticipants.length
      });
    }

    const requiredCount = this._normalizeRequiredCount(rule, activeParticipants.length, activeParticipants);
    if (achievableCount < requiredCount) {
      // Try downgrading: hot → warm → active
      const zoneDowngrades = ['fire', 'hot', 'warm', 'active'];
      const targetIdx = zoneDowngrades.indexOf(normalizeZoneId(targetZone));
      if (targetIdx >= 0 && targetIdx < zoneDowngrades.length - 1) {
        const downgrade = zoneDowngrades[targetIdx + 1];
        const downResult = this._checkChallengeFeasibility(downgrade, rule, activeParticipants);
        if (downResult.feasible) {
          return { feasible: false, suggestedZone: downgrade, reason: `${targetZone} not achievable, downgraded to ${downgrade}` };
        }
      }
      return { feasible: false, reason: `Only ${achievableCount}/${requiredCount} within ${FEASIBILITY_MARGIN_BPM} BPM of ${targetZone}` };
    }
    return { feasible: true };
  }

  /**
   * Update global window state for cross-component logging correlation
   * Uses getters for warningDuration/lockDuration so they're calculated fresh when accessed
   */
  _updateGlobalState() {
    if (typeof window !== 'undefined') {
      const self = this;
      const active = this.challengeState?.activeChallenge || null;
      const isCycle = active?.type === 'cycle';
      window.__fitnessGovernance = {
        phase: this.phase,
        get warningDuration() {
          return self._warningStartTime ? self._now() - self._warningStartTime : 0;
        },
        get lockDuration() {
          return self._lockStartTime ? self._now() - self._lockStartTime : 0;
        },
        activeChallenge: active?.id || null,
        activeChallengeZone: active?.zone || null,
        videoLocked: (this.challengeState?.videoLocked || this._mediaIsGoverned())
          && this.phase !== 'unlocked' && this.phase !== 'warning',
        contentId: this.media?.id || null,
        satisfiedOnce: this.meta?.satisfiedOnce || false,
        userZoneMap: { ...(this._latestInputs?.userZoneMap || {}) },
        activeParticipants: [...(this._latestInputs?.activeParticipants || [])],
        zoneRankMap: { ...(this._latestInputs?.zoneRankMap || {}) },
        // Cycle-challenge state — null when no cycle challenge is active.
        // Consumers: sim-panel.html readCycleChallengeInfo(), CycleChallengeOverlay diagnostics.
        activeChallengeType: active?.type || null,
        activeChallengeEquipment: isCycle ? (active.equipment || null) : null,
        cycleState: isCycle ? (active.cycleState || null) : null,
        currentRpm: isCycle ? (active.currentRpm ?? null) : null,
        riderId: isCycle ? ((active.rider?.id ?? active.rider) || null) : null,
        currentPhaseIndex: isCycle ? (active.currentPhaseIndex ?? null) : null,
        totalPhases: isCycle ? (active.totalPhases ?? null) : null,
        phaseProgressPct: isCycle ? (active.phaseProgressPct ?? null) : null
      };
      // Bridge engine-tick cycle state changes to the sim popout via onCycleStateChange.
      const cycleSig = [
        active?.type === 'cycle' ? 'cycle' : 'none',
        active?.cycleState || null,
        active?.currentPhaseIndex ?? null,
        (active?.rider?.id ?? active?.rider) || null
      ].join('|');
      if (cycleSig !== this._lastCycleSig) {
        this._lastCycleSig = cycleSig;
        if (typeof this.onCycleStateChange === 'function') {
          try { this.onCycleStateChange(); } catch (_) {}
        }
      }
    }
  }

  /**
   * Detect and log zone changes for participants
   */
  _logZoneChanges(userZoneMap, zoneInfoMap) {
    const logger = getLogger();
    const now = this._now();
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
          userId: userId,
          userName: rosterEntry?.name || rosterEntry?.displayName || userId,
          fromZone: prevZone || 'none',
          toZone: newZone || 'none',
          fromZoneLabel: this._getZoneInfo(prevZone)?.name || prevZone,
          toZoneLabel: this._getZoneInfo(newZone)?.name || newZone,
          hr,
          hrPercent,
          governancePhase: this.phase,
          contentId: this.media?.id
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

    // Cycle challenge branch: emit cycle-shaped snapshot with rider, phases,
    // ramp/init/phase progress, dim factor, boost info, and swap eligibility.
    if (activeChallenge.type === 'cycle') {
      const phase = activeChallenge.generatedPhases?.[activeChallenge.currentPhaseIndex] || null;
      const cadenceEntry = this._latestInputs?.equipmentCadenceMap?.[activeChallenge.equipment];
      const currentRpm = cadenceEntry?.rpm || 0;

      // Dim factor only applies during maintain when RPM is in [lo, hi) band
      let dimFactor = 0;
      if (activeChallenge.cycleState === 'maintain' && phase
          && currentRpm >= phase.loRpm && currentRpm < phase.hiRpm) {
        dimFactor = (phase.hiRpm - currentRpm) / (phase.hiRpm - phase.loRpm);
      }

      // Reuse the boost helper for consistent behaviour with _evaluateCycleChallenge
      const { multiplier, contributors } = this._computeBoostMultiplier(activeChallenge, {
        activeParticipants: this._latestInputs?.activeParticipants || [],
        userZoneMap: this._latestInputs?.userZoneMap || {}
      });

      // Swap is allowed only during init or the very first ramp (phase 0)
      const swapAllowed = activeChallenge.cycleState === 'init'
        || (activeChallenge.cycleState === 'ramp' && activeChallenge.currentPhaseIndex === 0);

      // Eligible swap targets = equipment whitelist minus current rider minus
      // users still on cooldown
      const swapEligibleUsers = this._getEligibleUsers(activeChallenge.equipment)
        .filter((uid) => {
          if (uid === activeChallenge.rider) return false;
          const until = this._cycleCooldowns?.[uid];
          return !until || until <= now;
        });

      const riderName = this.session?.getParticipantProfile?.(activeChallenge.rider)?.name
        || activeChallenge.rider;

      const phases = Array.isArray(activeChallenge.generatedPhases)
        ? activeChallenge.generatedPhases
        : [];
      const allPhasesProgress = phases.map((p, i) => {
        if (i < activeChallenge.currentPhaseIndex) return 1.0;
        if (i > activeChallenge.currentPhaseIndex) return 0.0;
        const total = (p?.maintainSeconds || 0) * 1000;
        if (!total) return 0;
        return Math.min(1.0, (activeChallenge.phaseProgressMs || 0) / total);
      });

      const phaseProgressPct = phase && phase.maintainSeconds
        ? Math.min(1.0, (activeChallenge.phaseProgressMs || 0) / (phase.maintainSeconds * 1000))
        : 0;

      const rampTotalMs = phase ? (phase.rampSeconds || 0) * 1000 : 0;
      const rampRemainingMs = phase
        ? Math.max(0, rampTotalMs - (activeChallenge.rampElapsedMs || 0))
        : 0;

      const initTotalMs = activeChallenge.initTotalMs || 0;
      const initRemainingMs = Math.max(0, initTotalMs - (activeChallenge.initElapsedMs || 0));

      // Edge-triggered audio cue emission. We track the last-seen (cycleState,
      // status, currentPhaseIndex) on the active challenge itself — since each
      // challenge gets a fresh object, a new challenge will naturally emit
      // cycle_challenge_init on its first snapshot.
      //
      // Priority (highest first): success > locked > phase_complete. The init
      // cue is only emitted on the first snapshot we ever see of the challenge.
      let cycleAudioCue = null;
      const priorState = activeChallenge._lastAudioCueState;
      const priorPhase = activeChallenge._lastAudioCuePhase;
      const priorStatus = activeChallenge._lastAudioCueStatus;

      if (priorState === undefined) {
        // First snapshot of this challenge
        cycleAudioCue = 'cycle_challenge_init';
      } else if (activeChallenge.status === 'success' && priorStatus !== 'success') {
        cycleAudioCue = 'cycle_success';
      } else if (activeChallenge.cycleState === 'locked' && priorState !== 'locked') {
        cycleAudioCue = 'cycle_locked';
      } else if (priorPhase !== undefined && activeChallenge.currentPhaseIndex > priorPhase) {
        cycleAudioCue = 'cycle_phase_complete';
      }

      // Update trackers for next snapshot
      activeChallenge._lastAudioCueState = activeChallenge.cycleState;
      activeChallenge._lastAudioCuePhase = activeChallenge.currentPhaseIndex;
      activeChallenge._lastAudioCueStatus = activeChallenge.status;

      if (cycleAudioCue) {
        getLogger().debug('governance.cycle.audio_cue_emitted', {
          challengeId: activeChallenge.id,
          cue: cycleAudioCue,
          cycleState: activeChallenge.cycleState,
          status: activeChallenge.status,
          currentPhaseIndex: activeChallenge.currentPhaseIndex
        });
      }

      return {
        id: activeChallenge.id,
        type: 'cycle',
        status: activeChallenge.status,
        rider: { id: activeChallenge.rider, name: riderName },
        cycleState: activeChallenge.cycleState,
        currentPhaseIndex: activeChallenge.currentPhaseIndex,
        totalPhases: activeChallenge.totalPhases,
        currentPhase: phase ? { ...phase } : null,
        generatedPhases: phases.map((p) => ({ ...p })),
        currentRpm,
        phaseProgressPct,
        allPhasesProgress,
        rampRemainingMs,
        rampTotalMs,
        initRemainingMs,
        initTotalMs,
        dimFactor,
        boostMultiplier: multiplier,
        boostingUsers: contributors,
        lockReason: activeChallenge.lockReason || null,
        swapAllowed,
        swapEligibleUsers,
        cycleAudioCue
      };
    }

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
      totalCount: Number.isFinite(payload.totalCount) ? payload.totalCount : activeParticipants.length,
      hrInactiveUsers: Array.isArray(payload.hrInactiveUsers) ? [...payload.hrInactiveUsers] : [],
      equipmentCadenceMap: payload.equipmentCadenceMap && typeof payload.equipmentCadenceMap === 'object'
        ? { ...payload.equipmentCadenceMap }
        : {}
    };
    this._lastEvaluationTs = this._now();

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

              // Cycle challenge selection branch — distinct shape from zone/vibration
              if (selectionValue.type === 'cycle') {
                const selectionId = `${policyId}_${index}_${selectionIndex}`;
                const equipment = selectionValue.equipment;
                if (!equipment || typeof equipment !== 'string' || !equipment.trim()) {
                  getLogger().warn('governance.cycle.config_rejected', {
                    selectionId,
                    reason: 'missing_equipment'
                  });
                  return null;
                }

                const weight = Number(selectionValue.weight ?? 1);
                const normalizedSequenceType = String(selectionValue.sequence_type ?? 'random').toLowerCase();
                const hiRpmRange = normalizeCycleRange(selectionValue.hi_rpm_range, [50, 90]);
                const segmentCount = normalizeCycleRange(selectionValue.segment_count, [3, 5]);
                const segmentDurationSeconds = normalizeCycleRange(selectionValue.segment_duration_seconds, [20, 45]);
                const rampSeconds = normalizeCycleRange(selectionValue.ramp_seconds, [10, 20]);
                const explicitPhases = parseCycleExplicitPhases(selectionValue.phases);
                const usingExplicitPhases = !!(explicitPhases && explicitPhases.length);

                // Warn if both explicit phases and procedural fields provided
                if (usingExplicitPhases) {
                  const hasProcedural = selectionValue.hi_rpm_range !== undefined
                    || selectionValue.segment_count !== undefined
                    || selectionValue.segment_duration_seconds !== undefined
                    || selectionValue.ramp_seconds !== undefined;
                  if (hasProcedural) {
                    getLogger().warn('governance.cycle.config_explicit_overrides_procedural', {
                      selectionId,
                      equipment: String(equipment),
                      explicitPhaseCount: explicitPhases.length
                    });
                  }
                }

                // Guard numeric fields against NaN from malformed YAML (e.g., "ten" instead of 10).
                // `??` only catches null/undefined; Number("ten") = NaN leaks through without Number.isFinite check.
                const rawUserCooldown = Number(selectionValue.user_cooldown_seconds ?? 600);
                const userCooldownSeconds = Number.isFinite(rawUserCooldown) && rawUserCooldown > 0 ? rawUserCooldown : 600;

                const rawLoRpmRatio = Number(selectionValue.lo_rpm_ratio ?? 0.75);
                const loRpmRatio = Number.isFinite(rawLoRpmRatio) && rawLoRpmRatio > 0 ? rawLoRpmRatio : 0.75;

                const rawInitMinRpm = Number(selectionValue.init?.min_rpm ?? 30);
                const initMinRpm = Number.isFinite(rawInitMinRpm) && rawInitMinRpm > 0 ? rawInitMinRpm : 30;

                const rawInitTimeAllowed = Number(selectionValue.init?.time_allowed_seconds ?? 60);
                const initTimeAllowedSeconds = Number.isFinite(rawInitTimeAllowed) && rawInitTimeAllowed > 0 ? rawInitTimeAllowed : 60;

                const rawBoostMaxTotal = Number(selectionValue.boost?.max_total_multiplier ?? 3.0);
                const boostMaxTotalMultiplier = Number.isFinite(rawBoostMaxTotal) && rawBoostMaxTotal > 0 ? rawBoostMaxTotal : 3.0;

                const cycleSelection = {
                  id: selectionId,
                  type: 'cycle',
                  label: selectionValue.label || selectionValue.name || null,
                  weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
                  equipment: String(equipment),
                  userCooldownSeconds,
                  loRpmRatio,
                  sequenceType: normalizedSequenceType,
                  init: {
                    minRpm: initMinRpm,
                    timeAllowedSeconds: initTimeAllowedSeconds
                  },
                  hiRpmRange,
                  segmentCount,
                  segmentDurationSeconds,
                  rampSeconds,
                  explicitPhases,
                  boost: {
                    zoneMultipliers: { ...(selectionValue.boost?.zone_multipliers || {}) },
                    maxTotalMultiplier: boostMaxTotalMultiplier
                  }
                };

                getLogger().info('governance.cycle.config_parsed', {
                  selectionId,
                  equipment: cycleSelection.equipment,
                  sequenceType: cycleSelection.sequenceType,
                  segmentCountRange: cycleSelection.segmentCount,
                  hiRpmRange: cycleSelection.hiRpmRange,
                  loRpmRatio: cycleSelection.loRpmRatio,
                  userCooldownSeconds: cycleSelection.userCooldownSeconds,
                  usingExplicitPhases
                });

                return cycleSelection;
              }

              const zone = selectionValue.zone || selectionValue.zoneId || selectionValue.zone_id;
              const vibration = selectionValue.vibration;

              // Either zone-based or vibration-based selection required
              if (!zone && !vibration) return null;

              const rule = selectionValue.min_participants ?? selectionValue.minParticipants ?? selectionValue.rule ?? 'all';
              const timeAllowed = Number(selectionValue.time_allowed ?? selectionValue.timeAllowed);
              if (!Number.isFinite(timeAllowed) || timeAllowed <= 0) return null;

              const weight = Number(selectionValue.weight ?? 1);

              return {
                id: `${policyId}_${index}_${selectionIndex}`,
                zone: zone ? String(zone) : null,
                rule,
                timeAllowedSeconds: Math.max(1, Math.round(timeAllowed)),
                weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
                label: selectionValue.label || selectionValue.name || null,
                vibration: vibration ? String(vibration) : null,
                criteria: selectionValue.criteria || null,
                target: Number(selectionValue.target) || null,
                count: Number(selectionValue.count) || null,
              };
            })
            .filter(Boolean);

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

  setCallbacks({ onPhaseChange, onPulse, onStateChange }) {
    this.callbacks.onPhaseChange = onPhaseChange;
    this.callbacks.onPulse = onPulse;
    this.callbacks.onStateChange = onStateChange || null;
  }

  _setPhase(newPhase, evalContext = null) {
    if (this.phase !== newPhase) {
      const oldPhase = this.phase;
      const now = this._now();
      this.phase = newPhase;
      this._invalidateStateCache(); // Invalidate cache on phase change

      // Track warning/lock timing for production correlation
      const savedWarningStartTime = this._warningStartTime;
      if (newPhase === 'warning' && oldPhase !== 'warning') {
        this._warningStartTime = now;
      } else if (newPhase !== 'warning') {
        this._warningStartTime = null;
      }

      // Start warning cooldown when returning to unlocked from warning or locked.
      // After a warning or lock cycle, suppress immediate re-entry to warning.
      if ((oldPhase === 'warning' || oldPhase === 'locked') && newPhase === 'unlocked') {
        const cooldownSeconds = Number(this.config?.warning_cooldown_seconds);
        if (Number.isFinite(cooldownSeconds) && cooldownSeconds > 0) {
          this._warningCooldownUntil = now + cooldownSeconds * 1000;
        }
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
        const cachedState = this._getCachedState();
        logger.sampled('governance.phase_change', {
          from: oldPhase,
          to: newPhase,
          contentId: this.media?.id,
          deadline: this.meta?.deadline,
          satisfiedOnce: this.meta?.satisfiedOnce,
          requirementCount: this.requirementSummary?.requirements?.length || 0,
          firstRequirement: firstReq ? {
            zone: firstReq.zone,
            zoneLabel: firstReq.zoneLabel,
            satisfied: firstReq.satisfied
          } : null,
          lockRowCount: cachedState?.lockRows?.length ?? -1,
          activeParticipantCount: evalContext?.activeParticipants?.length ?? this._latestInputs?.activeParticipants?.length ?? -1,
          videoLocked: cachedState?.videoLocked ?? null,
          evaluatePath: this._lastEvaluatePath || null
        }, { maxPerMinute: 30 });
      }

      // Enhanced production logging for specific transitions
      if (newPhase === 'warning' && oldPhase !== 'warning') {
        const participantsBelowThreshold = this._getParticipantsBelowThreshold(evalContext);
        logger.info('governance.warning_started', {
          contentId: this.media?.id,
          deadline: this.meta?.deadline,
          gracePeriodTotal: this.meta?.gracePeriodTotal,
          participantsBelowThreshold,
          participantCount: evalContext?.activeParticipants?.length ?? this._latestInputs.activeParticipants?.length ?? 0,
          requirements: this.requirementSummary?.requirements?.slice(0, 5) // Limit for log size
        });
      }

      if (newPhase === 'locked') {
        const timeSinceWarning = oldPhase === 'warning' && savedWarningStartTime
          ? now - savedWarningStartTime
          : null;
        logger.info('governance.lock_triggered', {
          contentId: this.media?.id,
          reason: this.challengeState?.activeChallenge?.status === 'failed' ? 'challenge_failed' : 'requirements_not_met',
          timeSinceWarningMs: timeSinceWarning,
          participantStates: this._getParticipantStates(evalContext),
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
  _getParticipantsBelowThreshold(evalContext = null) {
    const requirements = this.requirementSummary?.requirements || [];
    const userZoneMap = evalContext?.userZoneMap || this._latestInputs.userZoneMap || {};
    const below = [];
    for (const req of requirements) {
      if (!Array.isArray(req.missingUsers)) continue;
      const requiredRank = this._getZoneRank(req.zone || req.zoneLabel);
      const requiredZoneId = (req.zone || req.zoneLabel || '').toLowerCase();
      for (const name of req.missingUsers) {
        const currentZone = userZoneMap[name];
        const currentRank = this._getZoneRank(currentZone) ?? 0;
        // Only include if they are actually below the required zone right now
        if (!Number.isFinite(requiredRank) || currentRank < requiredRank) {
          // Get HR from roster
          const rosterEntry = this.session?.roster?.find(
            e => (e.id || e.profileId) === name
          );
          const hr = Number.isFinite(rosterEntry?.heartRate) ? rosterEntry.heartRate : null;

          // Get per-user zone threshold from ZoneProfileStore
          let threshold = null;
          if (this.session?.zoneProfileStore) {
            const profile = this.session.zoneProfileStore.getProfile(name);
            if (profile?.zoneConfig) {
              const requiredZone = profile.zoneConfig.find(
                z => z.id === requiredZoneId
              );
              threshold = requiredZone?.min ?? null;
            }
          }

          const delta = (hr != null && threshold != null) ? hr - threshold : null;

          below.push({
            name,
            zone: currentZone || req.zone || req.zoneLabel,
            requiredZone: requiredZoneId,
            required: req.requiredCount,
            hr,
            threshold,
            delta
          });
        }
      }
    }
    return below.slice(0, 10); // Limit for log size
  }

  /**
   * Get participant states for lock logging
   */
  _getParticipantStates(evalContext = null) {
    const userZoneMap = evalContext?.userZoneMap || this._latestInputs.userZoneMap || {};
    const zoneInfoMap = evalContext?.zoneInfoMap || this._latestInputs.zoneInfoMap || {};
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

    // SIMPLIFIED: Self-evaluate on each pulse using canonical participant state
    if (this.session?.getActiveParticipantState) {
      this.evaluate();  // No params needed - reads from session.getActiveParticipantState() directly
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
    this._pausedAt = this._now();

    if (this.meta?.deadline) {
      this._remainingMs = Math.max(0, this.meta.deadline - this._now());
    }

    getLogger().info('governance.timers_paused', {
      phase: this.phase,
      remainingMs: this._remainingMs,
      contentId: this.media?.id
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
      this.meta.deadline = this._now() + this._remainingMs;
    }

    const pauseDuration = this._pausedAt ? this._now() - this._pausedAt : 0;
    this._pausedAt = null;

    getLogger().info('governance.timers_resumed', {
      phase: this.phase,
      newDeadline: this.meta?.deadline,
      pauseDurationMs: pauseDuration,
      contentId: this.media?.id
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
    this._warningCooldownUntil = null;

    // State caching for performance - throttle recomputation to 200ms
    this._stateCache = null;
    this._stateCacheTs = 0;
    this._stateCacheThrottleMs = 200;
    this._stateVersion = 0; // Incremented on evaluate() to invalidate cache
    this._stateCacheVersion = -1; // Track which version the cache represents
    this._stateChangePending = false;
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
    // Already idle — skip all work to avoid thousands of wasted onStateChange callbacks
    if (this.phase === null && !this.meta.satisfiedOnce && !this.challengeState.activeChallenge) {
      return;
    }
    this._clearTimers();
    this._cleanupPlaybackSubscription();
    if (this._zoneChangeDebounceTimer) {
      clearTimeout(this._zoneChangeDebounceTimer);
      this._zoneChangeDebounceTimer = null;
    }
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
    // Preserve zone maps that were seeded during configure()
    const preservedZoneRankMap = this._latestInputs?.zoneRankMap || {};
    const preservedZoneInfoMap = this._latestInputs?.zoneInfoMap || {};
    const preservedEquipmentCadenceMap = this._latestInputs?.equipmentCadenceMap || {};
    this._latestInputs = {
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: preservedZoneRankMap,
      zoneInfoMap: preservedZoneInfoMap,
      totalCount: 0,
      equipmentCadenceMap: preservedEquipmentCadenceMap
    };
    this._lastEvaluationTs = null;
    this._timersPaused = false;
    this._pausedAt = null;
    this._remainingMs = null;
    this._warningCooldownUntil = null;
    this._stateCache = null;
    this._stateCacheTs = 0;
    this._stateCacheThrottleMs = 200;
    this._stateVersion = 0;
    this._stateCacheVersion = -1;
    this._stateChangePending = false;

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
    const now = this._now();
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
   * Invalidate state cache - call this when significant state changes occur.
   * Fires onStateChange callback so React can re-render with fresh state.
   */
  _invalidateStateCache() {
    this._stateVersion++;
    if (this.callbacks.onStateChange && !this._stateChangePending) {
      this._stateChangePending = true;
      queueMicrotask(() => {
        this._stateChangePending = false;
        if (this.callbacks.onStateChange) {
          this.callbacks.onStateChange();
        }
      });
    }
  }

  _composeState() {
    const now = this._now();
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
    const combinedRequirements = [...unsatisfied];

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
      videoLocked: (this.challengeState?.videoLocked || this._mediaIsGoverned())
        && this.phase !== 'unlocked' && this.phase !== 'warning',
      challengePaused: challengeSnapshot ? Boolean(challengeSnapshot.paused) : false,
      challenge: challengeSnapshot,
      challengeHistory: Array.isArray(this.challengeState?.challengeHistory)
        ? [...this.challengeState.challengeHistory]
        : [],
      challengeCountdownSeconds: challengeSnapshot ? challengeSnapshot.remainingSeconds : null,
      challengeCountdownTotal: challengeSnapshot ? challengeSnapshot.totalSeconds : null,
      nextChallenge: nextChallengeSnapshot,
      hrInactiveUsers: Array.isArray(this._latestInputs?.hrInactiveUsers) ? [...this._latestInputs.hrInactiveUsers] : []
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
   * @param {Object.<string, {rpm: number, connected: boolean}>} input.equipmentCadenceMap - Latest cadence reading per equipment id. Default: {}.
   */
  evaluate({ activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount, hrInactiveUsers, equipmentCadenceMap } = {}) {
    // Tag which code path triggered this evaluation (for prod log diagnostics)
    this._lastEvaluatePath = activeParticipants ? 'snapshot' : 'pulse';

    // Skip evaluation while timers are paused (playback stalled)
    if (this._timersPaused) {
      getLogger().debug('governance.evaluate.skipped_paused', { phase: this.phase });
      return;
    }

    const now = this._now();
    const hasGovernanceRules = (this._governedLabelSet.size + this._governedTypeSet.size) > 0;

    // Use canonical participant state from ParticipantRoster (SSOT).
    // This replaces reading session.roster and re-extracting IDs/zones.
    if (!activeParticipants && this.session?.getActiveParticipantState) {
      const state = this.session.getActiveParticipantState();
      activeParticipants = state.participants;
      userZoneMap = state.zoneMap;
      totalCount = state.totalCount;
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

    // Zone enrichment and ghost filtering removed:
    // - Second-pass zone enrichment via getParticipantProfile is redundant —
    //   the roster already includes ZoneProfileStore data via _buildZoneLookup().
    // - Ghost filter (removing participants without zone data) is redundant —
    //   isActive from ParticipantRoster is the authority, not zone-data presence.
    //   Removing it fixes the startup bug where participants without zone data
    //   (because zones haven't arrived yet) were incorrectly excluded.

    // Capture zone maps early so _getZoneRank()/_getZoneInfo() work during evaluation
    // (Previously stored only after evaluation, causing first-call misses)
    if (zoneRankMap && Object.keys(zoneRankMap).length > 0) {
      this._latestInputs.zoneRankMap = zoneRankMap;
    }
    if (zoneInfoMap && Object.keys(zoneInfoMap).length > 0) {
      this._latestInputs.zoneInfoMap = zoneInfoMap;
    }
    // Capture equipmentCadenceMap early so it survives no-media/no-participant early-exit paths.
    // Store verbatim; missing map becomes empty object.
    this._latestInputs.equipmentCadenceMap = equipmentCadenceMap && typeof equipmentCadenceMap === 'object'
      ? { ...equipmentCadenceMap }
      : {};

    // Build evalContext so _setPhase logging reads current data (not stale _latestInputs)
    const evalContext = { userZoneMap, zoneRankMap, zoneInfoMap, activeParticipants };

    // 1. Check if media is governed
    if (!this.media || !this.media.id || !hasGovernanceRules) {
      getLogger().sampled('governance.evaluate.no_media_or_rules', {
        hasMedia: !!(this.media && this.media.id),
        hasGovernanceRules
      }, { maxPerMinute: 2, aggregate: true });
      this._resetToIdle();
      return;
    }

    const hasGovernedMedia = this._mediaIsGoverned();
    if (!hasGovernedMedia) {
      getLogger().sampled('governance.evaluate.media_not_governed', {
        contentId: this.media?.id
      }, { maxPerMinute: 2, aggregate: true });
      this._resetToIdle();
      return;
    }

    // 2. Check participants
    if (activeParticipants.length === 0) {
      // Already pending with no participants — skip redundant work to avoid feedback loop
      if (this.phase === 'pending' && this._latestInputs?.activeParticipants?.length === 0) {
        return;
      }
      getLogger().sampled('governance.evaluate.no_participants', {}, { maxPerMinute: 2, aggregate: true });

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
      this._setPhase('pending', evalContext);
      // Capture latest inputs so UI (watchers) reflects the current empty state
      this._latestInputs = {
        activeParticipants: [],
        userZoneMap: userZoneMap || {},
        zoneRankMap: zoneRankMap || {},
        zoneInfoMap: zoneInfoMap || {},
        totalCount: totalCount || 0,
        hrInactiveUsers: Array.isArray(hrInactiveUsers) ? [...hrInactiveUsers] : [],
        equipmentCadenceMap: equipmentCadenceMap && typeof equipmentCadenceMap === 'object'
          ? { ...equipmentCadenceMap }
          : {}
      };
      this._invalidateStateCache();
      // No polling needed here - governance is reactive via TreasureBox mutation callback
      // in FitnessContext, which calls _triggerPulse() to re-evaluate when HR data arrives.
      return;
    }

    // 3. Choose Policy
    const activePolicy = this._chooseActivePolicy(totalCount);
    if (!activePolicy) {
      this.reset();
      this._setPhase('pending', evalContext);
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
      // Failed challenge -> locked (regardless of base requirements)
      if (this.timers.governance) clearTimeout(this.timers.governance);
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('locked', evalContext);
    } else if (allSatisfied) {
      // Requirements met -> unlocked immediately (no hysteresis delay)
      this.meta.satisfiedOnce = true;
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('unlocked', evalContext);
    } else if (!this.meta.satisfiedOnce) {
      // Never been satisfied -> pending
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('pending', evalContext);
    } else {
      // Was satisfied, now failing -> warning with grace period
      // Check warning cooldown: if recently dismissed a warning, suppress re-entry
      const inCooldown = this._warningCooldownUntil && now < this._warningCooldownUntil;
      if (inCooldown) {
        // Stay in current phase (unlocked) during cooldown
        // Don't clear satisfiedOnce so next eval after cooldown works normally
      } else {
        let graceSeconds = baseGraceSeconds;
        if (!Number.isFinite(graceSeconds) || graceSeconds <= 0) {
          // No grace period configured -> locked immediately
          if (this.timers.governance) clearTimeout(this.timers.governance);
          this.meta.deadline = null;
          this.meta.gracePeriodTotal = null;
          this._setPhase('locked', evalContext);
        } else {
          // Start or continue grace period countdown
          if (!Number.isFinite(this.meta.deadline) && this.phase !== 'locked') {
            this.meta.deadline = now + graceSeconds * 1000;
            this.meta.gracePeriodTotal = graceSeconds;
          }

          if (!Number.isFinite(this.meta.deadline)) {
            if (this.timers.governance) clearTimeout(this.timers.governance);
            this.meta.gracePeriodTotal = null;
            this._setPhase('locked', evalContext);
          } else {
            const remainingMs = this.meta.deadline - now;
            if (remainingMs <= 0) {
              // Grace period expired -> locked
              if (this.timers.governance) clearTimeout(this.timers.governance);
              this.meta.deadline = null;
              this.meta.gracePeriodTotal = null;
              this._setPhase('locked', evalContext);
            } else {
              // Grace period active -> warning
              if (this.timers.governance) clearTimeout(this.timers.governance);
              this.timers.governance = setTimeout(() => this._triggerPulse(), remainingMs);
              this._setPhase('warning', evalContext);
            }
          }
        }
      }
    }

    // 7. Handle Challenges
    this._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount, evalContext);

    this._captureLatestInputs({
      activeParticipants,
      userZoneMap,
      zoneRankMap,
      zoneInfoMap,
      totalCount,
      hrInactiveUsers,
      equipmentCadenceMap
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

    const exemptUsers = (this.config.exemptions || []).map(u => normalizeName(u));
    const metUsers = [];
    let nonExemptMetCount = 0;
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
        if (!exemptUsers.includes(normalizeName(participantId))) {
          nonExemptMetCount++;
        }
      }
    });

    const requiredCount = this._normalizeRequiredCount(rule, totalCount, activeParticipants);
    // Only non-exempt users count toward satisfying the requirement.
    // Exempt users get a free pass — their zone status doesn't affect governance.
    const satisfied = nonExemptMetCount >= requiredCount;
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
      actualCount: nonExemptMetCount,
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

  /**
   * Evaluate a vibration-based challenge against the current tracker state.
   * @param {Object} selection - { vibration: equipmentId, criteria, target, count? }
   * @returns {boolean} Whether the challenge criteria are satisfied
   */
  _evaluateVibrationChallenge(selection) {
    if (!selection?.vibration || !this.session?.getVibrationTracker) return false;
    const tracker = this.session.getVibrationTracker(selection.vibration);
    if (!tracker) return false;

    const snap = tracker.snapshot;
    const criteria = selection.criteria;
    const target = Number(selection.target);

    if (!Number.isFinite(target) || target <= 0) return false;

    switch (criteria) {
      case 'duration':
        return snap.sessionDurationMs >= target * 1000;

      case 'impacts':
        return snap.estimatedImpacts >= target;

      case 'intensity': {
        const count = Number(selection.count) || 1;
        const hits = (snap.recentIntensityHistory || []).filter(m => m >= target);
        return hits.length >= count;
      }

      default:
        getLogger().warn('governance.vibration_challenge.unknown_criteria', { criteria });
        return false;
    }
  }

  _pickIntervalMs(rangeSeconds) {
    if (!Array.isArray(rangeSeconds) || rangeSeconds.length < 2) return 180000;
    const min = rangeSeconds[0];
    const max = rangeSeconds[1];
    const randomSeconds = Math.floor(this._random() * (max - min + 1)) + min;
    return randomSeconds * 1000;
  }

  _pickInRange([min, max]) {
    if (min === max) return min;
    return Math.floor(this._random() * (max - min + 1)) + min;
  }

  _generateCyclePhases(selection) {
    if (Array.isArray(selection.explicitPhases) && selection.explicitPhases.length) {
      const phases = selection.explicitPhases.map(p => ({ ...p }));
      getLogger().info('governance.cycle.phases_generated', {
        selectionId: selection.id,
        sequenceType: selection.sequenceType,
        phaseCount: phases.length,
        phases: phases.map(({ hiRpm, loRpm, rampSeconds, maintainSeconds }) => ({
          hiRpm, loRpm, rampSeconds, maintainSeconds
        }))
      });
      return phases;
    }
    const count = this._pickInRange(selection.segmentCount);
    const [minHi, maxHi] = selection.hiRpmRange;
    let hiValues;
    switch (selection.sequenceType) {
      case 'progressive':
      case 'regressive': {
        const span = maxHi - minHi;
        const stepBase = count > 1 ? span / (count - 1) : 0;
        hiValues = Array.from({ length: count }, (_, i) => {
          const jitter = (this._random() - 0.5) * 0.1 * span; // ±5%
          return Math.round(minHi + stepBase * i + jitter);
        });
        if (selection.sequenceType === 'regressive') hiValues.reverse();
        break;
      }
      case 'constant': {
        const v = this._pickInRange([minHi, maxHi]);
        hiValues = Array(count).fill(v);
        break;
      }
      case 'random':
      default:
        hiValues = Array.from({ length: count }, () => this._pickInRange([minHi, maxHi]));
    }
    const ratio = selection.loRpmRatio ?? 0.75;
    const phases = hiValues.map(hiRpm => ({
      hiRpm: Math.max(1, Math.min(300, hiRpm)),
      loRpm: Math.round(hiRpm * ratio),
      rampSeconds: this._pickInRange(selection.rampSeconds),
      maintainSeconds: this._pickInRange(selection.segmentDurationSeconds)
    }));
    getLogger().info('governance.cycle.phases_generated', {
      selectionId: selection.id,
      sequenceType: selection.sequenceType,
      phaseCount: phases.length,
      phases: phases.map(({ hiRpm, loRpm, rampSeconds, maintainSeconds }) => ({
        hiRpm, loRpm, rampSeconds, maintainSeconds
      }))
    });
    return phases;
  }

  /**
   * Start a cycle challenge: pick a rider from equipment's eligible users (minus
   * those still on cooldown), generate phases, and build the initial activeChallenge
   * object in the 'init' cycleState.
   *
   * This method does NOT mutate challengeState.activeChallenge — that wiring is
   * performed by the evaluator in a later task. It simply produces the structure.
   *
   * @param {Object} selection - Normalized cycle selection (from _normalizePolicies)
   * @param {Object} [ctx] - Context fields: { policyId, policyName, configId, forceRiderId }
   * @returns {Object} Either the activeChallenge object on success, or
   *   { ok: false, reason } where reason is one of:
   *   'equipment_not_found', 'no_eligible_riders',
   *   'force_rider_not_eligible', 'all_riders_on_cooldown'.
   */
  _startCycleChallenge(selection, ctx = {}) {
    const catalog = this.session?._deviceRouter?.getEquipmentCatalog?.() || [];
    const catalogEntry = catalog.find(e => e.id === selection.equipment);
    if (!catalogEntry) {
      getLogger().info('governance.cycle.start_skipped', {
        equipment: selection.equipment,
        reason: 'equipment_not_found',
        eligibleCount: 0,
        onCooldownCount: 0
      });
      return { ok: false, reason: 'equipment_not_found' };
    }
    const eligible = Array.isArray(catalogEntry.eligible_users) ? [...catalogEntry.eligible_users] : [];
    if (!eligible.length) {
      getLogger().info('governance.cycle.start_skipped', {
        equipment: selection.equipment,
        reason: 'no_eligible_riders',
        eligibleCount: 0,
        onCooldownCount: 0
      });
      return { ok: false, reason: 'no_eligible_riders' };
    }
    const now = this._now();
    let rider;
    let riderPool;
    if (ctx.forceRiderId) {
      // Admin/manual trigger path: bypass cooldown filter + random pick. Caller is expected
      // to have verified eligibility, but double-check here defensively.
      if (!eligible.includes(ctx.forceRiderId)) {
        getLogger().info('governance.cycle.start_skipped', {
          equipment: selection.equipment,
          reason: 'force_rider_not_eligible',
          forceRiderId: ctx.forceRiderId,
          eligibleCount: eligible.length,
          onCooldownCount: 0
        });
        return { ok: false, reason: 'force_rider_not_eligible' };
      }
      rider = ctx.forceRiderId;
      riderPool = [ctx.forceRiderId];
    } else {
      const filtered = eligible.filter(uid => {
        const until = this._cycleCooldowns[uid];
        return !until || until <= now;
      });
      if (!filtered.length) {
        getLogger().info('governance.cycle.start_skipped', {
          equipment: selection.equipment,
          reason: 'all_riders_on_cooldown',
          eligibleCount: eligible.length,
          onCooldownCount: eligible.length
        });
        return { ok: false, reason: 'all_riders_on_cooldown' };
      }
      rider = filtered[Math.floor(this._random() * filtered.length)];
      riderPool = filtered;
    }
    const phases = this._generateCyclePhases(selection);
    const initTotalMs = Math.max(0, Number(selection?.init?.timeAllowedSeconds) || 0) * 1000;
    const active = {
      id: `${selection.id}_${now}`,
      type: 'cycle',
      selectionId: selection.id,
      selectionLabel: selection.label || null,
      configId: ctx.configId || null,
      policyId: ctx.policyId || null,
      policyName: ctx.policyName || null,
      equipment: selection.equipment,
      rider,
      ridersUsed: [rider],
      generatedPhases: phases,
      totalPhases: phases.length,
      currentPhaseIndex: 0,
      cycleState: 'init',
      status: 'pending',
      startedAt: now,
      initStartedAt: now,
      initElapsedMs: 0,
      initTotalMs,
      rampElapsedMs: 0,
      phaseProgressMs: 0,
      totalLockEventsCount: 0,
      totalBoostedMs: 0,
      boostContributors: new Set(),
      lockReason: null,
      pausedAt: null,
      pausedRemainingMs: null,
      selection
    };
    getLogger().info('governance.cycle.started', {
      challengeId: active.id,
      equipment: selection.equipment,
      rider,
      eligibleUsers: eligible,
      riderPool,
      forced: Boolean(ctx.forceRiderId),
      totalPhases: phases.length,
      initTotalMs: active.initTotalMs
    });
    return active;
  }

  _evaluateCycleChallenge(active, ctx) {
    const now = this._now();

    // Pause gate: base requirement failing globally → freeze all cycle timers
    if (ctx.baseReqSatisfiedGlobal === false) {
      if (active._pausedAt == null) {
        active._pausedAt = now;
        getLogger().info('governance.cycle.paused_by_base_req', {
          challengeId: active.id,
          cycleState: active.cycleState,
          frozenFields: {
            initElapsedMs: active.initElapsedMs,
            rampElapsedMs: active.rampElapsedMs,
            phaseProgressMs: active.phaseProgressMs
          }
        });
      }
      active._lastCycleTs = now; // consume dt so resume tick computes correctly
      return;
    }

    // Resume edge: emit log with duration
    if (active._pausedAt != null) {
      const pausedDurationMs = now - active._pausedAt;
      getLogger().info('governance.cycle.resumed_after_base_req', {
        challengeId: active.id,
        cycleState: active.cycleState,
        pausedDurationMs
      });
      active._pausedAt = null;
    }

    const dt = Number.isFinite(active._lastCycleTs) ? now - active._lastCycleTs : 0;
    active._lastCycleTs = now;

    if (active.cycleState === 'init') {
      active.initElapsedMs += dt;
      if (active.initElapsedMs >= active.initTotalMs) {
        const prev = active.cycleState;
        active.cycleState = 'locked';
        active.lockReason = 'init';
        active.totalLockEventsCount += 1;
        getLogger().info('governance.cycle.state_transition', {
          challengeId: active.id,
          from: prev,
          to: 'locked',
          currentPhaseIndex: active.currentPhaseIndex,
          rider: active.rider,
          currentRpm: ctx.equipmentRpm,
          reason: 'init_timeout'
        });
        getLogger().info('governance.cycle.locked', {
          challengeId: active.id,
          lockReason: 'init',
          phaseIndex: active.currentPhaseIndex,
          currentRpm: ctx.equipmentRpm,
          threshold: active.selection.init.minRpm,
          totalLockEventsCount: active.totalLockEventsCount
        });
        return;
      }
      if (ctx.equipmentRpm >= active.selection.init.minRpm && ctx.baseReqSatisfiedForRider) {
        const prev = active.cycleState;
        active.cycleState = 'ramp';
        active.rampElapsedMs = 0;
        getLogger().info('governance.cycle.state_transition', {
          challengeId: active.id,
          from: prev,
          to: 'ramp',
          currentPhaseIndex: active.currentPhaseIndex,
          rider: active.rider,
          currentRpm: ctx.equipmentRpm
        });
      }
      return;
    }

    if (active.cycleState === 'ramp') {
      const phase = active.generatedPhases[active.currentPhaseIndex];
      active.rampElapsedMs += dt;
      if (ctx.equipmentRpm >= phase.hiRpm) {
        active.cycleState = 'maintain';
        active.phaseProgressMs = 0;
        getLogger().info('governance.cycle.state_transition', {
          challengeId: active.id, from: 'ramp', to: 'maintain',
          currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
          currentRpm: ctx.equipmentRpm
        });
        return;
      }
      if (active.rampElapsedMs >= phase.rampSeconds * 1000) {
        active.cycleState = 'locked';
        active.lockReason = 'ramp';
        active.totalLockEventsCount += 1;
        getLogger().info('governance.cycle.state_transition', {
          challengeId: active.id, from: 'ramp', to: 'locked',
          currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
          currentRpm: ctx.equipmentRpm, reason: 'ramp_timeout'
        });
        getLogger().info('governance.cycle.locked', {
          challengeId: active.id, lockReason: 'ramp', phaseIndex: active.currentPhaseIndex,
          currentRpm: ctx.equipmentRpm, threshold: phase.hiRpm,
          totalLockEventsCount: active.totalLockEventsCount
        });
      }
      return;
    }

    if (active.cycleState === 'maintain') {
      const phase = active.generatedPhases[active.currentPhaseIndex];
      if (ctx.equipmentRpm < phase.loRpm) {
        active.cycleState = 'locked';
        active.lockReason = 'maintain';
        active.totalLockEventsCount += 1;
        getLogger().info('governance.cycle.state_transition', {
          challengeId: active.id, from: 'maintain', to: 'locked',
          currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
          currentRpm: ctx.equipmentRpm, reason: 'below_lo'
        });
        getLogger().info('governance.cycle.locked', {
          challengeId: active.id, lockReason: 'maintain', phaseIndex: active.currentPhaseIndex,
          currentRpm: ctx.equipmentRpm, threshold: phase.loRpm,
          totalLockEventsCount: active.totalLockEventsCount
        });
        return;
      }
      if (ctx.equipmentRpm >= phase.hiRpm) {
        const { multiplier, contributors } = this._computeBoostMultiplier(active, ctx);
        const progressAdd = dt * multiplier;
        active.phaseProgressMs += progressAdd;
        if (multiplier > 1.0) {
          active.totalBoostedMs += (progressAdd - dt);
          contributors.forEach(u => active.boostContributors.add(u));
        }
        if (active.phaseProgressMs >= phase.maintainSeconds * 1000) {
          const prev = active.currentPhaseIndex;
          if (active.currentPhaseIndex + 1 >= active.generatedPhases.length) {
            active.status = 'success';
            active.completedAt = now;
            getLogger().info('governance.cycle.state_transition', {
              challengeId: active.id, from: 'maintain', to: 'success',
              currentPhaseIndex: prev, rider: active.rider,
              currentRpm: ctx.equipmentRpm
            });
          } else {
            active.currentPhaseIndex += 1;
            active.cycleState = 'ramp';
            active.rampElapsedMs = 0;
            active.phaseProgressMs = 0;
            getLogger().info('governance.cycle.phase_advanced', {
              challengeId: active.id, fromPhaseIndex: prev, toPhaseIndex: active.currentPhaseIndex,
              elapsedMs: phase.maintainSeconds * 1000, boostedMs: Math.round(active.totalBoostedMs)
            });
            getLogger().info('governance.cycle.state_transition', {
              challengeId: active.id, from: 'maintain', to: 'ramp',
              currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
              currentRpm: ctx.equipmentRpm, reason: 'phase_complete'
            });
          }
        }
      }
      // between lo and hi: progress paused, no state change
      return;
    }

    if (active.cycleState === 'locked') {
      const phase = active.generatedPhases[active.currentPhaseIndex];
      if (active.lockReason === 'init') {
        if (ctx.equipmentRpm >= active.selection.init.minRpm) {
          const prevLockReason = active.lockReason;
          active.cycleState = 'init';
          active.initElapsedMs = 0;
          active.lockReason = null;
          getLogger().info('governance.cycle.state_transition', {
            challengeId: active.id, from: 'locked', to: 'init',
            currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
            currentRpm: ctx.equipmentRpm, reason: 'recovered_from_init_lock'
          });
          getLogger().info('governance.cycle.recovered', {
            challengeId: active.id, fromLockReason: prevLockReason,
            currentRpm: ctx.equipmentRpm, resumeState: 'init',
            lockDurationMs: null
          });
        }
        return;
      }
      if (active.lockReason === 'ramp' || active.lockReason === 'maintain') {
        if (ctx.equipmentRpm >= phase.hiRpm) {
          const prevLockReason = active.lockReason;
          active.cycleState = 'maintain';
          if (prevLockReason === 'ramp') active.phaseProgressMs = 0;
          active.lockReason = null;
          getLogger().info('governance.cycle.state_transition', {
            challengeId: active.id, from: 'locked', to: 'maintain',
            currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
            currentRpm: ctx.equipmentRpm, reason: `recovered_from_${prevLockReason}_lock`
          });
          getLogger().info('governance.cycle.recovered', {
            challengeId: active.id, fromLockReason: prevLockReason,
            currentRpm: ctx.equipmentRpm, resumeState: 'maintain',
            lockDurationMs: null
          });
        }
        return;
      }
    }
  }

  _computeBoostMultiplier(active, ctx) {
    const mults = active.selection?.boost?.zoneMultipliers || {};
    const cap = active.selection?.boost?.maxTotalMultiplier || 3.0;
    const participants = ctx.activeParticipants || [];
    let sum = 0;
    const contributors = [];
    participants.forEach(uid => {
      const z = ctx.userZoneMap?.[uid];
      const m = z && mults[z];
      if (m) { sum += m; contributors.push(uid); }
    });
    const total = Math.min(1.0 + sum, cap);
    return { multiplier: Math.max(1.0, total), contributors };
  }

  /**
   * Compute the minimum zone rank required by a policy's base_requirement
   * for a rider to be considered "satisfying" the base requirement themselves.
   *
   * base_requirement is a map of zone -> rule (e.g. { active: 'all', hot: 'some' }).
   * For a rider to satisfy ALL requirements they must be at >= rank(highest zone).
   * Returns 0 when no finite rank can be derived (effectively always satisfied).
   *
   * @param {Object} baseRequirement - Policy baseRequirement map (zone -> rule).
   * @returns {number} - Minimum zone rank the rider must meet.
   */
  _getBaseRequirementMinRank(baseRequirement) {
    if (!baseRequirement || typeof baseRequirement !== 'object') return 0;
    let maxRank = 0;
    Object.keys(baseRequirement).forEach((key) => {
      if (key === 'grace_period_seconds') return;
      const rank = this._getZoneRank(key);
      if (Number.isFinite(rank) && rank > maxRank) {
        maxRank = rank;
      }
    });
    return maxRank;
  }

  _evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount, evalContext = null) {
    const now = this._now();
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

    // Guard: don't run challenges if below minimum participant count
    if (
      Number.isFinite(challengeConfig.minParticipants) &&
      challengeConfig.minParticipants > 0 &&
      totalCount < challengeConfig.minParticipants
    ) {
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
            const j = Math.floor(this._random() * (i + 1));
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
      const selectionType = payload.selection.type || (payload.selection.vibration ? 'vibration' : 'zone');

      this.challengeState.nextChallenge = {
        configId: challengeConfig.id,
        selectionId: payload.selection.id,
        selectionLabel: payload.selection.label || null,
        zone: challengeZone,
        rule: payload.selection.rule,
        requiredCount,
        timeLimitSeconds,
        cursorIndex: payload.cursorIndex ?? null,
        scheduledFor: scheduledForTs,
        type: selectionType,
        // Keep the normalized selection object around so start/evaluate branches
        // (especially cycle) can access equipment, phase config, boost, etc.
        selection: payload.selection
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

      // Cycle challenge branch — distinct lifecycle (RPM-driven phases), so it
      // bypasses the zone-feasibility check (which is specific to HR zones) and
      // delegates construction to _startCycleChallenge. If no rider is
      // available, treat as a skipped-infeasible case and re-queue.
      if (preview.type === 'cycle' && preview.selection) {
        const cycleActive = this._startCycleChallenge(preview.selection, {
          policyId: activePolicy.id,
          policyName: this.challengeState.activePolicyName,
          configId: challengeConfig.id
        });
        if (!cycleActive || cycleActive.ok === false) {
          const nextDelay = this._pickIntervalMs?.(challengeConfig.intervalRangeSeconds) || 60000;
          queueNextChallenge(nextDelay);
          this._schedulePulse(50);
          return false;
        }

        this.challengeState.activeChallenge = cycleActive;
        this.challengeState.nextChallenge = null;
        this.challengeState.nextChallengeAt = null;
        this.challengeState.nextChallengeRemainingMs = null;
        this.challengeState.videoLocked = false;

        if (challengeConfig.selectionType === 'cyclic' && Number.isInteger(preview.cursorIndex)) {
          this.challengeState.selectionCursor[challengeConfig.id] = preview.cursorIndex;
        }

        this.challengeState.forceStartRequest = null;

        getLogger().debug('governance.cycle.dispatched', {
          challengeId: cycleActive.id,
          equipment: cycleActive.equipment,
          rider: cycleActive.rider,
          forced
        });

        // Short pulse so next tick progresses cycle state (init timeout etc.).
        this._schedulePulse(250);
        return true;
      }

      // Feasibility check: don't start challenges participants can't reach
      if (!forced) {
        const feasibility = this._checkChallengeFeasibility(
          preview.zone, preview.rule, activeParticipants
        );
        if (!feasibility.feasible) {
          if (feasibility.suggestedZone) {
            getLogger().info('governance.challenge.zone_downgraded', {
              original: preview.zone, downgraded: feasibility.suggestedZone,
              reason: feasibility.reason
            });
            preview.zone = feasibility.suggestedZone;
          } else {
            getLogger().info('governance.challenge.skipped_infeasible', { reason: feasibility.reason });
            const nextDelay = this._pickIntervalMs?.(challengeConfig.intervalRangeSeconds) || 60000;
            queueNextChallenge(nextDelay);
            this._schedulePulse(50);
            return false;
          }
        }
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

        // Vibration-based challenge — no zone/participant evaluation needed
        if (challenge.vibration) {
          const satisfied = this._evaluateVibrationChallenge(challenge);
          const tracker = this.session?.getVibrationTracker?.(challenge.vibration);
          const snap = tracker?.snapshot || {};
          return {
            satisfied,
            metUsers: satisfied ? activeParticipants : [],
            missingUsers: satisfied ? [] : activeParticipants,
            actualCount: satisfied ? 1 : 0,
            requiredCount: 1,
            zoneLabel: challenge.label || challenge.vibration,
            vibrationSnapshot: snap
          };
        }

        // Existing zone-based logic follows unchanged...
        const zoneId = challenge.zone;
        const zoneInfo = this._getZoneInfo(zoneId);
        const requiredRank = this._getZoneRank(zoneId) ?? 0;

        const exemptUsers = (this.config.exemptions || []).map(u => normalizeName(u));
        const metUsers = [];
        let nonExemptMetCount = 0;
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
          if (pRank >= requiredRank) {
            metUsers.push(participantId);
            if (!exemptUsers.includes(normalizeName(participantId))) {
              nonExemptMetCount++;
            }
          }
        });

        // Recompute requiredCount from current roster (not frozen value)
        const liveRequiredCount = this._normalizeRequiredCount(challenge.rule, totalCount, activeParticipants);
        // Only non-exempt users count toward satisfying challenges
        const satisfied = nonExemptMetCount >= liveRequiredCount;

        const missingUsers = activeParticipants.filter((participantId) =>
          !metUsers.includes(participantId) && !exemptUsers.includes(normalizeName(participantId))
        );

        return {
            satisfied,
            metUsers,
            missingUsers,
            actualCount: nonExemptMetCount,
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

        // Cycle challenge branch — RPM-driven state machine. Skips the
        // zone-specific pending/expiry/summary flow entirely.
        if (challenge.type === 'cycle') {
          const cadenceEntry = this._latestInputs?.equipmentCadenceMap?.[challenge.equipment];
          const rpmVal = Number(cadenceEntry?.rpm);
          const equipmentRpm = Number.isFinite(rpmVal) ? rpmVal : 0;

          const riderZone = userZoneMap?.[challenge.rider];
          const riderRank = this._getZoneRank(riderZone) ?? 0;
          const baseReqMinRank = this._getBaseRequirementMinRank(activePolicy.baseRequirement);
          const baseReqSatisfiedForRider = riderRank >= baseReqMinRank;
          const baseReqSatisfiedGlobal = this.phase === 'unlocked';

          const ctx = {
            equipmentRpm,
            activeParticipants,
            userZoneMap,
            baseReqSatisfiedForRider,
            baseReqSatisfiedGlobal
          };

          this._evaluateCycleChallenge(challenge, ctx);
          challenge.currentRpm = equipmentRpm;
          const _cPhase = challenge.generatedPhases?.[challenge.currentPhaseIndex];
          challenge.phaseProgressPct = _cPhase?.maintainSeconds
            ? Math.min(1.0, (challenge.phaseProgressMs || 0) / (_cPhase.maintainSeconds * 1000))
            : 0;

          // Success: record history, apply cooldowns, clear, schedule next.
          if (challenge.status === 'success') {
            if (!challenge.historyRecorded) {
              const completedAt = challenge.completedAt || now;
              const cooldownMs = (challenge.selection?.userCooldownSeconds || 600) * 1000;
              const ridersUsed = Array.isArray(challenge.ridersUsed)
                ? [...challenge.ridersUsed]
                : (challenge.rider ? [challenge.rider] : []);
              const boostContributors = challenge.boostContributors
                ? [...challenge.boostContributors]
                : [];
              const totalBoostedMs = Math.round(challenge.totalBoostedMs || 0);
              const totalLockEventsCount = challenge.totalLockEventsCount || 0;

              ridersUsed.forEach(uid => {
                this._cycleCooldowns[uid] = now + cooldownMs;
              });

              this.challengeState.challengeHistory.push({
                id: challenge.id,
                type: 'cycle',
                status: 'success',
                startedAt: challenge.startedAt,
                completedAt,
                selectionLabel: challenge.selectionLabel || null,
                equipment: challenge.equipment,
                rider: challenge.rider,
                ridersUsed,
                totalPhases: challenge.totalPhases,
                phasesCompleted: challenge.totalPhases,
                totalLockEventsCount,
                totalBoostedMs,
                boostContributors
              });
              if (this.challengeState.challengeHistory.length > 20) {
                this.challengeState.challengeHistory.splice(
                  0,
                  this.challengeState.challengeHistory.length - 20
                );
              }
              challenge.historyRecorded = true;

              getLogger().info('governance.cycle.completed', {
                challengeId: challenge.id,
                status: 'success',
                rider: challenge.rider,
                ridersUsed,
                totalPhases: challenge.totalPhases,
                phasesCompleted: challenge.totalPhases,
                totalLockEventsCount,
                totalBoostedMs,
                boostContributors,
                durationMs: completedAt - challenge.startedAt
              });

              ridersUsed.forEach(uid => {
                getLogger().info('governance.cycle.cooldown_applied', {
                  rider: uid,
                  cooldownUntilMs: this._cycleCooldowns[uid],
                  trigger: 'success'
                });
              });
            }

            this.challengeState.activeChallenge = null;
            this.challengeState.videoLocked = false;

            const nextDelay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
            queueNextChallenge(nextDelay);
            this._schedulePulse(50);
            return;
          }

          // Locked cycleState: drive lock screen but keep the challenge alive
          // so rider can recover (handled by _evaluateCycleChallenge next tick).
          if (challenge.cycleState === 'locked') {
            this.challengeState.videoLocked = true;
            this._schedulePulse(250);
            return;
          }

          // Otherwise (init / ramp / maintain): challenge is progressing.
          this.challengeState.videoLocked = false;
          const nextPulseMs = challenge.cycleState === 'maintain' ? 200 : 500;
          this._schedulePulse(nextPulseMs);
          return;
        }

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
            this._setPhase('locked', evalContext);
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
      // Only bypass feasibility if explicitly requested via payload.forced
      const isForced = forceStartRequest?.payload?.forced === true;
      const started = startChallenge({ previewOverride: forcePreviewPayload, forced: isForced });
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
  
  // Public method to trigger a challenge manually.
  //
  // Two shapes are supported:
  //
  //   1. Cycle challenge trigger (admin/manual firing):
  //        { type: 'cycle', selectionId, riderId? }
  //      - Finds the cycle selection by its normalized ID
  //        (format `${policyId}_${challengeIdx}_${selectionIdx}`).
  //      - If `riderId` is provided, forces that rider (bypasses the per-user
  //        cooldown + random pick in `_startCycleChallenge`). Caller must pass
  //        a userId that appears in the equipment's `eligible_users`.
  //      - On success, sets `challengeState.activeChallenge` directly and
  //        returns `{ success: true, challengeId }`.
  //      - On failure returns `{ success: false, reason }` where reason is
  //        one of: 'selection_not_found', 'rider_not_eligible',
  //        'equipment_not_found', 'no_eligible_riders',
  //        'force_rider_not_eligible', 'all_riders_on_cooldown',
  //        or 'failed_to_start' as a defensive fallback.
  //
  //   2. Legacy zone/vibration trigger (any other payload shape):
  //      - Sets `challengeState.forceStartRequest` and kicks a pulse so the
  //        main `_evaluateChallenges` loop picks it up and schedules/starts a
  //        challenge the normal way. Returns undefined (unchanged behavior).
  triggerChallenge(payload) {
    if (payload && payload.type === 'cycle') {
      const selectionId = payload.selectionId;
      // Find the cycle selection by ID in the active, normalized policies.
      let cycleSelection = null;
      let matchingPolicyId = null;
      let matchingPolicyName = null;
      for (const policy of (this.policies || [])) {
        for (const challenge of (policy.challenges || [])) {
          const found = (challenge.selections || []).find(s => s.id === selectionId && s.type === 'cycle');
          if (found) {
            cycleSelection = found;
            matchingPolicyId = policy.id || policy.policyId || null;
            matchingPolicyName = policy.name || policy.label || null;
            break;
          }
        }
        if (cycleSelection) break;
      }

      if (!cycleSelection) {
        getLogger().info('governance.cycle.triggered_manually', {
          selectionId: selectionId || null,
          riderId: payload.riderId || null,
          force: false,
          accepted: false,
          rejectionReason: 'selection_not_found'
        });
        return { success: false, reason: 'selection_not_found' };
      }

      if (payload.riderId) {
        const eligible = this._getEligibleUsers(cycleSelection.equipment);
        if (!eligible.includes(payload.riderId)) {
          getLogger().info('governance.cycle.triggered_manually', {
            selectionId,
            riderId: payload.riderId,
            equipment: cycleSelection.equipment,
            force: true,
            accepted: false,
            rejectionReason: 'rider_not_eligible'
          });
          return { success: false, reason: 'rider_not_eligible' };
        }
      }

      const active = this._startCycleChallenge(cycleSelection, {
        forceRiderId: payload.riderId || null,
        policyId: matchingPolicyId,
        policyName: matchingPolicyName,
        configId: null
      });

      if (!active || active.ok === false) {
        const rejectionReason = active?.reason || 'failed_to_start';
        getLogger().info('governance.cycle.triggered_manually', {
          selectionId,
          riderId: payload.riderId || null,
          force: Boolean(payload.riderId),
          accepted: false,
          rejectionReason
        });
        return { success: false, reason: rejectionReason };
      }

      this.challengeState.activeChallenge = active;

      getLogger().info('governance.cycle.triggered_manually', {
        selectionId,
        riderId: active.rider,
        challengeId: active.id,
        equipment: cycleSelection.equipment,
        force: Boolean(payload.riderId),
        accepted: true
      });

      return { success: true, challengeId: active.id };
    }

    // Legacy path — zone/vibration and any other non-cycle payloads.
    this.challengeState.forceStartRequest = {
      requestedAt: this._now(),
      payload: payload ? { ...payload } : null
    };
    // Wrap pulse so malformed payloads (e.g., missing `.selection`) don't throw
    // out of the public trigger method — the payload remains queued on
    // challengeState.forceStartRequest and will be evaluated on the next tick.
    try {
      this._triggerPulse();
    } catch (err) {
      getLogger().warn('governance.triggerChallenge.pulse_error', {
        error: err?.message || String(err)
      });
    }
  }

  /**
   * Swap the rider on the currently active cycle challenge.
   *
   * Swap is only allowed in a narrow window:
   *   - cycleState === 'init', OR
   *   - cycleState === 'ramp' AND currentPhaseIndex === 0 (i.e. phase-1 ramp)
   *
   * Rejected if:
   *   - there is no active cycle challenge
   *   - swap window is closed
   *   - riderId not in equipment's eligible_users
   *   - rider is on cooldown (unless { force: true })
   *
   * On success, updates active.rider, appends to ridersUsed (unique), resets
   * cycleState to 'init' and all in-phase timers, stamps a fresh initStartedAt.
   *
   * @param {string} riderId - Target rider user ID
   * @param {{ force?: boolean }} [options] - force: bypass cooldown check
   * @returns {{ success: boolean, reason?: string }}
   */
  swapCycleRider(riderId, { force = false } = {}) {
    const active = this.challengeState.activeChallenge;
    if (!active || active.type !== 'cycle') {
      getLogger().info('governance.cycle.swap_requested', {
        challengeId: active?.id || null,
        fromRider: active?.rider || null,
        toRider: riderId,
        cycleState: active?.cycleState || null,
        force,
        accepted: false,
        rejectionReason: 'no_active_cycle_challenge'
      });
      return { success: false, reason: 'no active cycle challenge' };
    }
    const allowed = active.cycleState === 'init'
      || (active.cycleState === 'ramp' && active.currentPhaseIndex === 0);
    if (!allowed) {
      getLogger().info('governance.cycle.swap_requested', {
        challengeId: active.id,
        fromRider: active.rider,
        toRider: riderId,
        cycleState: active.cycleState,
        force,
        accepted: false,
        rejectionReason: 'swap_window_closed'
      });
      return { success: false, reason: 'swap window closed' };
    }
    const eligible = this._getEligibleUsers(active.equipment);
    if (!eligible.includes(riderId)) {
      getLogger().info('governance.cycle.swap_requested', {
        challengeId: active.id,
        fromRider: active.rider,
        toRider: riderId,
        cycleState: active.cycleState,
        force,
        accepted: false,
        rejectionReason: 'not_eligible'
      });
      return { success: false, reason: 'rider not eligible for this equipment' };
    }
    const now = this._now();
    if (!force && this._cycleCooldowns[riderId] && this._cycleCooldowns[riderId] > now) {
      getLogger().info('governance.cycle.swap_requested', {
        challengeId: active.id,
        fromRider: active.rider,
        toRider: riderId,
        cycleState: active.cycleState,
        force,
        accepted: false,
        rejectionReason: 'on_cooldown'
      });
      return { success: false, reason: 'rider on cooldown' };
    }
    const fromRider = active.rider;
    active.rider = riderId;
    if (!active.ridersUsed.includes(riderId)) active.ridersUsed.push(riderId);
    active.cycleState = 'init';
    active.initElapsedMs = 0;
    active.initStartedAt = now;
    active.rampElapsedMs = 0;
    active.phaseProgressMs = 0;
    getLogger().info('governance.cycle.swap_requested', {
      challengeId: active.id,
      fromRider,
      toRider: riderId,
      cycleState: active.cycleState,
      force,
      accepted: true
    });
    getLogger().info('governance.cycle.swap_completed', {
      challengeId: active.id,
      fromRider,
      toRider: riderId,
      ridersUsed: [...active.ridersUsed]
    });
    return { success: true };
  }

  /**
   * Abandon the currently active cycle challenge (e.g. session ending, user
   * explicitly gives up). Records an 'abandoned' history entry, applies
   * cooldowns to every rider that participated, clears the active challenge,
   * and releases the video lock. No-op if there is no active challenge or if
   * the active challenge is not a cycle.
   */
  abandonActiveChallenge() {
    const active = this.challengeState.activeChallenge;
    if (!active || active.type !== 'cycle') return;
    const now = this._now();
    const cooldownMs = (active.selection?.userCooldownSeconds || 600) * 1000;
    const ridersUsed = Array.isArray(active.ridersUsed) ? [...active.ridersUsed] : [];
    const boostContributors = active.boostContributors ? [...active.boostContributors] : [];
    const totalBoostedMs = Math.round(active.totalBoostedMs || 0);
    const totalLockEventsCount = active.totalLockEventsCount || 0;

    ridersUsed.forEach(uid => {
      this._cycleCooldowns[uid] = now + cooldownMs;
    });

    this.challengeState.challengeHistory.push({
      id: active.id,
      type: 'cycle',
      status: 'abandoned',
      startedAt: active.startedAt,
      completedAt: now,
      selectionLabel: active.selectionLabel || null,
      equipment: active.equipment,
      rider: active.rider,
      ridersUsed,
      totalPhases: active.totalPhases,
      phasesCompleted: active.currentPhaseIndex,
      totalLockEventsCount,
      totalBoostedMs,
      boostContributors
    });
    if (this.challengeState.challengeHistory.length > 20) {
      this.challengeState.challengeHistory.splice(
        0,
        this.challengeState.challengeHistory.length - 20
      );
    }

    getLogger().info('governance.cycle.completed', {
      challengeId: active.id,
      status: 'abandoned',
      rider: active.rider,
      ridersUsed,
      totalPhases: active.totalPhases,
      phasesCompleted: active.currentPhaseIndex,
      totalLockEventsCount,
      totalBoostedMs,
      boostContributors,
      durationMs: now - active.startedAt
    });
    ridersUsed.forEach(uid => {
      getLogger().info('governance.cycle.cooldown_applied', {
        rider: uid,
        cooldownUntilMs: this._cycleCooldowns[uid],
        trigger: 'abandoned'
      });
    });

    this.challengeState.activeChallenge = null;
    this.challengeState.videoLocked = false;
  }
}
