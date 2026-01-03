/**
 * TimelineRecorder - Handles complete timeline metric recording for fitness sessions.
 *
 * Single Responsibility: Own all timeline tick recording, cumulative metrics, dropout
 * detection, and ActivityMonitor integration.
 *
 * Extracted from FitnessSession._collectTimelineTick() as part of the
 * Single Responsibility refactoring (postmortem-entityid-migration-fitnessapp.md #13).
 *
 * Dependencies (injected):
 * - DeviceManager: Source of device metrics
 * - UserManager: User state and device-to-user mapping
 * - TreasureBox: Coin accumulation (called synchronously during tick)
 * - FitnessTimeline: Time-series data storage
 * - ActivityMonitor: Single source of truth for participant activity state
 * - EventJournal: Structured event logging
 *
 * @see /docs/design/fitness-data-flow.md
 * @see /docs/design/fitness-identifier-contract.md
 */

import getLogger from '../../lib/logging/Logger.js';

// -------------------- Sanitization Helpers --------------------

const sanitizeHeartRate = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : null);
const sanitizeNumber = (value) => (Number.isFinite(value) ? value : null);
const sanitizeDistance = (value) => (Number.isFinite(value) && value > 0 ? value : null);

const hasNumericSample = (metrics = {}) =>
  ['heartRate', 'rpm', 'power', 'distance'].some((key) => metrics[key] != null);

const isValidTickKey = (key) => {
  if (!key || typeof key !== 'string') return false;
  const segments = key.split(':');

  // user:<userId>:<metric> and device:<deviceId>:<metric>
  if (segments.length === 3) {
    return segments.every((segment) => !!segment && /^[a-z0-9_-]+$/i.test(segment));
  }

  // global:<metric>
  if (segments.length === 2 && segments[0] === 'global') {
    return segments.every((segment) => !!segment && /^[a-z0-9_-]+$/i.test(segment));
  }

  return false;
};

// -------------------- TimelineRecorder Class --------------------

/**
 * @typedef {Object} TimelineRecorderConfig
 * @property {number} [intervalMs=5000] - Tick interval in milliseconds
 */

/**
 * @typedef {Object} TimelineRecorderDependencies
 * @property {Object} deviceManager - DeviceManager instance
 * @property {Object} userManager - UserManager instance
 * @property {Object} [treasureBox] - TreasureBox instance (optional until session starts)
 * @property {Object} timeline - FitnessTimeline instance
 * @property {Object} [activityMonitor] - ActivityMonitor instance
 * @property {Object} [eventJournal] - EventJournal instance
 * @property {Function} [resolveEquipmentId] - Equipment ID resolver function
 */

export class TimelineRecorder {
  /**
   * @param {TimelineRecorderConfig} [config]
   */
  constructor(config = {}) {
    this._intervalMs = config.intervalMs || 5000;

    // Dependencies (injected via configure())
    this._deviceManager = null;
    this._userManager = null;
    this._treasureBox = null;
    this._timeline = null;
    this._activityMonitor = null;
    this._eventJournal = null;
    this._resolveEquipmentId = null;

    // Cumulative tracking (survives tick-to-tick)
    this._cumulativeBeats = new Map();
    this._cumulativeRotations = new Map();

    // Track which users have had initial coins_total=0 recorded
    this._usersWithCoinsRecorded = new Set();

    // Pending snapshot reference for next tick
    this._pendingSnapshotRef = null;

    // Debug logging state
    this._chartDebugLogged = { noSeries: false };

    // Logging callback
    this._onLog = null;
  }

  // -------------------- Configuration --------------------

  /**
   * Configure dependencies. Call once after construction.
   * @param {TimelineRecorderDependencies} deps
   */
  configure(deps) {
    this._deviceManager = deps.deviceManager;
    this._userManager = deps.userManager;
    this._treasureBox = deps.treasureBox;
    this._timeline = deps.timeline;
    this._activityMonitor = deps.activityMonitor;
    this._eventJournal = deps.eventJournal;
    this._resolveEquipmentId = deps.resolveEquipmentId || (() => null);
  }

