/**
 * ActivityMonitor - Single Source of Truth for Participant Activity State
 * 
 * Centralizes activity tracking that was previously scattered across:
 * - DeviceManager (device timeout logic)
 * - FitnessSession.roster (roster membership)
 * - FitnessChartApp (isPresent tracking)
 * - buildSegments (heart_rate presence detection)
 * 
 * State Machine:
 *   ABSENT → ACTIVE (first broadcast)
 *   ACTIVE → IDLE (no data for idleThresholdTicks)
 *   IDLE → ACTIVE (resumed broadcasting)
 *   ACTIVE/IDLE → REMOVED (timeout exceeded)
 * 
 * @see /docs/notes/fitness-architecture-review.md
 */

import { 
  ParticipantStatus, 
  createActivityPeriod,
  isInSession,
  isBroadcasting,
  isDropout
} from './types.js';

/**
 * Default configuration for activity detection
 */
const DEFAULT_CONFIG = {
  /** Number of ticks without data before transitioning ACTIVE → IDLE */
  idleThresholdTicks: 2,
  /** Number of ticks without data before transitioning IDLE → REMOVED */
  removeThresholdTicks: 36,  // ~3 minutes at 5s intervals
  /** Interval in ms for each tick (used for timestamp calculations) */
  tickIntervalMs: 5000
};

/**
 * Participant activity state
 * @typedef {Object} ParticipantActivityState
 * @property {string} participantId
 * @property {import('./types.js').ParticipantStatusValue} status
 * @property {number} lastActiveTick - Last tick with actual data
 * @property {number} firstSeenTick - First tick participant was seen
 * @property {number} [lastActiveTimestamp] - Timestamp of lastActiveTick
 * @property {number} [firstSeenTimestamp] - Timestamp of firstSeenTick
 */

/**
 * Activity change event
 * @typedef {Object} ActivityChangeEvent
 * @property {string} participantId
 * @property {import('./types.js').ParticipantStatusValue} previousStatus
 * @property {import('./types.js').ParticipantStatusValue} newStatus
 * @property {number} tick
 * @property {number} [timestamp]
 */

/**
 * ActivityMonitor class - centralizes participant activity tracking
 */
export class ActivityMonitor {
  /**
   * @param {Object} [config]
   * @param {number} [config.idleThresholdTicks]
   * @param {number} [config.removeThresholdTicks]
   * @param {number} [config.tickIntervalMs]
   */
  constructor(config = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    
    /** @type {Map<string, ParticipantActivityState>} */
    this._participants = new Map();
    
    /** @type {Map<string, import('./types.js').ActivityPeriod[]>} */
    this._activityHistory = new Map();

    /** @type {Map<string, Array<{tick: number, value: any, timestamp: number, id: string}>>} */
    this._dropoutEvents = new Map();
    
    /** @type {Set<function(ActivityChangeEvent): void>} */
    this._subscribers = new Set();
    
    /** Current tick index */
    this._currentTick = 0;
    
    /** Start timestamp for tick calculations */
    this._startTimestamp = null;
    
    /** Participants who were active at the previous tick (for dropout detection) */
    this._previousTickActive = new Set();
  }

  /**
   * Reset the monitor for a new session
   * @param {number} [startTimestamp]
   */
  reset(startTimestamp = Date.now()) {
    this._participants.clear();
    this._activityHistory.clear();
    this._dropoutEvents.clear();
    this._currentTick = 0;
    this._startTimestamp = startTimestamp;
    this._previousTickActive = new Set();
  }

  /**Record a dropout event for a participant
   * @param {string} participantId
   * @param {number} tick
   * @param {any} value - The value at the dropout point (e.g. total coins or distance)
   * @param {number} [timestamp]
   */
  recordDropout(participantId, tick, value, timestamp) {
    if (!this._dropoutEvents.has(participantId)) {
      this._dropoutEvents.set(participantId, []);
    }
    const events = this._dropoutEvents.get(participantId);
    // Avoid duplicates at same tick
    if (!events.some(e => e.tick === tick)) {
      events.push({
        tick,
        value,
        timestamp: timestamp ?? this._tickToTimestamp(tick),
        id: `${participantId}-dropout-${tick}`
      });
      // Keep sorted by tick
      events.sort((a, b) => a.tick - b.tick);
    }
  }

