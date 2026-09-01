import { ILearningEvidenceSource } from '#apps/school/ports/ILearningEvidenceSource.mjs';
import { learningEvidenceFromAttempt } from '#domains/school/progress/index.mjs';
import { effectiveAttempts } from '#domains/school/attempt.mjs';

/** `YYYY-MM-DDTHH:mm:ss...` -> `YYYY-MM-DD`, or null for anything else. */
function dayOf(iso) {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null;
}

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
    // A caller that supplies BOTH bounds is asking for a window (this is how
    // `GetLearningProgress` reaches here: `evidenceQuery.from/to`) — read only
    // the day files that window can touch instead of every attempt the
    // learner has ever made. Either bound missing means "unbounded" on that
    // side, which the day-ranged read cannot express, so it falls back to a
    // full read + the same in-memory filter used before this existed.
    const fromDay = dayOf(from);
    const toDay = dayOf(to);
    const windowed = fromDay !== null && toDay !== null
      && typeof this.#datastore.readAttemptsInRange === 'function';
    return learnerIds.flatMap((learnerId) => {
      const attempts = windowed
        ? this.#datastore.readAttemptsInRange(learnerId, fromDay, toDay)
        : this.#datastore.readAllAttempts(learnerId);
      return effectiveAttempts(attempts)
        .filter((attempt) => (from === null || attempt.at >= from) && (to === null || attempt.at < to)
          // Regrade corrections are verdict amendments, not learning
          // evidence rows of their own (M8 fix 1).
          && attempt.provenance?.kind !== 'regrade')
        .map(learningEvidenceFromAttempt);
    });
  }
}

export default YamlSchoolAttemptEvidenceSource;
