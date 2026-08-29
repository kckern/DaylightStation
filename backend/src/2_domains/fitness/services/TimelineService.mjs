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
 * Decode a single RLE series to an array. Wire/storage parsing belongs to an
 * adapter; this function operates only on semantic array values.
 * @param {Array} encoded - RLE entries or an already-decoded array
 * @returns {number[]|null} Decoded array or null if empty/invalid
 */
export function decodeSingleSeries(encoded) {
  if (!Array.isArray(encoded) || isAllNullSeries(encoded)) return null;
  const arr = [];
  for (const entry of encoded) {
    if (Array.isArray(entry) && entry.length >= 2) {
      const [val, count] = entry;
      const reps = Number.isFinite(count) && count > 0 ? count : 0;
      for (let i = 0; i < reps; i++) arr.push(val === undefined ? null : val);
    } else {
      arr.push(entry === undefined ? null : entry);
    }
  }
  return !arr.length || arr.every(v => v == null) ? null : arr;
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
    if (Array.isArray(value)) {
      const decodedValue = decodeSingleSeries(value);
      if (decodedValue) decoded[key] = decodedValue;
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
 * Encode a single series to compact RLE entries.
 * @param {number[]} arr - Raw values array
 * @returns {Array} compact RLE entries
 */
export function encodeSingleSeries(arr) {
  return encodeToRLE(arr);
}

/**
 * Encode all series in a timeline for file storage
 * @param {Object} series - Object with series name -> number[]
 * @returns {Object} Object with series name -> compact RLE entries
 */
export function encodeSeries(series = {}) {
  if (!isPlainObject(series)) return {};

  const encoded = {};
  for (const [key, value] of Object.entries(series)) {
    if (Array.isArray(value) && value.length > 0) {
      // Skip all-null series
      if (value.every(v => v == null)) continue;
      encoded[key] = encodeSingleSeries(value);
    }
  }
  return encoded;
}

/**
 * Merge two timelines by concatenating series with a null-filled gap.
 * Source timeline comes first (earlier), target second (later).
 * Both timelines must be in decoded (raw array) form.
 *
 * @param {Object} source - Earlier timeline (decoded series, events)
 * @param {Object} target - Later timeline (decoded series, events)
 * @param {number} gapTicks - Number of null ticks to insert between source and target
 * @returns {Object} Merged timeline with combined series, events, and updated metadata
 */
export function mergeTimelines(source, target, gapTicks = 0) {
  const sourceSeries = source.series || {};
  const targetSeries = target.series || {};
  const allKeys = new Set([...Object.keys(sourceSeries), ...Object.keys(targetSeries)]);

  const sourceTickCount = source.tick_count || 0;
  const targetTickCount = target.tick_count || 0;
  const totalTicks = sourceTickCount + gapTicks + targetTickCount;

  const gap = gapTicks > 0 ? new Array(gapTicks).fill(null) : [];
  const mergedSeries = {};

  for (const key of allKeys) {
    const srcArr = sourceSeries[key] || [];
    const tgtArr = targetSeries[key] || [];
    // Pad source to sourceTickCount if short
    const paddedSrc = srcArr.length < sourceTickCount
      ? [...srcArr, ...new Array(sourceTickCount - srcArr.length).fill(null)]
      : srcArr;
    // Pad target to targetTickCount if short
    const paddedTgt = tgtArr.length < targetTickCount
      ? [...tgtArr, ...new Array(targetTickCount - tgtArr.length).fill(null)]
      : tgtArr;
    mergedSeries[key] = [...paddedSrc, ...gap, ...paddedTgt];
  }

  // Merge events — timestamps are already absolute, just combine and sort
  const sourceEvents = Array.isArray(source.events) ? source.events : [];
  const targetEvents = Array.isArray(target.events) ? target.events : [];
  const mergedEvents = [...sourceEvents, ...targetEvents].sort((a, b) => {
    const tsA = a?.timestamp || 0;
    const tsB = b?.timestamp || 0;
    return tsA - tsB;
  });

  return {
    series: mergedSeries,
    events: mergedEvents,
    interval_seconds: source.interval_seconds || target.interval_seconds || 5,
    tick_count: totalTicks
  };
}

export default {
  decodeSeries,
  encodeSeries,
  decodeSingleSeries,
  encodeSingleSeries,
  encodeToRLE,
  isAllNullSeries,
  mergeTimelines
};
