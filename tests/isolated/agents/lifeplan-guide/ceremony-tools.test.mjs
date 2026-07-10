import { describe, it, expect, beforeEach } from 'vitest';
import { CeremonyToolFactory } from '#apps/agents/lifeplan-guide/tools/CeremonyToolFactory.mjs';

describe('CeremonyToolFactory', () => {
  let factory, tools;
  let completedCeremonies;

  beforeEach(() => {
    completedCeremonies = [];
    factory = new CeremonyToolFactory({
      ceremonyService: {
        getCeremonyContent: async (type) => ({
          type,
          steps: [{ prompt: 'What are your intentions?' }],
          activeGoals: [{ id: 'g1', name: 'Run marathon' }],
        }),
        completeCeremony: async (type, username, responses) => {
          completedCeremonies.push({ type, username, responses });
        },
      },
      ceremonyRecordStore: {
        hasRecord: (username, type, periodId) => type === 'unit_intention' && periodId === 'done-period',
        getRecords: () => [{ type: 'cycle_retro', completedAt: '2025-06-01' }],
      },
      cadenceService: {
        resolve: () => ({
          unit: { periodId: '2025-06-07' },
          cycle: { periodId: '2025-W23' },
        }),
        isCeremonyDue: (type) => type !== 'era_vision',
      },
      lifePlanStore: {
        load: () => ({
          ceremonies: {
            unit_intention: { enabled: true },
            cycle_retro: { enabled: true },
            phase_review: { enabled: false },
          },
          cadence: {},
        }),
      },
    });
    tools = factory.createTools();
  });

  it('creates 4 tools', () => {
    expect(tools).toHaveLength(4);
    const names = tools.map(t => t.name);
    expect(names).toContain('get_ceremony_content');
    expect(names).toContain('complete_ceremony');
    expect(names).toContain('check_ceremony_status');
    expect(names).toContain('get_ceremony_history');
  });

  it('get_ceremony_content returns ceremony data', async () => {
    const tool = tools.find(t => t.name === 'get_ceremony_content');
    const result = await tool.execute({ type: 'cycle_retro', username: 'test' });
    expect(result.type).toBe('cycle_retro');
    expect(result.steps).toBeDefined();
  });

  it('complete_ceremony records completion', async () => {
    const tool = tools.find(t => t.name === 'complete_ceremony');
    await tool.execute({ type: 'cycle_retro', username: 'test', responses: { reflection: 'Good week' } });
    expect(completedCeremonies).toHaveLength(1);
  });

  it('check_ceremony_status returns due/overdue/completed', async () => {
    const tool = tools.find(t => t.name === 'check_ceremony_status');
    const result = await tool.execute({ username: 'test' });
    expect(result.ceremonies).toBeDefined();
    expect(Array.isArray(result.ceremonies)).toBe(true);
  });

  it('check_ceremony_status marks enabled ceremonies with correct status', async () => {
    const tool = tools.find(t => t.name === 'check_ceremony_status');
    const result = await tool.execute({ username: 'test' });
    // Only enabled ceremonies should appear (unit_intention, cycle_retro — phase_review is disabled)
    const types = result.ceremonies.map(c => c.type);
    expect(types).toContain('unit_intention');
    expect(types).toContain('cycle_retro');
    expect(types).not.toContain('phase_review');

    const unitIntention = result.ceremonies.find(c => c.type === 'unit_intention');
    expect(unitIntention.isDue).toBe(true);
    expect(unitIntention.isCompleted).toBe(false);
    expect(unitIntention.isOverdue).toBe(true);
  });

  it('get_ceremony_history returns past records', async () => {
    const tool = tools.find(t => t.name === 'get_ceremony_history');
    const result = await tool.execute({ username: 'test' });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].type).toBe('cycle_retro');
  });

  it('get_ceremony_history filters by type', async () => {
    const tool = tools.find(t => t.name === 'get_ceremony_history');
    const result = await tool.execute({ username: 'test', type: 'unit_intention' });
    expect(result.records).toHaveLength(0);
  });

  it('check_ceremony_status calls isCeremonyDue with a timing string and full cadence args', async () => {
    const calls = [];
    const spyFactory = new CeremonyToolFactory({
      ceremonyRecordStore: { hasRecord: () => false },
      cadenceService: {
        resolve: () => ({ unit: { periodId: '2026-U1' }, cycle: { periodId: '2026-C1' } }),
        isCeremonyDue: (...args) => { calls.push(args); return args[0] === 'start_of_unit'; },
      },
      lifePlanStore: {
        load: () => ({
          ceremonies: { unit_intention: { enabled: true }, cycle_retro: { enabled: true } },
          cadence: { unit: { alias: 'day' } },
        }),
      },
    });
    const tool = spyFactory.createTools().find(t => t.name === 'check_ceremony_status');
    const result = await tool.execute({ username: 'test-user' });

    const [timing, cadenceConfig, today, last] = calls[0];
    expect(timing).toBe('start_of_unit'); // timing string, not ceremony type
    expect(cadenceConfig).toEqual({ unit: { alias: 'day' } });
    expect(today).toBeInstanceOf(Date);
    expect(last).toBeNull();
    expect(result.ceremonies.find(c => c.type === 'unit_intention').isDue).toBe(true);
    expect(result.ceremonies.find(c => c.type === 'cycle_retro').isDue).toBe(false);
  });

  it('get_ceremony_content returns error on service failure', async () => {
    const failFactory = new CeremonyToolFactory({
      ceremonyService: {
        getCeremonyContent: async () => { throw new Error('not found'); },
      },
    });
    const failTools = failFactory.createTools();
    const tool = failTools.find(t => t.name === 'get_ceremony_content');
    const result = await tool.execute({ type: 'bad', username: 'test' });
    expect(result.error).toBe('not found');
  });
});
