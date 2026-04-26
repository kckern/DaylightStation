import { describe, it, expect, vi } from 'vitest';

import { WeeklyDigest } from '../../../../backend/src/3_applications/agents/health-coach/assignments/WeeklyDigest.mjs';

describe('WeeklyDigest', () => {
  it('has correct static properties', () => {
    expect(WeeklyDigest.id).toBe('weekly-digest');
    expect(WeeklyDigest.schedule).toBe('0 19 * * 0');
    expect(typeof WeeklyDigest.description).toBe('string');
  });

  it('gather calls all 5 expected tools (including long-term weight)', async () => {
    const digest = new WeeklyDigest();
    const calls = [];
    const mockTools = [
      { name: 'get_reconciliation_summary', execute: async (p) => { calls.push(`reconciliation:${p.days}`); return { avgAccuracy: 0.71, days: [] }; } },
      { name: 'get_weight_trend',           execute: async (p) => { calls.push(`weight:${p.days}`);         return { current: { lbs: 182 }, trend: { sevenDay: -0.5, fourteenDay: -1.2 } }; } },
      { name: 'get_nutrition_history',      execute: async (p) => { calls.push('nutrition');                 return { days: [], avgCalories: 1900 }; } },
      { name: 'get_user_goals',             execute: async (p) => { calls.push('goals');                     return { goals: { calories: 2000, protein: 150 } }; } },
    ];
    const gathered = await digest.gather({
      tools: mockTools,
      userId: 'kckern',
      memory: { serialize: () => '' },
      logger: { warn: () => {}, info: () => {} },
    });

    expect(calls.sort()).toEqual(['goals', 'nutrition', 'reconciliation:84', 'weight:14', 'weight:84']);
    expect(gathered.reconciliation).toBeTruthy();
    expect(gathered.weight).toBeTruthy();
    expect(gathered.weightLongTerm).toBeTruthy();
    expect(gathered.nutritionHistory).toBeTruthy();
    expect(gathered.goals).toBeTruthy();
  });

  it('buildPrompt includes weekly trend data and long-term context', () => {
    const digest = new WeeklyDigest();
    const gathered = {
      reconciliation:   { avgAccuracy: 0.71, missedDays: 1, days: [{ date: '2026-03-23', tracking_accuracy: 0.71 }] },
      weight:           { current: { lbs: 182 }, trend: { sevenDay: -0.5, fourteenDay: -1.2 } },
      weightLongTerm:   { current: { lbs: 182 }, trend: { sevenDay: -0.5, fourteenDay: -1.2 } },
      nutritionHistory: { days: [], avgCalories: 1900, avgProtein: 140 },
      goals:            { goals: { calories: 2000, protein: 150 } },
    };
    const prompt = digest.buildPrompt(gathered, { serialize: () => 'mem-content' });
    expect(typeof prompt === 'string').toBeTruthy();
    expect(prompt.length > 100).toBeTruthy();
    assert.ok(prompt.includes('1900') || prompt.includes('nutrition'));
    assert.ok(prompt.includes('mem-content'));
    assert.ok(prompt.includes('long-term') || prompt.includes('12 week'));
  });

  it('act sets last_weekly_digest in memory with 7-day TTL', async () => {
    const digest = new WeeklyDigest();
    const memory = { set: vi.fn() };
    await digest.act({ should_send: true, text: 'Weekly summary.' }, { memory, userId: 'kckern', logger: { info: () => {} } });

    expect(memory.set.mock.calls.length).toBe(1);
    expect(memory.set.mock.calls[0][0]).toBe('last_weekly_digest');
    const opts = memory.set.mock.calls[0][2];
    // TTL should be 7 days in ms
    expect(opts?.ttl).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('getOutputSchema returns coachingMessageSchema', () => {
    const digest = new WeeklyDigest();
    const schema = digest.getOutputSchema();
    expect(schema.properties.should_send).toBeTruthy();
    expect(schema.properties.text).toBeTruthy();
    expect(schema.required[0]).toBe('should_send');
  });
});
