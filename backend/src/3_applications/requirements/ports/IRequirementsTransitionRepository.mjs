export class IRequirementsTransitionRepository {
  async replayAfter(_householdId, _revision, _limit) { throw new Error('IRequirementsTransitionRepository.replayAfter must be implemented'); }
  async oldestAvailableRevision(_householdId) { throw new Error('IRequirementsTransitionRepository.oldestAvailableRevision must be implemented'); }
  async pending(_householdId) { throw new Error('IRequirementsTransitionRepository.pending must be implemented'); }
  async markPublished(_householdId, _transitionIds) { throw new Error('IRequirementsTransitionRepository.markPublished must be implemented'); }
  async compactThrough(_householdId, _revision) { throw new Error('IRequirementsTransitionRepository.compactThrough must be implemented'); }
}
export default IRequirementsTransitionRepository;
