import { decideEntitlement } from '#domains/requirements/index.mjs';

class EngineUseCase {
  constructor(engine) {
    if (!engine) throw new Error(`${this.constructor.name} requires an engine`);
    this.engine = engine;
  }
}

export class ObserveAssertion extends EngineUseCase { execute(householdId, command) { return this.engine.observeAssertion(householdId, command); } }
export class RetractAssertion extends EngineUseCase { execute(householdId, command) { return this.engine.retractAssertion(householdId, command); } }
export class ObserveManualAttestation extends EngineUseCase { execute(householdId, actor, command) { return this.engine.observeManualAttestation(householdId, actor, command); } }
export class ActivatePolicyGraph extends EngineUseCase { execute(householdId, actor) { return this.engine.activatePolicyGraph(householdId, actor); } }
export class EvaluateRequirements extends EngineUseCase { execute(householdId, cause) { return this.engine.evaluateRequirements(householdId, cause); } }
export class GetCurrentRequirements extends EngineUseCase { execute(householdId, filters) { return this.engine.getCurrentRequirements(householdId, filters); } }
export class GetCurrentEntitlements extends EngineUseCase { execute(householdId, filters) { return this.engine.getCurrentEntitlements(householdId, filters); } }
export class GetRequirementDiagnostics extends EngineUseCase { execute(householdId, actor) { return this.engine.getDiagnostics(householdId, actor); } }
export class ReplayRequirementTransitions extends EngineUseCase { execute(householdId, revision, limit) { return this.engine.replayTransitions(householdId, revision, limit); } }
export class ReconcileRequirementsState extends EngineUseCase { execute(householdId) { return this.engine.reconcile(householdId); } }

export class DecideEntitlements {
  execute(input) { return decideEntitlement(input); }
}
