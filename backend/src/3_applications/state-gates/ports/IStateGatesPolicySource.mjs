export class IStateGatesPolicySource {
  async loadCandidate(_householdId) { throw new Error('IStateGatesPolicySource.loadCandidate must be implemented'); }
}
export default IStateGatesPolicySource;
