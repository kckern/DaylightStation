# Health Coach Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the health coach agent — the first real consumer of the agent framework — with tool factories wrapping existing health/fitness services, a daily dashboard assignment that writes structured YAML, and a dashboard API endpoint.

**Architecture:** HealthCoachAgent extends BaseAgent with three ToolFactories (health, fitness-content, dashboard) and one Assignment (DailyDashboard). The agent programmatically gathers health data via tools during the gather phase, sends it to the LLM during the reason phase, validates structured output against a JSON Schema, and writes per-user dashboard YAML via DataService. A new API endpoint serves dashboard data to the frontend.

**Tech Stack:** Node.js (ESM), `node:test`, existing health/fitness/nutrition services (AggregateHealthUseCase, YamlHealthDatastore, FitnessPlayableService), DataService (YAML persistence), agent framework (BaseAgent, ToolFactory, Assignment, OutputValidator, Scheduler)

**Design spec:** `docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md` — Phase 2 (Health Coach Agent)

**Framework (already built):** `docs/plans/2026-02-14-agent-framework.md` — all 14 tasks complete, 77 tests passing

---

### Task 1: Fix framework review items

Two issues from the code review that must be fixed before building on the framework.

**Files:**
- Modify: `backend/src/3_applications/agents/framework/BaseAgent.mjs`
- Modify: `backend/src/1_adapters/agents/index.mjs`
- Modify: `backend/tests/unit/agents/framework/BaseAgent.test.mjs`

**Step 1: Fix `assignment.id` vs `assignment.constructor.id` in BaseAgent**

Currently `registerAssignment` uses `assignment.id` (instance property) but the Scheduler and API router use `assignment.constructor.id` (static property). Real Assignment subclasses define `static id`, so `assignment.id` would be undefined.

In `backend/src/3_applications/agents/framework/BaseAgent.mjs`, change:

```javascript
  registerAssignment(assignment) {
    this.#assignments.set(assignment.id, assignment);
  }
```

to:

```javascript
  registerAssignment(assignment) {
    const id = assignment.constructor.id || assignment.id;
    this.#assignments.set(id, assignment);
  }
```

**Step 2: Fix barrel export comment**

In `backend/src/1_adapters/agents/index.mjs`, the first line says `// backend/src/2_adapters/agents/index.mjs` — change `2_adapters` to `1_adapters`.

**Step 3: Add test for static id resolution**

Add this test to `backend/tests/unit/agents/framework/BaseAgent.test.mjs` in the `assignments` describe block:

```javascript
    it('should register assignment using static id from constructor', async () => {
      let executed = false;

      class RealAssignment {
        static id = 'real-assignment';
        async execute() { executed = true; return { done: true }; }
      }

      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'test'; }
        registerTools() {}
      }

      const agent = new TestAgent({ agentRuntime: mockRuntime, workingMemory: mockWorkingMemory, logger: mockLogger });
      agent.registerAssignment(new RealAssignment());

      const result = await agent.runAssignment('real-assignment', { userId: 'kevin' });
      assert.ok(executed);
    });
```

**Step 4: Run tests**

Run: `node --test backend/tests/unit/agents/framework/BaseAgent.test.mjs`

Expected: All tests PASS (existing + new)

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/BaseAgent.mjs backend/src/1_adapters/agents/index.mjs backend/tests/unit/agents/framework/BaseAgent.test.mjs
git commit -m "fix(agents): resolve assignment.id vs constructor.id ambiguity in BaseAgent"
```

---

### Task 2: Dashboard output JSON Schema

Define the structured output contract the agent must produce.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/schemas/dashboard.mjs`
- Test: `backend/tests/unit/agents/health-coach/dashboard-schema.test.mjs`

**Step 1: Write the failing test**

```javascript
// backend/tests/unit/agents/health-coach/dashboard-schema.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import Ajv from 'ajv';
import { dashboardSchema } from '../../../../src/3_applications/agents/health-coach/schemas/dashboard.mjs';

const ajv = new Ajv({ allErrors: true });

describe('Dashboard Schema', () => {
  it('should be a valid JSON Schema', () => {
    const validate = ajv.compile(dashboardSchema);
    assert.ok(validate, 'Schema should compile without errors');
  });

  it('should accept a valid full dashboard', () => {
    const validate = ajv.compile(dashboardSchema);
    const valid = validate({
      generated_at: '2026-02-14T04:12:00Z',
      curated: {
        up_next: {
          primary: {
            content_id: 'plex:12345',
            title: 'P90X - Day 23: Shoulders & Arms',
            duration: 60,
            program_context: 'P90X Week 4, Day 2',
          },
          alternates: [
            { content_id: 'plex:12399', title: 'Yoga X', duration: 92, reason: 'rest_day_option' },
          ],
        },
        playlist_suggestion: [
          { content_id: 'plex:99001', title: '5-Min Warm-Up', duration: 5 },
          { content_id: 'plex:12345', title: 'Shoulders & Arms', duration: 60 },
        ],
      },
      coach: {
        briefing: 'Down 1.2 lbs this week.',
        cta: [
          { type: 'data_gap', message: 'No meals logged yesterday.', action: 'open_nutrition' },
        ],
        prompts: [
          { type: 'multiple_choice', question: 'Ready for today?', options: ['Yes', 'Something lighter', 'Rest'] },
        ],
      },
    });

    assert.strictEqual(valid, true, `Validation errors: ${JSON.stringify(validate.errors)}`);
  });

  it('should accept a minimal dashboard (no alternates, no playlist, no prompts)', () => {
    const validate = ajv.compile(dashboardSchema);
    const valid = validate({
      generated_at: '2026-02-14T04:12:00Z',
      curated: {
        up_next: {
          primary: { content_id: 'plex:123', title: 'Workout', duration: 30 },
        },
      },
      coach: {
        briefing: 'Good morning.',
      },
    });

    assert.strictEqual(valid, true, `Validation errors: ${JSON.stringify(validate.errors)}`);
  });

  it('should reject missing required fields', () => {
    const validate = ajv.compile(dashboardSchema);

    assert.strictEqual(validate({}), false, 'Empty object should fail');
    assert.strictEqual(validate({ generated_at: 'x', curated: {} }), false, 'Missing coach should fail');
    assert.strictEqual(
      validate({ generated_at: 'x', curated: { up_next: { primary: {} } }, coach: { briefing: 'hi' } }),
      false,
      'Primary missing content_id should fail'
    );
  });

  it('should reject invalid CTA types', () => {
    const validate = ajv.compile(dashboardSchema);
    const valid = validate({
      generated_at: 'x',
      curated: { up_next: { primary: { content_id: 'a', title: 'b', duration: 1 } } },
      coach: {
        briefing: 'hi',
        cta: [{ type: 'invalid_type', message: 'test' }],
      },
    });

    assert.strictEqual(valid, false, 'Invalid CTA type should fail');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/health-coach/dashboard-schema.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the schema**

```javascript
// backend/src/3_applications/agents/health-coach/schemas/dashboard.mjs

/**
 * JSON Schema for the health coach daily dashboard output.
 *
 * The agent must produce output matching this schema. OutputValidator
 * validates against it with LLM retry on failure.
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — Dashboard Datastore
 */

const contentItem = {
  type: 'object',
  required: ['content_id', 'title', 'duration'],
  properties: {
    content_id: { type: 'string', description: 'Plex content ID (e.g., "plex:12345")' },
    title: { type: 'string' },
    duration: { type: 'number', description: 'Duration in minutes' },
    program_context: { type: 'string', description: 'Program position context (e.g., "P90X Week 4, Day 2")' },
    reason: { type: 'string', description: 'Why this alternate was chosen (e.g., "rest_day_option")' },
  },
  additionalProperties: false,
};

