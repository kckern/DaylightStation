import { deepClone } from './types.js';

const DEFAULT_INTERVAL_MS = 5000;

// MEMORY LEAK FIX: Limit timeline history to prevent unbounded growth
// At 5-second intervals: 2000 points = ~2.7 hours of data
// This provides sufficient history for chart visualization while preventing memory exhaustion
const MAX_SERIES_LENGTH = 2000;

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
      prunedTickCount: 0,
      lastTickTimestamp: null
    };
    this.series = {};
    this.events = [];
  }

  reset(startTime = Date.now(), intervalMs = this.timebase.intervalMs) {
    this.timebase.startTime = this._normalizeStartTime(startTime);
    this.timebase.intervalMs = this._normalizeInterval(intervalMs);
    this.timebase.tickCount = 0;
    this.timebase.prunedTickCount = 0;
    this.timebase.lastTickTimestamp = null;
    this.series = {};
    this.events = [];
  }

  /**
   * Pad all existing series with null values to simulate a gap.
   * Used when resuming a session after an interruption.
   * @param {number} count - Number of null ticks to append
   */
  padWithNulls(count) {
    if (!Number.isFinite(count) || count <= 0) return;
    for (const key of Object.keys(this.series)) {
      for (let i = 0; i < count; i++) {
        this.series[key].push(null);
      }
    }
    this.timebase.tickCount += count;
    this._pruneSeriesWindow();
  }

  setIntervalMs(intervalMs) {
    this.timebase.intervalMs = this._normalizeInterval(intervalMs);
  }

  tick(metricsSnapshot = {}, options = {}) {
    const tickIndex = this.timebase.tickCount;
    const localTickIndex = this._getLocalTickIndex(tickIndex);
    const normalizedSnapshot = this._normalizeSnapshot(metricsSnapshot);
    const providedKeys = new Set(Object.keys(normalizedSnapshot));
    const allKnownKeys = new Set([...Object.keys(this.series), ...providedKeys]);

    providedKeys.forEach((key) => {
      const seriesRef = this._getOrCreateSeries(key, localTickIndex);
      seriesRef[localTickIndex] = normalizedSnapshot[key];
    });

    // Ensure every tracked series advances even without new data.
    allKnownKeys.forEach((key) => {
      if (providedKeys.has(key)) return;
      const seriesRef = this._getOrCreateSeries(key, localTickIndex);
      seriesRef[localTickIndex] = null;
    });

    const timestamp = this._resolveTickTimestamp(tickIndex, options.timestamp);
    this.timebase.tickCount = tickIndex + 1;
    this.timebase.lastTickTimestamp = timestamp;

    this._pruneSeriesWindow();

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
   * Transfer USER series from one user to another (e.g., user:user_5 → user:user_6).
   * Used during guest assignment to move history to the new identity.
   * The original user's series is cleared (nulled out) so they don't appear in the chart.
   * 
   * @param {string} fromUserId - Source user ID (e.g., 'user_5')
   * @param {string} toUserId - Destination user ID (e.g., 'user_6')
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
      tickCount: this.timebase.tickCount,
      prunedTickCount: this._getPrunedTickCount()
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
    const prunedTickCount = Number(timebase?.prunedTickCount);
    const expectedLength = Number.isFinite(prunedTickCount) && prunedTickCount > 0
      ? Math.max(0, tickCount - prunedTickCount)
      : tickCount;

    const issues = [];
    Object.entries(series || {}).forEach(([key, arr]) => {
      if (!Array.isArray(arr)) return;
      if (arr.length !== expectedLength) {
        issues.push({ key, length: arr.length, tickCount, prunedTickCount: Math.max(0, prunedTickCount || 0), expectedLength });
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

  _getPrunedTickCount() {
    const value = Number(this.timebase.prunedTickCount);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  _getLocalTickIndex(tickIndex) {
    return Math.max(0, tickIndex - this._getPrunedTickCount());
  }

  _pruneSeriesWindow() {
    const lengths = Object.values(this.series)
      .filter(Array.isArray)
      .map((arr) => arr.length);
    if (!lengths.length) return 0;

    const maxLength = Math.max(...lengths);
    const removeCount = maxLength - MAX_SERIES_LENGTH;
    if (removeCount <= 0) return 0;

    Object.values(this.series).forEach((arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return;
      arr.splice(0, Math.min(removeCount, arr.length));
    });
    this.timebase.prunedTickCount = this._getPrunedTickCount() + removeCount;
    return removeCount;
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
