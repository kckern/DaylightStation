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
 * Structured progress rows for the printed card — `[{ label, completed, total }]`,
 * course-level first, then the unit inside it.
 *
 * Program launchers have been BUILDING these all along (see
 * `PianoCourseProgramLauncher#progress`) and nothing on the agenda path ever
 * read them: the card got `progressLabel`, a pre-formatted string, and printed
 * that. For the piano course that string is `34/366 · next: <title>` — a raw
 * tally a child does not act on, ending in a verbatim repeat of the card's own
 * title. The result receipt already proves the better answer for the same data:
 * a bar with a position marker. This is what feeds it.
 *
 * Curriculum (non-program) work has no equivalent per-lesson denominator here,
 * so it keeps its label and gets no bar rather than a fabricated one.
 */
function progressRowsFor(statuses) {
  const rows = statuses.find((status) => !status.error && Array.isArray(status.progress))?.progress;
  return Array.isArray(rows)
    ? rows.filter((row) => row && Number.isInteger(row.total) && row.total > 0)
    : [];
}

/**
 * Blended grade: mean of the latest graded% for each ATTEMPTED curriculum
 * unit (unattempted units are simply absent, never a zero) plus each
 * non-error program's `score`. Null when there is no evidence at all.
 *
 * A PROGRAM `score` IS ALREADY A PERCENT, on the same 0–100 scale as
 * `gradedPercent` — which is the only reason the two can be averaged together
 * at all. Every producer agrees: the piano launcher computes
 * `(completed / total) * 100`, the flashcard launcher passes the same mastery
 * figure it prints as "N% mastered", and PianoLessonCeremonyBridge reads the
 * field straight into a `percent`. This function used to scale it a second
 * time, which is how an arts section came back with `gradePercent: 1000`.
 */
function gradeFor(list, latestBySessionUnit, statuses) {
  const values = [];
  list.filter((e) => !e.program).forEach((e) => {
    const graded = latestBySessionUnit.get(e.unitId);
    if (graded) values.push(graded.gradedPercent);
  });
  statuses.forEach((s) => {
    if (!s.error && typeof s.score === 'number') values.push(s.score);
  });
  if (!values.length) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(mean);
}

// --- blocked-work provenance -------------------------------------------------
// A lock is two different situations wearing one name. "Finish Unit One first"
// when Unit One is sitting there waiting is an ordinary sequence and excuses
// the day; the same sentence pointing at something NOTHING can reach is a
// broken curriculum, and a broken curriculum must never read as a day served.
// The planner (planner.mjs `blockerFor`) reports only the NEAREST unpassed
// predecessor, which may itself be locked behind something else, so the chain
// has to be walked to a fixpoint before either verdict is safe.

/** Work a child can pick up right now. */
const ACTIONABLE_STATUSES = new Set(['available', 'in_progress']);

/**
 * The reasons that describe the SYSTEM being broken rather than the child
 * being legitimately off the hook. These fault the day (`indeterminate` in
 * completion.mjs) instead of excusing it, because a day that could not be
 * judged is not a day that was finished — and the piano-kiosk games hang off
 * that verdict.
 */
const FAULT_REASONS = new Set(['program_unavailable', 'blocked_unreachable']);

/**
 * Work held by the calendar or by a grown-up rather than by a broken
 * curriculum. A date arrives on its own and a grown-up can be asked, so
 * neither is a fault — and the excuse ladder below already has truthful names
 * for those days (`opens_later`, `awaiting_grown_up`).
 *
 * The exception is the planner's `not_scheduled` marker: a dated unit whose
 * module carries no window at all is not waiting for a date, it is waiting for
 * a date that will never exist.
 */
const isTimeHeld = (entry) => (entry.status === 'upcoming' || entry.status === 'dormant')
  && !(entry.timingReasons ?? []).includes('not_scheduled');

/**
 * Walk one locked entry's blocker chain to a fixpoint.
 *
 * @returns {boolean} true when the chain ends at something the child (or the
 *   calendar, or a grown-up) can actually get to. False when it dead-ends: a
 *   blocker absent from the plan, a lock that names no remedy at all, a
 *   never-scheduled dated unit, a blocker already passed (a contradiction the
 *   planner cannot produce, so evidence the data is wrong), or a cycle.
 */
