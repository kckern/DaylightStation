import { StateGatesEngine } from './StateGatesEngine.mjs';
import {
  ActivatePolicyGraph, DecideEntitlements, EvaluateGates, GetCurrentEntitlements,
  FlushPendingTransitions, GetCurrentGates, GetGateDiagnostics, ObserveAssertion,
  ObserveManualAttestation, ReconcileStateGates, ReplayGateTransitions,
  RetractAssertion,
} from './usecases/index.mjs';

export class StateGatesContainer {
  constructor(dependencies) {
    this.engine = new StateGatesEngine(dependencies);
    this.useCases = Object.freeze({
      observeAssertion: new ObserveAssertion(this.engine),
      retractAssertion: new RetractAssertion(this.engine),
      observeManualAttestation: new ObserveManualAttestation(this.engine),
      activatePolicyGraph: new ActivatePolicyGraph(this.engine),
      evaluateGates: new EvaluateGates(this.engine),
      decideEntitlements: new DecideEntitlements(),
      getCurrentGates: new GetCurrentGates(this.engine),
      getCurrentEntitlements: new GetCurrentEntitlements(this.engine),
      getGateDiagnostics: new GetGateDiagnostics(this.engine),
      replayGateTransitions: new ReplayGateTransitions(this.engine),
      flushPendingTransitions: new FlushPendingTransitions(this.engine),
      reconcileStateGates: new ReconcileStateGates(this.engine),
    });
    this.observeAssertion = this.engine.observeAssertion.bind(this.engine);
    this.retractAssertion = this.engine.retractAssertion.bind(this.engine);
    this.observeManualAttestation = this.engine.observeManualAttestation.bind(this.engine);
    this.retractManualAttestation = this.engine.retractManualAttestation.bind(this.engine);
    this.activatePolicyGraph = this.engine.activatePolicyGraph.bind(this.engine);
    this.evaluateGates = this.engine.evaluateGates.bind(this.engine);
    this.getCurrentGates = this.engine.getCurrentGates.bind(this.engine);
    this.getCurrentEntitlements = this.engine.getCurrentEntitlements.bind(this.engine);
    this.getDiagnostics = this.engine.getDiagnostics.bind(this.engine);
    this.replayTransitions = this.engine.replayTransitions.bind(this.engine);
    this.flushPendingTransitions = this.engine.flushPendingTransitions.bind(this.engine);
    this.reconcile = this.engine.reconcile.bind(this.engine);
  }
}

export default StateGatesContainer;
