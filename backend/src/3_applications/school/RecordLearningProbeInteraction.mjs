import { ValidationError } from '#domains/core/errors/index.mjs';
import { createLearningProbeEvidence } from '#domains/school/progress/index.mjs';

const OBSERVATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

/** Record one idempotently named feedback/continuation event for a probe. */
export class RecordLearningProbeInteraction {
  #evidence; #learners; #idFactory; #clock;

  constructor({ evidenceRepository, learnerDirectory, evidenceIdFactory, clock = () => new Date() } = {}) {
    if (!evidenceRepository || typeof evidenceRepository.appendEvidence !== 'function'
        || typeof evidenceRepository.listEvidence !== 'function'
        || !learnerDirectory || typeof learnerDirectory.hasLearner !== 'function'
        || typeof evidenceIdFactory !== 'function') {
      throw new Error('RecordLearningProbeInteraction requires evidence, learners, and evidenceIdFactory');
    }
    this.#evidence = evidenceRepository;
    this.#learners = learnerDirectory;
    this.#idFactory = evidenceIdFactory;
    this.#clock = clock;
  }

  async execute({
    observationId, learnerId, event, activity, learning = {}, attemptNumber,
    continuation = null, source = { surface: 'web', transport: 'screen' },
  } = {}) {
    if (!OBSERVATION_ID.test(observationId || '')) {
      throw new ValidationError('Learning probe observationId is invalid');
    }
    if (typeof learnerId !== 'string' || !learnerId || !(await this.#learners.hasLearner(learnerId))) {
      throw new ValidationError('Learning probe interaction requires an active learner');
    }
    const evidenceId = this.#idFactory({ observationId, learnerId });
    const existing = (await this.#evidence.listEvidence({ learnerIds: [learnerId] }))
      .find((entry) => entry.evidenceId === evidenceId);
    // The first write owns its receipt time. An exact network retry rebuilds
    // against that time, allowing the repository to return `duplicate`; a
    // changed payload with the same observation ID still conflicts.
    const occurredAt = existing?.occurredAt ?? readClock(this.#clock);
    let evidence;
    try {
      evidence = createLearningProbeEvidence({
        evidenceId,
        learnerId, occurredAt, event, activity, learning, attemptNumber,
        continuation, source,
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
    throw new Error('Learning probe clock must return a valid Date');
  }
  return value.toISOString();
}

export default RecordLearningProbeInteraction;
