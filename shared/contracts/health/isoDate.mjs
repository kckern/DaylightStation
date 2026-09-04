/**
 * The one place that decides whether a client-supplied day key is a real day.
 *
 * Extracted from BudgetService, which is where the two failure modes were first
 * paid for (Phase 8):
 *   - "2026-08-32" parses to an Invalid Date. A later `toISOString()` on it
 *     THROWS a RangeError, which surfaces to the caller as a 500 rather than
 *     the 400 the input deserves.
 *   - "2026-02-31" does NOT throw — it quietly normalizes to March 3, so the
 *     row lands on a day the person never named.
 * The NaN guard covers the first, the round-trip the second. The regex alone
 * covers neither, which is why every route that only regex-tests a date is a
 * latent version of one of these bugs.
 *
 * Noon UTC is the anchor deliberately: no household timezone offset and no DST
 * transition can push a noon-anchored instant across a date boundary.
 */
export const isISODate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

/** Local (not UTC) `YYYY-MM-DD` for a Date instance. */
export const localDateISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * The meal a capture lands in when nothing else names one, for a given target
 * day. See decision 2.24: a day that is not today has no "current hour", so the
 * clock cannot speak for it; such a day is filled from its first meal.
 *
 * @param {string} targetDate  the day the row will be written to (`YYYY-MM-DD`)
 * @param {Date} now           the wall clock
 * @param {(hour: number) => string} bucketForHour  the caller's hour→bucket map
 */
export const defaultBucketForDate = (targetDate, now, bucketForHour) => (
  targetDate === localDateISO(now) ? bucketForHour(now.getHours()) : 'morning'
);
