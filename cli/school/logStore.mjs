/**
 * cli/school/logStore.mjs — reading School events back out of the log store
 * (VictoriaLogs), shared by the `trace` commands (`word-ladder trace`,
 * `sentence-ladder trace`). Fetch-shape knowledge lives here so each domain's
 * trace formatter can stay pure and be tested against clean fixtures.
 */

export const DEFAULT_LOGSTORE = process.env.DAYLIGHT_LOGSTORE || 'http://localhost:9428';
export const LOG_QUERY_LIMIT = 5000;

/** UTC today as YYYY-MM-DD — a trace window's default day. */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Unquoted, VictoriaLogs tokenizes a value on `.` and `-`, so a learnerId or
// sittingId containing either (a sitting id is always `<pkg>.<token>.<n>`)
// matches far more than intended. Quoting makes it an exact-phrase match.
export function quoteLogsqlValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function parseLogLines(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* one malformed line must not sink the whole trace */ }
  }
  return rows;
}

/** "true"/"false"/"null"/a numeric string -> its real type. VictoriaLogs stores every field as a string. */
export function coerceLogValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (typeof value === 'string' && value !== '' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  // An array (a quiz queue, a round's word ids) is stored as its JSON text.
  if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function setPath(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * A log-store row is flat: `{_msg, _time, level, "data.itemId": "...", "data.to.state": "mastered", ...}`.
 * `formatTrace` wants nested, typed `{ msg, time, level, data }` — this is
 * the one place that un-flattening and string coercion happen, so the
 * domain formatter stays free of store-shape knowledge (and stays testable
 * against clean fixtures).
 */
export function unflattenRow(row) {
  const data = {};
  const context = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('data.')) setPath(data, key.slice('data.'.length).split('.'), coerceLogValue(value));
    else if (key.startsWith('context.')) setPath(context, key.slice('context.'.length).split('.'), coerceLogValue(value));
  }
  return { msg: row._msg, time: row._time, level: row.level, data, context };
}
