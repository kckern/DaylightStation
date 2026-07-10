import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanAuthoringService } from '#apps/lifeplan/services/PlanAuthoringService.mjs';

describe('PlanAuthoringService', () => {
  let store, saved, current, svc;
  beforeEach(() => {
    saved = null;
    current = null;
    // Stateful mock: load returns the last-saved plan so multi-call
    // assertions (next rank, id de-dup) exercise a real accumulating plan.
    store = {
      load: vi.fn(() => current),
      save: vi.fn((u, p) => { current = p; saved = p; }),
    };
    svc = new PlanAuthoringService({ lifePlanStore: store });
  });

  it('createPlan seeds a minimal valid plan; refuses to overwrite', () => {
    const plan = svc.createPlan('test-user');
    expect(store.save).toHaveBeenCalledWith('test-user', expect.anything());
    expect(plan.goals).toEqual([]);
    expect(plan.beliefs).toEqual([]);
    expect(plan.values).toEqual([]);
    expect(plan.purpose).toBe(null);
    store.load.mockReturnValue(plan);
    expect(() => svc.createPlan('test-user')).toThrow(/already exists/);
  });

  it('addGoal creates the plan if missing and slugs an id', () => {
    const goal = svc.addGoal('test-user', { name: 'Run a half marathon', why: 'health', milestone: '10k by Sept' });
    expect(goal.id).toBe('run-a-half-marathon');
    expect(goal.state).toBe('dream'); // real initial Goal state (Goal.mjs default)
    expect(goal.why).toBe('health');
    expect(goal.milestones).toHaveLength(1);
    expect(goal.milestones[0].name).toBe('10k by Sept');
    expect(saved.goals).toHaveLength(1);
  });

  it('addValue appends with next rank; addBelief seeds the initial belief state', () => {
    const v1 = svc.addValue('test-user', { name: 'Health' });
    expect(v1.rank).toBe(1);
    const v2 = svc.addValue('test-user', { name: 'Family' });
    expect(v2.rank).toBe(2);
    expect(saved.values).toHaveLength(2);

    const b = svc.addBelief('test-user', { if_hypothesis: 'train before 8am', then_outcome: 'training happens' });
    expect(b.if).toBe('train before 8am');
    expect(b.then).toBe('training happens');
    expect(b.state).toBe('hypothesized'); // real initial Belief state
    expect(b.confidence).toBe(0.5); // Belief confidence default
    expect(saved.beliefs).toHaveLength(1);
  });

  it('setPurpose sets/replaces the purpose statement', () => {
    svc.setPurpose('test-user', { statement: 'Live deliberately' });
    expect(saved.purpose.statement).toBe('Live deliberately');
    const p2 = svc.setPurpose('test-user', { statement: 'Live intentionally' });
    expect(p2.statement).toBe('Live intentionally');
    expect(saved.purpose.statement).toBe('Live intentionally');
  });

  it('addGoal de-dupes ids when the same name is added twice', () => {
    svc.addGoal('test-user', { name: 'Ship it' });
    store.load.mockReturnValue(saved); // now the plan exists with goal 'ship-it'
    const g2 = svc.addGoal('test-user', { name: 'Ship it' });
    expect(g2.id).toBe('ship-it-2');
  });
});
