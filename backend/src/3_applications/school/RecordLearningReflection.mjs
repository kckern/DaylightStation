import { ValidationError } from '#domains/core/errors/index.mjs';
import { createLearningReflectionEvidence } from '#domains/school/progress/index.mjs';

const OBSERVATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

/** Record one optional learner reflection through the shared evidence ledger. */
export class RecordLearningReflection {
  #evidence; #learners; #idFactory; #clock;

  constructor({ evidenceRepository, learnerDirectory, evidenceIdFactory, clock = () => new Date() } = {}) {
    if (!evidenceRepository || typeof evidenceRepository.appendEvidence !== 'function'
        || typeof evidenceRepository.listEvidence !== 'function'
        || !learnerDirectory || typeof learnerDirectory.hasLearner !== 'function'
        || typeof evidenceIdFactory !== 'function') {
      throw new Error('RecordLearningReflection requires evidence, learners, and evidenceIdFactory');
    }
    this.#evidence = evidenceRepository;
    this.#learners = learnerDirectory;
    this.#idFactory = evidenceIdFactory;
    this.#clock = clock;
  }

  async execute({ observationId, learnerId, activity, learning = {}, selfRegulation, source } = {}) {
    if (!OBSERVATION_ID.test(observationId || '')) {
      throw new ValidationError('Learning reflection observationId is invalid');
    }
    if (typeof learnerId !== 'string' || !learnerId || !(await this.#learners.hasLearner(learnerId))) {
      throw new ValidationError('Learning reflection requires an active learner');
    }
    const evidenceId = this.#idFactory({ observationId, learnerId });
    const existing = (await this.#evidence.listEvidence({ learnerIds: [learnerId] }))
      .find((entry) => entry.evidenceId === evidenceId);
    const occurredAt = existing?.occurredAt ?? readClock(this.#clock);
    let evidence;
    try {
      evidence = createLearningReflectionEvidence({
        evidenceId,
        learnerId,
        occurredAt,
        activity,
        learning,
        selfRegulation,
        source,
      });
    } catch (error) {
      if (error instanceof TypeError) throw new ValidationError(error.message);
      throw error;
    }
    const saved = await this.#evidence.appendEvidence(evidence);
    return Object.freeze({ status: saved.status, evidence: saved.evidence });
  }
}

function readClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error('Learning reflection clock must return a valid Date');
  }
  return value.toISOString();
}

export default RecordLearningReflection;
