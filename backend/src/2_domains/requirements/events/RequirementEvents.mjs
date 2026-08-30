import { deepFreeze } from '../support.mjs';

class RequirementDomainRecord {
  constructor(kind, props) {
    this.kind = kind;
    Object.assign(this, props);
    deepFreeze(this);
  }
}

export class AssertionObserved extends RequirementDomainRecord { constructor(props) { super('AssertionObserved', props); } }
export class AssertionCorrected extends RequirementDomainRecord { constructor(props) { super('AssertionCorrected', props); } }
export class AssertionRetracted extends RequirementDomainRecord { constructor(props) { super('AssertionRetracted', props); } }
export class PolicyGraphActivated extends RequirementDomainRecord { constructor(props) { super('PolicyGraphActivated', props); } }
export class RequirementStateChanged extends RequirementDomainRecord { constructor(props) { super('RequirementStateChanged', props); } }
export class EntitlementDecisionChanged extends RequirementDomainRecord { constructor(props) { super('EntitlementDecisionChanged', props); } }

export class StateObservation extends RequirementDomainRecord {
  constructor(props) {
    super('StateObservation', props);
  }
}
