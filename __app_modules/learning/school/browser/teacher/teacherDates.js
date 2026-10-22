/** Human dates for the adult console. Storage stays ISO; it never leaks into copy. */
function dateFor(value) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function teacherDate(value, { weekday = false } = {}) {
  const date = dateFor(value);
  if (!date) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    ...(weekday ? { weekday: 'long' } : {}), month: 'short', day: 'numeric', year: 'numeric',
  }).format(date);
}

/** Today (or a given Date) as YYYY-MM-DD in LOCAL time — toISOString() is UTC
 * and flips to tomorrow every evening. */
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Move a YYYY-MM-DD day by whole days. Noon-anchored, so DST can't eat a day. */
export function shiftDay(day, delta = 1) {
  const date = dateFor(day);
  if (!date) return null;
  date.setDate(date.getDate() + delta);
  return localDay(date);
}

/**
 * "Monday, Aug 24" — weekday-led day label. Null on garbage, so callers can ??
 * a fallback. `short` gives "Mon 24", for a column header seven to a row
 * (the week grid); the long form stays the accessible name beside it.
 */
export function humanDate(value, { short = false } = {}) {
  const date = dateFor(value);
  if (!date) return null;
  if (short) return `${new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)} ${date.getDate()}`;
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
}

/** "Aug 24, 2026, 3:20 PM" — timestamp label. Null on garbage. */
export function humanDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

/** "3:20 PM" — time-of-day label. Null on garbage. */
export function teacherTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function teacherDateRange(from, to = null) {
  if (!to || to === from) return teacherDate(from);
  const start = dateFor(from);
  const end = dateFor(to);
  if (!start || !end) return 'Date unavailable';
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(start)}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${teacherDate(from)} – ${teacherDate(to)}`;
}
