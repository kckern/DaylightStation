export class IRequirementsPolicySource {
  async loadCandidate(_householdId) { throw new Error('IRequirementsPolicySource.loadCandidate must be implemented'); }
}
export default IRequirementsPolicySource;
