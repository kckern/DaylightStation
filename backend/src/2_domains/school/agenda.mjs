/**
 * Daily agenda sectioning (pure domain). No I/O, no clock reads — `now` is
 * injected and stamped nowhere here; it is only ever compared against.
 *
 * `planLearnerWork` (./planner.mjs) answers "what is there to do?" as a flat
 * list. This module answers the parent-facing question: "what does today's
 * agenda LOOK like, subject by subject?" It groups the flat plan into the
 * nine curriculum shelves (plus a catch-all `other`), decides per subject
 * whether today's obligation is already served, what the single next thing
 * to hand a child is, and rolls up progress/grade for display.
 *
 * Two things it deliberately does NOT do:
 *   - It never reads `passing` off a unit (program units don't carry one —
 *     see Task 2's normalisation — and curriculum passing is the grading
 *     domain's business, not the agenda's).
 *   - It never re-derives session state; it trusts the derived facts handed
 *     in (`{ unitId, state, terminal, outcome, gradedPercent, updatedAt }`).
 */
import { SUBJECT_IDS } from './curriculum/unitValidation.mjs';
import { isSameStudyDay } from './studyDay.mjs';

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Latest (by `outcome.at ?? updatedAt`) session per unitId, restricted to
 * sessions that actually carry a `gradedPercent` — an ungraded session
 * (e.g. still open) contributes no evidence.
 */
function latestGradedPerUnit(sessions) {
  const byUnit = new Map();
  sessions.forEach((s) => {
    if (!s || !isNonEmptyString(s.unitId) || s.gradedPercent == null) return;
    const stampMs = Date.parse(s.outcome?.at ?? s.updatedAt ?? '');
    const held = byUnit.get(s.unitId);
    if (!held || stampMs >= held.stampMs) byUnit.set(s.unitId, { stampMs, gradedPercent: s.gradedPercent });
  });
  return byUnit;
}

/**
 * Progress label for one subject's entry list.
 *   - No curriculum (non-program) entries: defer to the first program
 *     status's own `progressLabel` (or null — the launcher owns this text).
 *   - Every curriculum entry shares the SAME non-null courseId (a single
 *     sequential course, no standalone entries mixed in):
 *     `Unit {min(passed+1,total)} of {total}`, or `Course complete` once
 *     every entry is `completed`.
 *   - Otherwise (multiple courses, a standalone-only set, or a course mixed
 *     with standalone entries): `{passed} of {total} done`.
 */
function progressLabelFor(list, statuses) {
  const curriculum = list.filter((e) => !e.program);
  if (!curriculum.length) {
    return statuses[0]?.progressLabel ?? null;
  }
  const total = curriculum.length;
  const passed = curriculum.filter((e) => e.status === 'completed').length;
  const courseIds = new Set(curriculum.map((e) => e.courseId).filter(isNonEmptyString));
  const singleCourse = courseIds.size === 1 && curriculum.every((e) => isNonEmptyString(e.courseId));
  if (singleCourse) {
    if (passed >= total) return 'Course complete';
    return `Unit ${Math.min(passed + 1, total)} of ${total}`;
  }
  return `${passed} of ${total} done`;
}

/**
 * Blended grade: mean of the latest graded% for each ATTEMPTED curriculum
 * unit (unattempted units are simply absent, never a zero) plus each
 * non-error program's `score * 100`. Null when there is no evidence at all.
 */
function gradeFor(list, latestBySessionUnit, statuses) {
  const values = [];
  list.filter((e) => !e.program).forEach((e) => {
    const graded = latestBySessionUnit.get(e.unitId);
    if (graded) values.push(graded.gradedPercent);
  });
  statuses.forEach((s) => {
    if (!s.error && typeof s.score === 'number') values.push(s.score * 100);
  });
  if (!values.length) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(mean);
}

const timingScope = (entry) => entry?.courseId ? `course:${entry.courseId}` : `unit:${entry?.unitId ?? ''}`;
const byEntryPriority = (left, right) => (left.timingPriority ?? 3) - (right.timingPriority ?? 3);
const focusBudget = (entry) => entry?.timingState === 'urgent'
  ? (entry.timing?.agenda?.urgentBlocks ?? 1)
  : 1;
const focusExtras = (entry) => entry?.timingState === 'urgent'
  ? Math.max(0, (entry.timing?.agenda?.urgentBlocks ?? 1) - (entry.timing?.agenda?.normalBlocks ?? 1))
  : 0;

/**
 * @param {object} args
 * @param {object} args.plan              `planLearnerWork()` result — reads `.entries`
 * @param {Array}  [args.sessions]        derived session facts — same shape the planner consumes,
 *                                         plus `gradedPercent: number|null`
 * @param {object} [args.programStatuses] `{ [programId]: { doneToday, progressLabel, score } | { error: true } }`
 * @param {string} args.now               ISO string — compared against, never stamped
 * @param {string|null} [args.timezone]   IANA zone, or null
 * @param {number} [args.boundaryHour]    study-day rollover hour (default 4am)
 * @returns {{ sections: object[] }}
 */
