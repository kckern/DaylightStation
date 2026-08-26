/**
 * The school-day calendar (pure domain). No clock, no timezone, no I/O.
 *
 * `timing.mjs` answers "is this unit open yet?" with one continuous
 * `opensOn`/`closesOn` window. That cannot say "weekdays only", "not
 * Thanksgiving week", or "we're making Thursday up on Saturday" — so before
 * this module a Saturday still read as an unmet obligation on the board.
 *
 * The input is a study-day KEY (`YYYY-MM-DD`), which the caller has already
 * resolved in household-local time (`studyDay.mjs`). Everything here is
 * calendar-key arithmetic: no `Date` is ever read in local time, because
 * parsing a local key as UTC and asking for the LOCAL weekday shifts a Sunday
 * to a Saturday anywhere west of Greenwich.
 */
import { isStudyDay } from './timing.mjs';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * ISO-8601 weekday for a study-day key: 1 = Monday … 7 = Sunday.
 * `getUTCDay()` numbers Sunday 0, which is the one value ISO renumbers.
 */
function isoWeekday(day) {
  const [year, month, date] = day.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/**
 * Normalize one `except`/`also` member to a `{ from, to }` span. A bare date
 * is a one-day span, which collapses membership to a single comparison.
 * Returns null for anything unreadable — the caller fails open on that.
 */
function readSpan(raw) {
  if (typeof raw === 'string') return isStudyDay(raw) ? { from: raw, to: raw } : null;
  if (!isObject(raw)) return null;
  return isStudyDay(raw.from) && isStudyDay(raw.to) ? { from: raw.from, to: raw.to } : null;
}

/** A span list, or null if ANY member is unreadable — see `readSchedule`. */
function readSpanList(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const spans = raw.map(readSpan);
  return spans.some((span) => span === null) ? null : spans;
}

/**
 * The readable form of a schedule, or null when any part of it is malformed.
 *
 * Malformation is judged over the WHOLE block rather than per field on
 * purpose: an unreadable `except` list next to a readable `daysOfWeek` would
 * otherwise still excuse every weekend, which is exactly the silent-excuse
 * failure this module refuses to have.
 */
function readSchedule(raw) {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) return null;
  let daysOfWeek = null;
  if (raw.daysOfWeek !== undefined && raw.daysOfWeek !== null) {
    if (!Array.isArray(raw.daysOfWeek)) return null;
    if (raw.daysOfWeek.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return null;
    daysOfWeek = raw.daysOfWeek;
  }
  const except = readSpanList(raw.except);
  const also = readSpanList(raw.also);
  if (except === null || also === null) return null;
  return { daysOfWeek, except, also };
}

const covers = (spans, day) => spans.some((span) => day >= span.from && day <= span.to);

/**
 * Is `day` a school day under `schedule`?
 *
 * Precedence is fixed: `also` beats `except` beats `daysOfWeek`. A makeup day
 * named explicitly has to win over the vacation range containing it, or
 * "we'll make it up on Saturday" is inexpressible.
 *
 * FAILS OPEN. An absent, unparseable or invalid schedule is a school day. The
 * failure mode of this module must be "the child is asked to do their work",
 * never "a typo excused the entire term and nobody noticed until June".
 */
export function isSchoolDay(day, schedule) {
  if (!isStudyDay(day)) return true;
  const normalized = readSchedule(schedule);
  if (!normalized) return true;
  if (covers(normalized.also, day)) return true;
  if (covers(normalized.except, day)) return false;
  if (!normalized.daysOfWeek) return true;
  return normalized.daysOfWeek.includes(isoWeekday(day));
}

export default isSchoolDay;
