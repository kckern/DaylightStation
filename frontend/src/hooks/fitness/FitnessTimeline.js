import { deepClone } from './types.js';

const DEFAULT_INTERVAL_MS = 5000;

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

const cloneValue = (value) => {
  if (value == null) return value === undefined ? null : value;
  if (typeof value === 'object') {
    const cloned = deepClone(value);
    if (cloned != null) return cloned;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch (_) {
        return null;
      }
    }
    return null;
  }
  return value;
};

/**
 * Phase 3: Key prefix constants for entity-based tracking
 * @see /docs/design/guest-switch-session-transition.md
 */
const KEY_PREFIX = {
  USER: 'user:',     // Legacy: user:{userId}:{metric}
  ENTITY: 'entity:', // Phase 3: entity:{entityId}:{metric}
  DEVICE: 'device:', // device:{deviceId}:{metric}
  GLOBAL: 'global:'  // global:{metric}
};

export class FitnessTimeline {
  constructor(startTime = Date.now(), intervalMs = DEFAULT_INTERVAL_MS) {
    this.timebase = {
      startTime: this._normalizeStartTime(startTime),
      intervalMs: this._normalizeInterval(intervalMs),
      tickCount: 0,
      lastTickTimestamp: null
    };
    this.series = {};
    this.events = [];
  }

  reset(startTime = Date.now(), intervalMs = this.timebase.intervalMs) {
    this.timebase.startTime = this._normalizeStartTime(startTime);
    this.timebase.intervalMs = this._normalizeInterval(intervalMs);
    this.timebase.tickCount = 0;
    this.timebase.lastTickTimestamp = null;
    this.series = {};
    this.events = [];
  }

  setIntervalMs(intervalMs) {
    this.timebase.intervalMs = this._normalizeInterval(intervalMs);
  }

  tick(metricsSnapshot = {}, options = {}) {
    const tickIndex = this.timebase.tickCount;
    const normalizedSnapshot = this._normalizeSnapshot(metricsSnapshot);
    const providedKeys = new Set(Object.keys(normalizedSnapshot));
    const allKnownKeys = new Set([...Object.keys(this.series), ...providedKeys]);

    providedKeys.forEach((key) => {
      const seriesRef = this._getOrCreateSeries(key, tickIndex);
      seriesRef[tickIndex] = normalizedSnapshot[key];
    });

    // Ensure every tracked series advances even without new data.
    allKnownKeys.forEach((key) => {
      if (providedKeys.has(key)) return;
      const seriesRef = this._getOrCreateSeries(key, tickIndex);
      seriesRef[tickIndex] = null;
    });

    const timestamp = this._resolveTickTimestamp(tickIndex, options.timestamp);
    this.timebase.tickCount = tickIndex + 1;
    this.timebase.lastTickTimestamp = timestamp;

    return { tickIndex, timestamp };
  }

  logEvent(type, data = {}, timestamp = Date.now()) {
    const normalizedType = this._normalizeKey(type);
    if (!normalizedType) return null;
    const eventTimestamp = this._normalizeTimestamp(timestamp);
    const offsetMs = this._getOffsetMs(eventTimestamp);
    const tickIndex = this.getTickIndexForTimestamp(eventTimestamp);
    const entry = {
      timestamp: eventTimestamp,
      offsetMs,
      tickIndex,
      type: normalizedType,
      data: cloneValue(data)
    };
    this.events.push(entry);
    return entry;
  }

  getTickIndexForTimestamp(timestamp = Date.now()) {
    const eventTimestamp = this._normalizeTimestamp(timestamp);
    const offsetMs = this._getOffsetMs(eventTimestamp);
    const interval = this.timebase.intervalMs || DEFAULT_INTERVAL_MS;
    if (!(interval > 0)) return 0;
    return Math.floor(offsetMs / interval);
  }

