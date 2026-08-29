/** Persistence codec for the compact JSON/RLE timeline representation. */

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isAllNullRle(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return true;
  return entries.every(entry => Array.isArray(entry)
    ? !(Number.isFinite(entry[1]) && entry[1] > 0 && entry[0] != null)
    : entry == null);
}

export function decodeTimelineSeries(series = {}) {
  if (!isPlainObject(series)) return {};
  const decoded = {};
  for (const [key, value] of Object.entries(series)) {
    let entries = value;
    if (typeof value === 'string') {
      try { entries = JSON.parse(value); } catch { continue; }
    }
    if (!Array.isArray(entries) || isAllNullRle(entries)) continue;
    const values = [];
    for (const entry of entries) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const count = Number.isFinite(entry[1]) && entry[1] > 0 ? entry[1] : 0;
        for (let i = 0; i < count; i++) values.push(entry[0] === undefined ? null : entry[0]);
      } else {
        values.push(entry === undefined ? null : entry);
      }
    }
    if (values.length && !values.every(item => item == null)) decoded[key] = values;
  }
  return decoded;
}

function encodeToRle(values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const result = [];
  for (let i = 0; i < values.length;) {
    const value = values[i];
    let count = 1;
    while (i + count < values.length && values[i + count] === value) count++;
    result.push(count === 1 ? value : [value, count]);
    i += count;
  }
  return result;
}

export function encodeTimelineSeries(series = {}) {
  if (!isPlainObject(series)) return {};
  const encoded = {};
  for (const [key, value] of Object.entries(series)) {
    if (typeof value === 'string' && value.startsWith('[')) encoded[key] = value;
    else if (Array.isArray(value) && value.length && !value.every(item => item == null)) {
      encoded[key] = JSON.stringify(encodeToRle(value));
    }
  }
  return encoded;
}

export function hydrateTimeline(timeline) {
  if (!timeline || typeof timeline !== 'object') return { series: {}, events: [] };
  return { ...timeline, series: decodeTimelineSeries(timeline.series), events: timeline.events || [] };
}

export function dehydrateTimeline(timeline) {
  if (!timeline || typeof timeline !== 'object') return { series: {}, events: [] };
  const {
    series,
    events,
    interval_seconds: intervalSeconds,
    tick_count: tickCount,
    encoding,
    ...additionalFields
  } = timeline;
  const result = {
    series: encodeTimelineSeries(series),
    events: events || [],
  };
  if (intervalSeconds != null) result.interval_seconds = intervalSeconds;
  if (tickCount != null) result.tick_count = tickCount;
  if (encoding) result.encoding = encoding;
  return Object.assign(result, additionalFields);
}
