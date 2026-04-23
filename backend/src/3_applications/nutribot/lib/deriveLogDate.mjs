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
 * @param {string} timezone - IANA timezone used for formatting createdAt fallback.
 * @returns {string} Date in YYYY-MM-DD format.
 * @throws {Error} If neither meal.date nor a parseable createdAt exists.
 */
export function deriveLogDate(log, timezone = 'America/Los_Angeles') {
  const mealDate = log?.meal?.date;
  if (typeof mealDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(mealDate)) {
    return mealDate;
  }

  const createdAt = log?.createdAt;
  if (typeof createdAt === 'string' && createdAt.length >= 10) {
    // Handle both "2026-04-16 12:00:00" and "2026-04-16T19:00:00Z"
    const parsed = new Date(createdAt.replace(' ', 'T'));
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-CA', { timeZone: timezone });
    }
    // Or just slice if it's already a local date string
    const sliced = createdAt.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sliced)) {
      return sliced;
    }
  }

  throw new Error(
    `deriveLogDate: cannot derive date for log id=${log?.id ?? '?'} — ` +
    `meal.date and createdAt are both missing or invalid.`
  );
}

export default deriveLogDate;
