export class IStateGatesTransitionRepository {
  async replayAfter(_householdId, _revision, _limit) { throw new Error('IStateGatesTransitionRepository.replayAfter must be implemented'); }
  async oldestAvailableRevision(_householdId) { throw new Error('IStateGatesTransitionRepository.oldestAvailableRevision must be implemented'); }
  async pending(_householdId) { throw new Error('IStateGatesTransitionRepository.pending must be implemented'); }
  async markPublished(_householdId, _transitionIds) { throw new Error('IStateGatesTransitionRepository.markPublished must be implemented'); }
  async compactThrough(_householdId, _revision) { throw new Error('IStateGatesTransitionRepository.compactThrough must be implemented'); }
}
export default IStateGatesTransitionRepository;