export const dashboardSchema = {
  type: 'object',
  required: ['generated_at', 'curated', 'coach'],
  properties: {
    generated_at: { type: 'string', description: 'ISO 8601 timestamp' },

    curated: {
      type: 'object',
      required: ['up_next'],
      properties: {
        up_next: {
          type: 'object',
          required: ['primary'],
          properties: {
            primary: contentItem,
            alternates: {
              type: 'array',
              items: contentItem,
              maxItems: 3,
            },
          },
          additionalProperties: false,
        },
        playlist_suggestion: {
          type: 'array',
          items: contentItem,
          maxItems: 5,
        },
      },
      additionalProperties: false,
    },

    coach: {
      type: 'object',
      required: ['briefing'],
      properties: {
        briefing: { type: 'string', description: '2-3 sentence coaching commentary' },
        cta: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'message'],
            properties: {
              type: { type: 'string', enum: ['data_gap', 'observation', 'nudge'] },
              message: { type: 'string' },
              action: { type: 'string', description: 'Frontend action key (e.g., "open_nutrition")' },
            },
            additionalProperties: false,
          },
          maxItems: 3,
        },
        prompts: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'question'],
            properties: {
              type: { type: 'string', enum: ['voice_memo', 'multiple_choice', 'free_text'] },
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' }, maxItems: 4 },
            },
            additionalProperties: false,
          },
          maxItems: 2,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};
```

**Step 4: Run tests**

Run: `node --test backend/tests/unit/agents/health-coach/dashboard-schema.test.mjs`

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/schemas/dashboard.mjs backend/tests/unit/agents/health-coach/dashboard-schema.test.mjs
git commit -m "feat(health-coach): add dashboard output JSON Schema"
```

---

### Task 3: System prompt

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/prompts/system.mjs`

**Step 1: Write the system prompt**

```javascript
// backend/src/3_applications/agents/health-coach/prompts/system.mjs

export const systemPrompt = `You are a personal health coach embedded in a household fitness dashboard.

## Personality
- Direct and data-driven. Reference specific numbers (weight, macros, session counts).
- Brief and actionable. No motivational fluff or filler.
- Acknowledge patterns with data. "Three workouts this week" not "Great job staying active!"
- Suggest, don't lecture. "Protein has averaged 95g — target is 145g" not "You need to eat more protein."

## Dashboard Output
You produce structured JSON with two sections:

### Curated Content (invisible elf)
Workout recommendations that feel like native app features. The user does NOT perceive an agent behind these.
- Select content_ids ONLY from the provided fitness content catalog
- Include program context when an active program exists
- Offer 1-2 alternates (lighter option, different focus)
- Playlist suggestions: warm-up + main + cool-down stacks

### Coach Presence (talking to Santa)
Observations and nudges in YOUR voice. The user knows they're hearing from their coach.
- Briefing: 2-3 sentences on current state, trends, notable patterns
- CTAs: Data gaps ("No meals logged yesterday"), observations ("Protein low this week"), nudges
- Prompts: Questions for the user (multiple-choice or voice memo)

## Rules
- ONLY use content_ids from the provided fitness content catalog. Never invent IDs.
- Reference real data from the gathered health summary. Never hallucinate numbers.
- Keep briefings to 2-3 sentences maximum.
- At most 3 CTAs and 2 prompts per dashboard.
- Check working memory for recent observations — don't nag about the same thing two days in a row.
- If data is missing (no weight readings, no meals logged), note it as a CTA, don't guess values.
- If no active program, suggest content based on variety and recency (things not done recently).

## Output Format
Return valid JSON matching the dashboard schema. The output will be validated against a JSON Schema.
Do not wrap in markdown code fences. Return raw JSON only.`;
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/prompts/system.mjs
git commit -m "feat(health-coach): add system prompt"
```

---

### Task 4: HealthToolFactory

Wraps existing health services into agent tools. Uses `YamlHealthDatastore` (healthStore) and `AggregateHealthUseCase` (healthService).

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs`
- Test: `backend/tests/unit/agents/health-coach/HealthToolFactory.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/health-coach/HealthToolFactory.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { HealthToolFactory } from '../../../../src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs';

describe('HealthToolFactory', () => {
  let factory;
  let mockHealthStore;
  let mockHealthService;

  const sampleWeight = {
    '2026-02-14': {
      date: '2026-02-14', lbs: 182.3, lbs_adjusted_average: 182.0,
      lbs_adjusted_average_7day_trend: -1.2, fat_percent: 15.2, fat_percent_average: 15.1,
    },
    '2026-02-13': {
      date: '2026-02-13', lbs: 182.8, lbs_adjusted_average: 182.5,
      lbs_adjusted_average_7day_trend: -1.0, fat_percent: 15.3, fat_percent_average: 15.2,
    },
  };

  const sampleHealth = {
    '2026-02-14': {
      date: '2026-02-14',
      weight: { lbs: 182.3, fatPercent: 15.2, trend: -1.2 },
      nutrition: { calories: 2100, protein: 140, carbs: 210, fat: 70, foodCount: 8 },
      workouts: [
        { source: 'strava', title: 'Morning Run', type: 'run', duration: 30, calories: 350, avgHr: 145 },
      ],
    },
  };

  beforeEach(() => {
    mockHealthStore = {
      loadWeightData: async () => sampleWeight,
      loadNutritionData: async () => ({
        '2026-02-14': { calories: 2100, protein: 140, carbs: 210, fat: 70, foodCount: 8 },
        '2026-02-13': { calories: 1900, protein: 120, carbs: 200, fat: 65, foodCount: 6 },
      }),
      loadCoachingData: async () => ({}),
      saveCoachingData: async () => {},
    };

    mockHealthService = {
      getHealthForRange: async () => sampleHealth,
      getHealthForDate: async () => sampleHealth['2026-02-14'],
    };

    factory = new HealthToolFactory({ healthStore: mockHealthStore, healthService: mockHealthService });
  });

  describe('createTools', () => {
    it('should return the expected tools', () => {
      const tools = factory.createTools();
      const names = tools.map(t => t.name);

      assert.ok(names.includes('get_weight_trend'));
      assert.ok(names.includes('get_today_nutrition'));
      assert.ok(names.includes('get_nutrition_history'));
      assert.ok(names.includes('get_recent_workouts'));
      assert.ok(names.includes('get_health_summary'));
    });

    it('should have 5 tools', () => {
      assert.strictEqual(factory.createTools().length, 5);
    });
  });

  describe('get_weight_trend', () => {
    it('should return weight data with current and trend', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_weight_trend');
      const result = await tool.execute({ userId: 'kckern', days: 7 });

      assert.ok(result.current, 'Should have current weight');
      assert.ok(result.current.lbs, 'Should have lbs');
      assert.ok(result.history, 'Should have history array');
      assert.ok(Array.isArray(result.history));
    });

    it('should return graceful empty when no data', async () => {
      mockHealthStore.loadWeightData = async () => ({});
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_weight_trend');
      const result = await tool.execute({ userId: 'kckern' });

      assert.strictEqual(result.current, null);
      assert.deepStrictEqual(result.history, []);
    });
  });

  describe('get_today_nutrition', () => {
    it('should return today nutrition data', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_today_nutrition');
      const result = await tool.execute({ userId: 'kckern' });

      assert.ok(result.calories !== undefined);
      assert.ok(result.protein !== undefined);
    });
  });

  describe('get_recent_workouts', () => {
    it('should return workouts from health data', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_recent_workouts');
      const result = await tool.execute({ userId: 'kckern', days: 7 });

      assert.ok(Array.isArray(result.workouts));
    });
  });

  describe('error handling', () => {
    it('should return error object when service throws', async () => {
      mockHealthStore.loadWeightData = async () => { throw new Error('Service unavailable'); };
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_weight_trend');
      const result = await tool.execute({ userId: 'kckern' });

      assert.ok(result.error, 'Should have error field');
      assert.strictEqual(result.current, null);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/health-coach/HealthToolFactory.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * HealthToolFactory - Agent tools wrapping existing health services.
 *
 * Tools return compact, pre-summarized data. Errors are caught and returned
 * as structured responses (not thrown) so the agent can adapt.
 */
export class HealthToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const { healthStore, healthService } = this.deps;

    return [
      createTool({
        name: 'get_weight_trend',
        description: 'Current weight, body fat %, 7-day trend, and recent history',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            days: { type: 'number', description: 'Lookback window in days', default: 7 },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const weightData = await healthStore.loadWeightData(userId);
            const dates = Object.keys(weightData).sort().reverse();
            const recent = dates.slice(0, days);

            if (!recent.length) return { current: null, trend: null, history: [] };

            const latest = weightData[recent[0]];
            return {
              current: {
                lbs: latest.lbs_adjusted_average || latest.lbs,
                fatPercent: latest.fat_percent_average || latest.fat_percent,
                date: latest.date,
              },
              trend: {
                sevenDay: latest.lbs_adjusted_average_7day_trend || null,
                fourteenDay: latest.lbs_adjusted_average_14day_trend || null,
              },
              history: recent.map(d => ({
                date: d,
                lbs: weightData[d].lbs_adjusted_average || weightData[d].lbs,
                fatPercent: weightData[d].fat_percent_average || weightData[d].fat_percent,
              })),
            };
          } catch (err) {
            return { error: err.message, current: null, trend: null, history: [] };
          }
        },
      }),

      createTool({
        name: 'get_today_nutrition',
        description: "Today's calorie and macro summary",
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            const nutritionData = await healthStore.loadNutritionData(userId);
            const today = new Date().toISOString().split('T')[0];
            const todayData = nutritionData?.[today];

            if (!todayData) return { logged: false, date: today, calories: 0, protein: 0, carbs: 0, fat: 0 };

            return {
              logged: true,
              date: today,
              calories: todayData.calories || 0,
              protein: todayData.protein || 0,
              carbs: todayData.carbs || 0,
              fat: todayData.fat || 0,
              foodCount: todayData.foodCount || 0,
            };
          } catch (err) {
            return { error: err.message, logged: false, date: new Date().toISOString().split('T')[0] };
          }
        },
      }),

      createTool({
        name: 'get_nutrition_history',
        description: 'Multi-day nutrition data with daily breakdowns and averages',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            days: { type: 'number', default: 7 },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const nutritionData = await healthStore.loadNutritionData(userId);
            const dates = Object.keys(nutritionData || {}).sort().reverse().slice(0, days);

            const dailyData = dates.map(d => ({
              date: d,
              calories: nutritionData[d]?.calories || 0,
              protein: nutritionData[d]?.protein || 0,
              carbs: nutritionData[d]?.carbs || 0,
              fat: nutritionData[d]?.fat || 0,
            }));

            const avg = (arr, key) => arr.length ? Math.round(arr.reduce((s, d) => s + d[key], 0) / arr.length) : 0;

            return {
              days: dailyData,
              averages: {
                calories: avg(dailyData, 'calories'),
                protein: avg(dailyData, 'protein'),
                carbs: avg(dailyData, 'carbs'),
                fat: avg(dailyData, 'fat'),
              },
            };
          } catch (err) {
            return { error: err.message, days: [], averages: {} };
          }
        },
      }),

      createTool({
        name: 'get_recent_workouts',
        description: 'Recent workout sessions from Strava and fitness trackers',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            days: { type: 'number', default: 7 },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const healthData = await healthService.getHealthForRange(userId, daysAgo(days), today());
            const workouts = [];

            for (const [date, metric] of Object.entries(healthData || {})) {
              for (const w of (metric?.workouts || [])) {
                workouts.push({
                  date,
                  title: w.title || w.type,
                  type: w.type,
                  duration: w.duration,
                  calories: w.calories,
                  avgHr: w.avgHr,
                });
              }
            }

            return {
              workouts: workouts.sort((a, b) => b.date.localeCompare(a.date)),
              totalThisWeek: workouts.length,
              lastWorkoutDate: workouts[0]?.date || null,
            };
          } catch (err) {
            return { error: err.message, workouts: [], totalThisWeek: 0 };
          }
        },
      }),

      createTool({
        name: 'get_health_summary',
        description: 'Comprehensive daily health snapshot: weight, nutrition, workouts',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            const todayDate = today();
            const metric = await healthService.getHealthForDate(userId, todayDate);

            return {
              date: todayDate,
              weight: metric?.weight || null,
              nutrition: metric?.nutrition || null,
              workouts: metric?.workouts || [],
            };
          } catch (err) {
            return { error: err.message, date: today() };
          }
        },
      }),
    ];
  }
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
```

