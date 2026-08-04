import { ILearningEvidenceSource } from './ILearningEvidenceSource.mjs';

/** Append and read generic, cross-surface School learning evidence. */
export class ILearningEvidenceRepository extends ILearningEvidenceSource {
  appendEvidence(evidence) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningEvidenceRepository.appendEvidence must be implemented');
  }
}

export default ILearningEvidenceRepository;

