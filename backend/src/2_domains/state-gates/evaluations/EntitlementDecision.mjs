import { EVALUATION_STATES, deepFreeze, fail } from '../support.mjs';

export class EntitlementDecision {
  constructor(props) {
    if (!['granted', 'denied'].includes(props.decision)) fail('Invalid entitlement decision', 'INVALID_ENTITLEMENT_DECISION', 'decision');
    if (!EVALUATION_STATES.includes(props.basisState)) fail('Invalid entitlement basis state', 'INVALID_GATE_STATE', 'basisState');
    Object.assign(this, props, { reasons: deepFreeze([...(props.reasons ?? [])]) });
    deepFreeze(this);
  }
}

export default EntitlementDecision;