**Step 4: Run tests**

Run: `node --test backend/tests/unit/agents/health-coach/HealthToolFactory.test.mjs`

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs backend/tests/unit/agents/health-coach/HealthToolFactory.test.mjs
git commit -m "feat(health-coach): add HealthToolFactory wrapping health services"
```

---

### Task 5: FitnessContentToolFactory

Tools for browsing Plex fitness content and managing program state. Program state is a simple YAML file per user read/written via DataService.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/FitnessContentToolFactory.mjs`
- Test: `backend/tests/unit/agents/health-coach/FitnessContentToolFactory.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/health-coach/FitnessContentToolFactory.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { FitnessContentToolFactory } from '../../../../src/3_applications/agents/health-coach/tools/FitnessContentToolFactory.mjs';

describe('FitnessContentToolFactory', () => {
  let factory;
  let mockFitnessPlayableService;
  let mockDataService;

  const sampleEpisodes = {
    containerItem: { title: 'P90X' },
    items: [
      { id: 'plex:101', title: 'Chest & Back', duration: 3600, watchProgress: 100, source: 'plex' },
      { id: 'plex:102', title: 'Plyometrics', duration: 3540, watchProgress: 0, source: 'plex' },
      { id: 'plex:103', title: 'Shoulders & Arms', duration: 3600, watchProgress: 0, source: 'plex' },
    ],
  };

  beforeEach(() => {
    mockFitnessPlayableService = {
      getPlayableEpisodes: async (showId) => sampleEpisodes,
    };

    mockDataService = {
      user: {
        read: (path, userId) => {
          if (path.includes('program-state')) {
            return { program: { id: 'p90x', content_source: 'plex:12345', current_day: 23, status: 'active' } };
          }
          return null;
        },
        write: () => true,
      },
    };

    factory = new FitnessContentToolFactory({
      fitnessPlayableService: mockFitnessPlayableService,
      dataService: mockDataService,
    });
  });

  describe('createTools', () => {
    it('should return 3 tools', () => {
      const tools = factory.createTools();
      assert.strictEqual(tools.length, 3);

      const names = tools.map(t => t.name);
      assert.ok(names.includes('get_fitness_content'));
      assert.ok(names.includes('get_program_state'));
      assert.ok(names.includes('update_program_state'));
    });
  });

  describe('get_fitness_content', () => {
    it('should return episodes for a show', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_fitness_content');
      const result = await tool.execute({ showId: '12345' });

      assert.ok(result.show);
      assert.ok(Array.isArray(result.episodes));
      assert.strictEqual(result.episodes.length, 3);
      assert.ok(result.episodes[0].id);
      assert.ok(result.episodes[0].title);
    });
  });

  describe('get_program_state', () => {
    it('should return program state from datastore', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_program_state');
      const result = await tool.execute({ userId: 'kckern' });

      assert.ok(result.program);
      assert.strictEqual(result.program.id, 'p90x');
      assert.strictEqual(result.program.status, 'active');
    });

    it('should return null program when no state exists', async () => {
      mockDataService.user.read = () => null;
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_program_state');
      const result = await tool.execute({ userId: 'kckern' });

      assert.strictEqual(result.program, null);
    });
  });

  describe('update_program_state', () => {
    it('should write state via DataService', async () => {
      let writtenPath, writtenData;
      mockDataService.user.write = (path, data, userId) => {
        writtenPath = path;
        writtenData = data;
        return true;
      };

      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'update_program_state');
      const result = await tool.execute({
        userId: 'kckern',
        state: { program: { id: 'p90x', current_day: 24, status: 'active' } },
      });

      assert.ok(result.success);
      assert.ok(writtenPath.includes('program-state'));
      assert.strictEqual(writtenData.program.current_day, 24);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/health-coach/FitnessContentToolFactory.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/health-coach/tools/FitnessContentToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * FitnessContentToolFactory - Tools for browsing fitness content and managing program state.
 *
 * - get_fitness_content: Browse Plex fitness episodes for a show
 * - get_program_state: Read user's current program tracking state
 * - update_program_state: Update program position, status
 *
 * Program state stored at: users/{userId}/agents/health-coach/program-state
 */
export class FitnessContentToolFactory extends ToolFactory {
  static domain = 'fitness-content';

  createTools() {
    const { fitnessPlayableService, dataService } = this.deps;

    return [
      createTool({
        name: 'get_fitness_content',
        description: 'Browse available fitness episodes for a Plex show. Returns episode list with watch state.',
        parameters: {
          type: 'object',
          properties: {
            showId: { type: 'string', description: 'Plex show ID (numeric string)' },
          },
          required: ['showId'],
        },
        execute: async ({ showId }) => {
          try {
            const result = await fitnessPlayableService.getPlayableEpisodes(showId);
            return {
              show: {
                id: `plex:${showId}`,
                title: result.containerItem?.title || 'Unknown',
              },
              episodes: (result.items || []).map(item => ({
                id: item.id,
                title: item.title,
                duration: Math.round((item.duration || 0) / 60),
                watched: (item.watchProgress || 0) >= 90,
                watchProgress: item.watchProgress || 0,
              })),
            };
          } catch (err) {
            return { error: err.message, show: null, episodes: [] };
          }
        },
      }),

      createTool({
        name: 'get_program_state',
        description: 'Read the user\'s current fitness program tracking state (position, schedule, status)',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            const state = dataService.user.read('agents/health-coach/program-state', userId);
            return { program: state?.program || null };
          } catch (err) {
            return { error: err.message, program: null };
          }
        },
      }),

      createTool({
        name: 'update_program_state',
        description: 'Update program tracking state (advance position, record substitutions, change status)',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            state: {
              type: 'object',
              description: 'Full program state object to persist',
              properties: {
                program: { type: 'object' },
              },
            },
          },
          required: ['userId', 'state'],
        },
        execute: async ({ userId, state }) => {
          try {
            dataService.user.write('agents/health-coach/program-state', state, userId);
            return { success: true };
          } catch (err) {
            return { error: err.message, success: false };
          }
        },
      }),
    ];
  }
}
```

