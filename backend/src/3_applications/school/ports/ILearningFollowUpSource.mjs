/** Produce structured next/review/remediation actions for a resolved progress slice. */
export class ILearningFollowUpSource {
  listFollowUps(query) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningFollowUpSource.listFollowUps must be implemented');
  }
}

export default ILearningFollowUpSource;

