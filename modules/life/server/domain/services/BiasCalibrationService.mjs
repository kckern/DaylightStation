/**
 * Calibrates belief bias based on evidence patterns.
 * Detects confirmation bias, anchoring, and recency effects.
 */
export class BiasCalibrationService {
  calculateBias(belief) {
    const history = belief.evidence_history || [];
    if (history.length < 3) return { biasScore: 0, biasType: 'insufficient_data' };

    const confirmations = history.filter(e => e.type === 'confirmation').length;
    const disconfirmations = history.filter(e => e.type === 'disconfirmation').length;
    const total = confirmations + disconfirmations;

    if (total === 0) return { biasScore: 0, biasType: 'no_evidence' };

    const confirmRate = confirmations / total;

    // Strong skew suggests confirmation bias
    if (confirmRate > 0.85 && total >= 5) {
      return { biasScore: confirmRate - 0.5, biasType: 'confirmation_bias' };
    }

    // Check recency bias: are recent entries disproportionately one type?
    const recent = history.slice(-3);
    const recentConfirm = recent.filter(e => e.type === 'confirmation').length;
    if (recentConfirm === 3 || recentConfirm === 0) {
      const recentSkew = Math.abs(recentConfirm / 3 - confirmRate);
      if (recentSkew > 0.3) {
        return { biasScore: recentSkew, biasType: 'recency_bias' };
      }
    }

    return { biasScore: Math.abs(confirmRate - 0.5), biasType: 'none' };
  }

  getBiasAdjustment(belief) {
    const { biasScore, biasType } = this.calculateBias(belief);
    if (biasType === 'none' || biasType === 'insufficient_data' || biasType === 'no_evidence') {
      return 0;
    }
    // Reduce confidence proportional to bias
    return -biasScore * 0.3;
  }

  isBlockedByBias(belief) {
    const { biasScore, biasType } = this.calculateBias(belief);
    return biasType === 'confirmation_bias' && biasScore > 0.3;
  }
}
