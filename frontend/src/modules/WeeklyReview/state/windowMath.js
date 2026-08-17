// frontend/src/modules/WeeklyReview/state/windowMath.js
//
// Date arithmetic for multi-week paging. The review shows a fixed-width window
// of days; paging walks that window backward and forward along a stride anchored
// to the newest window, so every window boundary lines up no matter how far back
// the user has gone.
//
// All dates are YYYY-MM-DD strings handled at UTC noon, which keeps a day from
// slipping across a DST boundary.

export const WINDOW_DAYS = 8;

const MS_PER_DAY = 86400000;

function toUtcNoon(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`);
}

export function addDaysISO(dateStr, n) {
  const d = toUtcNoon(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromDate, toDate) {
  return Math.round((toUtcNoon(toDate) - toUtcNoon(fromDate)) / MS_PER_DAY);
}

export function previousWindowStart(start) {
  return addDaysISO(start, -WINDOW_DAYS);
}

/** One window newer, never past `newest`. Returns null when already there. */
export function nextWindowStart(start, newest) {
  if (!start || start >= newest) return null;
  const candidate = addDaysISO(start, WINDOW_DAYS);
  return candidate > newest ? newest : candidate;
}

/** How many whole windows `start` sits behind `newest` (0 when current). */
export function windowsBack(start, newest) {
  if (!start) return 0;
  return Math.max(0, Math.round(daysBetween(start, newest) / WINDOW_DAYS));
}

/**
 * The start of the window that contains `target`, aligned to the stride
 * anchored at `newest`. Used to turn "oldest date with content" into a window
 * the user can actually be dropped into.
 */
export function windowStartForDate(target, newest) {
  const diff = daysBetween(target, newest);
  if (diff <= 0) return newest;
  const k = Math.ceil(diff / WINDOW_DAYS);
  return addDaysISO(newest, -k * WINDOW_DAYS);
}

/** Inclusive last day of the window beginning at `start`. */
export function windowEnd(start) {
  return addDaysISO(start, WINDOW_DAYS - 1);
}

/** "2 windows back", or null when viewing the newest window. */
export function windowsBackLabel(start, newest) {
  const k = windowsBack(start, newest);
  if (k <= 0) return null;
  return `${k} window${k === 1 ? '' : 's'} back`;
}