  /**
   * Update TreasureBox reference (set when session starts).
   * @param {Object} treasureBox
   */
  setTreasureBox(treasureBox) {
    this._treasureBox = treasureBox;
  }

  /**
   * Update timeline reference.
   * @param {Object} timeline
   */
  setTimeline(timeline) {
    this._timeline = timeline;
  }

  /**
   * Set tick interval.
   * @param {number} intervalMs
   */
  setInterval(intervalMs) {
    this._intervalMs = intervalMs;
  }

  /**
   * Set logging callback for structured events.
   * @param {Function} callback - (eventName, data) => void
   */
  setLogCallback(callback) {
    this._onLog = callback;
  }

  /**
   * Set pending snapshot reference to include in next tick.
   * @param {string} ref
   */
  setPendingSnapshotRef(ref) {
    this._pendingSnapshotRef = ref;
  }

  // -------------------- Reset --------------------

  /**
   * Reset all state for a new session.
   */
  reset() {
    this._cumulativeBeats.clear();
    this._cumulativeRotations.clear();
    this._usersWithCoinsRecorded.clear();
    this._pendingSnapshotRef = null;
    this._chartDebugLogged = { noSeries: false };
  }

  // -------------------- Main Recording Method --------------------

  /**
   * Collect metrics for one timeline tick.
   * This is the main method extracted from FitnessSession._collectTimelineTick().
   *
   * @param {Object} params
   * @param {number} [params.timestamp] - Current timestamp (defaults to Date.now())
   * @param {string} [params.sessionId] - Session ID for validation
   * @param {Array} [params.roster] - Current roster for baseline recording
   * @returns {Object|null} - Tick result from timeline, or null if not ready
   */
  recordTick({ timestamp, sessionId, roster = [] } = {}) {
    if (!this._timeline || !sessionId) return null;

    const tickPayload = {};
    const currentTickIndex = this._timeline.timebase?.tickCount ?? 0;
    const intervalMs = this._timeline?.timebase?.intervalMs || this._intervalMs;
    const intervalSeconds = intervalMs / 1000;

    // -------------------- Helper Functions --------------------

    const assignMetric = (key, value) => {
      if (!key) return;
      if (typeof value === 'number' && Number.isNaN(value)) return;
      // Preserve explicit nulls for dropout representation
      tickPayload[key] = value === undefined ? null : value;
    };

    /**
     * Assign a metric to a participant series.
     * Strict identifier contract: ALWAYS keyed by userId.
     * @param {string} userId
     * @param {string} metric
     * @param {*} value
     */
    const assignUserMetric = (userId, metric, value) => {
      if (!userId || !metric) return;
      assignMetric(`user:${userId}:${metric}`, value);
    };

    const stageUserEntry = (user, deviceId) => {
      if (!user?.id) return null;
      const userId = user.id;
      const snapshot = typeof user.getMetricsSnapshot === 'function' ? user.getMetricsSnapshot() : {};
      return {
        userId,
        deviceId,
        _hasDeviceDataThisTick: false, // Set true when device data received
        metadata: {
          name: user.name,
          groupLabel: user.groupLabel || null,
          source: user.source || null,
          color: snapshot?.zoneColor || user.currentData?.color || null
        },
        metrics: {
          heartRate: sanitizeHeartRate(snapshot?.heartRate ?? user.currentData?.heartRate),
          zoneId: snapshot?.zoneId || user.currentData?.zone || null,
          rpm: sanitizeNumber(snapshot?.rpm),
          power: sanitizeNumber(snapshot?.power),
          distance: sanitizeDistance(snapshot?.distance)
        }
      };
    };

    const validateTickPayloadKeys = () => {
      const invalidKeys = [];
      Object.keys(tickPayload).forEach((key) => {
        if (isValidTickKey(key)) return;
        invalidKeys.push(key);
        delete tickPayload[key];
      });
      if (invalidKeys.length) {
        this._log('timeline_tick_invalid_key', { keys: invalidKeys });
      }
    };

    // ID Consistency validation helper
    const validateIdConsistency = (userId, deviceId, ledgerEntry) => {
      const ledgerId = ledgerEntry?.metadata?.profileId || ledgerEntry?.occupantId;
      if (ledgerId && userId && ledgerId !== userId) {
        console.error('[TimelineRecorder] ID MISMATCH:', {
          userId,
          ledgerId,
          deviceId,
          ledgerOccupantName: ledgerEntry?.occupantName
        });
        this._eventJournal?.log('ID_MISMATCH', { userId, ledgerId, deviceId }, { severity: 'error' });
        return false;
      }
      return true;
    };

    // -------------------- Device Processing --------------------

    const userMetricMap = new Map();
    const deviceInactiveUsers = new Set();

    const devices = this._deviceManager?.getAllDevices() || [];
    devices.forEach((device) => {
      if (!device) return;
      const deviceId = device.id ? String(device.id) : null;
      if (!deviceId) return;

      // Check if device is inactive (aligns chart dropout with sidebar state)
      if (device.inactiveSince) {
        const mappedUser = this._userManager?.resolveUserForDevice(deviceId);
        if (mappedUser?.id) {
          deviceInactiveUsers.add(mappedUser.id);
          // Ensure user is in map for null HR recording
          if (!userMetricMap.has(mappedUser.id)) {
            const staged = stageUserEntry(mappedUser, deviceId);
            if (staged) userMetricMap.set(mappedUser.id, staged);
          }
        }
      }

      // Get device metrics
      const metrics = typeof device.getMetricsSnapshot === 'function'
        ? device.getMetricsSnapshot()
        : null;
      const sanitizedDeviceMetrics = {
        rpm: sanitizeNumber(metrics?.rpm ?? metrics?.cadence),
        power: sanitizeNumber(metrics?.power),
        speed: sanitizeNumber(metrics?.speed),
        distance: sanitizeDistance(metrics?.distance),
        heartRate: sanitizeHeartRate(metrics?.heartRate)
      };

      // Record device-level metrics
      const hasDeviceSample = Object.values(sanitizedDeviceMetrics).some((val) => val != null);
      if (hasDeviceSample) {
        assignMetric(`device:${deviceId}:rpm`, sanitizedDeviceMetrics.rpm);
        assignMetric(`device:${deviceId}:power`, sanitizedDeviceMetrics.power);
        assignMetric(`device:${deviceId}:speed`, sanitizedDeviceMetrics.speed);
        assignMetric(`device:${deviceId}:distance`, sanitizedDeviceMetrics.distance);
        assignMetric(`device:${deviceId}:heart_rate`, sanitizedDeviceMetrics.heartRate);
      }

      // Cumulative rotations for equipment
      const equipmentId = this._resolveEquipmentId(device);
      const equipmentKey = equipmentId || deviceId;
      if (equipmentKey) {
        const prevRotations = this._cumulativeRotations.get(equipmentKey) || 0;
        const deltaRotations = Number.isFinite(sanitizedDeviceMetrics.rpm) && sanitizedDeviceMetrics.rpm > 0
          ? (sanitizedDeviceMetrics.rpm / 60) * intervalSeconds
          : 0;
        const nextRotations = prevRotations + deltaRotations;
        this._cumulativeRotations.set(equipmentKey, nextRotations);
        assignMetric(`device:${equipmentKey}:rotations`, nextRotations);
      }

      // Skip user metric assignment if device is inactive
      if (device.inactiveSince) return;

      // Map device to user
      const mappedUser = this._userManager?.resolveUserForDevice(deviceId);
      if (!mappedUser?.id) return;
      const userId = mappedUser.id;

      // Validate ID consistency
      const ledgerEntry = this._userManager?.assignmentLedger?.get?.(deviceId);
      validateIdConsistency(userId, deviceId, ledgerEntry);

      // Stage user entry
      if (!userMetricMap.has(userId)) {
        const staged = stageUserEntry(mappedUser, deviceId);
        if (staged) userMetricMap.set(userId, staged);
      }

      // Merge device metrics into user entry
      const entry = userMetricMap.get(userId);
      if (!entry) return;
      entry._hasDeviceDataThisTick = true;
      entry.metrics.heartRate = entry.metrics.heartRate ?? sanitizedDeviceMetrics.heartRate;
      entry.metrics.rpm = entry.metrics.rpm ?? sanitizedDeviceMetrics.rpm;
      entry.metrics.power = entry.metrics.power ?? sanitizedDeviceMetrics.power;
      entry.metrics.distance = entry.metrics.distance ?? sanitizedDeviceMetrics.distance;
    });

    // -------------------- Activity Detection --------------------

    const currentTickActiveHR = new Set();
    const activeParticipantIds = new Set();

    // First pass: identify who has valid HR data this tick FROM DEVICE
    userMetricMap.forEach((entry, userId) => {
      if (!entry) return;
      // Only trust heartRate if we got FRESH device data this tick
      if (!entry._hasDeviceDataThisTick) return;
      // Don't count user as active if their device is inactive
      if (deviceInactiveUsers.has(entry.userId)) return;

      const hr = entry.metrics?.heartRate;
      const hasValidHR = hr != null && Number.isFinite(hr) && hr > 0;
      if (hasValidHR) {
        currentTickActiveHR.add(userId);
      }
    });

    // DEBUG: Log device-to-user mapping state periodically
    if (currentTickIndex < 3 || currentTickIndex % 10 === 0) {
      const usersWithData = Array.from(userMetricMap.entries())
        .filter(([_, e]) => e?._hasDeviceDataThisTick)
        .map(([mapUserId, e]) => ({
          mapUserId,
          userId: e?.userId,
          hr: e?.metrics?.heartRate
        }));
      getLogger().warn('fitness.timeline.tick', {
        tick: currentTickIndex,
        devices: devices.length,
        activeDevices: devices.filter(d => !d.inactiveSince).length,
        userMapSize: userMetricMap.size,
        usersWithDeviceData: usersWithData.length,
        users: usersWithData
      });
    }

    // -------------------- Dropout Detection --------------------

    // Record null for users who HAD active HR last tick but DON'T this tick
    const previousTickActive = this._activityMonitor?.getPreviousTickActive() || new Set();
    const droppedUsers = [];
    previousTickActive.forEach((userId) => {
      if (!currentTickActiveHR.has(userId)) {
        droppedUsers.push(userId);
      }
    });
    if (droppedUsers.length > 0) {
      console.log('[TimelineRecorder] DROPOUT DETECTED for:', droppedUsers);
    }

    // Record null HR for ALL roster users who are not currently active
    const inactiveUsers = [];
    userMetricMap.forEach((entry, mapUserId) => {
      if (!currentTickActiveHR.has(mapUserId)) {
        const userId = entry?.userId || mapUserId;
        assignUserMetric(userId, 'heart_rate', null);
        inactiveUsers.push(mapUserId);
      }
    });

    // -------------------- User Metrics Recording --------------------

    userMetricMap.forEach((entry, mapUserId) => {
      if (!entry) return;
      const userId = entry.userId || mapUserId;

      // Cumulative heart beats (always accumulate, even for inactive)
      const prevBeats = this._cumulativeBeats.get(userId) || 0;
      const hr = entry.metrics.heartRate;
      const hasValidHR = currentTickActiveHR.has(userId);
      const deltaBeats = hasValidHR ? (hr / 60) * intervalSeconds : 0;
      const nextBeats = prevBeats + deltaBeats;
      this._cumulativeBeats.set(userId, nextBeats);
      assignUserMetric(userId, 'heart_beats', nextBeats);

      // Only record other metrics if device is actively broadcasting valid HR
      if (!hasValidHR) return;

      activeParticipantIds.add(userId);
      assignUserMetric(userId, 'heart_rate', entry.metrics.heartRate);
      assignUserMetric(userId, 'zone_id', entry.metrics.zoneId);
      assignUserMetric(userId, 'rpm', entry.metrics.rpm);
      assignUserMetric(userId, 'power', entry.metrics.power);
      assignUserMetric(userId, 'distance', entry.metrics.distance);
    });

    // Update ActivityMonitor with current tick's activity
    if (this._activityMonitor) {
      this._activityMonitor.recordTick(currentTickIndex, activeParticipantIds, { timestamp });
    }

    // -------------------- Baseline Coin Recording --------------------

    // Ensure every roster user gets a baseline coins_total=0 once
    userMetricMap.forEach((entry) => {
      const userId = entry?.userId;
      if (userId && !this._usersWithCoinsRecorded.has(userId)) {
        assignMetric(`user:${userId}:coins_total`, 0);
        this._usersWithCoinsRecorded.add(userId);
      }
    });

    // -------------------- TreasureBox Processing --------------------

    if (this._treasureBox) {
      this._treasureBox.processTick(currentTickIndex, currentTickActiveHR, {});

      const treasureSummary = this._treasureBox.summary;
      if (treasureSummary) {
        assignMetric('global:coins_total', treasureSummary.totalCoins);
      }

      // Chart diagnostics
      this._logChartDiagnostics(roster, currentTickIndex);

      // Per-user coin totals
      const perUserCoinTotals = typeof this._treasureBox.getPerUserTotals === 'function'
        ? this._treasureBox.getPerUserTotals()
        : null;
      if (perUserCoinTotals && typeof perUserCoinTotals.forEach === 'function') {
        perUserCoinTotals.forEach((coins, key) => {
          if (!key) return;
          const coinValue = Number.isFinite(coins) ? coins : null;

          // Handle legacy entity keys
          if (typeof key === 'string' && key.startsWith('entity-')) {
            const acc = this._treasureBox?.perUser?.get(key);
            const profileId = acc?.profileId;
            this._log('treasurebox_entity_key_seen', { entityId: key, profileId });
            if (profileId) {
              assignMetric(`user:${profileId}:coins_total`, coinValue);
            }
            return;
          }

          assignMetric(`user:${key}:coins_total`, coinValue);
        });
      }
    }

    // -------------------- Pending Snapshot Reference --------------------

    if (this._pendingSnapshotRef) {
      assignMetric('global:snapshot_ref', this._pendingSnapshotRef);
      this._pendingSnapshotRef = null;
    }

    // -------------------- Finalize and Record --------------------

    validateTickPayloadKeys();
    const tickResult = this._timeline.tick(tickPayload, { timestamp });

    // Debug logging for dropout debugging
    if (currentTickIndex % 5 === 0 || currentTickIndex < 3) {
      this._logTimelineDebug(currentTickIndex, currentTickActiveHR);
    }

    return tickResult;
  }

