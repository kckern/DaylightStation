/**
 * Rules for editing the household calendar from the teacher console (pure).
 *
 * The past is settled. A day before today has already been judged on the term
 * grid (yesterday is still replayed on every read), so an edit may not change
 * what any such day MEANT: whether it was a school day, its tier, the subject
 * it swapped, or its activity. A label is not a verdict and may change.
 *
 * Keep-lists apply from today. A change to tier T's keep-list is held back
 * while yesterday was a T day, because yesterday's row is still replayed and
 * would be re-judged with the new list.
 */
import { scheduleVerdict, dayOffTier } from "./schoolCalendar.mjs";

const SPAN_KEYS = ['from', 'to', 'label', 'tier', 'replaces', 'assignment'];

/** `YYYY-MM-DD` + n days, in calendar-key arithmetic (UTC, never local). */
export function addDayKeys(day, n) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** What one day means under one schedule. */
export function effectiveDay(day, schedule) {
  const { schoolDay } = scheduleVerdict(day, schedule);
  const span = schedule ? dayOffTier(day, schedule) : null;
  return {
    schoolDay,
    tier: span?.tier ?? null,
    replaces: span?.replaces ?? null,
    assignment: span?.assignment ?? null,
  };
}

const spansOf = (schedule) => [...(schedule?.except ?? []), ...(schedule?.also ?? [])];

function daysCovered(schedules, beforeDay) {
  const days = new Set();
  for (const schedule of schedules) {
    for (const span of spansOf(schedule)) {
      if (!span?.from || !span?.to) continue;
      for (let day = span.from; day <= span.to && day < beforeDay; day = addDayKeys(day, 1)) days.add(day);
    }
  }
  return [...days].sort();
}

/** Days before `today` whose meaning differs between the two schedules. */
export function lockedDayChanges({ before, after, today }) {
  const same = (a, b) => a.schoolDay === b.schoolDay && a.tier === b.tier
    && a.replaces === b.replaces && a.assignment === b.assignment;
  return daysCovered([before, after], today)
    .filter((day) => !same(effectiveDay(day, before), effectiveDay(day, after)));
}

const keyOf = (selector) => (selector?.subject ? `subject:${selector.subject}` : `program:${selector?.program}`);
const keySet = (policy, tier) => [...new Set((policy?.[tier]?.keep ?? []).map(keyOf))].sort().join('|');

/** Tiers whose keep-list differs (order-insensitive). */
export function keepListChanges({ beforePolicy, afterPolicy }) {
  const tiers = new Set([...Object.keys(beforePolicy ?? {}), ...Object.keys(afterPolicy ?? {})]);
  return [...tiers].filter((tier) => keySet(beforePolicy, tier) !== keySet(afterPolicy, tier)).sort();
}

/** The changed tier yesterday belonged to, or null. */
export function keepListBlocked({ changedTiers, schedule, yesterday }) {
  const tier = schedule ? dayOffTier(yesterday, schedule)?.tier ?? null : null;
  return tier && changedTiers.includes(tier) ? tier : null;
}

/** The raw `calendar` mapping to write: span keys in a fixed order, empties dropped. */
export function buildCalendarBlock({ except = [], also = [] } = {}) {
  const tidy = (span) => Object.fromEntries(SPAN_KEYS
    .filter((key) => span[key] !== undefined && span[key] !== null && span[key] !== '')
    .map((key) => [key, span[key]]));
  const block = {
    ...(except.length ? { except: except.map(tidy) } : {}),
    ...(also.length ? { also: also.map(tidy) } : {}),
  };
  return Object.keys(block).length ? block : null;
}
