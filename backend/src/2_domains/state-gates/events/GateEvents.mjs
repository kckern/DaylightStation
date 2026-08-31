import { deepFreeze } from '../support.mjs';

class GateDomainRecord {
  constructor(kind, props) {
    this.kind = kind;
    Object.assign(this, props);
    deepFreeze(this);
  }
}

export class AssertionObserved extends GateDomainRecord { constructor(props) { super('AssertionObserved', props); } }
export class AssertionCorrected extends GateDomainRecord { constructor(props) { super('AssertionCorrected', props); } }
export class AssertionRetracted extends GateDomainRecord { constructor(props) { super('AssertionRetracted', props); } }
export class PolicyGraphActivated extends GateDomainRecord { constructor(props) { super('PolicyGraphActivated', props); } }
export class GateStateChanged extends GateDomainRecord { constructor(props) { super('GateStateChanged', props); } }
export class EntitlementDecisionChanged extends GateDomainRecord { constructor(props) { super('EntitlementDecisionChanged', props); } }
export class StateRetired extends GateDomainRecord { constructor(props) { super('StateRetired', props); } }

export class StateObservation extends GateDomainRecord {
  constructor(props) {
    super('StateObservation', props);
  }
}
