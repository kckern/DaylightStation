/**
 * TimelineService - Handles timeline series encoding/decoding
 *
 * Series are stored in RLE (Run-Length Encoding) format for efficient storage:
 * - Compact RLE: [131, 124, [146, 14], [null, 6], ...] - value or [value, count]
 * - Classic RLE: [[131, 1], [124, 1], [146, 14], ...] - always [value, count]
 *
 * Decoded format: [131, 124, 146, 146, 146, ...] - raw values
 */

/**
 * Check if value is a plain object
 */
function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if a parsed JSON series contains only null values
 * @param {Array} parsed - Parsed series array
 * @returns {boolean}
 */
export function isAllNullSeries(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return true;
  for (const entry of parsed) {
    if (Array.isArray(entry) && entry.length >= 2) {
      const [val, count] = entry;
      const reps = Number.isFinite(count) && count > 0 ? count : 0;
      if (reps > 0 && val != null) return false;
    } else {
      if (entry != null) return false;
    }
  }
  return true;
}

/**
 * Decode a single RLE-encoded series string to an array
 * @param {string} encoded - JSON string with RLE encoding
 * @returns {number[]|null} Decoded array or null if empty/invalid
 */
export function decodeSingleSeries(encoded) {
  if (typeof encoded !== 'string') return encoded;

  try {
    const parsed = JSON.parse(encoded);
    if (!Array.isArray(parsed)) return null;
    if (isAllNullSeries(parsed)) return null;

    const arr = [];
    for (const entry of parsed) {
      // [value, count] format (classic or compact repeats)
      if (Array.isArray(entry) && entry.length >= 2) {
        const [val, count] = entry;
        const reps = Number.isFinite(count) && count > 0 ? count : 0;
        for (let i = 0; i < reps; i++) {
          arr.push(val === undefined ? null : val);
        }
        continue;
      }
      // Bare value (compact RLE singles OR raw arrays)
      arr.push(entry === undefined ? null : entry);
    }

    if (!arr.length || arr.every(v => v == null)) return null;
    return arr;
  } catch {
    return null;
  }
}

/**
 * Decode all series in a timeline object
 * @param {Object} series - Object with series name -> encoded string
 * @returns {Object} Object with series name -> decoded number[]
 */
export function decodeSeries(series = {}) {
  if (!isPlainObject(series)) return {};

  const decoded = {};
  for (const [key, value] of Object.entries(series)) {
    if (typeof value === 'string') {
      const decodedValue = decodeSingleSeries(value);
      if (decodedValue) {
        decoded[key] = decodedValue;
      }
    } else if (Array.isArray(value)) {
      // Already decoded array - filter out all-null
      if (value.length && !value.every(v => v == null)) {
        decoded[key] = value;
      }
    } else {
      decoded[key] = value;
    }
  }
  return decoded;
}

/**
 * Encode a raw array to compact RLE format
 * Uses mixed format: bare values for singles, [value, count] for runs
 * @param {number[]} arr - Raw values array
 * @returns {Array} RLE-encoded array
 */
export function encodeToRLE(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];

  const result = [];
  let i = 0;

  while (i < arr.length) {
    const value = arr[i];
    let count = 1;

    // Count consecutive identical values
    while (i + count < arr.length && arr[i + count] === value) {
      count++;
    }

    if (count === 1) {
      // Single value - store bare
      result.push(value);
    } else {
      // Run - store as [value, count]
      result.push([value, count]);
    }

    i += count;
  }

  return result;
}

/**
 * Encode a single series to JSON string with RLE
 * @param {number[]} arr - Raw values array
 * @returns {string} JSON string with RLE encoding
 */
export function encodeSingleSeries(arr) {
  const rle = encodeToRLE(arr);
  return JSON.stringify(rle);
}

/**
 * Encode all series in a timeline for file storage
 * @param {Object} series - Object with series name -> number[]
 * @returns {Object} Object with series name -> JSON string
 */