function blockerChainIsReachable(start, entryByUnit, logger) {
  const visited = new Set();
  let cursor = start;
  while (cursor) {
    if (visited.has(cursor.unitId)) {
      // A malformed curriculum must not hang the planner.
      logger?.warn?.('school.agenda.blocker-cycle', {
        unitId: start.unitId, subject: start.subject ?? null, chain: [...visited],
      });
      return false;
    }
    visited.add(cursor.unitId);
    const blockerId = cursor.remedy?.unitId ?? null;
    if (!isNonEmptyString(blockerId)) return false;
    const blocker = entryByUnit.get(blockerId);
    if (!blocker) return false;
    if (ACTIONABLE_STATUSES.has(blocker.status) || isTimeHeld(blocker)) return true;
    if (blocker.status !== 'locked') return false;
    cursor = blocker;
  }
  return false;
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
 * @param {object} [args.programStatuses] `{ [programStatusKey]: { doneToday, terminal?, progressLabel, score } | { error: true } }`
 * @param {string} args.now               ISO string — compared against, never stamped
 * @param {string|null} [args.timezone]   IANA zone, or null
 * @param {number} [args.boundaryHour]    study-day rollover hour (default 4am)
 * @param {object} [args.logger]          structured logger; `warn` is called when a
 *                                         subject turns out to be blocked by nothing reachable
 * @returns {{ sections: object[] }}
 */
export function planDailyAgenda({
  plan, sessions = [], programStatuses = {}, now, timezone = null, boundaryHour = 4, logger = null,
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
    // A once-only program owns completion evidence outside a School work
    // session. Once its launcher says the instance is terminal, it must leave
    // future agendas rather than being offered again every study day.
    const terminalProgramKeys = new Set(
      programs.filter((e) => e.cadence === 'once' && programStatusFor(programStatuses, e)?.terminal === true)
        .map(programStatusKey),
    );
    const eligible = list.filter((e) => !(e.program && (
      unavailableProgramKeys.has(programStatusKey(e)) || terminalProgramKeys.has(programStatusKey(e))
    )));
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
    //
    // EXCUSED is not the same as FAULTED. Excused means the child is
    // legitimately off the hook and the day may still complete; faulted means
    // the day could not be judged at all. Two reasons fault: a required
    // program that will not answer, and work blocked by something nothing can
    // reach (see `blockerChainIsReachable` above).
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
      else if (hasNonElective((e) => e.status === 'locked')) {
        // The split the 2026-08-25 unlock incident demanded: being blocked by a
        // sibling the child can still get to excuses the day, being blocked by
        // something nothing can reach is a fault. Only one locked entry needs a
        // live chain for the subject to have somewhere to go.
        const lockedNonElective = nonElectiveList.filter((e) => e.status === 'locked');
        const reachable = lockedNonElective
          .some((e) => blockerChainIsReachable(e, entryByUnit, logger));
        reason = reachable ? 'blocked_no_offer' : 'blocked_unreachable';
        if (!reachable) {
          logger?.warn?.('school.agenda.blocked-unreachable', {
            subject,
            unitIds: lockedNonElective.map((e) => e.unitId),
            blockerIds: lockedNonElective.map((e) => e.remedy?.unitId ?? null),
          });
        }
      } else if (hasNonElective((e) => e.status === 'dormant')) reason = 'awaiting_grown_up';
      else if (hasNonElective((e) => e.status === 'upcoming')) reason = 'opens_later';
      else reason = 'caught_up';
      obligation = FAULT_REASONS.has(reason)
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
      // Is the thing being OFFERED a lesson from a day that has already passed?
      // The schedule deliberately keeps moving when a day is missed rather than
      // waiting, so catching up is normal and expected — but on paper a backlog
      // lesson is otherwise indistinguishable from today's own work, and a child
      // cannot tell "you are backfilling Monday" from "this is today's". Stated
      // as one flag rather than left for a presenter to infer from `timing`
      // internals, and derived with the SAME `isBacklog` the obligation rules
      // above use so the paper and the policy can never disagree about what
      // counts as backlog.
      catchUp: !!(next && isBacklog(next)),
      lockedRemedy,
      timingNotice,
      progressLabel: progressLabelFor(list, statuses),
      progressRows: progressRowsFor(statuses),
      gradePercent: gradeFor(list, latestBySessionUnit, statuses),
      // WHAT WAS ACTUALLY DONE, not merely that something was. `servedToday`
      // is a boolean, and a boolean is all the paper could ever say: "SCRIPTURE
      // — done today" named the shelf and withheld the lesson. These are the
      // entries this subject passed on this study day, so the agenda's
      // finished-work tally can name the work. A program subject (piano) owns
      // its completion outside a work session, so its work cannot come from
      // `list` — it comes from the program's own status, which knows exactly
      // which lesson it credited today. Without that second source a served
      // program subject named nothing at all, and a presenter had only the
      // pre-formatted `progressLabel` to fall back on.
      servedWork: [
        ...list
          .filter((entry) => passedTodayIds.has(entry.unitId))
          .map((entry) => ({ unitId: entry.unitId, title: entry.title ?? null })),
        ...statuses.flatMap((status) => (status?.error ? [] : (status.servedWork ?? []))),
      ],
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
