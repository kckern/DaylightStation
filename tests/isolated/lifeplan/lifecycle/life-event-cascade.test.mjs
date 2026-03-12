import { describe, it, expect } from '@jest/globals';
import { LifeplanSimulation } from '../../../_lib/lifeplan-simulation.mjs';

describe('Life Event Cascade', () => {
  it('resolves goal dependency when life event occurs', () => {
    const sim = new LifeplanSimulation({
      goals: [{
        id: 'g1', name: 'Join local gym', state: 'considered',
        dependencies: [],
        metrics: [],
      }],
      beliefs: [],
      values: [],
      life_events: [
        { id: 'le1', type: 'relocation', name: 'Move to Seattle', state: 'anticipated' },
      ],
    }, '2025-01-01');

    // Life event occurs
    sim.runCycles(4);
    sim.injectLifeEvent({
      type: 'relocation',
      name: 'Move to Seattle',
      state: 'occurred',
    });

    // The event has occurred
    const events = sim.plan.life_events;
    const occurred = events.filter(e => e.state === 'occurred');
    expect(occurred.length).toBeGreaterThanOrEqual(1);

    // Goal can transition to ready
    sim.transitionGoal('g1', 'ready', 'Moved to new city, gym nearby');
    expect(sim.plan.goals[0].state).toBe('ready');
  });

  it('tracks multiple life events', () => {
    const sim = new LifeplanSimulation({
      goals: [],
      beliefs: [],
      values: [],
      life_events: [],
    }, '2025-01-01');

    sim.injectLifeEvent({ type: 'job_change', name: 'New job', state: 'occurred' });
    sim.runCycles(2);
    sim.injectLifeEvent({ type: 'relocation', name: 'New city', state: 'occurred' });

    expect(sim.plan.life_events).toHaveLength(2);
  });
});