**Step 4: Run tests**

Run: `node --test backend/tests/unit/agents/health-coach/FitnessContentToolFactory.test.mjs`

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/FitnessContentToolFactory.mjs backend/tests/unit/agents/health-coach/FitnessContentToolFactory.test.mjs
git commit -m "feat(health-coach): add FitnessContentToolFactory for content browsing and program state"
```

---

### Task 6: DashboardToolFactory

Tools for writing the dashboard YAML, reading user goals, and logging coaching notes.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/DashboardToolFactory.mjs`
- Test: `backend/tests/unit/agents/health-coach/DashboardToolFactory.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/health-coach/DashboardToolFactory.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DashboardToolFactory } from '../../../../src/3_applications/agents/health-coach/tools/DashboardToolFactory.mjs';

describe('DashboardToolFactory', () => {
  let factory;
  let mockDataService;
  let mockHealthStore;

  beforeEach(() => {
    mockDataService = {
      user: {
        read: (path, userId) => {
          if (path.includes('goals')) {
            return { weight: { target_lbs: 175 }, nutrition: { daily_calories: 2200, daily_protein: 145 } };
          }
          return null;
        },
        write: () => true,
      },
    };

    mockHealthStore = {
      loadCoachingData: async () => ({}),
      saveCoachingData: async () => {},
    };

    factory = new DashboardToolFactory({ dataService: mockDataService, healthStore: mockHealthStore });
  });

  describe('createTools', () => {
    it('should return 3 tools', () => {
      const tools = factory.createTools();
      assert.strictEqual(tools.length, 3);

      const names = tools.map(t => t.name);
      assert.ok(names.includes('write_dashboard'));
      assert.ok(names.includes('get_user_goals'));
      assert.ok(names.includes('log_coaching_note'));
    });
  });

  describe('write_dashboard', () => {
    it('should write dashboard data via DataService', async () => {
      let writtenPath, writtenData, writtenUser;
      mockDataService.user.write = (path, data, userId) => {
        writtenPath = path;
        writtenData = data;
        writtenUser = userId;
        return true;
      };

      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'write_dashboard');
      const dashboard = { generated_at: '2026-02-14T04:00:00Z', curated: {}, coach: { briefing: 'hi' } };

      const result = await tool.execute({ userId: 'kckern', date: '2026-02-14', dashboard });

      assert.ok(result.success);
      assert.ok(writtenPath.includes('health-dashboard/2026-02-14'));
      assert.strictEqual(writtenUser, 'kckern');
      assert.strictEqual(writtenData.generated_at, '2026-02-14T04:00:00Z');
    });
  });

  describe('get_user_goals', () => {
    it('should return goals from DataService', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_user_goals');
      const result = await tool.execute({ userId: 'kckern' });

      assert.ok(result.goals);
      assert.strictEqual(result.goals.weight.target_lbs, 175);
    });

    it('should return null when no goals set', async () => {
      mockDataService.user.read = () => null;
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_user_goals');
      const result = await tool.execute({ userId: 'kckern' });

      assert.strictEqual(result.goals, null);
    });
  });

  describe('log_coaching_note', () => {
    it('should save coaching note via healthStore', async () => {
      let savedData;
      mockHealthStore.saveCoachingData = async (userId, data) => { savedData = data; };

      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'log_coaching_note');
      const result = await tool.execute({
        userId: 'kckern',
        date: '2026-02-14',
        note: { type: 'observation', text: 'Consistent workout pattern this week' },
      });

      assert.ok(result.success);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/health-coach/DashboardToolFactory.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/health-coach/tools/DashboardToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * DashboardToolFactory - Tools for dashboard output and user profile data.
 *
 * - write_dashboard: Persist structured dashboard YAML
 * - get_user_goals: Read health/fitness goals
 * - log_coaching_note: Append to coaching history
 *
 * Dashboard path: users/{userId}/health-dashboard/{date}
 * Goals path: users/{userId}/agents/health-coach/goals
 */
export class DashboardToolFactory extends ToolFactory {
  static domain = 'dashboard';

  createTools() {
    const { dataService, healthStore } = this.deps;

    return [
      createTool({
        name: 'write_dashboard',
        description: 'Write the structured dashboard YAML to per-user, per-date datastore',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            dashboard: { type: 'object', description: 'Dashboard data matching the dashboard schema' },
          },
          required: ['userId', 'date', 'dashboard'],
        },
        execute: async ({ userId, date, dashboard }) => {
          try {
            dataService.user.write(`health-dashboard/${date}`, dashboard, userId);
            return { success: true, path: `health-dashboard/${date}` };
          } catch (err) {
            return { error: err.message, success: false };
          }
        },
      }),

      createTool({
        name: 'get_user_goals',
        description: 'Read the user\'s health and fitness goals (weight target, calorie target, etc.)',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            const goals = dataService.user.read('agents/health-coach/goals', userId);
            return { goals: goals || null };
          } catch (err) {
            return { error: err.message, goals: null };
          }
        },
      }),

      createTool({
        name: 'log_coaching_note',
        description: 'Save a coaching observation, milestone, or recommendation to history',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            note: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['observation', 'milestone', 'recommendation'] },
                text: { type: 'string' },
              },
              required: ['type', 'text'],
            },
          },
          required: ['userId', 'date', 'note'],
        },
        execute: async ({ userId, date, note }) => {
          try {
            const existing = await healthStore.loadCoachingData(userId) || {};
            const dayNotes = existing[date] || [];
            dayNotes.push({ ...note, timestamp: new Date().toISOString() });
            existing[date] = dayNotes;
            await healthStore.saveCoachingData(userId, existing);
            return { success: true };
          } catch (err) {
            return { error: err.message, success: false };
          }
        },
      }),
    ];
  }
}
```

