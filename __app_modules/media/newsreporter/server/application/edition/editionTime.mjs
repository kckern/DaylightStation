/**
 * Calendar helpers for edition reporters (pure). Dates are household-local
 * `YYYY-MM-DD` strings; instants are Dates. The timezone always comes from
 * the caller (the household's), never from the process.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value) => typeof value === 'string' && DATE_RE.test(value);

function parts(instant, timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
}

/** The household-local calendar date of an instant. */
export function localDate(instant, timezone) {
  const p = parts(instant, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The household-local wall clock of an instant, `HH:MM`. */
export function localTime(instant, timezone) {
  const p = parts(instant, timezone);
  return `${p.hour}:${p.minute}`;
}

/** `h:mm AM` wall clock, for footers. */
export function localClockLabel(instant, timezone) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(instant);
}

export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export const isWeekend = (date) => [0, 6].includes(weekdayOf(date));

/** "Tuesday, November 24, 2026" */
export function dateLabel(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/** "Wed" */
export function shortWeekday(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
}

/** Deterministic PRNG (mulberry32 over an FNV-1a hash of the seed). */
export function seededRandom(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
