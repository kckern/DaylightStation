export class IRequirementsProjectionRepository {
  async load(_householdId) { throw new Error('IRequirementsProjectionRepository.load must be implemented'); }
  async commitRevision(_householdId, _expectedRevision, _nextSnapshot, _transitionBatch) {
    throw new Error('IRequirementsProjectionRepository.commitRevision must be implemented');
  }
}
export default IRequirementsProjectionRepository;
