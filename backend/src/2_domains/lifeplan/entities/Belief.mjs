import { BeliefState } from '../value-objects/BeliefState.mjs';

const EVIDENCE_DELTAS = {
  confirmation: 0.05,
  disconfirmation: -0.08,
  spurious: -0.12,
  untested: 0,
};

const DORMANCY_THRESHOLD_DAYS = 60;

export class Belief {
  constructor(data = {}) {
    this.id = data.id;
    this.if = data.if;
    this.then = data.then;
    this.state = data.state || 'hypothesized';
    this.confidence = data.confidence ?? 0.5;
    this.foundational = data.foundational || false;
    this.signals = data.signals || [];
    this.evidence_history = data.evidence_history || [];
    this.evidence_quality = data.evidence_quality || {
      sample_size: 0,
      observation_span: null,
      biases_considered: [],
    };
    this.depends_on = data.depends_on || [];
    this.state_history = data.state_history || [];
    this.origin = data.origin || null;
  }

  addEvidence(evidence) {
    const delta = EVIDENCE_DELTAS[evidence.type] ?? 0;
    this.confidence = Math.max(0, Math.min(1, this.confidence + delta));

    this.evidence_history.push({
      type: evidence.type,
      delta,
      date: evidence.date || new Date().toISOString().slice(0, 10),
      note: evidence.note || null,
    });

    if (evidence.type !== 'untested') {
      this.evidence_quality.sample_size = (this.evidence_quality.sample_size || 0) + 1;
    }
  }

  getEffectiveConfidence() {
    const raw = this.confidence;
    const biases = this.evidence_quality?.biases_considered || [];

    const biasAdjustment = biases
      .filter(b => b.status === 'acknowledged')
      .reduce((sum, b) => sum + (b.confidence_adjustment || 0), 0);

    const sampleSize = this.evidence_quality?.sample_size ?? 0;
    const samplePenalty = sampleSize === 0 ? 0
      : sampleSize < 5 ? -0.15
      : sampleSize < 10 ? -0.05
      : 0;

    return Math.max(0, Math.min(1, raw + biasAdjustment + samplePenalty));
  }

  isDormant() {
    if (this.evidence_history.length === 0) return true;

    const lastEvidence = this.evidence_history[this.evidence_history.length - 1];
    const lastDate = new Date(lastEvidence.date);
    const daysSince = (Date.now() - lastDate.getTime()) / 86400000;
    return daysSince > DORMANCY_THRESHOLD_DAYS;
  }

  transition(newState, reason, timestamp) {
    if (!BeliefState.canTransition(this.state, newState)) {
      throw new Error(
        `Belief "${this.id}" cannot transition from "${this.state}" to "${newState}". ` +
        `Valid transitions: ${BeliefState.getValidTransitions(this.state).join(', ') || 'none (terminal)'}`
      );
    }

    this.state_history.push({
      from: this.state,
      to: newState,
      reason,
      timestamp: timestamp || new Date().toISOString(),
    });

    this.state = newState;
  }

  isTerminal() {
    return BeliefState.isTerminal(this.state);
  }

  toJSON() {
    return {
      id: this.id,
      if: this.if,
      then: this.then,
      state: this.state,
      confidence: this.confidence,
      foundational: this.foundational,
      signals: this.signals,
      evidence_history: this.evidence_history,
      evidence_quality: this.evidence_quality,
      depends_on: this.depends_on,
      state_history: this.state_history,
      origin: this.origin,
    };
  }
}
