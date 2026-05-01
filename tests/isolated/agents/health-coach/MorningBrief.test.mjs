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

  // ---------- Compliance integration (Task 22, F-003) ----------
  //
  // The MorningBrief should call get_compliance_summary, load the user's
  // playbook for thresholds + CTA copy, and surface a "## Compliance"
  // section in the prompt when documented daily-leverage actions have
  // lapsed. Memory keys with a 7-day TTL prevent the same CTA from firing
  // every morning.

  /**
   * Build a baseline tool list with a controllable get_compliance_summary
   * stub. `summary` is what the tool returns; defaults to an "all clean"
   * summary that should NOT trip any CTA.
   */
  function makeComplianceTools({ summary, calls = [] } = {}) {
    const baseSummary = summary || {
      windowDays: 30,
      dimensions: {
        post_workout_protein: {
          logged: 30, missed: 0, untracked: 0,
          complianceRate: 1, currentStreak: 30,
          currentMissStreak: 0, currentUntrackedStreak: 0,
          longestGap: 0,
        },
        daily_strength_micro: {
          logged: 30, untracked: 0, avgReps: 8,
          currentStreak: 30, currentUntrackedStreak: 0, longestGap: 0,
        },
        daily_note: { logged: 30, untracked: 0, complianceRate: 1 },
      },
    };
    return [
      ...makeStandardTools(),
      {
        name: 'get_compliance_summary',
        execute: async (params) => {
          calls.push(params);
          return baseSummary;
        },
      },
    ];
  }

  /**
   * Build a memory mock that supports get/set with TTL semantics for testing.
   * Pre-populated keys can be supplied; sets are tracked in `setCalls`.
   */
  function makeMemory({ initial = {}, setCalls = [] } = {}) {
    const store = new Map();
    for (const [k, v] of Object.entries(initial)) store.set(k, v);
    return {
      get: (key) => store.get(key),
      set: (key, value, opts) => {
        setCalls.push([key, value, opts]);
        store.set(key, value);
      },
      serialize: () => '',
    };
  }

  it('gather: calls get_compliance_summary', async () => {
    const brief = new MorningBrief();
    const calls = [];
    const tools = makeComplianceTools({ calls });
    const personalContextLoader = { loadPlaybook: async () => null };

    await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });

    expect(calls.length).toBe(1);
    expect(calls[0].userId).toBe('test-user');
  });

  it('gather: triggers protein CTA when current missed streak >= playbook threshold', async () => {
    const brief = new MorningBrief();
    const summary = {
      windowDays: 30,
      dimensions: {
        post_workout_protein: {
          logged: 27, missed: 3, untracked: 0,
          complianceRate: 0.9, currentStreak: 0,
          currentMissStreak: 3, currentUntrackedStreak: 0, longestGap: 3,
        },
        daily_strength_micro: {
          logged: 30, untracked: 0, avgReps: 8,
          currentStreak: 30, currentUntrackedStreak: 0, longestGap: 0,
        },
        daily_note: { logged: 30, untracked: 0, complianceRate: 1 },
      },
    };
    const tools = makeComplianceTools({ summary });
    const personalContextLoader = {
      loadPlaybook: async () => ({
        coaching_thresholds: {
          post_workout_protein: {
            consecutive_misses_trigger: 3,
            cta_text: 'Three days without the post-workout shake — re-anchor tomorrow.',
          },
        },
      }),
    };

    const gathered = await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });

    expect(Array.isArray(gathered.complianceCtas)).toBe(true);
    expect(gathered.complianceCtas.length).toBe(1);
    expect(gathered.complianceCtas[0].dimension).toBe('post_workout_protein');
    expect(gathered.complianceCtas[0].message).toMatch(/post-workout shake/);
  });

  it('gather: triggers strength CTA when untracked run >= playbook threshold', async () => {
    const brief = new MorningBrief();
    const summary = {
      windowDays: 30,
      dimensions: {
        post_workout_protein: {
          logged: 30, missed: 0, untracked: 0,
          complianceRate: 1, currentStreak: 30,
          currentMissStreak: 0, currentUntrackedStreak: 0, longestGap: 0,
        },
        daily_strength_micro: {
          logged: 25, untracked: 5, avgReps: 8,
          currentStreak: 0, currentUntrackedStreak: 5, longestGap: 0,
        },
        daily_note: { logged: 30, untracked: 0, complianceRate: 1 },
      },
    };
    const tools = makeComplianceTools({ summary });
    const personalContextLoader = {
      loadPlaybook: async () => ({
        coaching_thresholds: {
          daily_strength_micro: {
            untracked_run_trigger: 5,
            cta_text: '5+ days without the daily pull-up drill — daily-frequency exposure is the lever.',
          },
        },
      }),
    };

    const gathered = await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });

    expect(gathered.complianceCtas.length).toBe(1);
    expect(gathered.complianceCtas[0].dimension).toBe('daily_strength_micro');
    expect(gathered.complianceCtas[0].message).toMatch(/pull-up drill/);
  });

  it('gather: does NOT trigger when streaks/gaps are below threshold', async () => {
    const brief = new MorningBrief();
    const summary = {
      windowDays: 30,
      dimensions: {
        post_workout_protein: {
          logged: 28, missed: 2, untracked: 0,
          complianceRate: 0.93, currentStreak: 0,
          currentMissStreak: 2, currentUntrackedStreak: 0, longestGap: 2,
        },
        daily_strength_micro: {
          logged: 26, untracked: 4, avgReps: 8,
          currentStreak: 0, currentUntrackedStreak: 4, longestGap: 0,
        },
        daily_note: { logged: 30, untracked: 0, complianceRate: 1 },
      },
    };
    const tools = makeComplianceTools({ summary });
    const personalContextLoader = {
      loadPlaybook: async () => ({
        coaching_thresholds: {
          post_workout_protein: { consecutive_misses_trigger: 3, cta_text: 'protein cta' },
          daily_strength_micro: { untracked_run_trigger: 5, cta_text: 'strength cta' },
        },
      }),
    };

    const gathered = await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });

    expect(gathered.complianceCtas).toEqual([]);
  });

  it('gather: uses default thresholds when playbook lacks coaching_thresholds section', async () => {
    const brief = new MorningBrief();
    // Defaults are protein=3, strength=5. Both are crossed here.
    const summary = {
      windowDays: 30,
      dimensions: {
        post_workout_protein: {
          logged: 27, missed: 3, untracked: 0,
          complianceRate: 0.9, currentStreak: 0,
          currentMissStreak: 3, currentUntrackedStreak: 0, longestGap: 3,
        },
        daily_strength_micro: {
          logged: 25, untracked: 5, avgReps: 8,
          currentStreak: 0, currentUntrackedStreak: 5, longestGap: 0,
        },
        daily_note: { logged: 30, untracked: 0, complianceRate: 1 },
      },
    };
    const tools = makeComplianceTools({ summary });
    // Playbook exists but has no coaching_thresholds section.
    const personalContextLoader = {
      loadPlaybook: async () => ({ profile: { goal_context: 'cut' } }),
    };

    const gathered = await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });

    expect(gathered.complianceCtas.length).toBe(2);
    const dims = gathered.complianceCtas.map(c => c.dimension).sort();
    expect(dims).toEqual(['daily_strength_micro', 'post_workout_protein']);
    // Default CTA text references the dimension name so the brief still
    // surfaces something useful.
    for (const cta of gathered.complianceCtas) {
      expect(cta.message.length).toBeGreaterThan(0);
    }
  });

  it('buildPrompt: includes "## Compliance" section with the CTAs when triggered', () => {
    const brief = new MorningBrief();
    const gathered = {
      reconciliation: {}, weight: {}, goals: {}, todayNutrition: {},
      nutritionHistory: { days: [] }, yesterdayClosed: false,
      similarPeriod: null,
      complianceCtas: [
        { dimension: 'post_workout_protein', message: 'Three days without the shake — re-anchor.' },
        { dimension: 'daily_strength_micro', message: '5+ days without the pull-up drill.' },
      ],
    };
    const prompt = brief.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('## Compliance')).toBe(true);
    expect(prompt.includes('post_workout_protein')).toBe(true);
    expect(prompt.includes('daily_strength_micro')).toBe(true);
    expect(prompt.includes('re-anchor')).toBe(true);
    expect(prompt.includes('pull-up drill')).toBe(true);
    // Section appears before the Instructions block
    expect(prompt.indexOf('## Compliance')).toBeLessThan(prompt.indexOf('## Instructions'));
  });

  it('buildPrompt: does NOT include the section when no CTAs', () => {
    const brief = new MorningBrief();
    const gathered = {
      reconciliation: {}, weight: {}, goals: {}, todayNutrition: {},
      nutritionHistory: { days: [] }, yesterdayClosed: false,
      similarPeriod: null,
      complianceCtas: [],
    };
    const prompt = brief.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('## Compliance')).toBe(false);
  });

  it('gather: gracefully handles get_compliance_summary throwing or returning error', async () => {
    const brief = new MorningBrief();
    const personalContextLoader = { loadPlaybook: async () => null };

    // Case A: tool throws
    const throwingTools = [
      ...makeStandardTools(),
      { name: 'get_compliance_summary', execute: async () => { throw new Error('compliance boom'); } },
    ];
    const gatheredA = await brief.gather({
      tools: throwingTools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });
    expect(gatheredA.complianceCtas).toEqual([]);

    // Case B: tool returns structured error
    const erroringTools = [
      ...makeStandardTools(),
      { name: 'get_compliance_summary', execute: async () => ({ error: 'no health data', dimensions: null }) },
    ];
    const gatheredB = await brief.gather({
      tools: erroringTools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });
    expect(gatheredB.complianceCtas).toEqual([]);

    // Case C: tool not registered (no get_compliance_summary at all)
    const noTool = [...makeStandardTools()];
    const gatheredC = await brief.gather({
      tools: noTool,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });
    expect(gatheredC.complianceCtas).toEqual([]);
  });

  it('gather: writes a 7-day TTL memory key when CTA fires (compliance_<dim>_last_flagged)', async () => {
    const brief = new MorningBrief();
    const summary = {
      windowDays: 30,
      dimensions: {
        post_workout_protein: {
          logged: 27, missed: 3, untracked: 0,
          complianceRate: 0.9, currentStreak: 0,
          currentMissStreak: 3, currentUntrackedStreak: 0, longestGap: 3,
        },
        daily_strength_micro: {
          logged: 30, untracked: 0, avgReps: 8,
          currentStreak: 30, currentUntrackedStreak: 0, longestGap: 0,
        },
        daily_note: { logged: 30, untracked: 0, complianceRate: 1 },
      },
    };
    const tools = makeComplianceTools({ summary });
    const personalContextLoader = { loadPlaybook: async () => null };
    const setCalls = [];
    const memory = makeMemory({ setCalls });

    await brief.gather({
      tools,
      userId: 'test-user',
      memory,
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });

    const flaggedCalls = setCalls.filter(([k]) => k === 'compliance_post_workout_protein_last_flagged');
    expect(flaggedCalls.length).toBe(1);
    const opts = flaggedCalls[0][2];
    expect(opts?.ttl).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('gather: does NOT re-fire the CTA when the working-memory TTL key is still active', async () => {
    const brief = new MorningBrief();
    const summary = {
      windowDays: 30,
      dimensions: {
        post_workout_protein: {
          logged: 27, missed: 3, untracked: 0,
          complianceRate: 0.9, currentStreak: 0,
          currentMissStreak: 3, currentUntrackedStreak: 0, longestGap: 3,
        },
        daily_strength_micro: {
          logged: 30, untracked: 0, avgReps: 8,
          currentStreak: 30, currentUntrackedStreak: 0, longestGap: 0,
        },
        daily_note: { logged: 30, untracked: 0, complianceRate: 1 },
      },
    };
    const tools = makeComplianceTools({ summary });
    const personalContextLoader = { loadPlaybook: async () => null };
    // Pre-populate the TTL key so the CTA should be suppressed.
    const memory = makeMemory({
      initial: { compliance_post_workout_protein_last_flagged: '2026-04-30T10:00:00Z' },
    });

    const gathered = await brief.gather({
      tools,
      userId: 'test-user',
      memory,
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader },
    });

    expect(gathered.complianceCtas).toEqual([]);
  });

  // ---------- PatternDetector integration (Task 24, F-004) ----------
  //
  // The MorningBrief should pull 30-day windows (nutrition, weight, workouts,
  // compliance) and pass them through PatternDetector along with the user's
  // playbook patterns. Detections are filtered against working memory (7-day
  // TTL key per pattern name) so the same flag doesn't fire daily, then
  // surfaced under a "## Detected Patterns" section in the prompt.
  //
  // The 30-day query tools (query_historical_*) are already wired into the
  // tools array as of Task 15. The compliance tool (get_compliance_summary)
  // is wired as of Task 21. The PatternDetector is injected via
  // `context.patternDetector`.

  /**
   * Build a baseline tool list with controllable 30-day window stubs and a
   * compliance-summary stub. Tracks each tool's invocation params in `calls`.
   */
  function makePatternTools({
    weightRows = null,
    nutritionDays = null,
    workouts = null,
    compliance = null,
    calls = {},
  } = {}) {
    calls.weight = [];
    calls.nutrition = [];
    calls.workouts = [];
    calls.compliance = [];
    return [
      ...makeStandardTools(),
      {
        name: 'query_historical_weight',
        execute: async (p) => {
          calls.weight.push(p);
          return { aggregation: p.aggregation || 'daily', rows: weightRows ?? [] };
        },
      },
      {
        name: 'query_historical_nutrition',
        execute: async (p) => {
          calls.nutrition.push(p);
          return { days: nutritionDays ?? [] };
        },
      },
      {
        name: 'query_historical_workouts',
        execute: async (p) => {
          calls.workouts.push(p);
          return { workouts: workouts ?? [] };
        },
      },
      {
        name: 'get_compliance_summary',
        execute: async (p) => {
          calls.compliance.push(p);
          return compliance ?? {
            windowDays: 30,
            dimensions: {
              post_workout_protein: {
                logged: 30, missed: 0, untracked: 0,
                complianceRate: 1, currentStreak: 30,
                currentMissStreak: 0, currentUntrackedStreak: 0,
                longestGap: 0,
              },
              daily_strength_micro: {
                logged: 30, untracked: 0, avgReps: 8,
                currentStreak: 30, currentUntrackedStreak: 0, longestGap: 0,
              },
              daily_note: { logged: 30, untracked: 0, complianceRate: 1 },
            },
          };
        },
      },
    ];
  }

  it('gather: collects 30-day windows from longitudinal tools (weight/nutrition/workouts) and compliance', async () => {
    const brief = new MorningBrief();
    const calls = {};
    const tools = makePatternTools({ calls });
    // Playbook MUST have at least one pattern so the gather() path doesn't
    // short-circuit before fetching the 30-day windows.
    const personalContextLoader = {
      loadPlaybook: async () => ({ patterns: [{ name: 'cut-mode' }] }),
    };
    const patternDetector = { detect: () => [] };

    await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader, patternDetector },
    });

    expect(calls.weight.length).toBe(1);
    expect(calls.nutrition.length).toBe(1);
    expect(calls.workouts.length).toBe(1);
    // Compliance is called once by the F-003 path and once by the F-004 path.
    // Either is fine — but at least one call must hit it.
    expect(calls.compliance.length).toBeGreaterThanOrEqual(1);
    // Each window query covers a 30-day span ending today.
    const today = new Date().toISOString().split('T')[0];
    const expectedFrom = new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0];
    expect(calls.weight[0].userId).toBe('test-user');
    expect(calls.weight[0].from).toBe(expectedFrom);
    expect(calls.weight[0].to).toBe(today);
    expect(calls.nutrition[0].from).toBe(expectedFrom);
    expect(calls.nutrition[0].to).toBe(today);
    expect(calls.workouts[0].from).toBe(expectedFrom);
    expect(calls.workouts[0].to).toBe(today);
  });

  it('gather: invokes patternDetector.detect with the windows and playbook patterns', async () => {
    const brief = new MorningBrief();
    const tools = makePatternTools({
      weightRows: [{ date: '2026-04-15', lbs: 185, count: 1 }],
      nutritionDays: [{ date: '2026-04-15', calories: 1700, protein: 150 }],
      workouts: [{ date: '2026-04-15', type: 'run', title: 'Easy run' }],
    });
    const playbook = {
      patterns: [
        { name: 'cut-mode', type: 'success', detection: {}, severity: 'low' },
        { name: 'if-trap-risk', type: 'risk', detection: {}, severity: 'medium' },
      ],
    };
    const personalContextLoader = { loadPlaybook: async () => playbook };
    const detectCalls = [];
    const patternDetector = {
      detect: (args) => {
        detectCalls.push(args);
        return [];
      },
    };

    await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader, patternDetector },
    });

    expect(detectCalls.length).toBe(1);
    const arg = detectCalls[0];
    expect(arg.windows).toBeTruthy();
    expect(Array.isArray(arg.windows.nutrition)).toBe(true);
    expect(Array.isArray(arg.windows.workouts)).toBe(true);
    expect(Array.isArray(arg.windows.weight)).toBe(true);
    expect(arg.windows.nutrition.length).toBe(1);
    expect(arg.windows.workouts.length).toBe(1);
    expect(arg.windows.weight.length).toBe(1);
    expect(arg.windows.compliance).toBeTruthy();
    expect(arg.playbookPatterns).toEqual(playbook.patterns);
    expect(arg.userGoals).toBeTruthy();
  });

  it('gather: returns detectedPatterns in the gathered output', async () => {
    const brief = new MorningBrief();
    const tools = makePatternTools();
    const personalContextLoader = {
      loadPlaybook: async () => ({ patterns: [{ name: 'cut-mode', type: 'success' }] }),
    };
    const patternDetector = {
      detect: () => [
        {
          name: 'cut-mode',
          type: 'success',
          confidence: 0.85,
          evidence: { protein_avg_g: 155, calorie_avg: 1700, weight_delta_14d_lbs: -1.2 },
          recommendation: 'Stay on this protocol',
          memoryKey: 'pattern_cut-mode_last_flagged',
          severity: 'low',
        },
      ],
    };

    const gathered = await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader, patternDetector },
    });

    expect(Array.isArray(gathered.detectedPatterns)).toBe(true);
    expect(gathered.detectedPatterns.length).toBe(1);
    expect(gathered.detectedPatterns[0].name).toBe('cut-mode');
  });

  it('buildPrompt: includes "## Detected Patterns" section when patterns found', () => {
    const brief = new MorningBrief();
    const gathered = {
      reconciliation: {}, weight: {}, goals: {}, todayNutrition: {},
      nutritionHistory: { days: [] }, yesterdayClosed: false,
      similarPeriod: null,
      complianceCtas: [],
      detectedPatterns: [
        {
          name: 'if-trap-risk',
          type: 'risk',
          confidence: 0.78,
          evidence: { protein_avg_g: 92, breakfast_skipped_days_7d: 5 },
          recommendation: 'Move first food before 11am',
          memoryKey: 'pattern_if-trap-risk_last_flagged',
          severity: 'high',
        },
      ],
    };
    const prompt = brief.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('## Detected Patterns')).toBe(true);
    expect(prompt.includes('if-trap-risk')).toBe(true);
    expect(prompt.includes('high')).toBe(true);
    expect(prompt.includes('0.78')).toBe(true);
    expect(prompt.includes('Move first food before 11am')).toBe(true);
    // Section appears before the Instructions block
    expect(prompt.indexOf('## Detected Patterns')).toBeLessThan(prompt.indexOf('## Instructions'));
  });

  it('buildPrompt: omits the "## Detected Patterns" section when no patterns', () => {
    const brief = new MorningBrief();
    const gathered = {
      reconciliation: {}, weight: {}, goals: {}, todayNutrition: {},
      nutritionHistory: { days: [] }, yesterdayClosed: false,
      similarPeriod: null,
      complianceCtas: [],
      detectedPatterns: [],
    };
    const prompt = brief.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('## Detected Patterns')).toBe(false);
  });

  it('gather: writes 7-day TTL memory keys (pattern_<name>_last_flagged) for each detection', async () => {
    const brief = new MorningBrief();
    const tools = makePatternTools();
    const personalContextLoader = {
      loadPlaybook: async () => ({ patterns: [{ name: 'cut-mode' }, { name: 'if-trap-risk' }] }),
    };
    const patternDetector = {
      detect: () => [
        {
          name: 'cut-mode', type: 'success', confidence: 0.9, evidence: {},
          recommendation: 'r1', memoryKey: 'pattern_cut-mode_last_flagged', severity: 'low',
        },
        {
          name: 'if-trap-risk', type: 'risk', confidence: 0.7, evidence: {},
          recommendation: 'r2', memoryKey: 'pattern_if-trap-risk_last_flagged', severity: 'medium',
        },
      ],
    };
    const setCalls = [];
    const memory = makeMemory({ setCalls });

    await brief.gather({
      tools,
      userId: 'test-user',
      memory,
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader, patternDetector },
    });

    const cutSets = setCalls.filter(([k]) => k === 'pattern_cut-mode_last_flagged');
    const ifSets = setCalls.filter(([k]) => k === 'pattern_if-trap-risk_last_flagged');
    expect(cutSets.length).toBe(1);
    expect(ifSets.length).toBe(1);
    expect(cutSets[0][2]?.ttl).toBe(7 * 24 * 60 * 60 * 1000);
    expect(ifSets[0][2]?.ttl).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('gather: filters out detections that have an active TTL key (deduped within 7 days)', async () => {
    const brief = new MorningBrief();
    const tools = makePatternTools();
    const personalContextLoader = {
      loadPlaybook: async () => ({ patterns: [{ name: 'cut-mode' }, { name: 'if-trap-risk' }] }),
    };
    const patternDetector = {
      detect: () => [
        {
          name: 'cut-mode', type: 'success', confidence: 0.9, evidence: {},
          recommendation: 'r1', memoryKey: 'pattern_cut-mode_last_flagged', severity: 'low',
        },
        {
          name: 'if-trap-risk', type: 'risk', confidence: 0.7, evidence: {},
          recommendation: 'r2', memoryKey: 'pattern_if-trap-risk_last_flagged', severity: 'medium',
        },
      ],
    };
    // Pre-populate the cut-mode TTL key so it should be suppressed.
    const memory = makeMemory({
      initial: { 'pattern_cut-mode_last_flagged': '2026-04-30T10:00:00Z' },
    });

    const gathered = await brief.gather({
      tools,
      userId: 'test-user',
      memory,
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader, patternDetector },
    });

    expect(gathered.detectedPatterns.length).toBe(1);
    expect(gathered.detectedPatterns[0].name).toBe('if-trap-risk');
  });

  it('gather: gracefully handles patternDetector.detect throwing — returns empty detections, logs warn', async () => {
    const brief = new MorningBrief();
    const tools = makePatternTools();
    const personalContextLoader = {
      loadPlaybook: async () => ({ patterns: [{ name: 'cut-mode' }] }),
    };
    const patternDetector = {
      detect: () => { throw new Error('detector boom'); },
    };
    const warnCalls = [];
    const logger = {
      info: () => {},
      warn: (event, data) => warnCalls.push([event, data]),
    };

    const gathered = await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger,
      context: { personalContextLoader, patternDetector },
    });

    expect(gathered.detectedPatterns).toEqual([]);
    const errorWarn = warnCalls.find(([e]) => e === 'morning_brief.pattern_detector.error');
    expect(errorWarn).toBeTruthy();
  });

  it('gather: gracefully handles missing playbook (no patterns to evaluate, no detections)', async () => {
    const brief = new MorningBrief();
    const tools = makePatternTools();
    const personalContextLoader = { loadPlaybook: async () => null };
    const detectCalls = [];
    const patternDetector = {
      detect: (args) => { detectCalls.push(args); return []; },
    };

    const gathered = await brief.gather({
      tools,
      userId: 'test-user',
      memory: makeMemory(),
      logger: { info: () => {}, warn: () => {} },
      context: { personalContextLoader, patternDetector },
    });

    expect(gathered.detectedPatterns).toEqual([]);
    // The detector should NOT be invoked when there are no playbook patterns
    // (nothing to evaluate against) — saves a no-op call.
    expect(detectCalls.length).toBe(0);
  });

  it('buildPrompt: detected patterns are sorted by severity (high → medium → low) before being rendered', () => {
    const brief = new MorningBrief();
    const gathered = {
      reconciliation: {}, weight: {}, goals: {}, todayNutrition: {},
      nutritionHistory: { days: [] }, yesterdayClosed: false,
      similarPeriod: null,
      complianceCtas: [],
      detectedPatterns: [
        {
          name: 'low-sev', type: 'success', confidence: 0.9, evidence: {},
          recommendation: 'r-low', memoryKey: 'pattern_low-sev_last_flagged', severity: 'low',
        },
        {
          name: 'high-sev', type: 'risk', confidence: 0.6, evidence: {},
          recommendation: 'r-high', memoryKey: 'pattern_high-sev_last_flagged', severity: 'high',
        },
        {
          name: 'med-sev', type: 'risk', confidence: 0.7, evidence: {},
          recommendation: 'r-med', memoryKey: 'pattern_med-sev_last_flagged', severity: 'medium',
        },
      ],
    };
    const prompt = brief.buildPrompt(gathered, { serialize: () => '' });
    const idxHigh = prompt.indexOf('high-sev');
    const idxMed = prompt.indexOf('med-sev');
    const idxLow = prompt.indexOf('low-sev');
    expect(idxHigh).toBeGreaterThan(-1);
    expect(idxMed).toBeGreaterThan(-1);
    expect(idxLow).toBeGreaterThan(-1);
    expect(idxHigh).toBeLessThan(idxMed);
    expect(idxMed).toBeLessThan(idxLow);
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