export function encodeSeries(series = {}) {
  if (!isPlainObject(series)) return {};

  const encoded = {};
  for (const [key, value] of Object.entries(series)) {
    if (Array.isArray(value) && value.length > 0) {
      // Skip all-null series
      if (value.every(v => v == null)) continue;
      encoded[key] = encodeSingleSeries(value);
    } else if (typeof value === 'string' && value.startsWith('[')) {
      // Preserve already-encoded string values (v3 format)
      encoded[key] = value;
    }
  }
  return encoded;
}

/**
 * Parse a timestamp value to unix milliseconds
 * Handles both unix numbers and human-readable strings
 * @param {unknown} value - Timestamp value
 * @param {string} timezone - Timezone for parsing strings (default: UTC)
 * @returns {number|null}
 */
export function parseToUnixMs(value, timezone = 'UTC') {
  // Already a number
  if (Number.isFinite(Number(value))) {
    return Number(value);
  }

  // String timestamp
  if (typeof value !== 'string') return null;

  try {
    // Try parsing as ISO date
    const date = new Date(value);
    const ms = date.getTime();
    if (Number.isFinite(ms)) return ms;
  } catch {
    // Ignore parsing errors
  }

  return null;
}

/**
 * Format unix milliseconds to human-readable timestamp
 * @param {number} ms - Unix milliseconds
 * @param {string} timezone - Target timezone
 * @returns {string} Formatted timestamp
 */
export function formatTimestamp(ms, timezone = 'UTC') {
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return date.toISOString();
}

/**
 * Prepare timeline for API response (decode series)
 * @param {Object} timeline - Raw timeline from storage
 * @param {string} timezone - Timezone for timestamp parsing
 * @returns {Object} Timeline with decoded series
 */
export function prepareTimelineForApi(timeline, timezone = 'UTC') {
  if (!timeline || typeof timeline !== 'object') {
    return { series: {}, events: [] };
  }

  const result = {
    series: decodeSeries(timeline.series || {}),
    events: []
  };

  // Preserve timeline metadata fields
  if (timeline.interval_seconds != null) result.interval_seconds = timeline.interval_seconds;
  if (timeline.tick_count != null) result.tick_count = timeline.tick_count;
  if (timeline.encoding) result.encoding = timeline.encoding;
  if (timeline.timebase) result.timebase = timeline.timebase;

  // Parse event timestamps
  if (Array.isArray(timeline.events)) {
    result.events = timeline.events.map(evt => {
      if (!evt || typeof evt !== 'object') return evt;
      const ts = parseToUnixMs(evt.timestamp, timezone);
      if (ts == null) return evt;
      return { ...evt, timestamp: ts };
    });
  }

  return result;
}

/**
 * Prepare timeline for file storage (encode series, preserve metadata)
 * @param {Object} timeline - Timeline with decoded series
 * @returns {Object} Timeline with encoded series and preserved metadata
 */
export function prepareTimelineForStorage(timeline) {
  if (!timeline || typeof timeline !== 'object') {
    return { series: {}, events: [] };
  }

  const result = {
    series: encodeSeries(timeline.series || {}),
    events: timeline.events || []
  };

  // Preserve timeline metadata fields (flat form only — timebase is redundant)
  if (timeline.interval_seconds != null) result.interval_seconds = timeline.interval_seconds;
  if (timeline.tick_count != null) result.tick_count = timeline.tick_count;
  if (timeline.encoding) result.encoding = timeline.encoding;
  // Note: timeline.timebase intentionally omitted from storage — it duplicates
  // the flattened interval_seconds / tick_count / encoding fields above.

  return result;
}

export default {
  decodeSeries,
  encodeSeries,
  decodeSingleSeries,
  encodeSingleSeries,
  encodeToRLE,
  isAllNullSeries,
  parseToUnixMs,
  formatTimestamp,
  prepareTimelineForApi,
  prepareTimelineForStorage
};
