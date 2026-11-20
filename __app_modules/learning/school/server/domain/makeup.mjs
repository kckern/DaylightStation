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
 * Absent or `enabled: false` is the old behaviour: a past day is settled when
 * its window closes. The one exception is restitution (below): a lesson a
 * makeup sheet claimed still counts for the day it was done.
 *
 * DERIVED FROM THE LOG. Nothing here writes. The one stored fact is a
 * session's makeup_claimed annotation (which day a makeup-sheet lesson is
 * for); every credit is still worked out on read. Each day's row already carries
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
 *   - claimed lessons (`ledger.makeupClaims`, from a makeup-sheet code):
 *     spent on the day they name before any ordinary spare; one its day did
 *     not need turns into ordinary spare afterwards, and one nothing else
 *     takes is paid back to the day it was done on (restitution), even with
 *     makeup off or for a subject the policy leaves out.
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

/**
 * The earlier day a passed session counts for, or null when it counts for
 * the day it was done. A session carries a claim only when a makeup-sheet
 * code opened or reprinted it (`makeup_claimed`). The claim holds while the
 * pass falls after the claimed day, no later than the claim's deadline, and
 * in the same week; outside that the lesson is ordinary work again.
 * @param {{makeupFor?: string|null, makeupDeadline?: string|null}|null} session
 * @param {string} today the study day the pass is judged on
 * @returns {string|null}
 */
