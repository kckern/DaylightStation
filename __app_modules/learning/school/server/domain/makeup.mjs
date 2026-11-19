/**
 * MAKEUP WORK (2026-11-19, economy taxonomy D14). A required section a learner
 * missed on a school day can be made up later in the SAME week, up to the
 * makeup deadline (Saturday by default), and the missed day then reads as
 * served — functionally as if the work had been done that day — with the
 * credit stamped `timeliness: 'makeup'` and the day it was actually done.
 *
 * Config: `school.yml → makeup`, top level:
 *
 *   makeup:
 *     enabled: true
 *     deadline: saturday      # last study day of the week makeup counts on
 *     subjects: [math, english]   # optional; omitted = every subject
 *
 * Absent or `enabled: false` is the old behaviour exactly: a past day is
 * settled when its window closes.
 *
 * DERIVED, NEVER STORED. Nothing here writes. Each day's row already carries
 * a per-section `ledger` (what the day's work amounted to, by track); this
 * fold reads a week of rows and moves SPARE work from a later day onto an
 * earlier missed one. Cached rows stay the raw replay; the credit is laid
 * over them on every read, so a lesson done on Thursday turns Tuesday green
 * the moment Thursday's row is recomputed, and nothing past has to be
 * invalidated.
 *
 * SPARE WORK, per section and track:
 *   - lessons: required curriculum passes on the day, less the one the day
 *     itself asked for (a day that asked for nothing in the section — a
 *     Saturday, a holiday — keeps every pass spare);
 *   - programs: a required program done on a day that did not ask for it.
 *     A program reports done at most once a day, so on a day it is owed it
 *     never has a spare; a Saturday flashcard sitting does.
 * Electives never count: an elective pass must never make up required work.
 *
 * A missed section is credited only when EVERY track it lacked is covered by
 * spare work from a later day in the window; oldest missed day first. Spare
 * work is spent once.
 */
import { addDays, weekIdFor } from "./termVerdict.mjs";

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const WEEKDAY_NAMES = Object.freeze({
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
});

export const MAKEUP_TIMELINESS = 'makeup';

export const DEFAULT_MAKEUP_POLICY = Object.freeze({ enabled: false, deadlineWeekday: 6, subjects: null });

/**
 * Validate `school.yml → makeup`. A bad block turns makeup OFF and says why:
 * a typo must not hand out credit nobody configured.
 * @returns {{errors: string[], policy: {enabled: boolean, deadlineWeekday: number, subjects: string[]|null}}}
 */
export function readMakeupPolicy(raw) {
  if (raw === undefined || raw === null) return { errors: [], policy: DEFAULT_MAKEUP_POLICY };
  if (!isObject(raw)) return { errors: ['makeup must be a mapping'], policy: DEFAULT_MAKEUP_POLICY };
  const errors = [];
  const known = new Set(['enabled', 'deadline', 'subjects']);
  Object.keys(raw).filter((key) => !known.has(key)).forEach((key) => errors.push(`makeup has an unknown key: ${key}`));
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') errors.push('makeup.enabled must be true or false');
  let deadlineWeekday = DEFAULT_MAKEUP_POLICY.deadlineWeekday;
  if (raw.deadline !== undefined) {
    const named = typeof raw.deadline === 'string' ? WEEKDAY_NAMES[raw.deadline.trim().toLowerCase()] : null;
    const numbered = Number.isInteger(raw.deadline) && raw.deadline >= 1 && raw.deadline <= 7 ? raw.deadline : null;
    if (named ?? numbered) deadlineWeekday = named ?? numbered;
    else errors.push(`makeup.deadline must be a weekday name or 1-7, got ${JSON.stringify(raw.deadline)}`);
  }
  let subjects = null;
  if (raw.subjects !== undefined && raw.subjects !== null) {
    if (!Array.isArray(raw.subjects) || raw.subjects.some((s) => typeof s !== 'string' || !s.trim())) {
      errors.push('makeup.subjects must be a list of subject ids');
    } else subjects = Object.freeze(raw.subjects.map((s) => s.trim()));
  }
  if (errors.length) return { errors, policy: DEFAULT_MAKEUP_POLICY };
  return { errors, policy: Object.freeze({ enabled: raw.enabled === true, deadlineWeekday, subjects }) };
}

/** The last study day on which work for `day` can still be made up. */
export function makeupDeadline(day, policy = DEFAULT_MAKEUP_POLICY) {
  return addDays(weekIdFor(day), (policy?.deadlineWeekday ?? 6) - 1);
}

/**
 * Whether a missed `day` can still be made up as of `today`: makeup is on,
 * `day` is before today, and today is no later than the day's deadline.
 */
export function makeupOpen({ day, today, policy = DEFAULT_MAKEUP_POLICY }) {
  if (!policy?.enabled || typeof day !== 'string' || typeof today !== 'string') return false;
  if (!(day < today)) return false;
  const deadline = makeupDeadline(day, policy);
  return day < deadline && today <= deadline;
}

const subjectAllowed = (policy, subject) => !policy.subjects || policy.subjects.includes(subject);
const asked = (section) => section?.state === 'served' || section?.state === 'obligated';

