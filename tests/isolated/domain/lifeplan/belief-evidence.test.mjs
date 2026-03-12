import { describe, it, expect } from '@jest/globals';
import { Belief } from '#domains/lifeplan/entities/Belief.mjs';

describe('Belief Entity', () => {
  describe('construction', () => {
    it('creates a belief with if/then hypothesis', () => {
      const belief = new Belief({
        id: 'meritocracy',
        if: 'I work hard and smart',
        then: 'I will achieve success',
        state: 'hypothesized',
      });
      expect(belief.id).toBe('meritocracy');
      expect(belief.if).toBe('I work hard and smart');
      expect(belief.then).toBe('I will achieve success');
      expect(belief.state).toBe('hypothesized');
      expect(belief.confidence).toBe(0.5);
    });

    it('creates a belief with full evidence quality data', () => {
      const belief = new Belief({
        id: 'meritocracy',
        if: 'I work hard',
        then: 'I succeed',
        state: 'confirmed',
        confidence: 0.85,
        foundational: true,
        evidence_history: [
          { type: 'confirmation', delta: 0.05, date: '2025-01-01' },
        ],
        evidence_quality: {
          sample_size: 8,
          observation_span: '5 years',
          biases_considered: [
            { type: 'survivorship', status: 'acknowledged', confidence_adjustment: -0.10 },
            { type: 'confounding', status: 'acknowledged', confidence_adjustment: -0.15 },
            { type: 'small_sample', status: 'unexamined' },
          ],
        },
        depends_on: ['growth-mindset'],
      });
      expect(belief.confidence).toBe(0.85);
      expect(belief.foundational).toBe(true);
      expect(belief.evidence_history).toHaveLength(1);
      expect(belief.evidence_quality.sample_size).toBe(8);
      expect(belief.depends_on).toEqual(['growth-mindset']);
    });
  });

  describe('addEvidence()', () => {
    it('increases confidence on confirmation (+0.05)', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.5 });
      belief.addEvidence({ type: 'confirmation', date: '2025-03-01', note: 'Worked' });
      expect(belief.confidence).toBeCloseTo(0.55, 2);
      expect(belief.evidence_history).toHaveLength(1);
      expect(belief.evidence_quality.sample_size).toBe(1);
    });

    it('decreases confidence on disconfirmation (-0.08)', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.7 });
      belief.addEvidence({ type: 'disconfirmation', date: '2025-03-01' });
      expect(belief.confidence).toBeCloseTo(0.62, 2);
    });

    it('decreases confidence on spurious evidence (-0.12)', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.7 });
      belief.addEvidence({ type: 'spurious', date: '2025-03-01' });
      expect(belief.confidence).toBeCloseTo(0.58, 2);
    });

    it('does not change confidence on untested evidence', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.7 });
      belief.addEvidence({ type: 'untested', date: '2025-03-01' });
      expect(belief.confidence).toBe(0.7);
    });

    it('clamps confidence between 0 and 1', () => {
      const high = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.98 });
      high.addEvidence({ type: 'confirmation', date: '2025-03-01' });
      expect(high.confidence).toBe(1);

      const low = new Belief({ id: 'b2', if: 'X', then: 'Y', confidence: 0.02 });
      low.addEvidence({ type: 'spurious', date: '2025-03-01' });
      expect(low.confidence).toBe(0);
    });
  });

  describe('getEffectiveConfidence()', () => {
    it('returns raw confidence when no biases or quality data', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', confidence: 0.8 });
      expect(belief.getEffectiveConfidence()).toBe(0.8);
    });

    it('subtracts acknowledged bias adjustments', () => {
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', confidence: 0.85,
        evidence_quality: {
          sample_size: 10,
          biases_considered: [
            { type: 'survivorship', status: 'acknowledged', confidence_adjustment: -0.10 },
            { type: 'confounding', status: 'acknowledged', confidence_adjustment: -0.15 },
            { type: 'self_serving', status: 'dismissed' },
          ],
        },
      });
      // 0.85 + (-0.10) + (-0.15) = 0.60
      expect(belief.getEffectiveConfidence()).toBeCloseTo(0.60, 2);
    });

    it('applies small sample penalty (< 5 → -0.15)', () => {
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', confidence: 0.8,
        evidence_quality: { sample_size: 3, biases_considered: [] },
      });
      // 0.8 - 0.15 = 0.65
      expect(belief.getEffectiveConfidence()).toBeCloseTo(0.65, 2);
    });

    it('applies medium sample penalty (5-9 → -0.05)', () => {
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', confidence: 0.8,
        evidence_quality: { sample_size: 7, biases_considered: [] },
      });
      // 0.8 - 0.05 = 0.75
      expect(belief.getEffectiveConfidence()).toBeCloseTo(0.75, 2);
    });

    it('clamps effective confidence between 0 and 1', () => {
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', confidence: 0.3,
        evidence_quality: {
          sample_size: 2,
          biases_considered: [
            { type: 'survivorship', status: 'acknowledged', confidence_adjustment: -0.20 },
          ],
        },
      });
      // 0.3 - 0.20 - 0.15 = -0.05 → clamped to 0
      expect(belief.getEffectiveConfidence()).toBe(0);
    });
  });

  describe('dormancy detection', () => {
    it('detects dormancy when last evidence > 60 days ago', () => {
      const sixtyOneDaysAgo = new Date(Date.now() - 61 * 86400000).toISOString().slice(0, 10);
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', state: 'hypothesized',
        evidence_history: [{ type: 'confirmation', date: sixtyOneDaysAgo }],
      });
      expect(belief.isDormant()).toBe(true);
    });

    it('is not dormant when evidence is recent', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const belief = new Belief({
        id: 'b1', if: 'X', then: 'Y', state: 'hypothesized',
        evidence_history: [{ type: 'confirmation', date: yesterday }],
      });
      expect(belief.isDormant()).toBe(false);
    });

    it('is dormant when no evidence exists', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', state: 'hypothesized' });
      expect(belief.isDormant()).toBe(true);
    });
  });

  describe('state transitions', () => {
    it('transitions hypothesized → testing', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', state: 'hypothesized' });
      belief.transition('testing', 'Starting experiment');
      expect(belief.state).toBe('testing');
      expect(belief.state_history).toHaveLength(1);
    });

    it('throws on invalid transition', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', state: 'hypothesized' });
      expect(() => belief.transition('confirmed', 'Skipping'))
        .toThrow(/cannot transition/i);
    });

    it('throws on transition from terminal state', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', state: 'abandoned' });
      expect(() => belief.transition('testing', 'Retry'))
        .toThrow(/cannot transition/i);
    });
  });

  describe('foundational flag and depends_on', () => {
    it('tracks foundational flag', () => {
      const belief = new Belief({ id: 'b1', if: 'X', then: 'Y', foundational: true });
      expect(belief.foundational).toBe(true);
    });

    it('tracks depends_on references', () => {
      const belief = new Belief({
        id: 'derived',
        if: 'X', then: 'Y',
        depends_on: ['foundational-1', 'foundational-2'],
      });
      expect(belief.depends_on).toEqual(['foundational-1', 'foundational-2']);
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips correctly', () => {
      const data = {
        id: 'meritocracy',
        if: 'I work hard',
        then: 'I succeed',
        state: 'confirmed',
        confidence: 0.85,
        foundational: true,
        signals: [{ name: 'promotion', detection: 'manual' }],
        evidence_history: [
          { type: 'confirmation', delta: 0.05, date: '2025-01-01', note: 'Got promoted' },
        ],
        evidence_quality: {
          sample_size: 8,
          observation_span: '5 years',
          biases_considered: [
            { type: 'survivorship', status: 'acknowledged', confidence_adjustment: -0.10 },
          ],
        },
        depends_on: ['growth-mindset'],
        state_history: [{ from: 'hypothesized', to: 'testing', reason: 'start', timestamp: '2025-01-01' }],
        origin: { type: 'experience', description: 'Personal career' },
      };
      const belief = new Belief(data);
      const json = belief.toJSON();
      const restored = new Belief(json);
      expect(restored.id).toBe('meritocracy');
      expect(restored.state).toBe('confirmed');
      expect(restored.confidence).toBe(0.85);
      expect(restored.foundational).toBe(true);
      expect(restored.evidence_history).toHaveLength(1);
      expect(restored.evidence_quality.sample_size).toBe(8);
      expect(restored.depends_on).toEqual(['growth-mindset']);
      expect(restored.signals).toHaveLength(1);
      expect(restored.origin.type).toBe('experience');
    });
  });
});
