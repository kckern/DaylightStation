// agendaStatusModel.js — pure day-status/segment/ring derivation for
// AgendaStatusBoard.jsx, split out so Fast Refresh can hot-reload the board
// component on its own.
import { subjectLabel } from '../home/subjects.js';
import { labelize } from '../teacher/labelize.js';

// Shelf label where there is a shelf, humanized slug otherwise. This is the
// segment's ONLY name now that the tile carries no text, so it has to be
// speakable for every id the agenda can hand us, not just the nine.
function nameFor(subject) {
  const label = subjectLabel(subject);
  return label === subject ? labelize(subject) : label;
}

export function dayStatus({ total, done }) {
  if (!total) return null;
  if (done >= total) return 'Done for the day';
  if (done > 0) return 'In progress';
  return 'Not started';
}

/**
 * One disc per ASSIGNMENT, labelled by its subject.
 *
 * It used to be one disc per SUBJECT — a learner with two geography sheets got
 * one globe, and finishing either one turned it green. The discs are the only
 * per-item thing on this board, so collapsing them was hiding exactly what a
 * child walks up to check. Two geography assignments now draw two globes.
 *
 * THE SET IS PLAN ∪ EVIDENCE, keyed by ASSIGNMENT unitId:
 *   - every session the learner has today (started, printed, graded — anything
 *     that produced a session), and
 *   - every subject's still-offered next action that has not already appeared
 *     as a session, and
 *   - every assigned program whose launcher reports completed `servedWork`.
 *
 * Evidence has to be in the union because a lesson taken through the "one
 * more?" chain never appears as a section's `next` — the subject is already
 * served — and a sheet a child is holding is the most real thing on their
 * plate. The plan has to be in it because work not yet started has no session.
 * Program work is different: one assigned piano course can report several
 * completed lessons. The agenda attaches each lesson to an `assignmentUnitId`;
 * the first fills that assignment's disc and the rest become its `extraCount`
 * badge instead of inflating the assigned day.
 *
 * Four states, from the two worksheet outcomes, structured program obligation
 * progress, and the absence of either:
 *   passed      — scanned and over the pass threshold
 *   needs-retry — scanned and under it
 *   in-progress — a non-worksheet program obligation is partly complete
 *   pending     — no outcome recorded yet
 */
const stateOf = (result) => (
  result === 'passed' ? 'passed' : result === 'needs_remediation' ? 'needs-retry' : 'pending'
);