  /**
   * Get all unique participant IDs from timeline series.
   * Parses series keys like "user:alice:heart_rate" to extract "alice".
   * Used by FitnessSession.getHistoricalParticipants() to include dropped-out users.
   * @returns {string[]} Array of participant IDs (user IDs)
   */
  getAllParticipantIds() {
    const ids = new Set();
    
    Object.keys(this.series).forEach((key) => {
      if (key.startsWith(KEY_PREFIX.USER)) {
        // Parse "user:alice:heart_rate" -> "alice"
        const rest = key.slice(KEY_PREFIX.USER.length);
        const colonIdx = rest.indexOf(':');
        if (colonIdx > 0) {
          const userId = rest.slice(0, colonIdx);
          if (userId) ids.add(userId);
        }
      }
    });
    
    return Array.from(ids);
  }

  /**
   * Phase 3: Get all unique entity IDs from timeline series.
   * Parses series keys like "entity:entity-123-abc:heart_rate" to extract "entity-123-abc".
   * @returns {string[]} Array of entity IDs
   * @see /docs/design/guest-switch-session-transition.md
   */
  getAllEntityIds() {
    const ids = new Set();
    
    Object.keys(this.series).forEach((key) => {
      if (key.startsWith(KEY_PREFIX.ENTITY)) {
        // Parse "entity:entity-123-abc:heart_rate" -> "entity-123-abc"
        const rest = key.slice(KEY_PREFIX.ENTITY.length);
        const colonIdx = rest.indexOf(':');
        if (colonIdx > 0) {
          const entityId = rest.slice(0, colonIdx);
          if (entityId) ids.add(entityId);
        }
      }
    });
    
    return Array.from(ids);
  }

  /**
   * Phase 3: Get a series for an entity by entityId and metric.
   * @param {string} entityId - Entity ID (e.g., "entity-1735689600000-abc12")
   * @param {string} metric - Metric name (e.g., "heart_rate", "coins_total")
   * @returns {Array} Series data or empty array
   */
  getEntitySeries(entityId, metric) {
    if (!entityId || !metric) return [];
    const key = `${KEY_PREFIX.ENTITY}${entityId}:${metric}`;
    const series = this.series[key];
    return Array.isArray(series) ? series : [];
  }

