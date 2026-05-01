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

  // ---------- find_similar_period integration (Task 17, F-105.2) ----------

  /**
   * Build a 7-day nutrition history with controllable per-day overrides.
   * Used for asserting average-based detection over the weekly window.
   */
  function buildHistory(overrides = {}) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(Date.now() - (6 - i) * 86400000).toISOString().split('T')[0];
      days.push({
        date,
        calories: overrides.calories?.[i] ?? 1700,
        protein: overrides.protein?.[i] ?? 150,
      });
    }
    return { days };
  }

  /**
   * Build a 14-day weight history (matching the 14-day window WeeklyDigest pulls).
   */
  function buildWeightHistory(values) {
    const history = [];
    for (let i = 0; i < values.length; i++) {
      const date = new Date(Date.now() - (values.length - 1 - i) * 86400000).toISOString().split('T')[0];
      history.push({ date, lbs: values[i] });
    }
    return history;
  }

  function makeStandardTools(extras = {}) {
    const weightHistory = extras.weightHistory ?? buildWeightHistory([
      183.0, 183.5, 184.0, 184.2, 184.5, 184.8, 185.0,
      185.2, 185.5, 185.7, 185.8, 185.9, 186.0, 186.2,
    ]);
    return [
      { name: 'get_reconciliation_summary', execute: async () => ({ avgAccuracy: 0.7, days: [] }) },
      { name: 'get_weight_trend', execute: async (params) => {
        // 14 vs 84 day calls — both return the same shape for these tests
        return {
          current: { lbs: weightHistory[weightHistory.length - 1].lbs },
          history: weightHistory,
          trend: { sevenDay: 0.4, fourteenDay: 1.2 },
        };
      } },
      { name: 'get_user_goals', execute: async () => ({
        goals: { nutrition: { calories_min: 1400, calories_max: 1800, protein_min: 140 } },
      }) },
      { name: 'get_nutrition_history', execute: async () => extras.history ?? buildHistory() },
      ...(extras.findSimilarPeriod
        ? [{ name: 'find_similar_period', execute: extras.findSimilarPeriod }]
        : []),
    ];
  }

  it('gather: detects sustained 7-day calorie surplus and calls find_similar_period', async () => {
    const digest = new WeeklyDigest();
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
    // 7-day average calories ~2000, above calories_max of 1800
    const history = buildHistory({ calories: [2000, 1950, 2050, 2000, 2100, 1950, 2000] });
    const mockTools = makeStandardTools({ history, findSimilarPeriod });

    const gathered = await digest.gather({
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
    // Calorie average should reflect the surplus we built
    expect(sig.calorie_avg).toBeGreaterThan(1800);
    expect(gathered.similarPeriod).toBeTruthy();
    expect(gathered.similarPeriod.name).toBe('cut-2025-q4');
  });

  it('gather: detects sustained 7-day protein shortfall and calls find_similar_period', async () => {
    const digest = new WeeklyDigest();
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
    // 7-day average protein ~110g, below protein_min of 140g
    const history = buildHistory({ protein: [105, 110, 115, 100, 120, 105, 115] });
    const mockTools = makeStandardTools({ history, findSimilarPeriod });

    const gathered = await digest.gather({
      tools: mockTools,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });

    expect(fspCalls.length).toBe(1);
    expect(gathered.similarPeriod).toBeTruthy();
    expect(gathered.similarPeriod.name).toBe('low-protein-spring');
    const sig = fspCalls[0].pattern_signature;
    expect(sig.protein_avg_g).toBeLessThan(140);
  });

  it('gather: does NOT call find_similar_period when trends are within target', async () => {
    const digest = new WeeklyDigest();
    const fspCalls = [];
    const findSimilarPeriod = async (params) => {
      fspCalls.push(params);
      return { matches: [{ name: 'should-not-be-called', score: 1, period: {} }] };
    };
    // Calorie avg 1700 (under 1800 max) and protein avg 150 (above 140 min)
    const history = buildHistory({
      calories: [1700, 1650, 1750, 1700, 1750, 1700, 1700],
      protein: [150, 155, 145, 150, 160, 145, 150],
    });
    const mockTools = makeStandardTools({ history, findSimilarPeriod });

    const gathered = await digest.gather({
      tools: mockTools,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });

    expect(fspCalls.length).toBe(0);
    expect(gathered.similarPeriod).toBe(null);
  });

  it('buildPrompt: includes a "## Similar Period" section when a match was returned', () => {
    const digest = new WeeklyDigest();
    const gathered = {
      reconciliation: {},
      weight: {},
      weightLongTerm: {},
      nutritionHistory: { days: [] },
      goals: {},
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
    const prompt = digest.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('## Similar Period')).toBe(true);
    expect(prompt.includes('cut-2025-q4')).toBe(true);
    expect(prompt.includes('2025-10-01')).toBe(true);
    expect(prompt.includes('2025-10-31')).toBe(true);
    expect(prompt.includes('aggressive cut')).toBe(true);
    // Section appears before the Instructions block
    expect(prompt.indexOf('## Similar Period')).toBeLessThan(prompt.indexOf('## Instructions'));
  });

  it('buildPrompt: omits the section when no match', () => {
    const digest = new WeeklyDigest();
    const gathered = {
      reconciliation: {},
      weight: {},
      weightLongTerm: {},
      nutritionHistory: { days: [] },
      goals: {},
      similarPeriod: null,
    };
    const prompt = digest.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('## Similar Period')).toBe(false);
  });

  it('gather: gracefully handles tool throw / missing match / tool unregistered', async () => {
    const digest = new WeeklyDigest();
    const surplusHistory = buildHistory({ calories: [2000, 1950, 2050, 2000, 2100, 1950, 2000] });

    // Case A: throws
    const throwingFsp = async () => { throw new Error('boom'); };
    const toolsA = makeStandardTools({ history: surplusHistory, findSimilarPeriod: throwingFsp });
    const gatheredA = await digest.gather({
      tools: toolsA,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });
    expect(gatheredA.similarPeriod).toBe(null);

    // Case B: returns no matches
    const emptyFsp = async () => ({ matches: [] });
    const toolsB = makeStandardTools({ history: surplusHistory, findSimilarPeriod: emptyFsp });
    const gatheredB = await digest.gather({
      tools: toolsB,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });
    expect(gatheredB.similarPeriod).toBe(null);

    // Case C: tool not registered
    const toolsC = makeStandardTools({ history: surplusHistory });
    const gatheredC = await digest.gather({
      tools: toolsC,
      userId: 'test-user',
      memory: { serialize: () => '' },
      logger: { info: () => {}, warn: () => {} },
    });
    expect(gatheredC.similarPeriod).toBe(null);
  });
});
