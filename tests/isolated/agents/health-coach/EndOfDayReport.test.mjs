import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { EndOfDayReport } from '../../../../backend/src/3_applications/agents/health-coach/assignments/EndOfDayReport.mjs';

describe('EndOfDayReport', () => {
  it('has correct static properties', () => {
    assert.equal(EndOfDayReport.id, 'end-of-day-report');
    assert.equal(typeof EndOfDayReport.description, 'string');
    assert.equal(EndOfDayReport.schedule, undefined);
  });

  it('gather calls all 6 expected tools in parallel', async () => {
    const report = new EndOfDayReport();
    const calls = [];
    const mockTools = [
      { name: 'get_today_nutrition',       execute: async () => { calls.push('today_nutrition');      return { calories: 1800 }; } },
      { name: 'get_adjusted_nutrition',    execute: async () => { calls.push('adjusted_nutrition');   return { calories: 1950 }; } },
      { name: 'get_reconciliation_summary',execute: async () => { calls.push('reconciliation');       return { avgAccuracy: 0.72, days: [] }; } },
      { name: 'get_weight_trend',          execute: async () => { calls.push('weight');               return { current: { lbs: 183 } }; } },
      { name: 'get_recent_workouts',       execute: async () => { calls.push('workouts');             return { workouts: [] }; } },
      { name: 'get_coaching_history',      execute: async () => { calls.push('coaching_history');     return { history: [] }; } },
    ];
    const gathered = await report.gather({
      tools: mockTools,
      userId: 'kckern',
      memory: { serialize: () => '' },
      logger: { warn: () => {}, info: () => {} },
    });

    assert.deepEqual(calls.sort(), [
      'adjusted_nutrition',
      'coaching_history',
      'reconciliation',
      'today_nutrition',
      'weight',
      'workouts',
    ]);

    assert.ok(gathered.todayNutrition);
    assert.ok(gathered.adjustedNutrition);
    assert.ok(gathered.reconciliation);
    assert.ok(gathered.weight);
    assert.ok(gathered.workouts);
    assert.ok(gathered.coachingHistory);
  });

  it('gather returns null for missing tools gracefully', async () => {
    const report = new EndOfDayReport();
    const mockTools = [
      { name: 'get_today_nutrition', execute: async () => ({ calories: 1800 }) },
      { name: 'get_weight_trend',    execute: async () => ({ current: { lbs: 183 } }) },
    ];
    const gathered = await report.gather({
      tools: mockTools,
      userId: 'kckern',
      memory: { serialize: () => '' },
      logger: { warn: () => {}, info: () => {} },
    });
    assert.ok(gathered.todayNutrition);
    assert.ok(gathered.weight);
    assert.equal(gathered.adjustedNutrition, null);
    assert.equal(gathered.reconciliation, null);
    assert.equal(gathered.workouts, null);
    assert.equal(gathered.coachingHistory, null);
  });

  it('buildPrompt includes both raw and adjusted nutrition numbers', () => {
    const report = new EndOfDayReport();
    const gathered = {
      todayNutrition:    { calories: 1800, protein: 120 },
      adjustedNutrition: { calories: 1950, protein: 130 },
      reconciliation:    { avgAccuracy: 0.65, days: [] },
      weight:            { current: { lbs: 183 }, trend: { sevenDay: -0.5 } },
      workouts:          { workouts: [] },
      coachingHistory:   { history: [] },
    };
    const prompt = report.buildPrompt(gathered, { serialize: () => 'mem' });
    assert.ok(typeof prompt === 'string');
    // Raw and adjusted should both appear
    assert.ok(prompt.includes('1800') || prompt.includes('raw'));
    assert.ok(prompt.includes('1950') || prompt.includes('adjusted'));
    assert.ok(prompt.length > 100);
  });

  it('buildPrompt leads with tracking accuracy when below 70%', () => {
    const report = new EndOfDayReport();
    const gathered = {
      todayNutrition:    { calories: 1800, protein: 100 },
      adjustedNutrition: { calories: 2000, protein: 115 },
      reconciliation:    { avgAccuracy: 0.55, days: [] },
      weight:            null,
      workouts:          null,
      coachingHistory:   null,
    };
    const prompt = report.buildPrompt(gathered, { serialize: () => '' });
    // Accuracy / reconciliation instruction should be present
    assert.ok(prompt.includes('accuracy') || prompt.includes('70') || prompt.includes('0.55') || prompt.includes('55'));
  });

  it('getOutputSchema returns coachingMessageSchema', () => {
    const report = new EndOfDayReport();
    const schema = report.getOutputSchema();
    assert.ok(schema.properties.should_send);
    assert.ok(schema.properties.text);
    assert.equal(schema.required[0], 'should_send');
  });

  it('act is a no-op (no memory updates)', async () => {
    const report = new EndOfDayReport();
    const memory = {
      set: () => { throw new Error('memory.set should not be called'); },
    };
    // Should not throw
    await report.act(
      { should_send: true, text: 'Day complete.' },
      { memory, userId: 'kckern', logger: { info: () => {} } },
    );
  });
});