export function planDailyAgenda({
  plan, sessions = [], programStatuses = {}, now, timezone = null, boundaryHour = 4,
} = {}) {
  const nowMs = Date.parse(now ?? '');
  const entries = (plan?.entries ?? []).filter((e) => e && typeof e === 'object');
  const order = [...SUBJECT_IDS, 'other'];

  const bySubject = new Map();
  entries.forEach((e) => {
    const key = order.includes(e.subject) ? e.subject : 'other';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(e);
  });

  const latestBySessionUnit = latestGradedPerUnit(sessions);
  const passedToday = sessions
    .filter((s) => s?.outcome?.result === 'passed'
      && isSameStudyDay(Date.parse(s.outcome?.at ?? s.updatedAt ?? ''), nowMs, { timezone, boundaryHour }));
  const passedTodayIds = new Set(passedToday.map((s) => s.unitId));
  const entryByUnit = new Map(entries.map((entry) => [entry.unitId, entry]));
  const passedTodayByScope = new Map();
  passedToday.forEach((session) => {
    const entry = entryByUnit.get(session.unitId);
    if (!entry) return;
    const key = timingScope(entry);
    passedTodayByScope.set(key, (passedTodayByScope.get(key) ?? 0) + 1);
  });

  const sections = order.filter((subject) => bySubject.has(subject)).map((subject, subjectPosition) => {
    const list = bySubject.get(subject);
    const programs = list.filter((e) => e.program);
    const statuses = programs
      .map((e) => programStatuses[e.program])
      .filter(Boolean);
    const programUnavailable = statuses.some((s) => s.error === true);
    const programDone = statuses.some((s) => !s.error && s.doneToday === true);
    const candidate = [...list.filter((e) => e.status === 'in_progress'), ...list.filter((e) => e.status === 'available')]
      .sort(byEntryPriority)[0] ?? null;
    const subjectPassedToday = list.some((e) => passedTodayIds.has(e.unitId));
    const candidatePasses = candidate ? (passedTodayByScope.get(timingScope(candidate)) ?? 0) : 0;
    const isFocus = Boolean(candidate && focusExtras(candidate) > 0);
    // A normal subject is served after one pass. An urgent focus course can
    // offer its next newly-unlocked lesson until its declared daily budget is
    // reached; an in-progress retry is always resumable regardless.
    const servedToday = (subjectPassedToday || programDone)
      && !(isFocus && candidatePasses < focusBudget(candidate));

    const next = !servedToday && !programUnavailable ? candidate : null;

    const lockedRemedy = (!servedToday && !next && list.some((e) => e.status === 'locked'))
      ? (list.find((e) => e.status === 'locked')?.lockReason ?? null)
      : null;
    const timingHeld = !servedToday && !next
      ? (list.find((e) => e.status === 'upcoming' || e.status === 'dormant') ?? null)
      : null;
    const timingNotice = timingHeld?.status === 'upcoming'
      ? `Starts ${timingHeld.timing?.availability?.opensOn ?? 'later'}`
      : timingHeld?.status === 'dormant'
        ? 'Ask a grown-up to continue or reschedule this work.'
        : null;

    return {
      subject,
      servedToday,
      next,
      lockedRemedy,
      timingNotice,
      progressLabel: progressLabelFor(list, statuses),
      gradePercent: gradeFor(list, latestBySessionUnit, statuses),
      programUnavailable,
      focus: next && isFocus ? {
        blocksCompleted: candidatePasses,
        blockBudget: focusBudget(next),
        extraBlocks: focusExtras(next),
      } : null,
      suppressed: null,
      _subjectPosition: subjectPosition,
    };
  });

  // Urgent focus entries reserve extra blocks by deferring only lower-ranked
  // flexible subject offers. The agenda remains in its normal subject order;
  // this is capacity allocation, not a child-facing priority sort.
  const focusSections = sections.filter((section) => section.next && focusExtras(section.next) > 0)
    .sort((left, right) => byEntryPriority(left.next, right.next) || left._subjectPosition - right._subjectPosition);
  focusSections.forEach((focus) => {
    let remaining = focusExtras(focus.next);
    while (remaining > 0) {
      const candidate = sections
        .filter((section) => section !== focus && section.next && !section.suppressed
          && section.next.status !== 'in_progress' && section.next.timing?.flexibility === 'flexible')
        .sort((left, right) => byEntryPriority(right.next, left.next) || right._subjectPosition - left._subjectPosition)[0];
      if (!candidate) break;
      candidate.suppressed = {
        bySubject: focus.subject,
        byUnitId: focus.next.unitId,
        reasons: focus.next.timingReasons ?? ['urgent_focus'],
      };
      candidate.next = null;
      remaining -= 1;
    }
  });

  sections.forEach((section) => { delete section._subjectPosition; });

  return { sections };
}

export default planDailyAgenda;
