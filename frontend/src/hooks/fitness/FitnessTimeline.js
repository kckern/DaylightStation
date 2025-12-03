import { deepClone } from './types';

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
