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
    return statuses.find((status) => !status.error && status.progressLabel != null)?.progressLabel ?? null;
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
const byEntryPriority = (left, right) => (left.timingPriority ?? 3) - (right.timingPriority ?? 3)
  || (left.timingRank ?? 0) - (right.timingRank ?? 0);
const focusBudget = (entry) => entry?.timingState === 'urgent'
  ? (entry.timing?.agenda?.urgentBlocks ?? 1)
  : 1;
const focusExtras = (entry) => entry?.timingState === 'urgent'
  ? Math.max(0, (entry.timing?.agenda?.urgentBlocks ?? 1) - (entry.timing?.agenda?.normalBlocks ?? 1))
  : 0;

/** Stable status-map key for one configured program instance. Programs with
 * no instance retain their historical bare id so existing launchers and
 * hand-authored units remain compatible. */
export function programStatusKey(entry) {
  const program = entry?.program ?? '';
  const instance = entry?.programInstance;
  return instance ? `${program}::${instance}` : program;
}

/** Structured lookup; object keys remain a read-only compatibility input. */
export function programStatusFor(programStatuses, entry) {
  if (Array.isArray(programStatuses)) {
    return programStatuses.find((row) => row?.programId === entry?.program
      && (row?.programInstance ?? null) === (entry?.programInstance ?? null))?.status ?? null;
  }
  return programStatuses?.[programStatusKey(entry)] ?? null;
}

/**
 * @param {object} args
 * @param {object} args.plan              `planLearnerWork()` result — reads `.entries`
 * @param {Array}  [args.sessions]        derived session facts — same shape the planner consumes,
 *                                         plus `gradedPercent: number|null`
 * @param {object} [args.programStatuses] `{ [programStatusKey]: { doneToday, progressLabel, score } | { error: true } }`
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
      .map((entry) => programStatusFor(programStatuses, entry))
      .filter(Boolean);
    const programUnavailable = statuses.some((s) => s.error === true);
    const programDone = statuses.some((s) => !s.error && s.doneToday === true);
    // Only entries belonging to an UNAVAILABLE program are excluded from
    // candidacy — not the whole section. Gating the whole section on the
    // subject-level `programUnavailable` flag (the old behaviour) blanked a
    // live curriculum sibling whenever ANY program in the subject errored,
    // and was order-dependent besides (whichever entry won priority).
    const unavailableProgramKeys = new Set(
      programs.filter((e) => programStatusFor(programStatuses, e)?.error === true).map(programStatusKey),
    );
    const eligible = list.filter((e) => !(e.program && unavailableProgramKeys.has(programStatusKey(e))));
    const candidate = [...eligible.filter((e) => e.status === 'in_progress'), ...eligible.filter((e) => e.status === 'available')]
      .sort(byEntryPriority)[0] ?? null;
    const subjectPassedToday = list.some((e) => passedTodayIds.has(e.unitId));
    const candidatePasses = candidate ? (passedTodayByScope.get(timingScope(candidate)) ?? 0) : 0;
    const isFocus = Boolean(candidate && focusExtras(candidate) > 0);
    // A normal subject is served after one pass. An urgent focus course can
    // offer its next newly-unlocked lesson until its declared daily budget is
    // reached; an in-progress retry is always resumable regardless.
    const servedToday = (subjectPassedToday || programDone)
      && !(isFocus && candidatePasses < focusBudget(candidate));

    const next = !servedToday ? candidate : null;

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

    // --- obligation (student-completion-state-machine design, 2026-08-23) --
    // A section is OBLIGATED only if it holds actionable, non-elective work
    // with a same-day claim on the child; everything else is EXCUSED. Rule 1
    // deliberately ignores the focus multi-block term above (a focus subject
    // partway through its extra blocks is still "served" for completion
    // purposes) and counts only non-elective passes (an elective pass must
    // never excuse a required entry sharing its subject).
    const nonElectiveList = list.filter((e) => !e.elective);
    const actionable = eligible.filter((e) => !e.elective && (e.status === 'in_progress' || e.status === 'available'));
    const nonElectiveProgramDone = nonElectiveList.some((e) => (
      e.program && programStatusFor(programStatuses, e)?.error !== true
      && programStatusFor(programStatuses, e)?.doneToday === true
    ));
    const obligationServed = nonElectiveList.some((e) => passedTodayIds.has(e.unitId)) || nonElectiveProgramDone;
    const isBacklog = (e) => e.timing?.mode === 'catch_up' || e.timingState === 'catch_up';
    const hasNonElective = (pred) => nonElectiveList.some(pred);
    let obligation;
    if (obligationServed) {
      obligation = { state: 'served', reason: null };
    } else if (actionable.length === 0) {
      let reason;
      if (nonElectiveList.length === 0) reason = 'elective_only';
      else if (hasNonElective((e) => e.program && unavailableProgramKeys.has(programStatusKey(e)))) reason = 'program_unavailable';
      else if (hasNonElective((e) => e.status === 'locked')) reason = 'blocked_no_offer';
      else if (hasNonElective((e) => e.status === 'dormant')) reason = 'awaiting_grown_up';
      else if (hasNonElective((e) => e.status === 'upcoming')) reason = 'opens_later';
      else reason = 'caught_up';
      obligation = reason === 'program_unavailable'
        ? { state: 'faulted', reason }
        : { state: 'excused', reason };
    } else if (actionable.every(isBacklog)) {
      obligation = { state: 'excused', reason: 'optional_backlog' };
    } else if (actionable.every((e) => e.timingState === 'available' && e.timing?.target?.dueOn)) {
      obligation = { state: 'excused', reason: 'not_due_yet' };
    } else {
      obligation = { state: 'obligated', reason: null };
    }

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
      obligation,
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
      // Rule 1 outranks rule 2: a section that already served its non-elective
      // obligation stays `served` even when its extra-block offer is
      // displaced for printing purposes.
      if (candidate.obligation.state !== 'served') {
        candidate.obligation = { state: 'excused', reason: 'suppressed_by_focus' };
      }
      remaining -= 1;
    }
  });

  sections.forEach((section) => { delete section._subjectPosition; });

  return { sections };
}

export default planDailyAgenda;
