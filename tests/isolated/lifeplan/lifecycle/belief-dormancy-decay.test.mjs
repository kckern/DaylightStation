import { describe, it, expect } from 'vitest';
import { LifeplanSimulation } from '../../../_lib/lifeplan-simulation.mjs';

describe('Belief Dormancy Decay', () => {
  it('confidence decays when belief is untested for 60+ days', () => {
    const sim = new LifeplanSimulation({
      goals: [],
      beliefs: [{
        id: 'b1',
        if_hypothesis: 'Morning exercise leads to better focus',
        then_expectation: 'More productive work hours',
        confidence: 0.8,
        state: 'testing',
        sample_size: 5,
        bias_adjustment: 0,
        evidence_history: [
          { type: 'confirmation', date: '2025-01-01' },
          { type: 'confirmation', date: '2025-01-05' },
          { type: 'disconfirmation', date: '2025-01-10' },
          { type: 'confirmation', date: '2025-01-15' },
          { type: 'confirmation', date: '2025-01-20' },
        ],
      }],
      values: [],
    }, '2025-01-20');

    // Initial confidence
    const initialConf = sim.plan.beliefs[0].getEffectiveConfidence();
    expect(initialConf).toBeGreaterThan(0.7);

    // Fast-forward 70 days with no evidence
    sim.runCycles(10, 7); // 10 weeks = 70 days

    // Belief should now be dormant
    expect(sim.plan.beliefs[0].isDormant()).toBe(true);
  });

  it('adding evidence updates evidence history', () => {
    const sim = new LifeplanSimulation({
      goals: [],
      beliefs: [{
        id: 'b1',
        if_hypothesis: 'Test',
        confidence: 0.7,
        state: 'testing',
        sample_size: 3,
        bias_adjustment: 0,
        evidence_history: [
          { type: 'confirmation', date: '2025-01-01' },
          { type: 'confirmation', date: '2025-01-05' },
          { type: 'confirmation', date: '2025-01-10' },
        ],
      }],
      values: [],
    }, '2025-01-10');

    const initialCount = sim.plan.beliefs[0].evidence_history.length;

    // Add new evidence
    sim.injectEvidence('b1', { type: 'disconfirmation' });

    // Evidence should be added
    expect(sim.plan.beliefs[0].evidence_history.length).toBe(initialCount + 1);
    const lastEvidence = sim.plan.beliefs[0].evidence_history.at(-1);
    expect(lastEvidence.type).toBe('disconfirmation');
    expect(lastEvidence.date).toBe(sim.currentDate);
  });
});
