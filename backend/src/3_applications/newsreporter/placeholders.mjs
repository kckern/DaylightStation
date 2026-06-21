/**
 * TZ-aware placeholder resolver for reporter source/template config.
 *
 * Replaces {{today}} / {{date}} / {{yesterday}} with ISO calendar dates
 * (YYYY-MM-DD) computed in the run's timezone. Uses Intl.DateTimeFormat with
 * an explicit timeZone for the calendar date — NEVER raw Date local getters
 * (which use the host TZ and produce the Strava-style off-by-one trap).
 *
 * Pure: deep-walks strings inside nested objects/arrays, leaving non-string
 * leaves untouched.
 */

/**
 * Format an instant as its calendar date (YYYY-MM-DD) in the given IANA tz.
 * @param {Date} date
 * @param {string} timeZone IANA timezone, e.g. 'America/Denver'
 * @returns {string} YYYY-MM-DD
 */
export function toCalendarDate(date, timeZone) {
  // en-CA renders YYYY-MM-DD with 2-digit month/day.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Subtract one calendar day from a YYYY-MM-DD string (TZ-agnostic, operating
 * on the calendar date itself, so DST shifts don't matter).
 * @param {string} ymd YYYY-MM-DD
 * @returns {string} YYYY-MM-DD for the previous day
 */
function previousCalendarDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - 1);
  const py = utc.getUTCFullYear();
  const pm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const pd = String(utc.getUTCDate()).padStart(2, '0');
  return `${py}-${pm}-${pd}`;
}

function buildReplacements(ctx) {
  const timeZone = ctx?.timezone || 'America/Denver';
  const referenceDate = ctx?.referenceDate instanceof Date ? ctx.referenceDate : new Date();
  const today = toCalendarDate(referenceDate, timeZone);
  const yesterday = previousCalendarDate(today);
  return {
    today,
    date: today,
    yesterday,
  };
}

function resolveString(str, replacements) {
  return str.replace(/\{\{\s*(today|date|yesterday)\s*\}\}/g, (_match, key) => replacements[key]);
}

function walk(value, replacements) {
  if (typeof value === 'string') return resolveString(value, replacements);
  if (Array.isArray(value)) return value.map((v) => walk(v, replacements));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, replacements);
    return out;
  }
  return value;
}

/**
 * Resolve date placeholders in a string or deep-walk an object/array.
 * @param {string|object|Array} input
 * @param {{ referenceDate?: Date, timezone?: string }} ctx
 * @returns {string|object|Array} a new value with placeholders replaced
 */
export function resolvePlaceholders(input, ctx) {
  const replacements = buildReplacements(ctx);
  return walk(input, replacements);
}
