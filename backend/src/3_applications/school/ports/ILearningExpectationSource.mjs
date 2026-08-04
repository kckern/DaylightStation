/** Read authored, scope-specific learning pacing expectations. */
export class ILearningExpectationSource {
  listExpectations(query) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningExpectationSource.listExpectations must be implemented');
  }
}

export default ILearningExpectationSource;

