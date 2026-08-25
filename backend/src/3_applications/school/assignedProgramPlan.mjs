/**
 * Add durable program enrollments to a learner plan without copying their
 * underlying curriculum into School's authored catalog. The program launcher
 * remains the authority on what is next; School owns the enrollment and the
 * educational projection of that answer.
 */

const baseEntry = ({ unitId, title, subject, program, programInstance }) => ({
  unitId,
  title,
  description: null,
  subject,
  courseId: null,
  sequence: null,
  module: null,
  profile: null,
  timing: null,
  timingState: 'available',
  timingPriority: 3,
  timingRank: 0,
  timingReasons: ['program_assignment'],
  elective: false,
  program,
  programInstance,
  cadence: 'daily',
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
