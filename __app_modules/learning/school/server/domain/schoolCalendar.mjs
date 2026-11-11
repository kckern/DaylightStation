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
import { isStudyDay } from "./timing.mjs";
import { SUBJECT_IDS } from "./curriculum/unitValidation.mjs";

/**
 * What a household break MEANS for the day's work. A break used to be
 * all-or-nothing (every section excused, blue on the wall); a tier lets
 * daily habits continue on a stay-home day and reserves full exemption for
 * when the family is away. The keep-list per tier lives in `dayOffPolicy.mjs`.
 *
 * - `normal`        listed and named, but run as an ordinary school day
 * - `stay-home`     only the tier's kept work is asked
 * - `enrichment`    as stay-home, with one subject swapped for a date-bound unit
 * - `major-holiday` scripture plus a date-bound holiday activity
 * - `away`          nothing is asked (an untagged break reads as away)
 */
export const DAY_OFF_TIERS = Object.freeze(['normal', 'stay-home', 'enrichment', 'major-holiday', 'away']);
/** The tiers that excuse the day from being a school day. */
export const EXCUSING_TIERS = Object.freeze(['stay-home', 'enrichment', 'major-holiday', 'away']);
const ASSIGNMENT_TIERS = ['enrichment', 'major-holiday'];

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * ISO-8601 weekday for a study-day key: 1 = Monday … 7 = Sunday.
 * `getUTCDay()` numbers Sunday 0, which is the one value ISO renumbers.
 */
export function isoWeekday(day) {
  const [year, month, date] = day.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, date));
  // Date.UTC maps a year under 100 into the 1900s, so year 26 would be read as
  // 1926 — a different weekday. `isStudyDay` accepts '0026-11-26', so this
  // function has to too.
  at.setUTCFullYear(year);
  const weekday = at.getUTCDay();
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
  // An OPTIONAL NAME. A span decides whether a day is a school day; the name
  // decides what a child is told about it, and "Christmas" and "we're off on
  // the 24th" are not the same square on a wall. Optional because a course
  // schedule's own `except` rarely has a name worth printing, and a nameless
  // span must keep working exactly as it always has.
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null;
  const tierFields = readTierFields(raw, field, errors);
  if (!tierFields) return null;
  return { from, to, ...(label ? { label } : {}), ...tierFields };
}

/**
 * The optional day-off tier of a span, with the two fields only some tiers
 * may carry: `replaces` (the subject an enrichment day swaps out) and
 * `assignment` (the date-bound unit an enrichment or major-holiday day offers).
 * A misspelled tier is an error naming the value, never a silent `away`.
 */