  // -------------------- Accessors --------------------

  /**
   * Get cumulative beats for a user.
   * @param {string} userId
   * @returns {number}
   */
  getCumulativeBeats(userId) {
    return this._cumulativeBeats.get(userId) || 0;
  }

  /**
   * Get all cumulative beats.
   * @returns {Map<string, number>}
   */
  getAllCumulativeBeats() {
    return new Map(this._cumulativeBeats);
  }

  /**
   * Get cumulative rotations for equipment.
   * @param {string} equipmentKey
   * @returns {number}
   */
  getCumulativeRotations(equipmentKey) {
    return this._cumulativeRotations.get(equipmentKey) || 0;
  }

  /**
   * Get all cumulative rotations.
   * @returns {Map<string, number>}
   */
  getAllCumulativeRotations() {
    return new Map(this._cumulativeRotations);
  }

  /**
   * Transfer cumulative metrics from one user to another.
   * Used during grace period transfers.
   * @param {string} fromUserId
   * @param {string} toUserId
   */
  transferCumulativeMetrics(fromUserId, toUserId) {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return;

    // Transfer heart beats
    const fromBeats = this._cumulativeBeats.get(fromUserId);
    if (fromBeats != null) {
      const toBeats = this._cumulativeBeats.get(toUserId) || 0;
      this._cumulativeBeats.set(toUserId, toBeats + fromBeats);
      this._cumulativeBeats.delete(fromUserId);
    }

    // Transfer rotations (if fromUserId was used as equipment key)
    const fromRotations = this._cumulativeRotations.get(fromUserId);
    if (fromRotations != null) {
      const toRotations = this._cumulativeRotations.get(toUserId) || 0;
      this._cumulativeRotations.set(toUserId, toRotations + fromRotations);
      this._cumulativeRotations.delete(fromUserId);
    }

    console.log('[TimelineRecorder] Transferred cumulative metrics:', { fromUserId, toUserId });
  }

