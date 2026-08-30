import { RequirementsEngine } from './RequirementsEngine.mjs';
import {
  ActivatePolicyGraph, DecideEntitlements, EvaluateRequirements, GetCurrentEntitlements,
  GetCurrentRequirements, GetRequirementDiagnostics, ObserveAssertion,
  ObserveManualAttestation, ReconcileRequirementsState, ReplayRequirementTransitions,
  RetractAssertion,
} from './usecases/index.mjs';

export class RequirementsContainer {
  constructor(dependencies) {
    this.engine = new RequirementsEngine(dependencies);
    this.useCases = Object.freeze({
      observeAssertion: new ObserveAssertion(this.engine),
      retractAssertion: new RetractAssertion(this.engine),
      observeManualAttestation: new ObserveManualAttestation(this.engine),
      activatePolicyGraph: new ActivatePolicyGraph(this.engine),
      evaluateRequirements: new EvaluateRequirements(this.engine),
      decideEntitlements: new DecideEntitlements(),
      getCurrentRequirements: new GetCurrentRequirements(this.engine),
      getCurrentEntitlements: new GetCurrentEntitlements(this.engine),
      getRequirementDiagnostics: new GetRequirementDiagnostics(this.engine),
      replayRequirementTransitions: new ReplayRequirementTransitions(this.engine),
      reconcileRequirementsState: new ReconcileRequirementsState(this.engine),
    });
    this.observeAssertion = this.engine.observeAssertion.bind(this.engine);
    this.retractAssertion = this.engine.retractAssertion.bind(this.engine);
    this.observeManualAttestation = this.engine.observeManualAttestation.bind(this.engine);
    this.retractManualAttestation = this.engine.retractManualAttestation.bind(this.engine);
    this.activatePolicyGraph = this.engine.activatePolicyGraph.bind(this.engine);
    this.evaluateRequirements = this.engine.evaluateRequirements.bind(this.engine);
    this.getCurrentRequirements = this.engine.getCurrentRequirements.bind(this.engine);
    this.getCurrentEntitlements = this.engine.getCurrentEntitlements.bind(this.engine);
    this.getDiagnostics = this.engine.getDiagnostics.bind(this.engine);
    this.replayTransitions = this.engine.replayTransitions.bind(this.engine);
    this.reconcile = this.engine.reconcile.bind(this.engine);
  }
}

export default RequirementsContainer;
