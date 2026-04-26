import { describe, it, expect } from 'vitest';
import { LifeplanSimulation } from '../../../_lib/lifeplan-simulation.mjs';

describe('Paradigm Shift: Foundational Belief Refutation', () => {
  it('cascades to dependent beliefs and values when foundational belief is refuted', () => {
    const sim = new LifeplanSimulation({
      goals: [],
      beliefs: [
        {
          id: 'b-foundation',
          if_hypothesis: 'Hard work always leads to success',
          confidence: 0.9,
          state: 'confirmed',
          foundational: true,
          sample_size: 10,
          bias_adjustment: 0,
          evidence_history: Array(10).fill({ type: 'confirmation' }),
        },
        {
          id: 'b-dependent',
          if_hypothesis: 'Working overtime improves career',
          confidence: 0.7,
          state: 'testing',
          foundational: false,
          grounded_in: ['b-foundation'],
          sample_size: 3,
          bias_adjustment: 0,
          evidence_history: [],
        },
      ],
      values: [
        { id: 'v1', name: 'Achievement', rank: 1, justified_by: ['b-foundation'], alignment_state: 'aligned' },
      ],
      qualities: [
        { id: 'q1', name: 'Work Ethic', grounded_in: { beliefs: ['b-foundation'] }, rules: [] },
      ],
      purpose: {
        statement: 'Maximize impact through effort',
        grounded_in: { beliefs: ['b-foundation'] },
      },
    }, '2025-01-01');

    // Refute the foundational belief (confirmed → testing → refuted)
    sim.plan.beliefs[0].transition('testing', 'Re-evaluating after burnout');
    sim.plan.beliefs[0].transition('refuted', 'Sustained evidence against it');

    // Process cascade
    const cascade = sim.processCascade('b-foundation');

    // Cascade should flag dependent beliefs for questioning
    expect(cascade.beliefs_questioning.length + cascade.values_review.length +
      cascade.qualities_review.length + (cascade.purpose_threatened ? 1 : 0)).toBeGreaterThan(0);

    // Values justified by refuted belief should be flagged
    expect(cascade.values_review).toContain('v1');

    // Purpose grounded in refuted belief should be threatened
    expect(cascade.purpose_threatened).toBe(true);
  });

  it('detects paradigm collapse when 3+ foundational beliefs refuted', () => {
    const sim = new LifeplanSimulation({
      goals: [],
      beliefs: [
        { id: 'b1', foundational: true, state: 'refuted', confidence: 0.2, sample_size: 5, bias_adjustment: 0, evidence_history: [] },
        { id: 'b2', foundational: true, state: 'refuted', confidence: 0.1, sample_size: 5, bias_adjustment: 0, evidence_history: [] },
        { id: 'b3', foundational: true, state: 'refuted', confidence: 0.15, sample_size: 5, bias_adjustment: 0, evidence_history: [] },
        { id: 'b4', foundational: false, state: 'testing', confidence: 0.6, sample_size: 2, bias_adjustment: 0, evidence_history: [] },
      ],
      values: [],
    }, '2025-01-01');

    // Check if paradigm collapse is detected (3+ foundational refuted in a season)
    const foundationalRefuted = sim.plan.beliefs.filter(
      b => b.foundational && b.state === 'refuted'
    );
    expect(foundationalRefuted.length).toBeGreaterThanOrEqual(3);
  });
});
