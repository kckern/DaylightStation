import { FAILURE_POSTURES, deepFreeze, fail, requireNamespacedId } from '../support.mjs';

export class EntitlementDefinition {
  constructor({ capabilityId, gateId, failurePosture }) {
    this.capabilityId = requireNamespacedId(capabilityId, 'entitlement.capabilityId');
    this.gateId = requireNamespacedId(gateId, 'entitlement.gateId');
    if (!FAILURE_POSTURES.includes(failurePosture)) fail('Failure posture is required', 'INVALID_FAILURE_POSTURE', 'failurePosture');
    this.failurePosture = failurePosture;
    deepFreeze(this);
  }
}

export default EntitlementDefinition;