  /**
   * Get dropout events for a participant
   * @param {string} participantId
   * @returns {Array<{tick: number, value: any, timestamp: number, id: string}>}
   */
  getDropoutEvents(participantId) {
    return this._dropoutEvents.get(participantId) || [];
  }

  /**
   * Get all dropout events for all participants
   * @returns {Map<string, Array<{tick: number, value: any, timestamp: number, id: string}>>}
   */
  getAllDropoutEvents() {
    return new Map(this._dropoutEvents);
  }

  /**
   * Reconstruct dropout events from timeline series data.
   * Scans heart_rate series for gaps (nulls) that indicate dropouts.
   * 
   * @param {Function} getSeries - Function(userId, metric) returning array
   * @param {string[]} participantIds - List of participants to scan
   * @param {Object} timebase - Timebase object for timestamp conversion
   */
  reconstructFromTimeline(getSeries, participantIds, timebase) {
    this._dropoutEvents.clear();
    
    participantIds.forEach(userId => {
      const hrSeries = getSeries(userId, 'heart_rate') || [];
      const coinSeries = getSeries(userId, 'coins_total') || [];
      
      let isTracking = false;
      let lastActiveTick = -1;
      
      hrSeries.forEach((hr, tick) => {
        const hasData = hr !== null && hr !== undefined;
        
        if (hasData) {
          if (!isTracking) {
            // Started or resumed tracking
            isTracking = true;
          }
          lastActiveTick = tick;
        } else {
          if (isTracking) {
            // Detected dropout (transition from active to inactive)
            // The dropout marker belongs at the last active tick
            const value = coinSeries[lastActiveTick] || 0;
            const timestamp = timebase ? (timebase.startTime + (lastActiveTick * 1000)) : this._tickToTimestamp(lastActiveTick);
            
            this.recordDropout(userId, lastActiveTick, value, timestamp);
            isTracking = false;
          }
        }
      });
    });
  }

  /**
   * Transfer activity history from one participant to another.
   * Used during grace period transfers to maintain a continuous line on the chart.
   * 
   * @param {string} fromId - Source participant ID
   * @param {string} toId - Destination participant ID
   */
  transferActivity(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;

    // 1. Transfer activity history
    const fromHistory = this._activityHistory.get(fromId);
    if (fromHistory) {
      const toHistory = this._activityHistory.get(toId) || [];
      // Merge and sort by startTick
      const merged = [...toHistory, ...fromHistory].sort((a, b) => a.startTick - b.startTick);
      this._activityHistory.set(toId, merged);
      // Clear source history
      this._activityHistory.delete(fromId);
    }

    // 2. Transfer dropout events
    const fromDropouts = this._dropoutEvents.get(fromId);
    if (fromDropouts) {
      const toDropouts = this._dropoutEvents.get(toId) || [];
      const merged = [...toDropouts, ...fromDropouts].sort((a, b) => a.tick - b.tick);
      this._dropoutEvents.set(toId, merged);
      this._dropoutEvents.delete(fromId);
    }

    // 3. Update participant state
    const fromState = this._participants.get(fromId);
    const toState = this._participants.get(toId);
    if (fromState) {
      if (!toState || fromState.lastActiveTick > (toState.lastActiveTick || -1)) {
        this._participants.set(toId, {
          ...fromState,
          participantId: toId
        });
      }
      this._participants.delete(fromId);
    }

    console.log('[ActivityMonitor] Transferred activity:', { fromId, toId });
  }