  // -------------------- Private Helpers --------------------

  _log(eventName, data) {
    if (this._onLog) {
      this._onLog(eventName, data);
    }
  }

  _logChartDiagnostics(roster, tickCount) {
    if (this._chartDebugLogged.noSeries) return;

    const rosterCount = Array.isArray(roster) ? roster.length : 0;
    const seriesCount = this._timeline?.series ? Object.keys(this._timeline.series).length : 0;

    if (rosterCount > 0 && tickCount >= 1 && seriesCount === 0) {
      this._chartDebugLogged.noSeries = true;
      this._log('chart_no_series', {
        rosterCount,
        tickCount,
        seriesCount,
        timebaseIntervalMs: this._timeline?.timebase?.intervalMs
      });
    }
  }

  _logTimelineDebug(tickIndex, activeHRSet) {
    if (!this._timeline?.series) return;

    const userSeries = {};
    const seriesKeys = Object.keys(this._timeline.series);

    seriesKeys.forEach(key => {
      if (key.startsWith('user:') && key.endsWith(':heart_rate')) {
        const slug = key.replace('user:', '').replace(':heart_rate', '');
        const hrSeries = this._timeline.series[key] || [];
        const beatsSeries = this._timeline.series[`user:${slug}:heart_beats`] || [];
        const coinsSeries = this._timeline.series[`user:${slug}:coins_total`] || [];

        const nullCount = hrSeries.filter(v => v === null).length;
        const validCount = hrSeries.filter(v => v !== null && Number.isFinite(v) && v > 0).length;

        userSeries[slug] = {
          hrLength: hrSeries.length,
          nullCount,
          validCount,
          lastHR: hrSeries.slice(-10),
          lastBeats: beatsSeries.slice(-10).map(v => v?.toFixed?.(1) ?? v),
          lastCoins: coinsSeries.slice(-10).map(v => v?.toFixed?.(1) ?? v),
          isActiveNow: activeHRSet.has(slug)
        };
      }
    });

    const debugData = {
      tick: tickIndex,
      totalSeries: seriesKeys.length,
      lastTickActiveHR: [...(this._activityMonitor?.getPreviousTickActive() || [])],
      currentTickActiveHR: [...activeHRSet],
      userSeries
    };

    this._log('timeline-debug', debugData);
  }
}

/**
 * Create a TimelineRecorder instance.
 * @param {TimelineRecorderConfig} [config]
 * @returns {TimelineRecorder}
 */
export const createTimelineRecorder = (config) => new TimelineRecorder(config);

export default TimelineRecorder;
