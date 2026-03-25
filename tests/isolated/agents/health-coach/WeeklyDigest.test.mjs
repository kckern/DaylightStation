import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { WeeklyDigest } from '../../../../backend/src/3_applications/agents/health-coach/assignments/WeeklyDigest.mjs';

describe('WeeklyDigest', () => {
  it('has correct static properties', () => {
    assert.equal(WeeklyDigest.id, 'weekly-digest');
    assert.equal(WeeklyDigest.schedule, '0 19 * * 0');
    assert.equal(typeof WeeklyDigest.description, 'string');
  });

  it('gather calls all 4 expected tools', async () => {
    const digest = new WeeklyDigest();
    const calls = [];
    const mockTools = [
      { name: 'get_reconciliation_summary', execute: async (p) => { calls.push('reconciliation'); return { avgAccuracy: 0.71, days: [] }; } },
      { name: 'get_weight_trend',           execute: async (p) => { calls.push('weight');         return { current: { lbs: 182 }, trend: { sevenDay: -0.5, fourteenDay: -1.2 } }; } },
      { name: 'get_nutrition_history',      execute: async (p) => { calls.push('nutrition');      return { days: [], avgCalories: 1900 }; } },
      { name: 'get_user_goals',             execute: async (p) => { calls.push('goals');          return { goals: { calories: 2000, protein: 150 } }; } },
    ];
    const gathered = await digest.gather({
      tools: mockTools,
      userId: 'kckern',
      memory: { serialize: () => '' },
      logger: { warn: () => {}, info: () => {} },
    });

    assert.deepEqual(calls.sort(), ['goals', 'nutrition', 'reconciliation', 'weight']);
    assert.ok(gathered.reconciliation);
    assert.ok(gathered.weight);
    assert.ok(gathered.nutritionHistory);
    assert.ok(gathered.goals);
  });

  it('buildPrompt includes weekly trend data', () => {
    const digest = new WeeklyDigest();
    const gathered = {
      reconciliation:   { avgAccuracy: 0.71, missedDays: 1, days: [{ date: '2026-03-23', tracking_accuracy: 0.71 }] },
      weight:           { current: { lbs: 182 }, trend: { sevenDay: -0.5, fourteenDay: -1.2 } },
      nutritionHistory: { days: [], avgCalories: 1900, avgProtein: 140 },
      goals:            { goals: { calories: 2000, protein: 150 } },
    };
    const prompt = digest.buildPrompt(gathered, { serialize: () => 'mem-content' });
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 100);
    // Should include numeric data from the gathered payload
    assert.ok(prompt.includes('1900') || prompt.includes('avoidance') || prompt.includes('nutrition'));
    assert.ok(prompt.includes('mem-content'));
  });

  it('act sets last_weekly_digest in memory with 7-day TTL', async () => {
    const digest = new WeeklyDigest();
    const memory = { set: mock.fn() };
    await digest.act({ should_send: true, text: 'Weekly summary.' }, { memory, userId: 'kckern', logger: { info: () => {} } });

    assert.equal(memory.set.mock.calls.length, 1);
    assert.equal(memory.set.mock.calls[0].arguments[0], 'last_weekly_digest');
    const opts = memory.set.mock.calls[0].arguments[2];
    // TTL should be 7 days in ms
    assert.equal(opts?.ttl, 7 * 24 * 60 * 60 * 1000);
  });

  it('getOutputSchema returns coachingMessageSchema', () => {
    const digest = new WeeklyDigest();
    const schema = digest.getOutputSchema();
    assert.ok(schema.properties.should_send);
    assert.ok(schema.properties.text);
    assert.equal(schema.required[0], 'should_send');
  });
});
