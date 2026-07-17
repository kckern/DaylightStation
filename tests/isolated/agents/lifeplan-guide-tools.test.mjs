import { describe, it, expect, vi } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';

describe('PlanToolFactory write tools', () => {
  it('exposes create_goal/add_value/add_belief/set_purpose backed by PlanAuthoringService', async () => {
    const planAuthoringService = {
      addGoal: vi.fn().mockReturnValue({ id: 'g' }),
      addValue: vi.fn().mockReturnValue({ id: 'health', rank: 1 }),
      addBelief: vi.fn().mockReturnValue({ id: 'b', state: 'hypothesized' }),
      setPurpose: vi.fn().mockReturnValue({ statement: 'X' }),
    };
    const factory = new PlanToolFactory({ lifePlanStore: { load: () => null }, planAuthoringService });
    const tools = factory.createTools();
    const names = tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['create_goal', 'add_value', 'add_belief', 'set_purpose']));

    const createGoal = tools.find(t => t.name === 'create_goal');
    const out = await createGoal.execute({ userId: 'test-user', name: 'Ship it' });
    expect(planAuthoringService.addGoal).toHaveBeenCalledWith('test-user', expect.objectContaining({ name: 'Ship it' }));
    expect(out.created.id).toBe('g');
  });

  it('add_value/add_belief/set_purpose forward the right args and return { created }', async () => {
    const planAuthoringService = {
      addGoal: vi.fn(),
      addValue: vi.fn().mockReturnValue({ id: 'health', rank: 1 }),
      addBelief: vi.fn().mockReturnValue({ id: 'b', state: 'hypothesized' }),
      setPurpose: vi.fn().mockReturnValue({ statement: 'Live fully' }),
    };
    const factory = new PlanToolFactory({ lifePlanStore: { load: () => null }, planAuthoringService });
    const tools = factory.createTools();

    const addValue = tools.find(t => t.name === 'add_value');
    const v = await addValue.execute({ userId: 'test-user', name: 'Health', description: 'well-being' });
    expect(planAuthoringService.addValue).toHaveBeenCalledWith('test-user', expect.objectContaining({ name: 'Health', description: 'well-being' }));
    expect(v.created.id).toBe('health');

    const addBelief = tools.find(t => t.name === 'add_belief');
    const b = await addBelief.execute({ userId: 'test-user', if_hypothesis: 'train am', then_outcome: 'it happens' });
    expect(planAuthoringService.addBelief).toHaveBeenCalledWith('test-user', expect.objectContaining({ if_hypothesis: 'train am', then_outcome: 'it happens' }));
    expect(b.created.state).toBe('hypothesized');

    const setPurpose = tools.find(t => t.name === 'set_purpose');
    const p = await setPurpose.execute({ userId: 'test-user', statement: 'Live fully' });
    expect(planAuthoringService.setPurpose).toHaveBeenCalledWith('test-user', expect.objectContaining({ statement: 'Live fully' }));
    expect(p.created.statement).toBe('Live fully');
  });

  it('write tools surface an error envelope when the service throws', async () => {
    const planAuthoringService = { addGoal: vi.fn(() => { throw new Error('Plan already exists'); }), addValue: vi.fn(), addBelief: vi.fn(), setPurpose: vi.fn() };
    const factory = new PlanToolFactory({ lifePlanStore: { load: () => null }, planAuthoringService });
    const createGoal = factory.createTools().find(t => t.name === 'create_goal');
    const out = await createGoal.execute({ userId: 'test-user', name: 'X' });
    expect(out.error).toBeTruthy();
  });

  it('write-tool descriptions require conversational confirmation first', () => {
    const factory = new PlanToolFactory({ lifePlanStore: { load: () => null }, planAuthoringService: {} });
    const tools = factory.createTools();
    for (const name of ['create_goal', 'add_value', 'add_belief', 'set_purpose']) {
      const tool = tools.find(t => t.name === name);
      expect(tool.description.startsWith("Writes to the user's plan. Only call after the user has explicitly confirmed in conversation.")).toBe(true);
    }
  });
});