function readTierFields(raw, field, errors) {
  const out = {};
  const { tier, replaces, assignment } = raw;
  if (tier !== undefined && tier !== null) {
    if (!DAY_OFF_TIERS.includes(tier)) {
      errors.push(`${field} has an unknown tier: ${tier} (expected one of ${DAY_OFF_TIERS.join(', ')})`);
      return null;
    }
    out.tier = tier;
  }
  if (replaces !== undefined && replaces !== null) {
    if (out.tier !== 'enrichment') { errors.push(`${field} replaces is only allowed on an enrichment tier`); return null; }
    if (!SUBJECT_IDS.includes(replaces)) { errors.push(`${field} replaces an unknown subject: ${replaces}`); return null; }
    out.replaces = replaces;
  }
  if (assignment !== undefined && assignment !== null) {
    if (!ASSIGNMENT_TIERS.includes(out.tier)) {
      errors.push(`${field} assignment is only allowed on an enrichment or major-holiday tier`);
      return null;
    }
    if (typeof assignment !== 'string' || !assignment.trim()) { errors.push(`${field} assignment must be a unit id`); return null; }
    out.assignment = assignment.trim();
  }
  return out;
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
const SCHEDULE_KEYS = ['daysOfWeek', 'except', 'also'];

export function validateSchedule(raw) {
  if (raw === undefined || raw === null) return { errors: [], schedule: null };
  if (!isObject(raw)) return { errors: ['schedule must be a mapping'], schedule: null };
  const errors = [];

  // A key this file does not read is not a harmless extra: `daysofweek`,
  // `exept` or `holidays` would be dropped, leaving a schedule that excuses
  // nothing while its author believes a vacation is in force. Bad VALUES are
  // caught below; only this catches a bad KEY.
  const unknown = Object.keys(raw).filter((key) => !SCHEDULE_KEYS.includes(key));
  if (unknown.length) errors.push(`schedule has unknown keys: ${unknown.join(', ')}`);

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
  const schedule = {
    ...(daysOfWeek ? { daysOfWeek } : {}),
    ...(except.length ? { except } : {}),
    ...(also.length ? { also } : {}),
  };
  // An empty block constrains nothing. Returning it anyway would propagate a
  // meaningless `schedule: {}` into the syllabus record, the enrollment
  // snapshot and every planner entry built from it.
  return { errors, schedule: Object.keys(schedule).length ? schedule : null };
}

const covers = (spans, day) => spans.some((span) => day >= span.from && day <= span.to);

/**
 * The full verdict for one day under one schedule: whether it is a school day,
 * and whatever the schedule was refused for.
 *
 * Both halves come from a single validation pass because the caller that logs
 * a bad schedule is the same caller that has to decide the day, and running
 * the validator twice per entry per agenda build is waste.
 *
 * Precedence is fixed: `also` beats `except` beats `daysOfWeek`. A makeup day
 * named explicitly has to win over the vacation range containing it, or
 * "we'll make it up on Saturday" is inexpressible.
 *
 * FAILS OPEN. An absent, unparseable or invalid schedule is a school day — the
 * failure mode here must be "the child is asked to do their work", never "a
 * typo excused the entire term and nobody noticed until June". `errors` is how
 * a caller turns that silent-but-safe verdict into something findable.
 *
 * @returns {{schoolDay: boolean, errors: string[]}}
 */
export function scheduleVerdict(day, schedule) {
  const { errors, schedule: normalized } = validateSchedule(schedule);
  if (errors.length || !normalized || !isStudyDay(day)) return { schoolDay: true, errors };
  if (covers(normalized.also ?? [], day)) return { schoolDay: true, errors };
  // A `normal`-tier break is listed so the board can name it, but it is run as
  // a school day: it excepts nothing.
  const excepting = (normalized.except ?? []).filter((span) => span.tier !== 'normal');
  if (covers(excepting, day)) return { schoolDay: false, errors };
  if (!normalized.daysOfWeek) return { schoolDay: true, errors };
  return { schoolDay: normalized.daysOfWeek.includes(isoWeekday(day)), errors };
}

/**
 * The NAMED day off covering this day, or null.
 *
 * A wall of squares has two different reasons for a day nobody was asked to
 * work, and they must not look alike: a Saturday is the ordinary rhythm and
 * recedes, while Thanksgiving is a thing that happened and is worth seeing.
 * Only a named `except` span can answer the second, which is why `label` is
 * carried on the span at all.
 *
 * Precedence follows `scheduleVerdict` exactly, because the two must never
 * disagree about the same day: `also` wins, so a makeup Saturday inside a
 * vacation is a school day and therefore not a holiday. A weekend is NOT a
 * holiday here — it is nobody's `except`, it is just a day off the roster.
 *
 * @returns {{from: string, to: string, label: string}|null}
 */
export function namedDayOff(day, schedule) {
  const { errors, schedule: normalized } = validateSchedule(schedule);
  if (errors.length || !normalized || !isStudyDay(day)) return null;
  if (covers(normalized.also ?? [], day)) return null;
  return (normalized.except ?? []).find(
    (span) => day >= span.from && day <= span.to && span.label,
  ) ?? null;
}

/**
 * The day-off tier covering this day, or null.
 *
 * Same precedence as `namedDayOff` and `scheduleVerdict` (validate, then
 * `also` wins, then the first covering `except` span), but a span need not be
 * labelled to carry a tier. An untagged span reports `away`, which is exactly
 * how every break behaved before tiers existed.
 *
 * @returns {{from: string, to: string, label: string|null, tier: string,
 *   replaces?: string, assignment?: string}|null}
 */
export function dayOffTier(day, schedule) {
  const { errors, schedule: normalized } = validateSchedule(schedule);
  if (errors.length || !normalized || !isStudyDay(day)) return null;
  if (covers(normalized.also ?? [], day)) return null;
  const span = (normalized.except ?? []).find((s) => day >= s.from && day <= s.to);
  if (!span) return null;
  return {
    from: span.from,
    to: span.to,
    label: span.label ?? null,
    tier: span.tier ?? 'away',
    ...(span.replaces ? { replaces: span.replaces } : {}),
    ...(span.assignment ? { assignment: span.assignment } : {}),
  };
}

/** `scheduleVerdict` without the diagnostics. */
export function isSchoolDay(day, schedule) {
  return scheduleVerdict(day, schedule).schoolDay;
}

export default isSchoolDay;
