/**
 * SATURDAY CATCH-UP (2026-11-14). Which school weekdays of this week did a
 * daily program miss? Saturday offers those programs again, optionally, so a
 * missed weekday can be backfilled before the Monday→Sunday week closes (a
 * weekly gem such as "Flashcards on 4 days" counts a Saturday day).
 *
 * A day is MISSED when all hold:
 *   - it is Monday–Friday of today's week, before today;
 *   - the program's own schedule met that day (`scheduleVerdict`, which also
 *     reads the enrollment's `except` spans);
 *   - the household calendar did not take it off: an `away` (or untiered)
 *     break excuses it, a keeping tier excuses it unless its keep-list keeps
 *     this entry, a `normal` tier is a school day — the same reading
 *     `planDailyAgenda` gives today;
 *   - the program did not report it done (`doneOn`, which already counts a
 *     grown-up's day bypass).
 *
 * No `doneOn` array means nobody replayed the week: no evidence, no offer.
 *
 * WHAT IT DOES NOT SEE. Each past day is judged against TODAY's plan entry,
 * not the plan as it stood that day:
 *   - a date-bound entry that swapped this program out on a past weekday (a
 *     holiday lesson taking the subject's slot) is not in today's plan, so
 *     that weekday still reads as missed if the program was not done;
 *   - an enrollment that started mid-week is seen only through its
 *     schedule's `except` span; without one, the weekdays before the
 *     enrollment began read as missed.
 * Cadence and electives are the caller's filter (`planDailyAgenda` asks only
 * for required daily programs).
 */
import { dayOffTier, isoWeekday, scheduleVerdict } from "./schoolCalendar.mjs";
import { DEFAULT_DAY_OFF_POLICY, keepsEntry } from "./dayOffPolicy.mjs";
import { weekWindowFor } from "./measures/weeklyWindow.mjs";
import { addDays } from "./termVerdict.mjs";

/** Mirrors `planDailyAgenda`'s keepingTier / householdOff reading of a day. */
function householdTookOff(day, entry, householdSchedule, dayOffPolicy) {
  if (householdSchedule == null) return false;
  const tier = dayOffTier(day, householdSchedule)?.tier ?? null;
  const keepingTier = tier != null && tier !== 'normal' && tier !== 'away';
  if (keepingTier) return !keepsEntry(dayOffPolicy, tier, entry);
  return !scheduleVerdict(day, householdSchedule).schoolDay;
}

/**
 * @param {object} args
 * @param {object} args.entry            plan entry (`schedule`, `subject`, `program`, `dateBound?`)
 * @param {string[]|undefined} args.doneOn study days the program reported done this week
 * @param {string} args.today            `YYYY-MM-DD` study day
 * @param {object|null} [args.householdSchedule] household calendar (`validateSchedule` shape)
 * @param {object} [args.dayOffPolicy]   keep-lists per tier (`dayOffPolicy.mjs`)
 * @returns {string[]} missed weekdays, ascending
 */
export function missedWeekdays({
  entry, doneOn, today, householdSchedule = null, dayOffPolicy = DEFAULT_DAY_OFF_POLICY,
} = {}) {
  if (!Array.isArray(doneOn) || typeof today !== 'string') return [];
  const done = new Set(doneOn);
  const missed = [];
  for (let day = weekWindowFor(today).from; day < today; day = addDays(day, 1)) {
    if (isoWeekday(day) > 5 || done.has(day)) continue;
    if (!scheduleVerdict(day, entry?.schedule ?? null).schoolDay) continue;
    if (householdTookOff(day, entry, householdSchedule, dayOffPolicy)) continue;
    missed.push(day);
  }
  return missed;
}

export default missedWeekdays;