  /**
   * 
   * Update configuration
   * @param {Object} config 
   */
  configure(config) {
    this._config = { ...this._config, ...config };
  }

  /**
   * Get current configuration
   * @returns {typeof DEFAULT_CONFIG}
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Record activity for a participant at a specific tick.
   * This is the primary method for updating activity state.
   * 
   * @param {string} participantId 
   * @param {number} tick 
   * @param {boolean} hasData - Whether participant has actual data at this tick
   * @param {Object} [options]
   * @param {number} [options.timestamp]
   */
  recordActivity(participantId, tick, hasData, options = {}) {
    if (!participantId) return;
    
    this._currentTick = Math.max(this._currentTick, tick);
    const timestamp = options.timestamp ?? this._tickToTimestamp(tick);
    
    let state = this._participants.get(participantId);
    const previousStatus = state?.status ?? ParticipantStatus.ABSENT;
    
    if (!state) {
      // First time seeing this participant
      state = {
        participantId,
        status: hasData ? ParticipantStatus.ACTIVE : ParticipantStatus.ABSENT,
        lastActiveTick: hasData ? tick : -1,
        firstSeenTick: tick,
        lastActiveTimestamp: hasData ? timestamp : null,
        firstSeenTimestamp: timestamp
      };
      this._participants.set(participantId, state);
      this._activityHistory.set(participantId, []);
      
      if (hasData) {
        this._startPeriod(participantId, tick, ParticipantStatus.ACTIVE, timestamp);
        this._emitChange(participantId, previousStatus, ParticipantStatus.ACTIVE, tick, timestamp);
      }
      return;
    }
    
    // Existing participant - update state based on activity
    if (hasData) {
      state.lastActiveTick = tick;
      state.lastActiveTimestamp = timestamp;
      
      if (state.status !== ParticipantStatus.ACTIVE) {
        // Transitioning to ACTIVE (from IDLE or ABSENT)
        this._endCurrentPeriod(participantId, tick - 1);
        this._startPeriod(participantId, tick, ParticipantStatus.ACTIVE, timestamp);
        state.status = ParticipantStatus.ACTIVE;
        this._emitChange(participantId, previousStatus, ParticipantStatus.ACTIVE, tick, timestamp);
      }
    } else {
      // No data at this tick - check for status transitions
      const ticksSinceActive = tick - state.lastActiveTick;
      
      if (state.status === ParticipantStatus.ACTIVE && ticksSinceActive >= this._config.idleThresholdTicks) {
        // ACTIVE → IDLE (dropout detected)
        this._endCurrentPeriod(participantId, state.lastActiveTick);
        this._startPeriod(participantId, state.lastActiveTick + 1, ParticipantStatus.IDLE, timestamp);
        state.status = ParticipantStatus.IDLE;
        this._emitChange(participantId, previousStatus, ParticipantStatus.IDLE, tick, timestamp);
      } else if (state.status === ParticipantStatus.IDLE && ticksSinceActive >= this._config.removeThresholdTicks) {
        // IDLE → REMOVED (timeout)
        this._endCurrentPeriod(participantId, tick - 1);
        state.status = ParticipantStatus.REMOVED;
        this._emitChange(participantId, ParticipantStatus.IDLE, ParticipantStatus.REMOVED, tick, timestamp);
      }
    }
  }

  /**
   * Batch record activity for multiple participants at a tick.
   * Participants not in the activeIds set are considered to have no data.
   * 
   * @param {number} tick 
   * @param {Set<string>|string[]} activeIds - IDs with data at this tick
   * @param {Object} [options]
   * @param {number} [options.timestamp]
   */
  recordTick(tick, activeIds, options = {}) {
    const activeSet = activeIds instanceof Set ? activeIds : new Set(activeIds);
    
    // Detect dropouts: participants who were active last tick but not this tick
    const droppedOut = [];
    this._previousTickActive.forEach(id => {
      if (!activeSet.has(id)) {
        droppedOut.push(id);
      }
    });
    
    // Record activity for active participants
    activeSet.forEach(id => {
      this.recordActivity(id, tick, true, options);
    });
    
    // Record inactivity for known participants not in activeSet
    this._participants.forEach((state, id) => {
      if (!activeSet.has(id) && state.status !== ParticipantStatus.REMOVED) {
        this.recordActivity(id, tick, false, options);
      }
    });
    
    // Update previous tick tracking for next call
    this._previousTickActive = new Set(activeSet);
    this._currentTick = tick;
    
    // Return dropout info for callers who need it
    return { droppedOut, activeCount: activeSet.size };
  }
  