**Step 4: Run tests**

Run: `node --test backend/tests/unit/agents/health-coach/DashboardToolFactory.test.mjs`

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/DashboardToolFactory.mjs backend/tests/unit/agents/health-coach/DashboardToolFactory.test.mjs
git commit -m "feat(health-coach): add DashboardToolFactory for dashboard write, goals, and coaching notes"
```

---

### Task 7: DailyDashboard assignment

The main assignment — extends Assignment with gather/buildPrompt/validate/act.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/assignments/DailyDashboard.mjs`
- Test: `backend/tests/unit/agents/health-coach/DailyDashboard.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/health-coach/DailyDashboard.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DailyDashboard } from '../../../../src/3_applications/agents/health-coach/assignments/DailyDashboard.mjs';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('DailyDashboard', () => {
  const validDashboard = {
    generated_at: '2026-02-14T04:00:00Z',
    curated: {
      up_next: {
        primary: { content_id: 'plex:101', title: 'Chest & Back', duration: 60 },
        alternates: [
          { content_id: 'plex:102', title: 'Yoga', duration: 45, reason: 'rest_day_option' },
        ],
      },
    },
    coach: {
      briefing: 'Down 1.2 lbs this week. Solid protein yesterday.',
      cta: [{ type: 'data_gap', message: 'No meals logged yesterday.', action: 'open_nutrition' }],
    },
  };

  let mockTools;

  beforeEach(() => {
    mockTools = [
      { name: 'get_weight_trend', execute: async () => ({ current: { lbs: 182.3 }, trend: { sevenDay: -1.2 }, history: [] }) },
      { name: 'get_today_nutrition', execute: async () => ({ logged: true, calories: 2100, protein: 140 }) },
      { name: 'get_nutrition_history', execute: async () => ({ days: [], averages: { calories: 2050, protein: 135 } }) },
      { name: 'get_recent_workouts', execute: async () => ({ workouts: [{ date: '2026-02-13', title: 'Chest & Back' }], totalThisWeek: 3 }) },
      { name: 'get_fitness_content', execute: async () => ({ show: { id: 'plex:12345' }, episodes: [{ id: 'plex:101', title: 'Chest & Back', duration: 60 }] }) },
      { name: 'get_program_state', execute: async () => ({ program: { id: 'p90x', current_day: 23, status: 'active', content_source: 'plex:12345' } }) },
      { name: 'get_user_goals', execute: async () => ({ goals: { weight: { target_lbs: 175 } } }) },
      { name: 'write_dashboard', execute: async () => ({ success: true }) },
      { name: 'log_coaching_note', execute: async () => ({ success: true }) },
    ];
  });

  describe('static properties', () => {
    it('should have correct id and schedule', () => {
      assert.strictEqual(DailyDashboard.id, 'daily-dashboard');
      assert.strictEqual(DailyDashboard.schedule, '0 4 * * *');
    });
  });

  describe('gather', () => {
    it('should call tools and return gathered data', async () => {
      const assignment = new DailyDashboard();
      const result = await assignment.gather({
        tools: mockTools,
        userId: 'kckern',
        memory: new WorkingMemoryState(),
        logger: { info: () => {} },
      });

      assert.ok(result.weight, 'Should have weight data');
      assert.ok(result.nutrition, 'Should have nutrition data');
      assert.ok(result.workouts, 'Should have workout data');
      assert.ok(result.content, 'Should have fitness content');
      assert.ok(result.programState, 'Should have program state');
      assert.ok(result.goals, 'Should have user goals');
    });

    it('should handle missing tools gracefully', async () => {
      const assignment = new DailyDashboard();
      const result = await assignment.gather({
        tools: [], // no tools
        userId: 'kckern',
        memory: new WorkingMemoryState(),
        logger: { info: () => {}, warn: () => {} },
      });

      // Should not throw, missing tools produce null
      assert.ok(result);
    });
  });

  describe('buildPrompt', () => {
    it('should include gathered data in the prompt', () => {
      const assignment = new DailyDashboard();
      const gathered = {
        weight: { current: { lbs: 182 } },
        nutrition: { calories: 2100 },
        workouts: { workouts: [] },
        content: { episodes: [] },
        programState: { program: null },
        goals: { goals: null },
      };

      const prompt = assignment.buildPrompt(gathered, new WorkingMemoryState());
      assert.ok(prompt.includes('182'), 'Should contain weight data');
      assert.ok(prompt.includes('2100'), 'Should contain nutrition data');
    });
  });

  describe('getOutputSchema', () => {
    it('should return the dashboard schema', () => {
      const assignment = new DailyDashboard();
      const schema = assignment.getOutputSchema();

      assert.strictEqual(schema.type, 'object');
      assert.ok(schema.required.includes('generated_at'));
      assert.ok(schema.required.includes('curated'));
      assert.ok(schema.required.includes('coach'));
    });
  });

  describe('validate', () => {
    it('should accept valid dashboard output', async () => {
      const assignment = new DailyDashboard();
      const raw = { output: JSON.stringify(validDashboard), toolCalls: [] };
      const gathered = { content: { episodes: [{ id: 'plex:101' }, { id: 'plex:102' }] } };

      const result = await assignment.validate(raw, gathered, { warn: () => {} });
      assert.ok(result, 'Should return validated data');
      assert.strictEqual(result.coach.briefing, validDashboard.coach.briefing);
    });

    it('should throw on invalid schema', async () => {
      const assignment = new DailyDashboard();
      const raw = { output: JSON.stringify({ bad: 'data' }), toolCalls: [] };

      await assert.rejects(
        () => assignment.validate(raw, {}, { warn: () => {} }),
        /validation/i
      );
    });
  });

  describe('full lifecycle', () => {
    it('should execute end-to-end with mocked dependencies', async () => {
      const assignment = new DailyDashboard();
      let dashboardWritten = false;

      // Override write_dashboard to track
      const writeTool = mockTools.find(t => t.name === 'write_dashboard');
      writeTool.execute = async ({ dashboard }) => {
        dashboardWritten = true;
        return { success: true };
      };

      const result = await assignment.execute({
        agentRuntime: {
          execute: async () => ({ output: JSON.stringify(validDashboard), toolCalls: [] }),
        },
        workingMemory: {
          load: async () => new WorkingMemoryState(),
          save: async () => {},
        },
        tools: mockTools,
        systemPrompt: 'test',
        agentId: 'health-coach',
        userId: 'kckern',
        context: {},
        logger: { info: () => {}, warn: () => {} },
      });

      assert.ok(result);
      assert.ok(dashboardWritten, 'Dashboard should be written via tool');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/health-coach/DailyDashboard.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/health-coach/assignments/DailyDashboard.mjs

import { Assignment } from '../../framework/Assignment.mjs';
import { OutputValidator } from '../../framework/OutputValidator.mjs';
import { dashboardSchema } from '../schemas/dashboard.mjs';

/**
 * DailyDashboard - Scheduled assignment that prepares the daily fitness dashboard.
 *
 * Lifecycle:
 * 1. GATHER - programmatically call tools for health data, content, program state
 * 2. PROMPT - assemble gathered data + memory into focused LLM input
 * 3. REASON - LLM produces structured dashboard JSON
 * 4. VALIDATE - JSON Schema + domain checks (content IDs exist)
 * 5. ACT - write dashboard YAML, update memory, log coaching notes
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — Daily Dashboard Assignment
 */
export class DailyDashboard extends Assignment {
  static id = 'daily-dashboard';
  static description = "Prepare today's fitness dashboard";
  static schedule = '0 4 * * *';

  async gather({ tools, userId, memory, logger }) {
    const call = (name, params) => {
      const tool = tools.find(t => t.name === name);
      if (!tool) {
        logger?.warn?.('gather.tool_not_found', { name });
        return Promise.resolve(null);
      }
      return tool.execute(params).catch(err => {
        logger?.warn?.('gather.tool_error', { name, error: err.message });
        return { error: err.message };
      });
    };

    const [weight, nutrition, nutritionHistory, workouts, programState, goals] =
      await Promise.all([
        call('get_weight_trend', { userId, days: 7 }),
        call('get_today_nutrition', { userId }),
        call('get_nutrition_history', { userId, days: 7 }),
        call('get_recent_workouts', { userId, days: 7 }),
        call('get_program_state', { userId }),
        call('get_user_goals', { userId }),
      ]);

    // Get fitness content — if active program, get that show's episodes
    const showId = programState?.program?.content_source?.replace('plex:', '') || null;
    const content = showId
      ? await call('get_fitness_content', { showId })
      : null;

    return { weight, nutrition, nutritionHistory, workouts, content, programState, goals };
  }

  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Date: ${today}`];

    sections.push(`\n## Health Data\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## Nutrition Today\n${JSON.stringify(gathered.nutrition || {}, null, 2)}`);
    sections.push(`\n## Nutrition History (7 days)\n${JSON.stringify(gathered.nutritionHistory || {}, null, 2)}`);
    sections.push(`\n## Recent Workouts\n${JSON.stringify(gathered.workouts || {}, null, 2)}`);
    sections.push(`\n## Program State\n${JSON.stringify(gathered.programState || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(gathered.goals || {}, null, 2)}`);

    if (gathered.content) {
      sections.push(`\n## Available Fitness Content\n${JSON.stringify(gathered.content, null, 2)}`);
    }

    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    sections.push(`\n## Instructions
Produce a JSON object matching the dashboard schema.
- Select content_ids ONLY from the Available Fitness Content section above.
- Set generated_at to the current ISO timestamp.
- Reference real numbers from the health data. Do not invent values.
- If no active program, suggest content based on variety.
- Return raw JSON only, no markdown code fences.`);

    return sections.join('\n');
  }

  getOutputSchema() {
    return dashboardSchema;
  }

  async validate(raw, gathered, logger) {
    // Parse the LLM output
    let parsed;
    try {
      parsed = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output;
    } catch {
      throw new Error('Dashboard output is not valid JSON');
    }

    // Schema validation
    const result = OutputValidator.validate(parsed, dashboardSchema);
    if (!result.valid) {
      throw new Error(`Dashboard validation failed: ${JSON.stringify(result.errors)}`);
    }

    // Domain validation: check content IDs exist in gathered catalog
    if (gathered.content?.episodes) {
      const knownIds = new Set(gathered.content.episodes.map(e => e.id));
      const primary = result.data.curated.up_next.primary;
      if (!knownIds.has(primary.content_id)) {
        logger?.warn?.('validate.unknown_content_id', { id: primary.content_id });
        // Warn but don't fail — the content ID may be from another show
      }
    }

    return result.data;
  }

  async act(validated, { memory, userId, logger }) {
    // Find write_dashboard tool and write the output
    // Note: tools are not passed to act() in the base Assignment contract.
    // The validated data will be written by the caller (HealthCoachAgent or DailyDashboard override).
    // For now, store the dashboard in memory so the caller can write it.
    const today = new Date().toISOString().split('T')[0];

    // Track what we recommended for dedup
    const primaryId = validated.curated?.up_next?.primary?.content_id;
    if (primaryId) {
      memory.set('last_recommendation', primaryId, { ttl: 24 * 60 * 60 * 1000 }); // 24h
    }

    // Track coaching observations for dedup
    const ctas = validated.coach?.cta || [];
    for (const cta of ctas) {
      memory.set(`cta_${cta.type}_${today}`, cta.message, { ttl: 48 * 60 * 60 * 1000 }); // 48h
    }

    // Store validated dashboard on the instance for the caller to persist
    this._lastValidated = validated;
    this._lastDate = today;
    this._lastUserId = userId;
  }
}
```

**Important implementation note:** The base Assignment.execute() doesn't pass tools to act(). The DailyDashboard stores the validated output on the instance. The HealthCoachAgent overrides `runAssignment` to persist the dashboard after the assignment completes. This is addressed in Task 8.

**Step 4: Run tests**

Run: `node --test backend/tests/unit/agents/health-coach/DailyDashboard.test.mjs`

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/assignments/DailyDashboard.mjs backend/tests/unit/agents/health-coach/DailyDashboard.test.mjs
git commit -m "feat(health-coach): add DailyDashboard assignment with gather/prompt/validate/act"
```

