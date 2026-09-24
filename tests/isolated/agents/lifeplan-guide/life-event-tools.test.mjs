import { describe, it, expect, vi } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';

function tools(overrides = {}) {
  const deps = {
    lifePlanStore: { load: () => ({}), save: vi.fn() },
    goalStateService: {}, beliefEvaluator: {}, feedbackService: {},
    planAuthoringService: { addLifeEvent: vi.fn((u, e) => ({ id: 'moving-day', ...e, signals: e.signal ? [e.signal] : [] })) },
    lifeEventSuggester: {
      suggest: vi.fn(async () => ({ judge: 'keyword', startDate: '2026-09-11', endDate: '2026-09-24',
        suggestions: [{ date: '2026-09-20', type: 'location', subtype: 'relocation', name: 'Moving day', source: 'calendar', confidence: 0.8, detector: 'keyword' }] })),
      noteConfirmed: vi.fn(),
    },
    clock: { now: () => new Date('2026-09-24T12:00:00Z') },
    ...overrides,
  };
  const list = new PlanToolFactory(deps).createTools();
  return { deps, get: (name) => list.find((t) => t.name === name) };
}

describe('PlanToolFactory life-event tools', () => {
  it('suggest_life_events is read-only and returns the suggestions and window', async () => {
    const { deps, get } = tools();
    const tool = get('suggest_life_events');
    expect(tool.description).not.toMatch(/Writes to the user's plan/);
    const out = await tool.execute({ userId: 'kc', days: 30 });
    expect(deps.lifeEventSuggester.suggest).toHaveBeenCalledWith('kc', { days: 30 });
    expect(out.window).toEqual({ start: '2026-09-11', end: '2026-09-24' });
    expect(out.suggestions[0].name).toBe('Moving day');
  });

  it('suggest_life_events degrades to an error payload without a suggester or on failure', async () => {
    expect(await tools({ lifeEventSuggester: null }).get('suggest_life_events').execute({ userId: 'kc' }))
      .toEqual({ error: 'Life event suggestions are not available', suggestions: [] });
    const failing = { suggest: vi.fn(async () => { throw new Error('lifelog down'); }) };
    expect(await tools({ lifeEventSuggester: failing }).get('suggest_life_events').execute({ userId: 'kc' }))
      .toEqual({ error: 'lifelog down', suggestions: [] });
  });

  it('add_life_event is confirm-gated, writes via planAuthoringService, and logs the confirmation', async () => {
    const { deps, get } = tools();
    const tool = get('add_life_event');
    expect(tool.description).toMatch(/Only call after the user has explicitly confirmed/);
    const suggestion = { date: '2026-09-20', source: 'calendar', detector: 'keyword', confidence: 0.8 };
    const out = await tool.execute({ userId: 'kc', type: 'location', subtype: 'relocation', name: 'Moving day',
      status: 'occurred', date: '2026-09-20', fromSuggestion: suggestion });
    expect(deps.planAuthoringService.addLifeEvent).toHaveBeenCalledWith('kc', {
      type: 'location', subtype: 'relocation', name: 'Moving day', status: 'occurred', date: '2026-09-20',
      signal: { source: 'calendar', date: '2026-09-20', detector: 'keyword', confidence: 0.8 },
    });
    expect(deps.lifeEventSuggester.noteConfirmed).toHaveBeenCalledWith('kc', out.created);
  });

  it('add_life_event returns an error payload when authoring rejects', async () => {
    const planAuthoringService = { addLifeEvent: vi.fn(() => { throw new Error('Unknown life event type: travel'); }) };
    const out = await tools({ planAuthoringService }).get('add_life_event')
      .execute({ userId: 'kc', type: 'travel', name: 'x', status: 'occurred' });
    expect(out).toEqual({ error: 'Unknown life event type: travel' });
  });
});
