/** Read append-only School learning evidence for a resolved set of learners. */
export class ILearningEvidenceSource {
  /**
   * @param {{learnerIds:string[], from:string|null, to:string|null}} query
   * @returns {Promise<object[]>|object[]}
   */
  listEvidence(query) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningEvidenceSource.listEvidence must be implemented');
  }
}

export default ILearningEvidenceSource;

