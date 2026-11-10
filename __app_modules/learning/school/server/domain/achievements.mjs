/**
 * School's achievements as the economy's gems read them — pure rules, no I/O.
 * The application provider (`application/SchoolAchievementProvider.mjs`)
 * gathers the facts and hands them here.
 *
 * Vocabulary (the economy's achievement port):
 *   activity days  the distinct study days an activity happened on
 *   milestone      `{key, day, label}` — `key` names the achievement for that
 *                  learner forever, so a re-read of the same evidence names it
 *                  again rather than minting a second one
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `'YYYY-MM-DD'` from a day string or a Date (a hand-edited unquoted YAML date), else null. */
export function dayKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const day = typeof value === 'string' ? value.slice(0, 10) : null;
  return day && DAY.test(day) ? day : null;
}

/** Every calendar day from `from` to `to` inclusive (both `'YYYY-MM-DD'`). */
export function daysOfWeek({ from, to }) {
  const out = [];
  if (!DAY.test(from ?? '') || !DAY.test(to ?? '')) return out;
  for (let ms = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); ms <= end && out.length < 31; ms += 86_400_000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

export const inWeek = (day, week) => typeof day === 'string' && day >= week.from && day <= week.to;

/** Distinct, sorted days within the week. */
export function distinctDaysInWeek(days, week) {
  return [...new Set((days ?? []).map(dayKey).filter((d) => inWeek(d, week)))].sort();
}

export const MASTERY_STEP = 10;

/**
 * "Every 10 words mastered": sort every current sign-off by day (word id breaks
 * a tie so the order is stable), and the 10th, 20th, … sign-off's day is a
 * milestone keyed by its count. Computed from the PRESENT status: a demotion
 * clears a word's stamp and a later re-sign-off re-dates it, so a threshold's
 * day can move — its key does not, which is what keeps it paid once.
 * @param {Array<{wordId: string, day: string}>} signOffs - across every package
 * @returns {Array<{key: string, day: string, label: string}>}
 */
export function masteryMilestones(signOffs, { step = MASTERY_STEP } = {}) {
  const sorted = (signOffs ?? [])
    .map((row) => ({ id: String(row?.wordId ?? ''), day: dayKey(row?.day) }))
    .filter((row) => row.day)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = [];
  for (let n = step; n <= sorted.length; n += step) {
    out.push({ key: String(n), day: sorted[n - 1].day, label: `${n} words mastered` });
  }
  return out;
}

/**
 * A graded curriculum sheet that scored every point. Program sessions
 * (`<program>:<instance>` unit ids) are their own programs' evidence, an
 * external assessment never went through a `graded` event (`gradedAt` null),
 * and voided evidence is not an achievement.
 */
export function isPerfectSheet(session) {
  if (!session?.unitId || String(session.unitId).includes(':')) return false;
  if (!session.gradedAt || session.evidenceInvalidated === true) return false;
  const { gradedCorrectCount: right, gradedTotalCount: total } = session;
  if (Number.isInteger(total) && total > 0 && Number.isInteger(right)) return right === total;
  return typeof session.gradedPercent === 'number' && session.gradedPercent >= 100;
}

/**
 * The first finish of each book, so re-reading a finished book is not a
 * second "finished a book". `readings` are book-log v2 readings
 * (`{status, finishedOn, bookId}` after `shelfItemView`).
 * @returns {Map<string, {day: string, reading: object}>} bookId → first finish
 */
export function firstFinishes(readings) {
  const first = new Map();
  for (const reading of readings ?? []) {
    if (reading?.status !== 'finished' || !reading.bookId) continue;
    const day = dayKey(reading.finishedOn);
    if (!day) continue;
    const held = first.get(reading.bookId);
    if (!held || day < held.day) first.set(reading.bookId, { day, reading });
  }
  return first;
}