  /**
   * Phase 3: Get latest value for an entity metric.
   * @param {string} entityId
   * @param {string} metric
   * @returns {*} Latest non-null value or null
   */
  getEntityLatestValue(entityId, metric) {
    const series = this.getEntitySeries(entityId, metric);
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i] != null) return series[i];
    }
    return null;
  }

  /**
   * Phase 3: Transfer series data from one entity to another.
   * Used during grace period transfers when a brief session is merged into successor.
   * 
   * @param {string} fromEntityId - Source entity ID
   * @param {string} toEntityId - Destination entity ID
   * @returns {string[]} - List of transferred series keys
   */
  transferEntitySeries(fromEntityId, toEntityId) {
    if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) return [];
    
    const transferred = [];
    const fromPrefix = `${KEY_PREFIX.ENTITY}${fromEntityId}:`;
    const toPrefix = `${KEY_PREFIX.ENTITY}${toEntityId}:`;
    
    Object.keys(this.series).forEach((key) => {
      if (key.startsWith(fromPrefix)) {
        const metric = key.slice(fromPrefix.length);
        const newKey = `${toPrefix}${metric}`;
        
        // Copy series to new key
        this.series[newKey] = [...this.series[key]];
        // Clear original (but keep empty array for historical reference)
        this.series[key] = this.series[key].map(() => null);
        
        transferred.push({ from: key, to: newKey, metric });
      }
    });
    
    console.log('[FitnessTimeline] Transferred entity series:', {
      fromEntityId,
      toEntityId,
      count: transferred.length
    });
    
    return transferred;
  }

  /**
   * Transfer USER series from one user to another (e.g., user:soren → user:jin).
   * Used during guest assignment to move history to the new identity.
   * The original user's series is cleared (nulled out) so they don't appear in the chart.
   * 
   * @param {string} fromUserId - Source user ID (e.g., 'soren')
   * @param {string} toUserId - Destination user ID (e.g., 'jin')
   * @returns {string[]} - List of transferred series keys
   */
  transferUserSeries(fromUserId, toUserId) {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return [];
    
    const transferred = [];
    const fromPrefix = `${KEY_PREFIX.USER}${fromUserId}:`;
    const toPrefix = `${KEY_PREFIX.USER}${toUserId}:`;
    
    Object.keys(this.series).forEach((key) => {
      if (key.startsWith(fromPrefix)) {
        const metric = key.slice(fromPrefix.length);
        const newKey = `${toPrefix}${metric}`;
        
        // Copy entire series to new key (full backfill)
        this.series[newKey] = [...this.series[key]];
        // Clear original completely (nulls make it disappear from chart)
        this.series[key] = this.series[key].map(() => null);
        
        transferred.push({ from: key, to: newKey, metric });
      }
    });
    
    console.log('[FitnessTimeline] Transferred user series:', {
      fromUserId,
      toUserId,
      count: transferred.length
    });
    
    return transferred;
  }

  get summary() {
    const timebaseSummary = {
      startTime: this.timebase.startTime,
      intervalMs: this.timebase.intervalMs,
      tickCount: this.timebase.tickCount
    };
    if (Number.isFinite(this.timebase.lastTickTimestamp)) {
      timebaseSummary.lastTickTimestamp = this.timebase.lastTickTimestamp;
    }
    return {
      timebase: timebaseSummary,
      series: cloneValue(this.series) || {},
      events: cloneValue(this.events) || []
    };
  }

  static validateSeriesLengths(timebase = {}, series = {}) {
    const tickCount = Number(timebase?.tickCount);
    if (!Number.isFinite(tickCount) || tickCount < 0) {
      return { ok: true, issues: [] };
    }

    const issues = [];
    Object.entries(series || {}).forEach(([key, arr]) => {
      if (!Array.isArray(arr)) return;
      if (arr.length !== tickCount) {
        issues.push({ key, length: arr.length, tickCount });
      }
    });

    return { ok: issues.length === 0, issues };
  }

  validateSeriesLengths(seriesOverride = null) {
    return FitnessTimeline.validateSeriesLengths(this.timebase, seriesOverride || this.series);
  }

  _normalizeSnapshot(metricsSnapshot) {
    const entries = this._entriesFromSnapshot(metricsSnapshot);
    if (!entries.length) return {};
    return entries.reduce((acc, [rawKey, rawValue]) => {
      const key = this._normalizeKey(rawKey);
      if (!key) return acc;
      acc[key] = rawValue === undefined ? null : rawValue;
      return acc;
    }, {});
  }

  _entriesFromSnapshot(value) {
    if (!value) return [];
    if (value instanceof Map) {
      return Array.from(value.entries());
    }
    if (Array.isArray(value)) {
      return value.filter((entry) => Array.isArray(entry) && entry.length >= 2);
    }
    if (isPlainObject(value)) {
      return Object.entries(value);
    }
    return [];
  }

  _getOrCreateSeries(key, tickIndex) {
    if (!this.series[key]) {
      this.series[key] = new Array(tickIndex).fill(null);
    } else {
      while (this.series[key].length < tickIndex) {
        this.series[key].push(null);
      }
    }
    return this.series[key];
  }

  _normalizeStartTime(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
    return Date.now();
  }

  _normalizeInterval(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
    return DEFAULT_INTERVAL_MS;
  }

  _normalizeKey(rawKey) {
    if (rawKey == null) return null;
    const normalized = String(rawKey).trim();
    return normalized || null;
  }

  _resolveTickTimestamp(tickIndex, explicitTimestamp) {
    if (Number.isFinite(explicitTimestamp)) {
      return Math.max(this.timebase.startTime, explicitTimestamp);
    }
    const offsetMs = tickIndex * (this.timebase.intervalMs || DEFAULT_INTERVAL_MS);
    return this.timebase.startTime + offsetMs;
  }

  _normalizeTimestamp(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
    return Date.now();
  }

  _getOffsetMs(timestamp) {
    const base = Number.isFinite(this.timebase.startTime)
      ? this.timebase.startTime
      : timestamp;
    return Math.max(0, timestamp - base);
  }
}
