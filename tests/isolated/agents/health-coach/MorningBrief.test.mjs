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

  // ---------- find_similar_period integration (Task 16, F-105.1) ----------

  /**
   * Build a 7-day nutrition history with controllable per-day overrides.
   * Day 0 is 6 days ago; day 6 is "today" (the trailing edge for streak detection).
   */
  function buildHistory(overrides = {}) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(Date.now() - (6 - i) * 86400000).toISOString().split('T')[0];
      days.push({
        date,
        calories: overrides.calories?.[i] ?? 1800,
        protein: overrides.protein?.[i] ?? 150,
      });
    }
    return { days };
  }

  function makeStandardTools(extras = {}) {
    return [
      { name: 'get_reconciliation_summary', execute: async () => ({ avgAccuracy: 0.6, days: [] }) },
      { name: 'get_weight_trend', execute: async () => ({
        current: { lbs: 185 },
        history: [
          { date: '2026-04-25', lbs: 184.0 },
          { date: '2026-04-26', lbs: 184.5 },
          { date: '2026-04-27', lbs: 184.8 },
          { date: '2026-04-28', lbs: 185.2 },
          { date: '2026-04-29', lbs: 185.4 },
          { date: '2026-04-30', lbs: 185.6 },
          { date: '2026-05-01', lbs: 186.0 },
        ],
      }) },
      { name: 'get_user_goals', execute: async () => ({
        goals: { nutrition: { calories_min: 1400, calories_max: 1800, protein_min: 140 } },
      }) },
      { name: 'get_today_nutrition', execute: async () => ({ logged: true }) },
      { name: 'get_nutrition_history', execute: async () => extras.history ?? buildHistory() },
      { name: 'is_day_closed', execute: async () => ({ closed: false }) },
      ...(extras.findSimilarPeriod
        ? [{ name: 'find_similar_period', execute: extras.findSimilarPeriod }]
        : []),
    ];
  }

  it('gather: detects 3-day calorie-surplus streak and calls find_similar_period', async () => {
    const brief = new MorningBrief();
    const fspCalls = [];
    const findSimilarPeriod = async (params) => {
      fspCalls.push(params);
      return {
        matches: [{
          name: 'cut-2025-q4',
          score: 0.82,
          period: { name: 'cut-2025-q4', from: '2025-10-01', to: '2025-10-31', description: 'aggressive cut', stats: { weight_avg_lbs: 188, protein_avg_g: 160, calorie_avg: 1700, tracking_rate: 0.95 } },
        }],
      };
    };
    // Last 3 days over calorie max (1800)
    const history = buildHistory({ calories: [1700, 1700, 1700, 1700, 2100, 2200, 2050] });
    const mockTools = makeStandardTools({ history, findSimilarPeriod });

    const gathered = await brief.gather({
      tools: mockTools,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });

    expect(fspCalls.length).toBe(1);
    expect(fspCalls[0].userId).toBe('test-user');
    expect(fspCalls[0].max_results).toBe(1);
    expect(typeof fspCalls[0].pattern_signature).toBe('object');
    const sig = fspCalls[0].pattern_signature;
    expect(typeof sig.weight_avg_lbs).toBe('number');
    expect(typeof sig.weight_delta_lbs).toBe('number');
    expect(typeof sig.protein_avg_g).toBe('number');
    expect(typeof sig.calorie_avg).toBe('number');
    expect(typeof sig.tracking_rate).toBe('number');
    expect(gathered.similarPeriod).toBeTruthy();
    expect(gathered.similarPeriod.name).toBe('cut-2025-q4');
  });

  it('gather: detects 3-day protein-shortfall streak and calls find_similar_period', async () => {
    const brief = new MorningBrief();
    const fspCalls = [];
    const findSimilarPeriod = async (params) => {
      fspCalls.push(params);
      return {
        matches: [{
          name: 'low-protein-spring',
          score: 0.71,
          period: { name: 'low-protein-spring', from: '2025-04-01', to: '2025-04-21', description: 'protein dipped during travel', stats: { weight_avg_lbs: 184, protein_avg_g: 110, calorie_avg: 1900, tracking_rate: 0.85 } },
        }],
      };
    };
    // Last 3 days under protein min (140)
    const history = buildHistory({ protein: [150, 150, 150, 150, 100, 95, 110] });
    const mockTools = makeStandardTools({ history, findSimilarPeriod });

    const gathered = await brief.gather({
      tools: mockTools,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });

    expect(fspCalls.length).toBe(1);
    expect(gathered.similarPeriod).toBeTruthy();
    expect(gathered.similarPeriod.name).toBe('low-protein-spring');
  });

  it('gather: does NOT call find_similar_period when no notable signal present', async () => {
    const brief = new MorningBrief();
    const fspCalls = [];
    const findSimilarPeriod = async (params) => {
      fspCalls.push(params);
      return { matches: [{ name: 'should-not-be-called', score: 1, period: {} }] };
    };
    // All days within bounds — no streak
    const history = buildHistory({ calories: [1600, 1650, 1700, 1700, 1750, 1700, 1650], protein: [150, 155, 160, 145, 150, 155, 160] });
    const mockTools = makeStandardTools({ history, findSimilarPeriod });

    const gathered = await brief.gather({
      tools: mockTools,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });

    expect(fspCalls.length).toBe(0);
    expect(gathered.similarPeriod).toBe(null);
  });

  it('buildPrompt: includes a "## Similar Period" section when a match was returned', () => {
    const brief = new MorningBrief();
    const gathered = {
      reconciliation: {},
      weight: {},
      goals: {},
      todayNutrition: {},
      nutritionHistory: { days: [] },
      yesterdayClosed: false,
      similarPeriod: {
        name: 'cut-2025-q4',
        score: 0.82,
        period: {
          name: 'cut-2025-q4',
          from: '2025-10-01',
          to: '2025-10-31',
          description: 'aggressive cut',
          stats: { weight_avg_lbs: 188, protein_avg_g: 160, calorie_avg: 1700, tracking_rate: 0.95 },
        },
      },
    };
    const prompt = brief.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('## Similar Period')).toBe(true);
    expect(prompt.includes('cut-2025-q4')).toBe(true);
    expect(prompt.includes('2025-10-01')).toBe(true);
    expect(prompt.includes('2025-10-31')).toBe(true);
    expect(prompt.includes('aggressive cut')).toBe(true);
    // Section appears before the Instructions block
    expect(prompt.indexOf('## Similar Period')).toBeLessThan(prompt.indexOf('## Instructions'));
  });

  it('buildPrompt: does NOT include the section when no match', () => {
    const brief = new MorningBrief();
    const gathered = {
      reconciliation: {},
      weight: {},
      goals: {},
      todayNutrition: {},
      nutritionHistory: { days: [] },
      yesterdayClosed: false,
      similarPeriod: null,
    };
    const prompt = brief.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('## Similar Period')).toBe(false);
  });

  it('gather: gracefully handles find_similar_period throwing or returning empty matches', async () => {
    const brief = new MorningBrief();

    // Case A: throws
    const throwingFsp = async () => { throw new Error('boom'); };
    const history = buildHistory({ calories: [1700, 1700, 1700, 1700, 2100, 2200, 2050] });
    const toolsA = makeStandardTools({ history, findSimilarPeriod: throwingFsp });
    const gatheredA = await brief.gather({
      tools: toolsA,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });
    expect(gatheredA.similarPeriod).toBe(null);

    // Case B: returns no matches
    const emptyFsp = async () => ({ matches: [] });
    const toolsB = makeStandardTools({ history, findSimilarPeriod: emptyFsp });
    const gatheredB = await brief.gather({
      tools: toolsB,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });
    expect(gatheredB.similarPeriod).toBe(null);

    // Case C: tool not registered (regression guard — no find_similar_period in tool list)
    const toolsC = makeStandardTools({ history }); // no findSimilarPeriod key
    const gatheredC = await brief.gather({
      tools: toolsC,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });
    expect(gatheredC.similarPeriod).toBe(null);
  });
});
