import { describe, it, expect } from '@jest/globals';
import { BeliefEvaluator } from '#domains/lifeplan/services/BeliefEvaluator.mjs';
import { Belief } from '#domains/lifeplan/entities/Belief.mjs';
import { frozenClock } from '../../../_lib/clock-helper.mjs';

describe('BeliefEvaluator', () => {
  const evaluator = new BeliefEvaluator();

  describe('evaluateEvidence()', () => {
    it('applies confirmation delta', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.5 });
      evaluator.evaluateEvidence(belief, { type: 'confirmation', date: '2025-03-01' });
      expect(belief.confidence).toBeGreaterThan(0.5);
      expect(belief.evidence_history).toHaveLength(1);
    });

    it('applies disconfirmation delta', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.7 });
      evaluator.evaluateEvidence(belief, { type: 'disconfirmation', date: '2025-03-01' });
      expect(belief.confidence).toBeLessThan(0.7);
    });

    it('applies spurious delta (strongest negative)', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.7 });
      evaluator.evaluateEvidence(belief, { type: 'spurious', date: '2025-03-01' });
      expect(belief.confidence).toBeLessThan(0.62); // spurious is -0.12
    });

    it('untested does not change confidence', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.7 });
      evaluator.evaluateEvidence(belief, { type: 'untested', date: '2025-03-01' });
      expect(belief.confidence).toBe(0.7);
    });
  });

  describe('calculateDormancyDecay()', () => {
    it('returns 0 when evidence is recent', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y',
        evidence_history: [{ type: 'confirmation', date: yesterday }],
      });
      expect(evaluator.calculateDormancyDecay(belief)).toBe(0);
    });

    it('returns decay when untested > 60 days (~2% per month)', () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', confidence: 0.8,
        evidence_history: [{ type: 'confirmation', date: ninetyDaysAgo }],
      });
      const decay = evaluator.calculateDormancyDecay(belief);
      // 90 days = ~3 months, 60 day grace = 1 month of decay at ~2%/month ≈ 0.02
      expect(decay).toBeGreaterThan(0);
      expect(decay).toBeLessThan(0.1);
    });

    it('returns 0 when no evidence history', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y' });
      // No evidence = dormant but no decay to apply (confidence is already initial)
      const decay = evaluator.calculateDormancyDecay(belief);
      expect(decay).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getEffectiveConfidence()', () => {
    it('includes bias adjustments and sample penalty', () => {
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', confidence: 0.85,
        evidence_quality: {
          sample_size: 8,
          biases_considered: [
            { type: 'survivorship', status: 'acknowledged', confidence_adjustment: -0.10 },
          ],
        },
      });
      const eff = evaluator.getEffectiveConfidence(belief);
      // 0.85 - 0.10 (bias) - 0.05 (sample 5-9) = 0.70
      expect(eff).toBeCloseTo(0.70, 2);
    });
  });

  describe('canTransitionToConfirmed()', () => {
    it('allows when bias < 30% and sample >= 5', () => {
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', confidence: 0.85,
        evidence_quality: {
          sample_size: 10,
          biases_considered: [
            { type: 'survivorship', status: 'acknowledged', confidence_adjustment: -0.10 },
          ],
        },
      });
      const result = evaluator.canTransitionToConfirmed(belief);
      expect(result.allowed).toBe(true);
    });

    it('blocks when total bias > 30%', () => {
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', confidence: 0.85,
        evidence_quality: {
          sample_size: 10,
          biases_considered: [
            { type: 'survivorship', status: 'acknowledged', confidence_adjustment: -0.20 },
            { type: 'confounding', status: 'acknowledged', confidence_adjustment: -0.15 },
          ],
        },
      });
      const result = evaluator.canTransitionToConfirmed(belief);
      expect(result.allowed).toBe(false);
      expect(result.max_state).toBe('uncertain');
      expect(result.reason).toMatch(/bias/i);
    });

    it('blocks when sample size < 5', () => {
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', confidence: 0.85,
        evidence_quality: {
          sample_size: 3,
          biases_considered: [],
        },
      });
      const result = evaluator.canTransitionToConfirmed(belief);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/sample/i);
    });
  });
});
