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
 */
function readSpan(raw, field, errors) {
  if (typeof raw === 'string') {
    if (!isStudyDay(raw)) { errors.push(`${field} has an invalid date: ${raw}`); return null; }
    return { from: raw, to: raw };
  }
  if (!isObject(raw)) { errors.push(`${field} entries must be a date or a {from, to} range`); return null; }
  const { from, to } = raw;
  if (!isStudyDay(from) || !isStudyDay(to)) {
    errors.push(`${field} has an invalid range: ${JSON.stringify(raw)}`);
    return null;
  }
  if (to < from) { errors.push(`${field} range ends before it starts: ${from} → ${to}`); return null; }
  return { from, to };
}

function readSpanList(raw, field, errors) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { errors.push(`${field} must be a list`); return []; }
  return raw.map((member) => readSpan(member, field, errors)).filter(Boolean);
}

/**
 * Validate and normalize a `schedule` block, in the `{ errors, x }` shape the
 * other School validators return.
 *
 * Malformation is judged over the WHOLE block rather than per field on
 * purpose: an unreadable `except` list next to a readable `daysOfWeek` would
 * otherwise still excuse every weekend, which is exactly the silent-excuse
 * failure this module refuses to have. So `schedule` is null whenever
 * `errors` is non-empty, and callers must read `errors` rather than infer a
 * verdict from the null.
 */
export function validateSchedule(raw) {
  if (raw === undefined || raw === null) return { errors: [], schedule: null };
  if (!isObject(raw)) return { errors: ['schedule must be a mapping'], schedule: null };
  const errors = [];

  let daysOfWeek = null;
  if (raw.daysOfWeek !== undefined && raw.daysOfWeek !== null) {
    if (!Array.isArray(raw.daysOfWeek)) {
      errors.push('daysOfWeek must be a list of ISO weekdays (1=Monday … 7=Sunday)');
    } else if (!raw.daysOfWeek.length) {
      // A term with no school days at all is never what anyone meant, and it
      // would excuse every day from now to June without raising a single error.
      errors.push('daysOfWeek must name at least one weekday');
    } else if (raw.daysOfWeek.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      errors.push(`daysOfWeek must be integers 1..7 (1=Monday … 7=Sunday), got: ${JSON.stringify(raw.daysOfWeek)}`);
    } else {
      daysOfWeek = [...new Set(raw.daysOfWeek)].sort((left, right) => left - right);
    }
  }

  const except = readSpanList(raw.except, 'except', errors);
  const also = readSpanList(raw.also, 'also', errors);

  if (errors.length) return { errors, schedule: null };
  return {
    errors,
    schedule: {
      ...(daysOfWeek ? { daysOfWeek } : {}),
      ...(except.length ? { except } : {}),
      ...(also.length ? { also } : {}),
    },
  };
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
  const { errors, schedule: normalized } = validateSchedule(schedule);
  if (errors.length || !normalized) return true;
  if (covers(normalized.also ?? [], day)) return true;
  if (covers(normalized.except ?? [], day)) return false;
  if (!normalized.daysOfWeek) return true;
  return normalized.daysOfWeek.includes(isoWeekday(day));
}

export default isSchoolDay;
