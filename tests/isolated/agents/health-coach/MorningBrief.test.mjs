import { describe, it, expect, vi } from 'vitest';

import { MorningBrief } from '../../../../backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs';

describe('MorningBrief', () => {
  it('has correct static properties', () => {
    expect(MorningBrief.id).toBe('morning-brief');
    expect(MorningBrief.schedule).toBe('0 10 * * *');
    expect(typeof MorningBrief.description).toBe('string');
  });

  it('gather calls expected tools', async () => {
    const brief = new MorningBrief();
    const calls = [];
    const mockTools = [
      { name: 'get_reconciliation_summary', execute: async (p) => { calls.push('recon'); return { avgAccuracy: 0.53, days: [] }; } },
      { name: 'get_weight_trend', execute: async (p) => { calls.push('weight'); return { current: { lbs: 185 } }; } },
      { name: 'get_user_goals', execute: async (p) => { calls.push('goals'); return { goals: { calories: 2000 } }; } },
      { name: 'get_today_nutrition', execute: async (p) => { calls.push('today'); return { logged: false }; } },
    ];
    const gathered = await brief.gather({ tools: mockTools, userId: 'kckern', memory: { serialize: () => '' }, logger: console });
    expect(calls.sort()).toEqual(['goals', 'recon', 'today', 'weight']);
    expect(gathered.reconciliation).toBeTruthy();
    expect(gathered.weight).toBeTruthy();
    expect(gathered.goals).toBeTruthy();
    expect(gathered.todayNutrition).toBeTruthy();
  });

  it('gather returns null for missing tools gracefully', async () => {
    const brief = new MorningBrief();
    // Only provide two of the four tools
    const mockTools = [
      { name: 'get_reconciliation_summary', execute: async () => ({ avgAccuracy: 0.53, days: [] }) },
      { name: 'get_weight_trend', execute: async () => ({ current: { lbs: 185 } }) },
    ];
    const gathered = await brief.gather({ tools: mockTools, userId: 'kckern', memory: { serialize: () => '' }, logger: { warn: () => {} } });
    expect(gathered.reconciliation).toBeTruthy();
    expect(gathered.weight).toBeTruthy();
    expect(gathered.goals).toBe(null);
    expect(gathered.todayNutrition).toBe(null);
  });

  it('buildPrompt includes reconciliation data', () => {
    const brief = new MorningBrief();
    const gathered = {
      reconciliation: { avgAccuracy: 0.53, days: [{ date: '2026-03-25', tracking_accuracy: 0.53 }] },
      weight: { current: { lbs: 185 }, trend: { sevenDay: -0.3 } },
      goals: { goals: { calories: 2000, protein: 150 } },
      todayNutrition: { logged: false },
    };
    const prompt = brief.buildPrompt(gathered, { serialize: () => '' });
    expect(typeof prompt === 'string').toBeTruthy();
    assert.ok(prompt.includes('0.53') || prompt.includes('53'));
    expect(prompt.length > 100).toBeTruthy();
  });

  it('buildPrompt includes date and instructions', () => {
    const brief = new MorningBrief();
    const gathered = {
      reconciliation: null,
      weight: null,
      goals: null,
      todayNutrition: null,
    };
    const prompt = brief.buildPrompt(gathered, { serialize: () => 'memory-content' });
    assert.ok(prompt.includes('memory-content'));
    assert.ok(prompt.includes('should_send') || prompt.includes('JSON'));
  });

  it('act sets last_morning_brief in memory', async () => {
    const brief = new MorningBrief();
    const memory = { set: vi.fn() };
    await brief.act({ should_send: true, text: 'test' }, { memory, userId: 'kckern', logger: console });
    expect(memory.set.mock.calls.length).toBe(1);
    expect(memory.set.mock.calls[0][0]).toBe('last_morning_brief');
    // TTL should be 24h in ms
    const opts = memory.set.mock.calls[0][2];
    expect(opts?.ttl).toBe(24 * 60 * 60 * 1000);
  });

  it('act still sets memory when should_send is false', async () => {
    const brief = new MorningBrief();
    const memory = { set: vi.fn() };
    await brief.act({ should_send: false }, { memory, userId: 'kckern', logger: { info: () => {} } });
    expect(memory.set.mock.calls.length).toBe(1);
    expect(memory.set.mock.calls[0][0]).toBe('last_morning_brief');
  });

  it('getOutputSchema returns coachingMessageSchema', () => {
    const brief = new MorningBrief();
    const schema = brief.getOutputSchema();
    expect(schema.properties.should_send).toBeTruthy();
    expect(schema.properties.text).toBeTruthy();
    expect(schema.required[0]).toBe('should_send');
  });

  it('validate parses valid JSON output', async () => {
    const brief = new MorningBrief();
    const raw = { output: JSON.stringify({ should_send: true, text: 'Hello' }) };
    const result = await brief.validate(raw, {}, { warn: () => {} });
    expect(result.should_send).toBe(true);
    expect(result.text).toBe('Hello');
  });

  it('validate throws on invalid JSON', async () => {
    const brief = new MorningBrief();
    const raw = { output: 'not json at all' };
    await expect(
      brief.validate(raw, {}, { warn: () => {} }),
    ).rejects.toThrow(/JSON/i);
  });

  it('validate throws when should_send is missing', async () => {
    const brief = new MorningBrief();
    const raw = { output: JSON.stringify({ text: 'Hello' }) };
    await expect(
      brief.validate(raw, {}, { warn: () => {} }),
    ).rejects.toThrow();
  });
});
