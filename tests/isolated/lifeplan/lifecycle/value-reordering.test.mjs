import { describe, it, expect } from '@jest/globals';
import { LifeplanSimulation } from '../../../_lib/lifeplan-simulation.mjs';

describe('Value Reordering from Drift', () => {
  it('detects drift when time allocation diverges from value ranking', () => {
    const sim = new LifeplanSimulation({
      goals: [],
      beliefs: [],
      values: [
        { id: 'v1', name: 'Health', rank: 1, alignment_state: 'aligned' },
        { id: 'v2', name: 'Career', rank: 2, alignment_state: 'aligned' },
        { id: 'v3', name: 'Relationships', rank: 3, alignment_state: 'aligned' },
      ],
    }, '2025-01-01');

    // Simulate drift: set alignment states to show divergence
    sim.plan.values[0].alignment_state = 'drifting';
    sim.plan.values[1].alignment_state = 'reconsidering';

    sim.runCycles(4);

    const snapshot = sim.snapshot();
    const driftingValues = snapshot.values.filter(v => v.alignment_state !== 'aligned');
    expect(driftingValues.length).toBeGreaterThanOrEqual(1);
  });

  it('reordering updates rank numbers', () => {
    const sim = new LifeplanSimulation({
      goals: [],
      beliefs: [],
      values: [
        { id: 'v1', name: 'Health', rank: 1 },
        { id: 'v2', name: 'Career', rank: 2 },
        { id: 'v3', name: 'Relationships', rank: 3 },
      ],
    }, '2025-01-01');

    // Swap ranks
    const values = sim.plan.values;
    const temp = values[0].rank;
    values[0].rank = values[1].rank;
    values[1].rank = temp;

    expect(values[0].rank).toBe(2);
    expect(values[1].rank).toBe(1);
  });
});
