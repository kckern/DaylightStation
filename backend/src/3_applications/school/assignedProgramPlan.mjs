/**
 * Add durable program enrollments to a learner plan without copying their
 * underlying curriculum into School's authored catalog. The program launcher
 * remains the authority on what is next; School owns the enrollment and the
 * educational projection of that answer.
 */

import { STORY_TIME_PROGRAM_ID } from '#domains/school/storyTime.mjs';
import { BOOK_LOG_PROGRAM_ID, DEFAULT_BOOK_LOG_SUBJECT } from '#domains/school/bookLog.mjs';

const baseEntry = ({
  unitId, title, subject, program, programInstance, schedule = null, cadence = 'daily',
}) => ({
  unitId,
  title,
  description: null,
  subject,
  courseId: null,
  sequence: null,
  module: null,
  profile: null,
  // Programs take their school-day calendar directly from their enrollment;
  // unlike courses, there is no syllabus snapshot between the two.
  schedule: schedule ? structuredClone(schedule) : null,
  timing: null,
  timingState: 'available',
  timingPriority: 3,
  timingRank: 0,
  timingReasons: ['program_assignment'],
  elective: false,
  program,
  programInstance,
  cadence,
  status: 'available',
  sessionId: null,
  state: null,
  lockReason: null,
  remedy: null,
  unlocks: [],
});

/** Mutates the planner result in the same additive way BuildAgenda always has. */
export function appendAssignedProgramEntries(plan, assignment) {
  if (!plan || !Array.isArray(plan.entries)) return plan;
  for (const enrollment of assignment?.programs ?? []) {
    if (enrollment?.programId === 'flashcards') {
      const deckId = enrollment.deckId ?? enrollment.corpusId;
      if (!deckId) continue;
      plan.entries.push(baseEntry({
        unitId: `flashcards:${deckId}`,
        title: enrollment.title ?? 'Flashcards',
        subject: 'flashcards',
        program: 'flashcards',
        programInstance: deckId,
        schedule: enrollment.schedule,
      }));
    }
    if (enrollment?.programId === STORY_TIME_PROGRAM_ID) {
      // One instance per learner — there is no corpus to distinguish, and
      // SetAssignments' dedupe key already refuses a second one.
      plan.entries.push(baseEntry({
        unitId: `${STORY_TIME_PROGRAM_ID}:daily`,
        title: enrollment.title ?? 'Story time',
        subject: enrollment.subject ?? 'english',
        program: STORY_TIME_PROGRAM_ID,
        programInstance: 'daily',
        schedule: enrollment.schedule,
      }));
    }
    if (enrollment?.programId === BOOK_LOG_PROGRAM_ID) {
      // One shelf per learner — `corpusId: null` is the dedupe key
      // SetAssignments already enforces. The entry is what makes the agenda
      // consult the launcher at all (collectProgramStatuses reads plan.entries);
      // without it a book-log enrollment was silently inert.
      plan.entries.push(baseEntry({
        unitId: `${BOOK_LOG_PROGRAM_ID}:shelf`,
        title: enrollment.title ?? 'Reading',
        subject: enrollment.subject ?? DEFAULT_BOOK_LOG_SUBJECT,
        program: BOOK_LOG_PROGRAM_ID,
        programInstance: 'shelf',
        schedule: enrollment.schedule,
        // The agenda retires a program entry only when it is `once` AND its
        // launcher says terminal. The launcher reports a met once-obligation
        // as terminal; without the matching cadence a finished series would
        // be offered on every future study day.
        cadence: enrollment.obligation?.per === 'once' ? 'once' : 'daily',
      }));
    }
    if (enrollment?.programId === 'piano-course') {
      const courseId = enrollment.courseId ?? enrollment.corpusId;
      if (!courseId) continue;
      plan.entries.push(baseEntry({
        unitId: `piano-course:${courseId}`,
        title: enrollment.title ?? 'Piano lesson',
        subject: enrollment.subject ?? 'arts',
        program: 'piano-course',
        programInstance: courseId,
        schedule: enrollment.schedule,
      }));
    }
  }
  return plan;
}

/**
 * Turn a launcher-owned structured projection into the unit-shaped value the
 * School card/agenda pipeline already understands. The synthetic program
 * unitId stays stable; `programContext.lesson.id` is the real lesson identity.
 */
export function projectProgramEntry(entry, status) {
  const context = status?.context ?? null;
  if (!entry || !context) return entry;
  return {
    ...entry,
    title: context.lesson?.title ?? entry.title,
    courseId: context.course?.id ?? entry.courseId,
    module: context.unit?.id ?? entry.module,
    programContext: context,
    programProgress: Array.isArray(status?.progress) ? status.progress : [],
  };
}

export default appendAssignedProgramEntries;
