import { FAILURE_POSTURES, deepFreeze, fail, requireNamespacedId } from '../support.mjs';

export class EntitlementDefinition {
  constructor({ capabilityId, requirementId, failurePosture }) {
    this.capabilityId = requireNamespacedId(capabilityId, 'entitlement.capabilityId');
    this.requirementId = requireNamespacedId(requirementId, 'entitlement.requirementId');
    if (!FAILURE_POSTURES.includes(failurePosture)) fail('Failure posture is required', 'INVALID_FAILURE_POSTURE', 'failurePosture');
    this.failurePosture = failurePosture;
    deepFreeze(this);
  }
}

export default EntitlementDefinition;