/** What a missed section still lacks, by track; null when it cannot be told. */
function lacking(section) {
  const ledger = section?.ledger;
  if (!isObject(ledger)) return null;
  const done = new Set(ledger.programsDone ?? []);
  return {
    lesson: ledger.needsLesson === true && (ledger.lessons ?? 0) < 1,
    programs: (ledger.needsPrograms ?? []).filter((key) => !done.has(key)),
  };
}

/** The spare work a section's day leaves over for an earlier one. */
function spareOf(section) {
  const ledger = section?.ledger;
  if (!isObject(ledger)) return { lessons: 0, programs: new Set() };
  // `ledger.asked`: whether the calendar asked for the section at all that
  // day. A served Saturday section reads `served` like any other, so its
  // state cannot say whether the work was owed.
  const owed = typeof ledger.asked === 'boolean' ? ledger.asked : asked(section);
  const lessons = Math.max(0, (ledger.lessons ?? 0) - (owed && ledger.needsLesson === true ? 1 : 0));
  const needs = new Set(owed ? (ledger.needsPrograms ?? []) : []);
  return { lessons, programs: new Set((ledger.programsDone ?? []).filter((key) => !needs.has(key))) };
}

function rejudge(row, sections) {
  const served = sections.filter((s) => s?.state === 'served').length;
  const askedCount = served + sections.filter((s) => s?.state === 'obligated').length;
  if (row.state !== 'met' && row.state !== 'partial' && row.state !== 'none') return { ...row, sections };
  const state = served >= askedCount ? 'met' : (served > 0 ? 'partial' : 'none');
  return { ...row, sections, served, asked: askedCount, state, reason: null };
}

/**
 * Lay makeup credit over a set of day rows.
 *
 * @param {Record<string, object>} rows  study day -> term-verdict row (with `sections[].ledger`)
 * @param {{policy: object, today: string}} opts
 * @returns {{rows: Record<string, object>, credits: Array<{day: string, subject: string, servedOn: string}>}}
 *   rows: a new map; a credited row carries `makeup: [{subject, servedOn}]` and
 *   `timeliness: 'makeup'`, and each credited section `makeup: {servedOn}`.
 */
export function foldMakeup(rows, { policy = DEFAULT_MAKEUP_POLICY, today } = {}) {
  const out = { ...(rows ?? {}) };
  const credits = [];
  if (!policy?.enabled || typeof today !== 'string') return { rows: out, credits };
  const days = Object.keys(out).filter((day) => day < today || day === today).sort();
  // Spare work, per day and subject, spent as it is used.
  const spare = new Map();
  const spareFor = (day, subject) => {
    const key = `${day}|${subject}`;
    if (!spare.has(key)) {
      const section = (out[day]?.sections ?? []).find((s) => s?.subject === subject);
      spare.set(key, spareOf(section));
    }
    return spare.get(key);
  };
  for (const day of days) {
    // The deadline day (and a Sunday after it) has no later day to borrow from.
    if (day >= makeupDeadline(day, policy)) continue;
    const row = out[day];
    if (!row || !['partial', 'none'].includes(row.state)) continue;
    const deadline = makeupDeadline(day, policy);
    const later = days.filter((d) => d > day && d <= deadline && d <= today);
    if (!later.length) continue;
    let sections = row.sections ?? [];
    const credited = [];
    sections = sections.map((section) => {
      if (section?.state !== 'obligated' || !subjectAllowed(policy, section.subject)) return section;
      const need = lacking(section);
      if (!need || (!need.lesson && !need.programs.length)) return section;
      // Find every lacking track in later days before spending any of it.
      const plan = [];
      let lessonFrom = null;
      if (need.lesson) {
        lessonFrom = later.find((d) => spareFor(d, section.subject).lessons > 0) ?? null;
        if (!lessonFrom) return section;
      }
      for (const key of need.programs) {
        const from = later.find((d) => spareFor(d, section.subject).programs.has(key));
        if (!from) return section;
        plan.push({ key, from });
      }
      if (lessonFrom) spareFor(lessonFrom, section.subject).lessons -= 1;
      plan.forEach(({ key, from }) => spareFor(from, section.subject).programs.delete(key));
      const servedOn = [lessonFrom, ...plan.map((p) => p.from)].filter(Boolean).sort().at(-1);
      credited.push({ subject: section.subject, servedOn });
      credits.push({ day, subject: section.subject, servedOn });
      return { ...section, state: 'served', reason: null, makeup: { servedOn } };
    });
    if (!credited.length) continue;
    out[day] = { ...rejudge(row, sections), makeup: credited, timeliness: MAKEUP_TIMELINESS };
  }
  return { rows: out, credits };
}

/**
 * The sections still missed and still recoverable as of `today`, oldest
 * first — what a makeup sheet lists. Reads rows AFTER `foldMakeup`.
 * @returns {Array<{day: string, subject: string, deadline: string}>}
 */
export function openMakeupWork(rows, { policy = DEFAULT_MAKEUP_POLICY, today } = {}) {
  if (!policy?.enabled || typeof today !== 'string') return [];
  return Object.keys(rows ?? {}).sort()
    .filter((day) => makeupOpen({ day, today, policy }))
    .flatMap((day) => (rows[day]?.sections ?? [])
      .filter((s) => s?.state === 'obligated' && s.subject && subjectAllowed(policy, s.subject) && lacking(s) != null)
      .map((s) => ({ day, subject: s.subject, deadline: makeupDeadline(day, policy) })));
}