export function honouredMakeupClaim(session, today) {
  const forDay = session?.makeupFor;
  const deadline = session?.makeupDeadline;
  if (typeof forDay !== 'string' || typeof deadline !== 'string' || typeof today !== 'string') return null;
  if (!(forDay < today) || today > deadline) return null;
  if (weekIdFor(forDay) !== weekIdFor(today)) return null;
  return forDay;
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
  if (!isObject(ledger)) return { lessons: 0, programs: new Set(), claims: new Map() };
  // `ledger.asked`: whether the calendar asked for the section at all that
  // day. A served Saturday section reads `served` like any other, so its
  // state cannot say whether the work was owed.
  const owed = typeof ledger.asked === 'boolean' ? ledger.asked : asked(section);
  const lessons = Math.max(0, (ledger.lessons ?? 0) - (owed && ledger.needsLesson === true ? 1 : 0));
  const needs = new Set(owed ? (ledger.needsPrograms ?? []) : []);
  // Claimed lessons (`makeupClaims`) are not the day's own and never paid
  // for it, so every one is spare, earmarked for the day it names.
  const claims = new Map();
  (Array.isArray(ledger.makeupClaims) ? ledger.makeupClaims : [])
    .filter((day) => typeof day === 'string')
    .forEach((day) => claims.set(day, (claims.get(day) ?? 0) + 1));
  return { lessons, programs: new Set((ledger.programsDone ?? []).filter((key) => !needs.has(key))), claims };
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
 *   A restituted section carries `makeup: {servedOn: <its own day>, restituted: true}`;
 *   its row is rejudged but gains no `makeup` entry, no `timeliness`, and no credit.
 */
export function foldMakeup(rows, { policy = DEFAULT_MAKEUP_POLICY, today } = {}) {
  const out = { ...(rows ?? {}) };
  const credits = [];
  const crediting = Boolean(policy?.enabled) && typeof today === 'string';
  const days = Object.keys(out)
    .filter((day) => typeof today !== 'string' || day < today || day === today).sort();
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
  // Credit one missed day from spare work later in its window.
  const creditDay = (day) => {
    // The deadline day (and a Sunday after it) has no later day to borrow from.
    if (day >= makeupDeadline(day, policy)) return;
    const row = out[day];
    if (!row || !['partial', 'none'].includes(row.state)) return;
    const deadline = makeupDeadline(day, policy);
    const later = days.filter((d) => d > day && d <= deadline && d <= today);
    if (!later.length) return;
    let sections = row.sections ?? [];
    const credited = [];
    sections = sections.map((section) => {
      if (section?.state !== 'obligated' || !subjectAllowed(policy, section.subject)) return section;
      const need = lacking(section);
      if (!need || (!need.lesson && !need.programs.length)) return section;
      // Find every lacking track in later days before spending any of it.
      // A lesson claimed for THIS day is spent before ordinary spare.
      const plan = [];
      let lessonFrom = null;
      let lessonClaimed = false;
      if (need.lesson) {
        lessonFrom = later.find((d) => (spareFor(d, section.subject).claims.get(day) ?? 0) > 0) ?? null;
        lessonClaimed = Boolean(lessonFrom);
        if (!lessonFrom) lessonFrom = later.find((d) => spareFor(d, section.subject).lessons > 0) ?? null;
        if (!lessonFrom) return section;
      }
      for (const key of need.programs) {
        const from = later.find((d) => spareFor(d, section.subject).programs.has(key));
        if (!from) return section;
        plan.push({ key, from });
      }
      if (lessonFrom) {
        const pool = spareFor(lessonFrom, section.subject);
        if (lessonClaimed) pool.claims.set(day, pool.claims.get(day) - 1);
        else pool.lessons -= 1;
      }
      plan.forEach(({ key, from }) => spareFor(from, section.subject).programs.delete(key));
      const servedOn = [lessonFrom, ...plan.map((p) => p.from)].filter(Boolean).sort().at(-1);
      credited.push({ subject: section.subject, servedOn });
      credits.push({ day, subject: section.subject, servedOn });
      return { ...section, state: 'served', reason: null, makeup: { servedOn } };
    });
    if (!credited.length) return;
    out[day] = {
      ...rejudge(row, sections),
      makeup: [...(Array.isArray(row.makeup) ? row.makeup : []), ...credited],
      timeliness: MAKEUP_TIMELINESS,
    };
  };
  if (crediting) days.forEach(creditDay);
  // Every (day, subject) holding a claim gets its pool now, so what follows
  // never depends on which pools pass 1 happened to open.
  days.forEach((day) => (out[day]?.sections ?? []).forEach((section) => {
    if (section?.subject && Array.isArray(section.ledger?.makeupClaims) && section.ledger.makeupClaims.length) {
      spareFor(day, section.subject);
    }
  }));
  // A claim its day did not need (served some other way, or still lacking a
  // program) is still a lesson done: it becomes ordinary spare for any other
  // missed day, rather than counting for nothing.
  let leftover = false;
  spare.forEach((pool) => {
    pool.unspentClaims = 0;
    pool.claims.forEach((count) => {
      if (count > 0) { pool.lessons += count; pool.unspentClaims += count; leftover = true; }
    });
    pool.claims.clear();
  });
  // Pass 2, oldest day first: a day whose own claim is still unspent is paid
  // back by it before it may borrow anyone else's spare. Borrowing first
  // would spend another day's lesson on it and leave its own counting for
  // nothing.
  days.forEach((day) => {
    restituteDay(out, day, spare);
    if (leftover && crediting) creditDay(day);
  });
  return { rows: out, credits };
}

/**
 * RESTITUTION (review, 2026-11-19). The agenda always takes a claimed pass
 * away from the day it was done on; the fold above pays it to the missed day
 * only when it can (makeup on, the subject allowed, the missed day inside the
 * policy's window, every other track covered). A claim still unspent after
 * pass 1, and not taken as spare by an older missed day in pass 2, is paid
 * back to its own day's section, so a real lesson never counts for no day. It runs with makeup off and for excluded subjects too.
 * The section must lack only the lesson; the row is rejudged but not stamped
 * `timeliness: 'makeup'` (the work was done that day), and no credit is
 * reported.
 */
function restituteDay(out, day, spare) {
  const row = out[day];
  if (!row || !Array.isArray(row.sections)) return;
  let changed = false;
  const sections = row.sections.map((section) => {
    if (section?.state !== 'obligated' || !section.subject) return section;
    const pool = spare.get(`${day}|${section.subject}`);
    if (!pool || !(pool.unspentClaims > 0) || !(pool.lessons > 0)) return section;
    const need = lacking(section);
    if (!need?.lesson || need.programs.length) return section;
    pool.unspentClaims -= 1;
    pool.lessons -= 1;
    changed = true;
    return { ...section, state: 'served', reason: null, makeup: { servedOn: day, restituted: true } };
  });
  if (changed) out[day] = rejudge(row, sections);
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
