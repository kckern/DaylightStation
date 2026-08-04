import { ILearningEvidenceSource } from '#apps/school/ports/ILearningEvidenceSource.mjs';
import { learningEvidenceFromAttempt } from '#domains/school/progress/index.mjs';

/** Adapt the existing per-learner YAML attempt ledger to generic evidence. */
export class YamlSchoolAttemptEvidenceSource extends ILearningEvidenceSource {
  #datastore;

  constructor({ datastore } = {}) {
    super();
    if (!datastore || typeof datastore.readAllAttempts !== 'function') {
      throw new Error('YamlSchoolAttemptEvidenceSource requires a School attempt datastore');
    }
    this.#datastore = datastore;
  }

  listEvidence({ learnerIds, from = null, to = null } = {}) {
    if (!Array.isArray(learnerIds)) throw new Error('School attempt evidence requires learnerIds');
    return learnerIds.flatMap((learnerId) => (this.#datastore.readAllAttempts(learnerId) ?? [])
      .filter((attempt) => (from === null || attempt.at >= from) && (to === null || attempt.at < to))
      .map(learningEvidenceFromAttempt));
  }
}

export default YamlSchoolAttemptEvidenceSource;

