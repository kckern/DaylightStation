import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { MorningBrief } from '../../../../backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs';

describe('MorningBrief', () => {
  it('has correct static properties', () => {
    assert.equal(MorningBrief.id, 'morning-brief');
    assert.equal(MorningBrief.schedule, '0 10 * * *');
    assert.equal(typeof MorningBrief.description, 'string');
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
    assert.deepEqual(calls.sort(), ['goals', 'recon', 'today', 'weight']);
    assert.ok(gathered.reconciliation);
    assert.ok(gathered.weight);
    assert.ok(gathered.goals);
    assert.ok(gathered.todayNutrition);
  });

  it('gather returns null for missing tools gracefully', async () => {
    const brief = new MorningBrief();
    // Only provide two of the four tools
    const mockTools = [
      { name: 'get_reconciliation_summary', execute: async () => ({ avgAccuracy: 0.53, days: [] }) },
      { name: 'get_weight_trend', execute: async () => ({ current: { lbs: 185 } }) },
    ];
    const gathered = await brief.gather({ tools: mockTools, userId: 'kckern', memory: { serialize: () => '' }, logger: { warn: () => {} } });
    assert.ok(gathered.reconciliation);
    assert.ok(gathered.weight);
    assert.equal(gathered.goals, null);
    assert.equal(gathered.todayNutrition, null);
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
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.includes('0.53') || prompt.includes('53'));
    assert.ok(prompt.length > 100);
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
    const memory = { set: mock.fn() };
    await brief.act({ should_send: true, text: 'test' }, { memory, userId: 'kckern', logger: console });
    assert.equal(memory.set.mock.calls.length, 1);
    assert.equal(memory.set.mock.calls[0].arguments[0], 'last_morning_brief');
    // TTL should be 24h in ms
    const opts = memory.set.mock.calls[0].arguments[2];
    assert.equal(opts?.ttl, 24 * 60 * 60 * 1000);
  });

  it('act still sets memory when should_send is false', async () => {
    const brief = new MorningBrief();
    const memory = { set: mock.fn() };
    await brief.act({ should_send: false }, { memory, userId: 'kckern', logger: { info: () => {} } });
    assert.equal(memory.set.mock.calls.length, 1);
    assert.equal(memory.set.mock.calls[0].arguments[0], 'last_morning_brief');
  });

  it('getOutputSchema returns coachingMessageSchema', () => {
    const brief = new MorningBrief();
    const schema = brief.getOutputSchema();
    assert.ok(schema.properties.should_send);
    assert.ok(schema.properties.text);
    assert.equal(schema.required[0], 'should_send');
  });

  it('validate parses valid JSON output', async () => {
    const brief = new MorningBrief();
    const raw = { output: JSON.stringify({ should_send: true, text: 'Hello' }) };
    const result = await brief.validate(raw, {}, { warn: () => {} });
    assert.equal(result.should_send, true);
    assert.equal(result.text, 'Hello');
  });

  it('validate throws on invalid JSON', async () => {
    const brief = new MorningBrief();
    const raw = { output: 'not json at all' };
    await assert.rejects(
      () => brief.validate(raw, {}, { warn: () => {} }),
      /JSON/i,
    );
  });

  it('validate throws when should_send is missing', async () => {
    const brief = new MorningBrief();
    const raw = { output: JSON.stringify({ text: 'Hello' }) };
    await assert.rejects(
      () => brief.validate(raw, {}, { warn: () => {} }),
    );
  });
});
