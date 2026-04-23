/**
 * Derive the authoritative date for a food log.
 *
 * The persistence layer stores `meal.date` as a `YYYY-MM-DD` string. When it's
 * missing (legacy logs, corrupted writes, migration artifacts), we fall back to
 * the date portion of `createdAt` — the moment the log was entered.
 *
 * We NEVER fall back to the current wall-clock time. Accept-day and revision-day
 * are irrelevant to what date the meal belongs to.
 *
 * @param {object} log - A NutriLog or its JSON representation. Must expose
 *                       `meal` (possibly missing `date`) and `createdAt`.
 * @param {string} timezone - IANA timezone. Reserved for future use; the current
 *                       createdAt fallback slices the already-local date prefix
 *                       and does not reproject via the runtime TZ (see note below).
 * @returns {string} Date in YYYY-MM-DD format.
 * @throws {Error} If neither meal.date nor a parseable createdAt exists.
 */
// eslint-disable-next-line no-unused-vars
export function deriveLogDate(log, timezone = 'America/Los_Angeles') {
  const mealDate = log?.meal?.date;
  if (typeof mealDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(mealDate)) {
    return mealDate;
  }

  const createdAt = log?.createdAt;
  if (typeof createdAt === 'string' && createdAt.length >= 10) {
    // Project stores createdAt as "YYYY-MM-DD HH:mm:ss" (user-local time, no TZ marker)
    // or occasionally as ISO "YYYY-MM-DDTHH:mm:ssZ". In both formats, the leading 10
    // characters are the date portion. Slice it directly — never Date-parse-then-reproject,
    // which would silently shift the day if the server's system TZ differs from the user's.
    const prefix = createdAt.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(prefix) && (createdAt[10] === ' ' || createdAt[10] === 'T' || createdAt.length === 10)) {
      return prefix;
    }
  }

  throw new Error(
    `deriveLogDate: cannot derive date for log id=${log?.id ?? '?'} — ` +
    `meal.date and createdAt are both missing or invalid.`
  );
}

export default deriveLogDate;
