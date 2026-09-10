/**
 * The term grid's vocabulary: one verdict per study day, one per week, and
 * the term's own bounds. Pure — no clock, no I/O. Every input is a fact some
 * other module already established (`resolveDayCompletion`'s fold, the
 * compact sections `GetLearnerDayCompletion` returns, the household's
 * academic periods), and every output is a colour a child can read from
 * across the room plus the reason a grown-up can ask for.
 *
 * DERIVED, NEVER STORED — the school convention (`docs/reference/school/
 * README.md`). What a cache holds is this function's OUTPUT for a day, keyed
 * by `VERDICT_VERSION`; bump the version and every cached row is recomputed.
 * Editing a course re-colours the past. That is accepted, and it is the whole
 * reason the ladder lives here as a function rather than in a file of
 * verdicts somebody would one day have to migrate.
 *
 * THE LADDER, top rung wins:
 *
 *   1  day after today, or nothing computed yet ......... unknown / pending
 *   2  completion indeterminate (a fault) ............... unknown / <the fault>
 *   2b nothing asked and every excuse is `no_history` ... unknown / no_history
 *   3  nothing asked, the house was off ................. exempt / household_calendar
 *   4  nothing asked, every course said not a school day  exempt / not_a_school_day
 *   5  nothing asked, no sections at all ................ exempt / no_work
 *   6  nothing asked (excused for other reasons) ........ exempt / nothing_owed
 *   7  served everything asked .......................... met
 *   8  served some of it ................................ partial
 *   9  served none of it ................................ none
 *
 * 2b sits ABOVE the exempt rungs on purpose. A day on which the only assigned
 * work was a program that keeps no record is a day nobody can judge; painting
 * it the calm blue of a vacation would state "the house took the day off"
 * about a day that was probably ordinary school. Grey with a reason is the
 * honest colour. `unknown` ALWAYS carries a reason.
 *
 * Work done on an exempt day still reads `met` (rungs 7–9 need `asked > 0`,
 * and `planDailyAgenda`'s calendar override never un-serves a section), so a
 * child who reads on a Saturday sees the Saturday go green.
 */
import { isoWeekday } from './schoolCalendar.mjs';

export { isoWeekday };

/** Bump when the ladder's meaning changes; every cached row then recomputes. */
export const VERDICT_VERSION = 1;

export const DAY_STATES = Object.freeze(['met', 'partial', 'none', 'exempt', 'unknown']);

