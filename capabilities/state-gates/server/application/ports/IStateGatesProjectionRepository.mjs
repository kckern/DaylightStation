export class IStateGatesProjectionRepository {
  async load(_householdId) { throw new Error('IStateGatesProjectionRepository.load must be implemented'); }
  async commitRevision(_householdId, _expectedRevision, _nextSnapshot, _transitionBatch) {
    throw new Error('IStateGatesProjectionRepository.commitRevision must be implemented');
  }
}
export default IStateGatesProjectionRepository;
