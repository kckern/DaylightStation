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

import { slugifyId } from './types.js';

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
  if (segments.length !== 3) return false;
  return segments.every((segment) => !!segment && /^[a-z0-9_]+$/i.test(segment));
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
      if (value != null && key) tickPayload[key] = value;
    };

    // Stage user entries
    const userMetricMap = new Map();
    const users = userManager.getAllUsers();
    
    users.forEach((user) => {
      const staged = this._stageUserEntry(user);
      if (staged) {
        userMetricMap.set(staged.slug, staged);
      }
    });

    // Process devices
    const devices = deviceManager.getAllDevices();
    
    devices.forEach((device) => {
      if (!device) return;
      
      const deviceId = slugifyId(device.id || device.deviceId || device.name);
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
      if (!deviceId) return;
      const mappedUser = userManager.resolveUserForDevice(device.id || device.deviceId);
      if (!mappedUser) return;
      
      const slug = slugifyId(mappedUser.name);
      if (!slug) return;
      
      // Ensure user is in map
      if (!userMetricMap.has(slug)) {
        const staged = this._stageUserEntry(mappedUser);
        if (staged) {
          userMetricMap.set(slug, staged);
        }
      }
      
      // Merge device metrics into user entry
      const entry = userMetricMap.get(slug);
      if (!entry) return;
      entry.metrics.heartRate = entry.metrics.heartRate ?? sanitizedDeviceMetrics.heartRate;
      entry.metrics.rpm = entry.metrics.rpm ?? sanitizedDeviceMetrics.rpm;
      entry.metrics.power = entry.metrics.power ?? sanitizedDeviceMetrics.power;
      entry.metrics.distance = entry.metrics.distance ?? sanitizedDeviceMetrics.distance;
    });

    // Process user metrics
    userMetricMap.forEach((entry, slug) => {
      if (!entry) return;
      
      // Cumulative heart beats
      const prevBeats = this._cumulativeBeats.get(slug) || 0;
      const hr = entry.metrics.heartRate;
      const deltaBeats = Number.isFinite(hr) && hr > 0
        ? (hr / 60) * intervalSeconds
        : 0;
      const nextBeats = prevBeats + deltaBeats;
      this._cumulativeBeats.set(slug, nextBeats);
      assignMetric(`user:${slug}:heart_beats`, nextBeats);

      // Only record other metrics if we have numeric sample
      if (!hasNumericSample(entry.metrics)) return;
      
      // Track as active participant
      activeParticipants.add(slug);
      
      assignMetric(`user:${slug}:heart_rate`, entry.metrics.heartRate);
      assignMetric(`user:${slug}:zone_id`, entry.metrics.zoneId);
      assignMetric(`user:${slug}:rpm`, entry.metrics.rpm);
      assignMetric(`user:${slug}:power`, entry.metrics.power);
      assignMetric(`user:${slug}:distance`, entry.metrics.distance);
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
        perUserCoinTotals.forEach((coins, userName) => {
          if (!userName) return;
          const slug = slugifyId(userName);
          if (!slug) return;
          assignMetric(`user:${slug}:coins_total`, Number.isFinite(coins) ? coins : null);
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
    if (!user?.name) return null;
    const slug = slugifyId(user.name);
    if (!slug) return null;
    
    const snapshot = typeof user.getMetricsSnapshot === 'function' ? user.getMetricsSnapshot() : {};
    
    return {
      slug,
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
}

/**
 * Create a MetricsRecorder instance
 * @param {MetricsRecorderConfig} [config]
 * @returns {MetricsRecorder}
 */
export const createMetricsRecorder = (config) => new MetricsRecorder(config);

export default MetricsRecorder;
