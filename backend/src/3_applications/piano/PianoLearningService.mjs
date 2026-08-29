import {
  buildLearningPrograms,
  buildLearningSummary,
  normalizeRequirement,
  requirementEvidence,
} from '#shared/music/learningPrograms.mjs';
import {
  InvalidInputError,
  MissingResourceError,
  StateConflictError,
} from '#apps/common/errors/SemanticErrors.mjs';

export class PianoLearningService {
  constructor({ exerciseBank, attemptStore, learningStore, studioDatastore = null, teacherGate = null, logger = console } = {}) {
    if (!exerciseBank || !attemptStore || !learningStore) throw new Error('PianoLearningService requires bank, attempts, and learning store');
    this.exerciseBank = exerciseBank;
    this.attemptStore = attemptStore;
    this.learningStore = learningStore;
    this.studioDatastore = studioDatastore;
    this.teacherGate = teacherGate;
    this.logger = logger;
  }

  programs() {
    return buildLearningPrograms(this.exerciseBank);
  }

  program(programId) {
    return this.programs().find((program) => program.id === programId) ?? null;
  }

  summary(userId) {
    const guest = userId === 'guest';
    const attempts = guest ? [] : this.attemptStore.list(userId, { limit: 5000 });
    const enrollments = guest ? [] : this.learningStore.getEnrollments(userId);
    const assignment = guest ? null : this.learningStore.getAssignment(userId);
    const legacyProgress = guest ? null : this.studioDatastore?.getProgress?.(userId);
    const summary = buildLearningSummary({ programs: this.programs(), attempts, enrollments, assignment, legacyProgress });
    const pending = guest ? [] : this.learningStore.getPendingCheckpoints(userId)
      .filter((checkpoint) => !requirementEvidence(attempts, checkpoint.requirement).passed);
    if (pending.length) {
      const checkpoint = pending[0];
      summary.next_up = {
        type: 'video-checkpoint',
        title: checkpoint.title ?? 'Lesson checkpoint',
        course_title: checkpoint.courseTitle ?? null,
        requirement: checkpoint.requirement,
        return_to: checkpoint.returnTo ?? null,
      };
    }
    summary.pending_checkpoints = pending;
    return summary;
  }

  enroll(userId, programId) {
    if (!this.program(programId)) throw new MissingResourceError('Unknown piano program', { code: null });
    return this.learningStore.enroll(userId, programId);
  }

  unenroll(userId, programId) {
    const assignment = this.learningStore.getAssignment(userId);
    if ((assignment?.programs ?? []).includes(programId)) {
      throw new StateConflictError('A required program cannot be removed by the learner.', { code: null });
    }
    return this.learningStore.unenroll(userId, programId);
  }

  assignment(userId) {
    return this.learningStore.getAssignment(userId);
  }

  putAssignment({ learnerId, programs, assignedBy, pin, baseUpdatedAt }) {
    this.teacherGate?.assert({
      userId: assignedBy, pin, action: 'piano.program-assignments.put', context: { learnerId },
    });
    const known = new Set(this.programs().map((program) => program.id));
    const ghosts = (programs ?? []).filter((id) => !known.has(id));
    if (ghosts.length) throw new InvalidInputError(`Unknown piano program: ${ghosts.join(', ')}`, { code: null });
    const record = this.learningStore.putAssignment({ learnerId, programs, assignedBy, baseUpdatedAt });
    this.logger.info?.('piano.program-assignment.updated', { learnerId, assignedBy, programs: programs.length });
    return record;
  }

  requirementStatus(userId, requirementInput) {
    const requirement = normalizeRequirement(requirementInput);
    if (!requirement || userId === 'guest') return { passed: false, passes: 0, required_passes: requirement?.required_passes ?? 1 };
    return requirementEvidence(this.attemptStore.list(userId, {
      limit: 5000, exerciseId: requirement.exercise_id,
    }), requirement);
  }

  requirementStatuses(userId, requirementInputs = []) {
    const requirements = requirementInputs.map(normalizeRequirement);
    if (userId === 'guest') return requirements.map((requirement) => ({
      passed: false, passes: 0, required_passes: requirement?.required_passes ?? 1,
    }));
    const attempts = this.attemptStore.list(userId, { limit: 5000 });
    return requirements.map((requirement) => (
      requirement ? requirementEvidence(attempts, requirement) : { passed: false, passes: 0, required_passes: 1 }
    ));
  }

  rememberCheckpoint(userId, checkpoint) {
    const requirement = normalizeRequirement(checkpoint?.requirement);
    if (!requirement) throw new InvalidInputError('Invalid exercise checkpoint', { code: null });
    return this.learningStore.putPendingCheckpoint(userId, { ...checkpoint, requirement });
  }
}

export default PianoLearningService;
