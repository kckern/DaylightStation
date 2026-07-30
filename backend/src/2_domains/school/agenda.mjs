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
  const passedToday = new Set(
    sessions
      .filter((s) => s?.outcome?.result === 'passed'
        && isSameStudyDay(Date.parse(s.outcome?.at ?? s.updatedAt ?? ''), nowMs, { timezone, boundaryHour }))
      .map((s) => s.unitId),
  );

  const sections = order.filter((subject) => bySubject.has(subject)).map((subject) => {
    const list = bySubject.get(subject);
    const programs = list.filter((e) => e.program);
    const statuses = programs
      .map((e) => programStatuses[e.program])
      .filter(Boolean);
    const programUnavailable = statuses.some((s) => s.error === true);
    const programDone = statuses.some((s) => !s.error && s.doneToday === true);
    const servedToday = list.some((e) => passedToday.has(e.unitId)) || programDone;

    let next = null;
    if (!servedToday && !programUnavailable) {
      next = list.find((e) => e.status === 'in_progress')
        ?? list.find((e) => e.status === 'available')
        ?? null;
    }

    const lockedRemedy = (!servedToday && !next && list.some((e) => e.status === 'locked'))
      ? (list.find((e) => e.status === 'locked')?.lockReason ?? null)
      : null;

    return {
      subject,
      servedToday,
      next,
      lockedRemedy,
      progressLabel: progressLabelFor(list, statuses),
      gradePercent: gradeFor(list, latestBySessionUnit, statuses),
      programUnavailable,
    };
  });

  return { sections };
}

export default planDailyAgenda;