  /**
   * Get participants who were active at the previous tick.
   * Useful for detecting dropouts without maintaining separate state.
   * @returns {Set<string>}
   */
  getPreviousTickActive() {
    return new Set(this._previousTickActive);
  }
  
  /**
   * Check if a participant was active at the previous tick
   * @param {string} participantId
   * @returns {boolean}
   */
  wasActiveLastTick(participantId) {
    return this._previousTickActive.has(participantId);
  }

  /**
   * Build activity state from timeline series data.
   * Used to reconstruct state from persisted/historical data.
   * 
   * @param {string} participantId 
   * @param {Array<boolean|number|null>} activityMask - Array where truthy = active
   * @param {Object} [options]
   * @param {number} [options.startTimestamp]
   */
  buildFromSeries(participantId, activityMask, options = {}) {
    if (!participantId || !Array.isArray(activityMask)) return;
    
    const startTs = options.startTimestamp ?? this._startTimestamp ?? Date.now();
    
    // Reset this participant's state
    this._participants.delete(participantId);
    this._activityHistory.set(participantId, []);
    
    // Process each tick
    activityMask.forEach((isActive, tick) => {
      const hasData = Boolean(isActive);
      const timestamp = startTs + (tick * this._config.tickIntervalMs);
      this.recordActivity(participantId, tick, hasData, { timestamp });
    });
  }

  /**
   * Get current status for a participant
   * @param {string} participantId 
   * @returns {import('./types.js').ParticipantStatusValue}
   */
  getStatus(participantId) {
    return this._participants.get(participantId)?.status ?? ParticipantStatus.ABSENT;
  }

  /**
   * Get full activity state for a participant
   * @param {string} participantId 
   * @returns {ParticipantActivityState|null}
   */
  getState(participantId) {
    const state = this._participants.get(participantId);
    return state ? { ...state } : null;
  }

  /**
   * Get activity periods for a participant (for chart segment generation)
   * @param {string} participantId 
   * @returns {import('./types.js').ActivityPeriod[]}
   */
  getActivityPeriods(participantId) {
    const periods = this._activityHistory.get(participantId);
    return periods ? [...periods] : [];
  }

  /**
   * Get all participants with a specific status
   * @param {import('./types.js').ParticipantStatusValue} status 
   * @returns {string[]}
   */
  getParticipantsByStatus(status) {
    const result = [];
    this._participants.forEach((state, id) => {
      if (state.status === status) result.push(id);
    });
    return result;
  }

  /**
   * Get all active participants (ACTIVE status)
   * @returns {string[]}
   */
  getActiveParticipants() {
    return this.getParticipantsByStatus(ParticipantStatus.ACTIVE);
  }

  /**
   * Get all participants currently in session (ACTIVE or IDLE)
   * @returns {string[]}
   */
  getInSessionParticipants() {
    const result = [];
    this._participants.forEach((state, id) => {
      if (isInSession(state.status)) result.push(id);
    });
    return result;
  }

  /**
   * Get all known participants (any status except ABSENT)
   * @returns {string[]}
   */
  getAllParticipants() {
    return Array.from(this._participants.keys());
  }

  /**
   * Check if participant is currently active (broadcasting)
   * @param {string} participantId 
   * @returns {boolean}
   */
  isActive(participantId) {
    return isBroadcasting(this.getStatus(participantId));
  }