const DAY_MS = 86_400_000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` shifted by `n` days. Calendar arithmetic in UTC on purpose:
 * the keys are already household-local study days, so no zone applies. */
export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of the week containing `day` — the week's id everywhere. */
export function weekIdFor(day) {
  return addDays(day, -(isoWeekday(day) - 1));
}

/** Every study-day key from `from` to `to`, inclusive. Empty when reversed. */
export function termDaysFor(from, to) {
  if (!DAY_KEY.test(from ?? '') || !DAY_KEY.test(to ?? '') || to < from) return [];
  const out = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/**
 * One day's verdict.
 *
 * @param {object} args
 * @param {string} args.studyDay
 * @param {string} args.today - the current study day; anything after it is `pending`
 * @param {{state: string, faults?: Array<{reason: string}>}|null} args.completion
 *   `resolveDayCompletion`'s answer for the day
 * @param {Array<{subject: string|null, state: string, reason: string|null}>} args.sections
 *   the compact sections the day was judged over
 * @param {string} [args.computedAt] - ISO, for `retryAfter` on a fault
 * @param {number} [args.retryAfterMs] - how long a faulted day stays cached
 * @returns {{state: string, reason: string|null, served: number, asked: number,
 *            weekday: number, retryAfter?: string}}
 */
export function dayVerdict({
  studyDay, today, completion = null, sections = [], computedAt = null, retryAfterMs = 6 * 3_600_000,
} = {}) {
  const weekday = isoWeekday(studyDay);
  const served = sections.filter((s) => s?.state === 'served').length;
  const asked = served + sections.filter((s) => s?.state === 'obligated').length;
  const base = { served, asked, weekday };
  const excuses = sections.filter((s) => s?.state === 'excused').map((s) => s.reason ?? 'excused');

  if (!completion || studyDay > today) return { state: 'unknown', reason: 'pending', ...base };
  if (completion.state === 'indeterminate') {
    const reason = completion.faults?.[0]?.reason ?? sections.find((s) => s?.state === 'faulted')?.reason ?? 'faulted';
    const retryAfter = computedAt ? new Date(Date.parse(computedAt) + retryAfterMs).toISOString() : undefined;
    return { state: 'unknown', reason, ...base, ...(retryAfter ? { retryAfter } : {}) };
  }
  if (asked === 0) {
    if (excuses.length && excuses.every((r) => r === 'no_history')) return { state: 'unknown', reason: 'no_history', ...base };
    if (excuses.includes('household_calendar')) return { state: 'exempt', reason: 'household_calendar', ...base };
    if (excuses.length && excuses.every((r) => r === 'not_a_school_day' || r === 'no_history')) {
      return { state: 'exempt', reason: 'not_a_school_day', ...base };
    }
    if (!sections.length) return { state: 'exempt', reason: 'no_work', ...base };
    return { state: 'exempt', reason: 'nothing_owed', ...base };
  }
  if (served >= asked) return { state: 'met', reason: null, ...base };
  if (served > 0) return { state: 'partial', reason: null, ...base };
  return { state: 'none', reason: null, ...base };
}

/**
 * One week's verdict over its days' `weekly` rows — the 8th row of the grid.
 *
 * A weekly obligation is one unit owed once per Monday→Sunday week
 * (`cadence: 'weekly'`). Each day records, per weekly unit, whether it was
 * `served` that day, already `satisfied` earlier in the week, or still `open`.
 * The week is judged on the UNION: a unit served on any day is done for the
 * week.
 *
 * @param {object} args
 * @param {string} args.weekId - Monday key
 * @param {string} args.today
 * @param {Array<{studyDay: string, weekly?: Array<{unitId: string, state: string}>}>} args.days
 *   the week's day rows, any order, may be partial
 * @returns {{state: string, reason: string|null, open: boolean, served: number, asked: number}}
 */
export function weekVerdict({ weekId, today, days = [] } = {}) {
  const to = addDays(weekId, 6);
  const open = to > today;
  const units = new Map();
  for (const day of days) {
    for (const row of day?.weekly ?? []) {
      if (!row?.unitId) continue;
      const prior = units.get(row.unitId) ?? 'open';
      const done = row.state === 'served' || row.state === 'satisfied';
      units.set(row.unitId, done || prior !== 'open' ? 'done' : 'open');
    }
  }
  const asked = units.size;
  const served = [...units.values()].filter((v) => v === 'done').length;
  if (asked === 0) return { state: 'exempt', reason: 'no_weekly_work', open, served, asked };
  if (served >= asked) return { state: 'met', reason: null, open, served, asked };
  if (served > 0) return { state: 'partial', reason: null, open, served, asked };
  // Nothing yet, and the week is still running: not a failure, not yet.
  if (open) return { state: 'unknown', reason: 'pending', open, served, asked };
  return { state: 'none', reason: null, open, served, asked };
}

/**
 * The term the grid draws: the academic period containing `today` (the most
 * specific one — a semester inside a year wins), with an optional explicit
 * window narrowing the days shown. Day bounds are inclusive study-day keys:
 * `from` is the period's first day, `to` its `endsAt` minus one day, because
 * `endsAt` is an exclusive instant.
 *
 * @param {Array<{periodId: string, kind: string, startsAt: string, endsAt: string, parentPeriodId?: string}>} periods
 * @param {{today: string, termId?: string|null, window?: {from?: string, to?: string}|null}} args
 * @returns {{termId: string, label: string|null, from: string, to: string}|null}
 */
export function resolveTermFor(periods = [], { today, termId = null, window = null } = {}) {
  const dayOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : null);
  const candidates = (periods ?? []).filter((p) => p && DAY_KEY.test(dayOf(p.startsAt) ?? '') && DAY_KEY.test(dayOf(p.endsAt) ?? ''));
  let period = null;
  if (termId) period = candidates.find((p) => p.periodId === termId) ?? null;
  else {
    // Containing periods, most specific first: the one with a parent beats the
    // parent; ties break on the shorter span.
    const containing = candidates.filter((p) => dayOf(p.startsAt) <= today && today < dayOf(p.endsAt));
    containing.sort((a, b) => (b.parentPeriodId ? 1 : 0) - (a.parentPeriodId ? 1 : 0)
      || (Date.parse(a.endsAt) - Date.parse(a.startsAt)) - (Date.parse(b.endsAt) - Date.parse(b.startsAt)));
    period = containing[0] ?? null;
  }
  if (!period) return null;
  let from = dayOf(period.startsAt);
  let to = addDays(dayOf(period.endsAt), -1);
  if (DAY_KEY.test(window?.from ?? '') && window.from > from) from = window.from;
  if (DAY_KEY.test(window?.to ?? '') && window.to < to) to = window.to;
  if (to < from) return null;
  return { termId: period.periodId, label: period.label ?? null, from, to };
}

export default dayVerdict;