export function summarize(sections, sessions, entries = []) {
  const planned = (sections ?? []).filter((section) => !section.suppressed);
  const plannedSubjects = new Set(planned.map((s) => s.subject));
  const byUnit = new Map();

  // Index completed work before sessions so any evidence for the actual item
  // can be projected onto the assignment that owns it. Curriculum work points
  // to itself; programs (piano) point several lesson ids at one synthetic
  // assignment id. Distinct actual ids, not raw rows, determine overflow.
  const servedByAssignment = new Map();
  const assignmentByServedUnit = new Map();
  for (const section of planned) {
    for (const work of section.servedWork ?? []) {
      if (!work?.unitId) continue;
      const assignmentUnitId = work.assignmentUnitId ?? work.unitId;
      if (!assignmentUnitId) continue;
      if (!servedByAssignment.has(assignmentUnitId)) {
        servedByAssignment.set(assignmentUnitId, {
          assignmentUnitId,
          subject: section.subject ?? null,
          completedUnitIds: new Set(),
        });
      }
      servedByAssignment.get(assignmentUnitId).completedUnitIds.add(work.unitId);
      if (!assignmentByServedUnit.has(work.unitId)) {
        assignmentByServedUnit.set(work.unitId, assignmentUnitId);
      }
    }
  }

  // Evidence first, so a real attempt always wins over the plan's idea of it.
  for (const session of sessions ?? []) {
    if (!session?.unitId) continue;
    // A subject the focus pass suppressed is off the child's paper today; its
    // sessions should not reappear here as discs.
    if (session.subject && plannedSubjects.size && !plannedSubjects.has(session.subject)) continue;
    const assignmentUnitId = assignmentByServedUnit.get(session.unitId) ?? session.unitId;
    const served = servedByAssignment.get(assignmentUnitId);
    const subject = session.subject ?? served?.subject ?? null;
    const prior = byUnit.get(assignmentUnitId);
    const state = stateOf(session.outcome?.result);
    // Two sessions for one unit (a retry) collapse to the best outcome — a
    // passed retry is a pass, not a lingering yellow.
    if (!prior || (prior.state !== 'passed' && state === 'passed')) {
      byUnit.set(assignmentUnitId, {
        unitId: assignmentUnitId,
        subject,
        label: nameFor(subject),
        state,
      });
    }
  }

  // Then work the planner reports as SERVED today. One group is one assigned
  // disc. Its first distinct completion satisfies the assignment; subsequent
  // distinct completion ids are acknowledged by the badge without becoming
  // more assigned work.
  //
  // Not every kind of work opens a work-session. A PROGRAM subject — piano is
  // the one in the house — is served by finishing a lesson in its own app, so
  // it completes with no session row and no OMR outcome; only the section's
  // `servedWork` ever knows it happened. Building discs from sessions alone
  // therefore dropped the piano disc entirely (2026-08-26: User_4 finished piano
  // in the morning, was served four things, and the board could only see three
  // — it read "2 OF 3" for a day that was really 3 of 4).
  //
  // Sessions still win: this runs after the evidence pass and skips any unit
  // already claimed, so a served unit whose sheet is still open — a partial
  // scan the grader refused to bridge — keeps its pending disc instead of
  // being painted green by the plan's word.
  for (const served of servedByAssignment.values()) {
    const extraCount = Math.max(0, served.completedUnitIds.size - 1);
    const prior = byUnit.get(served.assignmentUnitId);
    if (prior) {
      const subject = prior.subject ?? served.subject;
      byUnit.set(served.assignmentUnitId, {
        ...prior,
        subject,
        label: prior.subject == null ? nameFor(subject) : prior.label,
        ...(extraCount > 0 ? { extraCount } : {}),
      });
      continue;
    }
    byUnit.set(served.assignmentUnitId, {
      unitId: served.assignmentUnitId,
      subject: served.subject,
      label: nameFor(served.subject),
      state: 'passed',
      ...(extraCount > 0 ? { extraCount } : {}),
    });
  }

  // Then the plan, for work with no session yet.
  const fromEntries = new Map((entries ?? []).map((e) => [e.unitId, e]));
  for (const section of planned) {
    // A non-school day deliberately keeps `next` available for voluntary
    // work, but that does not put the lesson on the child's required Today
    // board. Completed evidence above still counts; only the unstarted offer
    // is omitted. The same rule covers other excused obligations such as
    // optional backlog and work that is not due yet.
    if (section.obligation?.state === 'excused') continue;
    const next = section.next;
    if (!next?.unitId || byUnit.has(next.unitId)) continue;
    const entry = fromEntries.get(next.unitId);
    const progress = next.obligationProgress;
    const inProgress = Number.isFinite(progress?.completed)
      && Number.isFinite(progress?.total)
      && progress.total > 0
      && progress.completed > 0;
    byUnit.set(next.unitId, {
      unitId: next.unitId,
      subject: entry?.subject ?? section.subject,
      label: nameFor(entry?.subject ?? section.subject),
      state: inProgress ? 'in-progress' : 'pending',
    });
  }

  const segments = [...byUnit.values()];
  return {
    total: segments.length,
    done: segments.filter((s) => s.state === 'passed').length,
    segments,
  };
}

/** learnerId -> ring count, from active fitness.weekly-rings gate progress. */
export function ringsByLearner(payload, at = Date.now()) {
  const out = {};
  const chosen = new Map();
  for (const item of payload?.items ?? []) {
    const evaluation = item?.evaluation;
    if (evaluation?.gateId !== 'fitness.weekly-rings') continue;
    const { period, subject, progress } = evaluation;
    if (subject?.kind !== 'learner' || !subject.id || period?.kind !== 'interval') continue;
    if (!Number.isFinite(period.startsAt) || !Number.isFinite(period.endsAt)
      || at < period.startsAt || at >= period.endsAt || !Number.isFinite(progress?.current)) continue;
    const previous = chosen.get(subject.id);
    if (!previous || period.startsAt > previous.startsAt) {
      chosen.set(subject.id, { startsAt: period.startsAt, value: progress.current });
    }
  }
  for (const [learnerId, value] of chosen) out[learnerId] = value.value;
  return out;
}