  /**
   * Check if participant is in dropout period
   * @param {string} participantId 
   * @returns {boolean}
   */
  isInDropout(participantId) {
    return isDropout(this.getStatus(participantId));
  }

  /**
   * Check if participant is in session (active or idle)
   * @param {string} participantId 
   * @returns {boolean}
   */
  isParticipantInSession(participantId) {
    return isInSession(this.getStatus(participantId));
  }

  /**
   * Subscribe to activity changes
   * @param {function(ActivityChangeEvent): void} callback 
   * @returns {function(): void} Unsubscribe function
   */
  subscribe(callback) {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  /**
   * Get activity status at a specific tick (for historical queries)
   * @param {string} participantId 
   * @param {number} tick 
   * @returns {import('./types.js').ParticipantStatusValue}
   */
  getStatusAtTick(participantId, tick) {
    const periods = this._activityHistory.get(participantId);
    if (!periods || periods.length === 0) return ParticipantStatus.ABSENT;
    
    for (const period of periods) {
      if (tick >= period.startTick && (period.endTick === null || tick <= period.endTick)) {
        return period.status;
      }
    }
    
    // Check if tick is before first period
    if (periods.length > 0 && tick < periods[0].startTick) {
      return ParticipantStatus.ABSENT;
    }
    
    // Check if tick is after last period (participant removed)
    const lastPeriod = periods[periods.length - 1];
    if (lastPeriod.endTick !== null && tick > lastPeriod.endTick) {
      return ParticipantStatus.REMOVED;
    }
    
    return ParticipantStatus.ABSENT;
  }

  /**
   * Generate activity mask array for a participant up to current tick.
   * Useful for chart rendering.
   * @param {string} participantId 
   * @param {number} [upToTick] - Defaults to current tick
   * @returns {boolean[]}
   */
  getActivityMask(participantId, upToTick) {
    const endTick = upToTick ?? this._currentTick;
    const mask = new Array(endTick + 1).fill(false);
    
    const periods = this._activityHistory.get(participantId);
    if (!periods) return mask;
    
    periods.forEach(period => {
      if (period.status === ParticipantStatus.ACTIVE) {
        const start = period.startTick;
        const end = period.endTick ?? endTick;
        for (let i = start; i <= Math.min(end, endTick); i++) {
          mask[i] = true;
        }
      }
    });
    
    return mask;
  }

  // ─────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────

  _tickToTimestamp(tick) {
    if (!this._startTimestamp) return Date.now();
    return this._startTimestamp + (tick * this._config.tickIntervalMs);
  }

  _startPeriod(participantId, startTick, status, timestamp) {
    const periods = this._activityHistory.get(participantId) || [];
    periods.push(createActivityPeriod(startTick, null, status, { startTimestamp: timestamp }));
    this._activityHistory.set(participantId, periods);
  }

  _endCurrentPeriod(participantId, endTick) {
    const periods = this._activityHistory.get(participantId);
    if (!periods || periods.length === 0) return;
    
    const currentPeriod = periods[periods.length - 1];
    if (currentPeriod.endTick === null) {
      currentPeriod.endTick = endTick;
      currentPeriod.endTimestamp = this._tickToTimestamp(endTick);
    }
  }

  _emitChange(participantId, previousStatus, newStatus, tick, timestamp) {
    if (this._subscribers.size === 0) return;
    
    const event = {
      participantId,
      previousStatus,
      newStatus,
      tick,
      timestamp
    };
    
    this._subscribers.forEach(callback => {
      try {
        callback(event);
      } catch (err) {
        console.error('[ActivityMonitor] Subscriber error:', err);
      }
    });
  }
}

/**
 * Create and configure an ActivityMonitor instance
 * @param {Object} [config] 
 * @returns {ActivityMonitor}
 */
export const createActivityMonitor = (config) => new ActivityMonitor(config);

export default ActivityMonitor;
