/**
 * Add durable program enrollments to a learner plan without copying their
 * underlying curriculum into School's authored catalog. The program launcher
 * remains the authority on what is next; School owns the enrollment and the
 * educational projection of that answer.
 */

import { STORY_TIME_PROGRAM_ID } from '#domains/school/storyTime.mjs';
import {
  BOOK_LOG_PROGRAM_ID, DEFAULT_BOOK_LOG_SUBJECT, DEFAULT_BOOK_LOG_TITLE, BOOK_LOG_SHELF_UNIT_ID,
} from '#domains/school/bookLog.mjs';

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

/**
 * The reading shelf as a plan entry.
 *
 * EXPORTED BECAUSE THERE ARE NOW TWO WAYS TO REACH THE SHELF and they must
 * produce the same entry. An ENROLLED learner gets one appended here, from
 * their enrollment. An UNENROLLED learner has no enrollment to append from —
 * the shelf is open to everyone, only the OBLIGATION comes from enrollment —
 * so `ResolveAccessCode` synthesizes one when a reading code arrives and the
 * plan holds no shelf. Two hand-built entries would drift on `timingPriority`,
 * `status`, or the unitId itself, and the second one would resolve to a card
 * subtly unlike the first.
 *
 * Not persisted and not owed: a synthesized entry never reaches `plan.entries`,
 * so it cannot put a row on anyone's agenda.
 *
 * @param {{title?: string|null, subject?: string|null, schedule?: object|null,
 *   cadence?: string}} [args]
 */
export function bookLogShelfEntry({
  title = null, subject = null, schedule = null, cadence = 'daily',
} = {}) {
  return baseEntry({
    unitId: BOOK_LOG_SHELF_UNIT_ID,
    title: title ?? DEFAULT_BOOK_LOG_TITLE,
    subject: subject ?? DEFAULT_BOOK_LOG_SUBJECT,
    program: BOOK_LOG_PROGRAM_ID,
    programInstance: 'shelf',
    schedule,
    cadence,
  });
}

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
      plan.entries.push(bookLogShelfEntry({
        title: enrollment.title,
        subject: enrollment.subject,
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
    // THE SENTENCE LADDER. Missing from this list until 2026-09-09, which is
    // why two enrolled learners had no `language` section: the August
    // integration design routed the ladder through an authored curriculum
    // unit (`programInstance` on a `school.unit`), and that unit was never
    // written, while the September enrolment records landed HERE, under
    // `programs:` — where nothing knew the program's name. The entry mirrors
    // piano-course: one per corpus, keyed so `collectProgramStatuses` reaches
    // `LanguageProgramLauncher.status({userId, programInstance})`.
    if (enrollment?.programId === 'sentence-ladder') {
      const corpusId = enrollment.corpusId;
      if (!corpusId) continue;
      plan.entries.push(baseEntry({
        unitId: `sentence-ladder:${corpusId}`,
        title: enrollment.title ?? 'Language practice',
        subject: enrollment.subject ?? 'language',
        program: 'sentence-ladder',
        programInstance: corpusId,
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
    // The sentence under the title — "6 repetition, 12 dictation", the one line
    // that says what the day actually asks for. `next` is this entry spread, so
    // the card reads it as `next.description` with nothing in between.
    ...(typeof status?.description === 'string' && status.description.trim()
      ? { description: status.description.trim() } : {}),
  };
}

export default appendAssignedProgramEntries;
