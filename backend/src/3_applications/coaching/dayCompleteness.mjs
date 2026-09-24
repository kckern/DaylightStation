/**
 * Logging completeness — whether a day's logged totals can be believed.
 *
 * A logged total under the threshold is far more often a meal that was never
 * logged than a day the user actually ate that little. So a day under the
 * threshold is treated as MISSING DATA unless the user explicitly said it was
 * final (`/done`) or a fast (`/fast`). Only trusted days feed averages,
 * patterns and commentary about intake.
 */

export const DEFAULT_MIN_CALORIES = 1200;

export const DAY_STATUS = Object.freeze({
  COMPLETE: 'complete',     // logged total at/above the threshold
  DONE: 'done',             // user said the day's log is final
  FASTING: 'fasting',       // user said the day was a fast
  INCOMPLETE: 'incomplete', // something logged, under the threshold, not confirmed
  UNLOGGED: 'unlogged',     // nothing logged at all
});

const TRUSTED = new Set([DAY_STATUS.COMPLETE, DAY_STATUS.DONE, DAY_STATUS.FASTING]);

export function isTrusted(day) {
  return TRUSTED.has(day?.status);
}

/**
 * Resolve the configured threshold. Accepts the household `coaching.yml`
 * `logging_completeness` block; anything non-numeric falls back to the default.
 * @param {{min_calories?: number}} [cfg]
 */
export function resolveMinCalories(cfg) {
  const n = Number(cfg?.min_calories);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_CALORIES;
}

/**
 * Normalize a day-closed record. Legacy records are a bare `true` (from the
 * original `/done`); current ones are `{ status: 'done'|'fasting', at }`.
 * @returns {'done'|'fasting'|null}
 */
export function closureStatus(record) {
  if (!record) return null;
  if (record === true) return DAY_STATUS.DONE;
  if (record.status === DAY_STATUS.FASTING) return DAY_STATUS.FASTING;
  return DAY_STATUS.DONE;
}

/**
 * @param {{calories?: number, protein?: number}|undefined} entry - nutriday row
 * @param {*} closure - day-closed record for the same date
 * @param {number} minCalories
 */
export function classifyDay(entry, closure, minCalories = DEFAULT_MIN_CALORIES) {
  const calories = Number(entry?.calories) || 0;
  const closed = closureStatus(closure);
  if (closed) return closed;
  if (!entry || calories <= 0) return DAY_STATUS.UNLOGGED;
  return calories >= minCalories ? DAY_STATUS.COMPLETE : DAY_STATUS.INCOMPLETE;
}

/** YYYY-MM-DD minus n calendar days (date-only math, no timezone drift). */
export function shiftDate(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * The `count` CALENDAR days before `beforeDate`, most recent first. Days with
 * no nutriday row are included as `unlogged` rather than silently skipped —
 * skipping them is what made a Saturday read as "yesterday" on Monday.
 */
export function buildCalendarDays({ nutritionData, closures, beforeDate, count, minCalories }) {
  const days = [];
  for (let i = 1; i <= count; i++) {
    const date = shiftDate(beforeDate, i);
    const entry = nutritionData?.[date];
    days.push({
      date,
      calories: Math.round(Number(entry?.calories) || 0),
      protein: Math.round(Number(entry?.protein) || 0),
      status: classifyDay(entry, closures?.[date], minCalories),
    });
  }
  return days;
}

/**
 * Averages over trusted days only.
 * @returns {{calories: number|null, protein: number|null, trustedDays: number, totalDays: number}}
 */
export function averageTrusted(days) {
  const trusted = (days || []).filter(isTrusted);
  if (!trusted.length) return { calories: null, protein: null, trustedDays: 0, totalDays: days?.length || 0 };
  const sum = trusted.reduce((acc, d) => ({ calories: acc.calories + d.calories, protein: acc.protein + d.protein }), { calories: 0, protein: 0 });
  return {
    calories: Math.round(sum.calories / trusted.length),
    protein: Math.round(sum.protein / trusted.length),
    trustedDays: trusted.length,
    totalDays: days.length,
  };
}
