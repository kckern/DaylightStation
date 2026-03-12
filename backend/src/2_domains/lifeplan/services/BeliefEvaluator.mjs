const DORMANCY_THRESHOLD_DAYS = 60;
const DECAY_PER_MONTH = 0.02;

export class BeliefEvaluator {
  evaluateEvidence(belief, evidence) {
    belief.addEvidence(evidence);
  }

  calculateDormancyDecay(belief) {
    if (belief.evidence_history.length === 0) {
      // No evidence at all — treat as fully dormant
      return 0;
    }

    const lastEvidence = belief.evidence_history[belief.evidence_history.length - 1];
    const lastDate = new Date(lastEvidence.date);
    const daysSince = (Date.now() - lastDate.getTime()) / 86400000;

    if (daysSince <= DORMANCY_THRESHOLD_DAYS) return 0;

    const monthsBeyondThreshold = (daysSince - DORMANCY_THRESHOLD_DAYS) / 30;
    return monthsBeyondThreshold * DECAY_PER_MONTH;
  }

  getEffectiveConfidence(belief) {
    return belief.getEffectiveConfidence();
  }

  canTransitionToConfirmed(belief) {
    const biases = belief.evidence_quality?.biases_considered || [];
    const totalBiasAdjustment = biases
      .filter(b => b.status === 'acknowledged')
      .reduce((sum, b) => sum + (b.confidence_adjustment || 0), 0);

    const sampleSize = belief.evidence_quality?.sample_size ?? 0;

    if (totalBiasAdjustment < -0.30) {
      return {
        allowed: false,
        max_state: 'uncertain',
        reason: 'Bias adjustments exceed 30% — cannot confirm',
      };
    }

    if (sampleSize < 5) {
      return {
        allowed: false,
        max_state: 'uncertain',
        reason: 'Sample size < 5 — need more observations',
      };
    }

    return { allowed: true };
  }
}
