/**
 * MetricsRecorder - Handles timeline metric recording
 * 
 * Extracted from FitnessSession._collectTimelineTick() as part of Phase 4.
 * This module handles:
 * - Device metrics collection
 * - User metrics collection
 * - Cumulative value tracking (beats, rotations)
 * - Timeline tick recording
 * - Activity monitoring integration
 * 
 * @see /docs/notes/fitness-architecture-review.md Phase 4
 */

// Note: slugifyId has been removed - we now use user.id directly

/**
 * @typedef {Object} MetricsRecorderConfig
 * @property {number} [intervalMs=5000] - Tick interval in ms
 */

/**
 * @typedef {Object} RecordedMetrics
 * @property {Map<string, any>} tickPayload - Metrics keyed by series name
 * @property {Set<string>} activeParticipants - IDs with numeric data this tick
 * @property {number} tickIndex - Current tick index
 */

/**
 * Sanitization helpers
 */
const sanitizeNumber = (val) => {
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const sanitizeHeartRate = (val) => {
  if (val == null) return null;
  const hr = Number(val);
  if (!Number.isFinite(hr)) return null;
  if (hr < 30 || hr > 250) return null;
  return Math.round(hr);
};

const sanitizeDistance = (val) => {
  if (val == null) return null;
  const d = Number(val);
  return Number.isFinite(d) && d >= 0 ? d : null;
};

/**
 * Check if metrics object has any numeric sample
 * @param {Object} metrics 
 * @returns {boolean}
 */
const hasNumericSample = (metrics = {}) => {
  return ['heartRate', 'rpm', 'power', 'distance'].some((key) => metrics[key] != null);
};

/**
 * Validate tick payload key format
 * @param {string} key 
 * @returns {boolean}
 */
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

/**
 * MetricsRecorder class - handles metric collection and recording
 */
export class MetricsRecorder {
  /**
   * @param {MetricsRecorderConfig} [config]
   */
  constructor(config = {}) {
    this._intervalMs = config.intervalMs || 5000;
    
    // Cumulative tracking
    this._cumulativeBeats = new Map();
    this._cumulativeRotations = new Map();
    
    // Equipment ID resolution cache
    this._equipmentIdByCadence = new Map();
    
    // Event logging callback
    this._onLog = null;
  }

  /**
   * Configure interval
   * @param {number} intervalMs 
   */
  setInterval(intervalMs) {
    this._intervalMs = intervalMs;
  }

  /**
   * Set logging callback
   * @param {Function} callback 
   */
  setLogCallback(callback) {
    this._onLog = callback;
  }

  /**
   * Reset cumulative trackers
   */
  reset() {
    this._cumulativeBeats.clear();
    this._cumulativeRotations.clear();
    this._equipmentIdByCadence.clear();
  }

  /**
   * Collect metrics from all sources and build tick payload.
   * This is the main method - extracts logic from _collectTimelineTick.
   * 
   * @param {Object} params
   * @param {number} params.timestamp - Current timestamp
   * @param {number} params.tickIndex - Current tick index
   * @param {Object} params.deviceManager - DeviceManager instance
   * @param {Object} params.userManager - UserManager instance
   * @param {Object} [params.treasureBox] - TreasureBox instance
   * @param {string} [params.pendingSnapshotRef] - Pending snapshot reference
   * @returns {RecordedMetrics}
   */
  collectMetrics({ timestamp, tickIndex, deviceManager, userManager, treasureBox, pendingSnapshotRef }) {
    const tickPayload = {};
    const activeParticipants = new Set();
    const intervalSeconds = this._intervalMs / 1000;

    const assignMetric = (key, value) => {
      if (!key) return;
      if (typeof value === 'number' && Number.isNaN(value)) return;

      // Preserve explicit nulls so consumers can represent dropouts and missing samples.
      tickPayload[key] = value === undefined ? null : value;
    };

    // Stage user entries (only once we have a stable participant id)
    const userMetricMap = new Map();

    // Process devices
    const devices = deviceManager.getAllDevices();
    
    devices.forEach((device) => {
      if (!device) return;
      
      // Use device ID directly
      const deviceId = device.id ? String(device.id) : null;
      if (!deviceId) return;
      
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

      // Record device metrics if any valid data
      const hasDeviceSample = Object.values(sanitizedDeviceMetrics).some((val) => val != null);
      if (hasDeviceSample) {
        assignMetric(`device:${deviceId}:rpm`, sanitizedDeviceMetrics.rpm);
        assignMetric(`device:${deviceId}:power`, sanitizedDeviceMetrics.power);
        assignMetric(`device:${deviceId}:speed`, sanitizedDeviceMetrics.speed);
        assignMetric(`device:${deviceId}:distance`, sanitizedDeviceMetrics.distance);
        assignMetric(`device:${deviceId}:heart_rate`, sanitizedDeviceMetrics.heartRate);
      }

      // Track cumulative rotations for equipment
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

      // Map device to user
      const mappedUser = userManager.resolveUserForDevice(deviceId);
      if (!mappedUser) return;
      
      const userId = mappedUser.id;
      if (!userId) return;
      
      // Ensure user is in map
      if (!userMetricMap.has(userId)) {
        const staged = this._stageUserEntry(mappedUser);
        if (staged) {
          userMetricMap.set(userId, staged);
        }
      }
      
      // Merge device metrics into user entry
      const entry = userMetricMap.get(userId);
      if (!entry) return;
      entry.metrics.heartRate = entry.metrics.heartRate ?? sanitizedDeviceMetrics.heartRate;
      entry.metrics.rpm = entry.metrics.rpm ?? sanitizedDeviceMetrics.rpm;
      entry.metrics.power = entry.metrics.power ?? sanitizedDeviceMetrics.power;
      entry.metrics.distance = entry.metrics.distance ?? sanitizedDeviceMetrics.distance;
    });

    // Process user metrics
    userMetricMap.forEach((entry, userId) => {
      if (!entry) return;
      
      // Cumulative heart beats
      const prevBeats = this._cumulativeBeats.get(userId) || 0;
      const hr = entry.metrics.heartRate;
      const deltaBeats = Number.isFinite(hr) && hr > 0
        ? (hr / 60) * intervalSeconds
        : 0;
      const nextBeats = prevBeats + deltaBeats;
      this._cumulativeBeats.set(userId, nextBeats);
      assignMetric(`user:${userId}:heart_beats`, nextBeats);

      // Only record other metrics if we have numeric sample
      if (!hasNumericSample(entry.metrics)) return;
      
      // Track as active participant
      activeParticipants.add(userId);
      
      assignMetric(`user:${userId}:heart_rate`, entry.metrics.heartRate);
      assignMetric(`user:${userId}:zone_id`, entry.metrics.zoneId);
      assignMetric(`user:${userId}:rpm`, entry.metrics.rpm);
      assignMetric(`user:${userId}:power`, entry.metrics.power);
      assignMetric(`user:${userId}:distance`, entry.metrics.distance);
    });

    // TreasureBox metrics
    if (treasureBox) {
      const treasureSummary = treasureBox.summary;
      if (treasureSummary) {
        assignMetric('global:coins_total', treasureSummary.totalCoins);
      }
      
      const perUserCoinTotals = typeof treasureBox.getPerUserTotals === 'function'
        ? treasureBox.getPerUserTotals()
        : null;
      
      if (perUserCoinTotals && typeof perUserCoinTotals.forEach === 'function') {
        perUserCoinTotals.forEach((coins, userId) => {
          if (!userId) return;
          assignMetric(`user:${userId}:coins_total`, Number.isFinite(coins) ? coins : null);
        });
      }
    }

    // Pending snapshot reference
    if (pendingSnapshotRef) {
      assignMetric('global:snapshot_ref', pendingSnapshotRef);
    }

    // Validate keys
    this._validateTickPayloadKeys(tickPayload);

    return {
      tickPayload,
      activeParticipants,
      tickIndex
    };
  }

  /**
   * Get cumulative beats for a user
   * @param {string} userId 
   * @returns {number}
   */
  getCumulativeBeats(userId) {
    return this._cumulativeBeats.get(userId) || 0;
  }

  /**
   * Get all cumulative beats
   * @returns {Map<string, number>}
   */
  getAllCumulativeBeats() {
    return new Map(this._cumulativeBeats);
  }

  /**
   * Get cumulative rotations for equipment
   * @param {string} equipmentId 
   * @returns {number}
   */
  getCumulativeRotations(equipmentId) {
    return this._cumulativeRotations.get(equipmentId) || 0;
  }

  // Private helpers

  _stageUserEntry(user) {
    if (!user?.id) return null;
    const userId = user.id;
    
    const snapshot = typeof user.getMetricsSnapshot === 'function' ? user.getMetricsSnapshot() : {};
    
    return {
      userId,
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
  }

  _resolveEquipmentId(device) {
    // Equipment ID resolution based on cadence sensor mapping
    // This is a simplified version - the full logic lives in FitnessSession
    const deviceId = device?.id || device?.deviceId;
    if (!deviceId) return null;
    return this._equipmentIdByCadence.get(deviceId) || null;
  }

  _validateTickPayloadKeys(tickPayload) {
    const invalidKeys = [];
    Object.keys(tickPayload).forEach((key) => {
      if (isValidTickKey(key)) return;
      invalidKeys.push(key);
      delete tickPayload[key];
    });
    
    if (invalidKeys.length && this._onLog) {
      this._onLog('timeline_tick_invalid_key', { keys: invalidKeys });
    }
  }

  /**
   * Transfer cumulative metrics from one user to another.
   * Used during grace period transfers.
   * 
   * @param {string} fromUserId - Source user ID
   * @param {string} toUserId - Destination user ID
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

    console.log('[MetricsRecorder] Transferred cumulative metrics:', { fromUserId, toUserId });
  }
}

/**
 * Create a MetricsRecorder instance
 * @param {MetricsRecorderConfig} [config]
 * @returns {MetricsRecorder}
 */
export const createMetricsRecorder = (config) => new MetricsRecorder(config);

export default MetricsRecorder;
