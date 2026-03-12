import { describe, it, expect } from '@jest/globals';
import { LifeplanSimulation } from '../../../_lib/lifeplan-simulation.mjs';

describe('Goal Full Journey: dream → achieved', () => {
  it('transitions a goal through all states over multiple cycles', () => {
    const sim = new LifeplanSimulation({
      goals: [{
        id: 'g1', name: 'Run a marathon', state: 'dream',
        quality: 'fitness',
        metrics: [{ name: 'weekly_miles', current: 0, target: 30, unit: 'miles' }],
        milestones: [
          { name: 'First 5K', completed: false },
          { name: 'Half marathon', completed: false },
        ],
      }],
      beliefs: [],
      values: [],
    }, '2025-01-01');

    // Week 1: Dream → Considered
    sim.runCycle();
    sim.transitionGoal('g1', 'considered', 'Researching race options');
    expect(sim.plan.goals[0].state).toBe('considered');

    // Week 2: Considered → Ready (add sacrifice/why)
    sim.runCycle();
    sim.plan.goals[0].why = 'Prove I can push beyond limits';
    sim.plan.goals[0].sacrifice = 'Less screen time, early mornings';
    sim.plan.goals[0].deadline = '2025-12-31';
    sim.transitionGoal('g1', 'ready', 'Plan solidified');
    expect(sim.plan.goals[0].state).toBe('ready');

    // Week 3: Ready → Committed
    sim.runCycle();
    sim.transitionGoal('g1', 'committed', 'Training plan starts');
    expect(sim.plan.goals[0].state).toBe('committed');

    // Weeks 4-10: Progress updates
    for (let w = 0; w < 7; w++) {
      sim.runCycle();
      sim.plan.goals[0].metrics[0].current = Math.min(30, (w + 1) * 5);
    }

    // Complete milestones
    sim.plan.goals[0].milestones[0].completed = true;
    sim.plan.goals[0].milestones[1].completed = true;

    // Achieve
    sim.transitionGoal('g1', 'achieved', 'Marathon completed!');
    expect(sim.plan.goals[0].state).toBe('achieved');
    expect(sim.plan.goals[0].isTerminal()).toBe(true);

    // Verify snapshots captured progression
    const snapshots = sim.snapshots;
    expect(snapshots.length).toBe(10);
    expect(snapshots[0].goals[0].state).toBe('dream'); // First snapshot before transitions
  });
});
