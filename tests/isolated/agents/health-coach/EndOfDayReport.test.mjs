import { describe, it, expect } from 'vitest';

import { EndOfDayReport } from '../../../../backend/src/3_applications/agents/health-coach/assignments/EndOfDayReport.mjs';

describe('EndOfDayReport', () => {
  it('has correct static properties', () => {
    expect(EndOfDayReport.id).toBe('end-of-day-report');
    expect(typeof EndOfDayReport.description).toBe('string');
    expect(EndOfDayReport.schedule).toBe(undefined);
  });

  it('gather calls all 4 expected tools in parallel', async () => {
    const report = new EndOfDayReport();
    const calls = [];
    const mockTools = [
      { name: 'get_today_nutrition',       execute: async () => { calls.push('today_nutrition');      return { calories: 1800 }; } },
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
      'coaching_history',
      'today_nutrition',
      'weight',
      'workouts',
    ]);

    expect(gathered.todayNutrition).toBeTruthy();
    expect(gathered.weight).toBeTruthy();
    expect(gathered.workouts).toBeTruthy();
    expect(gathered.coachingHistory).toBeTruthy();
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
    expect(gathered.todayNutrition).toBeTruthy();
    expect(gathered.weight).toBeTruthy();
    expect(gathered.workouts).toBe(null);
    expect(gathered.coachingHistory).toBe(null);
  });

  it('buildPrompt focuses on tracked nutrition vs goals, not implied intake', () => {
    const report = new EndOfDayReport();
    const gathered = {
      todayNutrition:    { calories: 1800, protein: 120 },
      weight:            { current: { lbs: 183 }, trend: { sevenDay: -0.5 } },
      workouts:          { workouts: [] },
      coachingHistory:   { history: [] },
    };
    const prompt = report.buildPrompt(gathered, { serialize: () => 'mem' });
    expect(typeof prompt === 'string').toBeTruthy();
    expect(prompt.includes('1800')).toBeTruthy();
    // Should NOT include adjusted nutrition data section or reconciliation data section
    expect(!prompt.includes('## Adjusted Nutrition')).toBeTruthy();
    expect(!prompt.includes('## Reconciliation')).toBeTruthy();
    // Should instruct coach NOT to mention implied intake
    expect(prompt.includes('Do NOT mention implied intake')).toBeTruthy();
    expect(prompt.length > 100).toBeTruthy();
  });

  it('buildPrompt instructs not to mention implied intake', () => {
    const report = new EndOfDayReport();
    const gathered = {
      todayNutrition:    { calories: 1800, protein: 100 },
      weight:            null,
      workouts:          null,
      coachingHistory:   null,
    };
    const prompt = report.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('Do NOT mention implied intake')).toBeTruthy();
  });

  it('getOutputSchema returns coachingMessageSchema', () => {
    const report = new EndOfDayReport();
    const schema = report.getOutputSchema();
    expect(schema.properties.should_send).toBeTruthy();
    expect(schema.properties.text).toBeTruthy();
    expect(schema.required[0]).toBe('should_send');
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