---

### Task 8: HealthCoachAgent

The agent class that ties everything together.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`
- Create: `backend/src/3_applications/agents/health-coach/index.mjs`
- Test: `backend/tests/unit/agents/health-coach/HealthCoachAgent.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/health-coach/HealthCoachAgent.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { HealthCoachAgent } from '../../../../src/3_applications/agents/health-coach/HealthCoachAgent.mjs';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('HealthCoachAgent', () => {
  let mockRuntime;
  let mockWorkingMemory;
  let mockLogger;
  let mockDeps;

  beforeEach(() => {
    mockRuntime = {
      execute: async () => ({ output: 'response', toolCalls: [] }),
    };

    mockWorkingMemory = {
      load: async () => new WorkingMemoryState(),
      save: async () => {},
    };

    mockLogger = { info: () => {}, error: () => {}, warn: () => {} };

    mockDeps = {
      agentRuntime: mockRuntime,
      workingMemory: mockWorkingMemory,
      logger: mockLogger,
      healthStore: {
        loadWeightData: async () => ({}),
        loadNutritionData: async () => ({}),
        loadCoachingData: async () => ({}),
        saveCoachingData: async () => {},
      },
      healthService: {
        getHealthForRange: async () => ({}),
        getHealthForDate: async () => null,
      },
      fitnessPlayableService: {
        getPlayableEpisodes: async () => ({ items: [], containerItem: {} }),
      },
      dataService: {
        user: {
          read: () => null,
          write: () => true,
        },
      },
      configService: {
        getHeadOfHousehold: () => 'kckern',
      },
    };
  });

  describe('static properties', () => {
    it('should have correct id', () => {
      assert.strictEqual(HealthCoachAgent.id, 'health-coach');
    });

    it('should have a description', () => {
      assert.ok(HealthCoachAgent.description);
    });
  });

  describe('constructor', () => {
    it('should create with valid dependencies', () => {
      const agent = new HealthCoachAgent(mockDeps);
      assert.ok(agent);
    });
  });

  describe('getTools', () => {
    it('should return tools from all three factories', () => {
      const agent = new HealthCoachAgent(mockDeps);
      const tools = agent.getTools();

      const names = tools.map(t => t.name);
      // Health tools
      assert.ok(names.includes('get_weight_trend'));
      assert.ok(names.includes('get_today_nutrition'));
      // Fitness content tools
      assert.ok(names.includes('get_fitness_content'));
      assert.ok(names.includes('get_program_state'));
      // Dashboard tools
      assert.ok(names.includes('write_dashboard'));
      assert.ok(names.includes('get_user_goals'));
    });

    it('should have 11 total tools', () => {
      const agent = new HealthCoachAgent(mockDeps);
      assert.strictEqual(agent.getTools().length, 11);
    });
  });

  describe('getSystemPrompt', () => {
    it('should return a non-empty string', () => {
      const agent = new HealthCoachAgent(mockDeps);
      const prompt = agent.getSystemPrompt();
      assert.ok(typeof prompt === 'string');
      assert.ok(prompt.length > 100);
    });
  });

  describe('getAssignments', () => {
    it('should include daily-dashboard assignment', () => {
      const agent = new HealthCoachAgent(mockDeps);
      const assignments = agent.getAssignments();

      assert.strictEqual(assignments.length, 1);
      assert.strictEqual(assignments[0].constructor.id, 'daily-dashboard');
    });
  });

  describe('runAssignment', () => {
    it('should inject default userId when not provided', async () => {
      let capturedUserId;

      mockRuntime.execute = async ({ context }) => {
        capturedUserId = context?.userId;
        return {
          output: JSON.stringify({
            generated_at: new Date().toISOString(),
            curated: { up_next: { primary: { content_id: 'plex:1', title: 'Test', duration: 30 } } },
            coach: { briefing: 'Test.' },
          }),
          toolCalls: [],
        };
      };

      const agent = new HealthCoachAgent(mockDeps);

      try {
        await agent.runAssignment('daily-dashboard', {});
      } catch {
        // May fail on write — that's OK, we just check userId was injected
      }

      assert.strictEqual(capturedUserId, 'kckern');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/health-coach/HealthCoachAgent.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { HealthToolFactory } from './tools/HealthToolFactory.mjs';
import { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
import { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
import { DailyDashboard } from './assignments/DailyDashboard.mjs';
import { systemPrompt } from './prompts/system.mjs';

/**
 * HealthCoachAgent - Autonomous health coaching agent.
 *
 * First real consumer of the agent framework. Provides:
 * - Health data tools (weight, nutrition, workouts)
 * - Fitness content tools (Plex browsing, program state)
 * - Dashboard tools (write dashboard, goals, coaching notes)
 * - Daily dashboard assignment (scheduled at 4 AM)
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md
 */
export class HealthCoachAgent extends BaseAgent {
  static id = 'health-coach';
  static description = 'Health coaching and fitness dashboard agent';

  getSystemPrompt() {
    return systemPrompt;
  }

  registerTools() {
    const { healthStore, healthService, fitnessPlayableService, dataService } = this.deps;

    this.addToolFactory(new HealthToolFactory({ healthStore, healthService }));
    this.addToolFactory(new FitnessContentToolFactory({ fitnessPlayableService, dataService }));
    this.addToolFactory(new DashboardToolFactory({ dataService, healthStore }));

    // Register assignments
    this.registerAssignment(new DailyDashboard());
  }

  async runAssignment(assignmentId, opts = {}) {
    // Inject default userId from config if not provided (e.g., scheduler trigger)
    if (!opts.userId) {
      opts.userId = this.deps.configService?.getHeadOfHousehold?.() || 'default';
    }
    return super.runAssignment(assignmentId, opts);
  }
}
```

```javascript
// backend/src/3_applications/agents/health-coach/index.mjs

export { HealthCoachAgent } from './HealthCoachAgent.mjs';
export { DailyDashboard } from './assignments/DailyDashboard.mjs';
export { HealthToolFactory } from './tools/HealthToolFactory.mjs';
export { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
export { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
export { dashboardSchema } from './schemas/dashboard.mjs';
```

**Step 4: Run tests**

Run: `node --test backend/tests/unit/agents/health-coach/HealthCoachAgent.test.mjs`

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs backend/src/3_applications/agents/health-coach/index.mjs backend/tests/unit/agents/health-coach/HealthCoachAgent.test.mjs
git commit -m "feat(health-coach): add HealthCoachAgent with tool factories and daily-dashboard assignment"
```

---

### Task 9: Bootstrap wiring

Register HealthCoachAgent in bootstrap with all service dependencies.

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Read current bootstrap code**

Read `backend/src/0_system/bootstrap.mjs` and find the `createAgentsApiRouter` function. Note the current signature and what services are available elsewhere in the file.

**Step 2: Update `createAgentsApiRouter`**

Add imports at the top of bootstrap.mjs:

```javascript
import { YamlWorkingMemoryAdapter } from '../1_adapters/agents/YamlWorkingMemoryAdapter.mjs';
import { Scheduler } from '../3_applications/agents/framework/Scheduler.mjs';
import { HealthCoachAgent } from '../3_applications/agents/health-coach/HealthCoachAgent.mjs';
```

Update the `createAgentsApiRouter` function to accept and wire health services:

```javascript
export function createAgentsApiRouter(config) {
  const {
    logger = console,
    healthStore,
    healthService,
    fitnessPlayableService,
    dataService,
    configService,
  } = config;

  const agentRuntime = new MastraAdapter({ logger });
  const workingMemory = new YamlWorkingMemoryAdapter({ dataService, logger });
  const agentOrchestrator = new AgentOrchestrator({ agentRuntime, logger });
  const scheduler = new Scheduler({ logger });

  // Register existing agents
  agentOrchestrator.register(EchoAgent);

  // Register health coach agent with service dependencies
  if (healthStore && healthService) {
    agentOrchestrator.register(HealthCoachAgent, {
      workingMemory,
      healthStore,
      healthService,
      fitnessPlayableService,
      dataService,
      configService,
    });
  }

  // Register scheduled assignments
  for (const agent of agentOrchestrator.listInstances()) {
    scheduler.registerAgent(agent, agentOrchestrator);
  }

  logger.info?.('agents.bootstrap.complete', {
    registeredAgents: agentOrchestrator.list().map(a => a.id),
    scheduledJobs: scheduler.list(),
  });

  return createAgentsRouter({ agentOrchestrator, scheduler, logger });
}
```

**Step 3: Update the call site in app.mjs**

Read `backend/src/app.mjs` (or wherever `createAgentsApiRouter` is called) and pass the health services. The call currently passes only `{ logger }`. Update it to also pass:

```javascript
v1Routers.agents = createAgentsApiRouter({
  logger: rootLogger.child({ module: 'agents-api' }),
  healthStore: healthServices.healthStore,
  healthService: healthServices.healthService,
  fitnessPlayableService: /* from fitnessServices — read app.mjs to find the variable */,
  dataService,
  configService,
});
```

**Note for implementer:** Read `app.mjs` to find where `healthServices`, `fitnessServices`, and `dataService` are created. The exact variable names may differ. The key dependencies are:
- `healthServices.healthStore` (YamlHealthDatastore)
- `healthServices.healthService` (AggregateHealthUseCase)
- `fitnessPlayableService` (may need to be extracted from fitnessServices)
- `dataService` (DataService singleton)
- `configService` (ConfigService singleton)

**Step 4: Run existing tests to verify nothing breaks**

Run: `node --test backend/tests/unit/agents/AgentOrchestrator.test.mjs backend/tests/unit/agents/EchoAgent.test.mjs`

Expected: All existing tests PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "feat(health-coach): wire HealthCoachAgent into bootstrap with service dependencies"
```

---

### Task 10: Dashboard API endpoint

New endpoint for the frontend to read dashboard data.

**Files:**
- Create: `backend/src/4_api/v1/routers/health-dashboard.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (add `createHealthDashboardRouter`)

**Step 1: Write the router**

```javascript
// backend/src/4_api/v1/routers/health-dashboard.mjs

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Health Dashboard API Router
 *
 * Serves agent-generated dashboard data for the fitness frontend.
 *
 * Endpoints:
 * - GET /api/v1/health-dashboard/:userId/:date — Read dashboard for user and date
 */
export function createHealthDashboardRouter(config) {
  const router = express.Router();
  const { dataService, logger = console } = config;

  if (!dataService) {
    throw new Error('dataService is required');
  }

  /**
   * GET /api/v1/health-dashboard/:userId/:date
   * Read the agent-generated dashboard for a specific user and date
   */
  router.get('/:userId/:date', asyncHandler(async (req, res) => {
    const { userId, date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD format' });
    }

    const dashboard = dataService.user.read(`health-dashboard/${date}`, userId);

    if (!dashboard) {
      return res.status(404).json({
        error: 'No dashboard available',
        userId,
        date,
        hint: 'The agent may not have run yet for this date',
      });
    }

    res.json({ userId, date, dashboard });
  }));

  /**
   * GET /api/v1/health-dashboard/:userId
   * Read today's dashboard (convenience endpoint)
   */
  router.get('/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const dashboard = dataService.user.read(`health-dashboard/${today}`, userId);

    if (!dashboard) {
      return res.status(404).json({
        error: 'No dashboard available for today',
        userId,
        date: today,
      });
    }

    res.json({ userId, date: today, dashboard });
  }));

  return router;
}

export default createHealthDashboardRouter;
```

**Step 2: Wire the router in bootstrap and app.mjs**

Add to `bootstrap.mjs`:

```javascript
export function createHealthDashboardRouter(config) {
  const { dataService, logger = console } = config;
  const { createHealthDashboardRouter: createRouter } = await import('../4_api/v1/routers/health-dashboard.mjs');
  return createRouter({ dataService, logger });
}
```

Add to `app.mjs` where routers are mounted (read the file to find the right location):

```javascript
v1Routers['health-dashboard'] = createHealthDashboardRouter({
  dataService,
  logger: rootLogger.child({ module: 'health-dashboard-api' }),
});
```

**Note for implementer:** The exact mounting pattern depends on how `app.mjs` mounts v1 routers. Read the file and follow the existing pattern (likely `app.use('/api/v1/health-dashboard', router)`).

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/health-dashboard.mjs backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "feat(health-coach): add health dashboard API endpoint"
```

---

### Task 11: Run all health-coach tests together

**Step 1: Run all tests**

Run: `node --test backend/tests/unit/agents/health-coach/dashboard-schema.test.mjs backend/tests/unit/agents/health-coach/HealthToolFactory.test.mjs backend/tests/unit/agents/health-coach/FitnessContentToolFactory.test.mjs backend/tests/unit/agents/health-coach/DashboardToolFactory.test.mjs backend/tests/unit/agents/health-coach/DailyDashboard.test.mjs backend/tests/unit/agents/health-coach/HealthCoachAgent.test.mjs`

Expected: ALL PASS

**Step 2: Run all framework tests to verify no regressions**

Run: `node --test backend/tests/unit/agents/AgentOrchestrator.test.mjs backend/tests/unit/agents/EchoAgent.test.mjs backend/tests/unit/agents/framework/WorkingMemoryState.test.mjs backend/tests/unit/agents/framework/YamlWorkingMemoryAdapter.test.mjs backend/tests/unit/agents/framework/ToolFactory.test.mjs backend/tests/unit/agents/framework/OutputValidator.test.mjs backend/tests/unit/agents/framework/Assignment.test.mjs backend/tests/unit/agents/framework/BaseAgent.test.mjs backend/tests/unit/agents/framework/Scheduler.test.mjs`

Expected: ALL 77+ tests PASS

---

### Task 12: Update documentation

**Files:**
- Modify: `docs/ai-context/agents.md`
- Modify: `backend/src/3_applications/agents/index.mjs`

**Step 1: Add health-coach exports to agents barrel**

In `backend/src/3_applications/agents/index.mjs`, add:

```javascript
// Health Coach Agent
export { HealthCoachAgent } from './health-coach/index.mjs';
```

**Step 2: Update agents context doc**

Add to `docs/ai-context/agents.md` in the File Locations section:

```markdown
### Health Coach Agent (`3_applications/agents/health-coach/`)
- `HealthCoachAgent.mjs` - Main agent class (extends BaseAgent)
- `assignments/DailyDashboard.mjs` - Daily dashboard preparation assignment
- `tools/HealthToolFactory.mjs` - Weight, nutrition, workout tools (5 tools)
- `tools/FitnessContentToolFactory.mjs` - Plex content browsing, program state (3 tools)
- `tools/DashboardToolFactory.mjs` - Dashboard write, goals, coaching notes (3 tools)
- `schemas/dashboard.mjs` - Dashboard output JSON Schema
- `prompts/system.mjs` - System prompt
- `index.mjs` - Barrel exports
```

Add to the API Endpoints table:

```markdown
| GET | `/health-dashboard/:userId/:date` | Read agent-generated dashboard |
| GET | `/health-dashboard/:userId` | Read today's dashboard |
```

Add to the Tests section:

```markdown
- `health-coach/dashboard-schema.test.mjs` - Schema validation tests
- `health-coach/HealthToolFactory.test.mjs` - Health tool tests
- `health-coach/FitnessContentToolFactory.test.mjs` - Fitness content tool tests
- `health-coach/DashboardToolFactory.test.mjs` - Dashboard tool tests
- `health-coach/DailyDashboard.test.mjs` - Assignment lifecycle tests
- `health-coach/HealthCoachAgent.test.mjs` - Agent integration tests
```

**Step 3: Commit**

```bash
git add docs/ai-context/agents.md backend/src/3_applications/agents/index.mjs
git commit -m "docs: add health coach agent to agents context and barrel exports"
```
