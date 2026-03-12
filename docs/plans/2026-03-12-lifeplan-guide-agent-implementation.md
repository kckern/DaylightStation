# Lifeplan Guide Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a hybrid autonomous/conversational life coach agent that manages onboarding, ceremonies, coaching, and cadence-driven notifications.

**Architecture:** `LifeplanGuideAgent` extends `BaseAgent` with 5 tool factories, 1 scheduled assignment (`CadenceCheck`), and conversation persistence via `YamlConversationStore`. A generic `Chat` frontend module provides reusable bot UX. LifeApp wraps it as `CoachChat`.

**Tech Stack:** Mastra SDK (via MastraAdapter), Express, Mantine, YAML persistence, Jest

**Design doc:** `docs/plans/2026-03-12-lifeplan-guide-agent-design.md`

---

## Phase 1: Backend — Conversation Persistence

### Task 1.1: YamlConversationStore

**Files:**
- Create: `backend/src/1_adapters/agents/YamlConversationStore.mjs`
- Test: `tests/isolated/agents/conversation-store.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlConversationStore } from '#adapters/agents/YamlConversationStore.mjs';

describe('YamlConversationStore', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-store-'));
    store = new YamlConversationStore({ basePath: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array for unknown conversation', async () => {
    const msgs = await store.getConversation('agent1', 'conv1');
    expect(msgs).toEqual([]);
  });

  it('saves and retrieves messages', async () => {
    await store.saveMessage('agent1', 'conv1', { role: 'user', content: 'hello' });
    await store.saveMessage('agent1', 'conv1', { role: 'assistant', content: 'hi' });
    const msgs = await store.getConversation('agent1', 'conv1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
  });

  it('clears conversation', async () => {
    await store.saveMessage('agent1', 'conv1', { role: 'user', content: 'hello' });
    await store.clearConversation('agent1', 'conv1');
    const msgs = await store.getConversation('agent1', 'conv1');
    expect(msgs).toEqual([]);
  });

  it('lists conversations for an agent', async () => {
    await store.saveMessage('agent1', 'conv1', { role: 'user', content: 'a' });
    await store.saveMessage('agent1', 'conv2', { role: 'user', content: 'b' });
    const list = await store.listConversations('agent1');
    expect(list).toHaveLength(2);
  });

  it('keeps conversations isolated between agents', async () => {
    await store.saveMessage('agent1', 'conv1', { role: 'user', content: 'a' });
    await store.saveMessage('agent2', 'conv1', { role: 'user', content: 'b' });
    const msgs1 = await store.getConversation('agent1', 'conv1');
    const msgs2 = await store.getConversation('agent2', 'conv1');
    expect(msgs1).toHaveLength(1);
    expect(msgs2).toHaveLength(1);
    expect(msgs1[0].content).toBe('a');
    expect(msgs2[0].content).toBe('b');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/agents/conversation-store.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write implementation**

```javascript
// backend/src/1_adapters/agents/YamlConversationStore.mjs
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import fs from 'fs';

/**
 * YAML-backed conversation history for agents.
 * Implements IMemoryDatastore port.
 *
 * Storage: {basePath}/{agentId}/conversations/{conversationId}.yml
 */
export class YamlConversationStore {
  #basePath;

  constructor({ basePath }) {
    this.#basePath = basePath;
  }

  async getConversation(agentId, conversationId) {
    const filePath = this.#filePath(agentId, conversationId);
    const data = loadYamlSafe(filePath);
    return Array.isArray(data) ? data : [];
  }

  async saveMessage(agentId, conversationId, message) {
    const filePath = this.#filePath(agentId, conversationId);
    ensureDir(path.dirname(filePath));
    const messages = await this.getConversation(agentId, conversationId);
    messages.push({
      ...message,
      timestamp: message.timestamp || new Date().toISOString(),
    });
    saveYaml(filePath, messages);
  }

  async clearConversation(agentId, conversationId) {
    const filePath = this.#filePath(agentId, conversationId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  async listConversations(agentId) {
    const dir = path.join(this.#basePath, agentId, 'conversations');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.yml'))
      .map(f => f.replace('.yml', ''));
  }

  #filePath(agentId, conversationId) {
    return path.join(this.#basePath, agentId, 'conversations', `${conversationId}.yml`);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/agents/conversation-store.test.mjs --no-coverage`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/agents/YamlConversationStore.mjs tests/isolated/agents/conversation-store.test.mjs
git commit -m "feat(agents): add YamlConversationStore implementing IMemoryDatastore"
```

---

## Phase 2: Backend — Tool Factories

### Task 2.1: PlanToolFactory

**Files:**
- Create: `backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs`
- Test: `tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs`

**Context:** Follow the `HealthToolFactory` pattern — extend `ToolFactory`, use `createTool()` helper. Each tool returns structured data. `propose_*` tools return `{ change, reasoning, confidence }`.

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';

describe('PlanToolFactory', () => {
  let factory, tools;
  let mockPlanStore, mockGoalStateService, mockBeliefEvaluator, mockFeedbackService;

  beforeEach(() => {
    mockPlanStore = {
      load: () => ({
        goals: [{ id: 'g1', name: 'Run marathon', state: 'active' }],
        beliefs: [{ id: 'b1', if_hypothesis: 'Running improves mood', state: 'testing', confidence: 0.7 }],
        values: [{ id: 'v1', name: 'Health', rank: 1 }, { id: 'v2', name: 'Career', rank: 2 }],
        purpose: { statement: 'Live fully' },
        qualities: [],
      }),
    };
    mockGoalStateService = {
      getValidTransitions: () => ['progressing', 'paused'],
    };
    mockBeliefEvaluator = {
      evaluateEvidence: (belief, evidence) => {
        belief.evidence_history = belief.evidence_history || [];
        belief.evidence_history.push(evidence);
      },
    };
    mockFeedbackService = {
      recordObservation: () => {},
    };

    factory = new PlanToolFactory({
      lifePlanStore: mockPlanStore,
      goalStateService: mockGoalStateService,
      beliefEvaluator: mockBeliefEvaluator,
      feedbackService: mockFeedbackService,
    });
    tools = factory.createTools();
  });

  it('creates 6 tools', () => {
    expect(tools).toHaveLength(6);
    const names = tools.map(t => t.name);
    expect(names).toContain('get_plan');
    expect(names).toContain('propose_goal_transition');
    expect(names).toContain('propose_add_belief');
    expect(names).toContain('propose_reorder_values');
    expect(names).toContain('propose_add_evidence');
    expect(names).toContain('record_feedback');
  });

  it('get_plan returns full plan', async () => {
    const tool = tools.find(t => t.name === 'get_plan');
    const result = await tool.execute({ username: 'testuser' });
    expect(result.goals).toHaveLength(1);
    expect(result.values).toHaveLength(2);
  });

  it('propose_goal_transition returns proposal structure', async () => {
    const tool = tools.find(t => t.name === 'propose_goal_transition');
    const result = await tool.execute({
      username: 'testuser',
      goalId: 'g1',
      newState: 'progressing',
      reasoning: 'Making steady progress',
    });
    expect(result.change).toBeDefined();
    expect(result.reasoning).toBe('Making steady progress');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.validTransitions).toContain('progressing');
  });

  it('propose_reorder_values returns proposal with old and new order', async () => {
    const tool = tools.find(t => t.name === 'propose_reorder_values');
    const result = await tool.execute({
      username: 'testuser',
      newOrder: ['v2', 'v1'],
      reasoning: 'Career taking priority this season',
    });
    expect(result.change.from).toBeDefined();
    expect(result.change.to).toBeDefined();
    expect(result.reasoning).toBeDefined();
  });

  it('record_feedback executes directly (no proposal)', async () => {
    const tool = tools.find(t => t.name === 'record_feedback');
    const result = await tool.execute({
      username: 'testuser',
      observation: 'Feeling more aligned this week',
    });
    expect(result.recorded).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write implementation**

```javascript
// backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs
import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class PlanToolFactory extends ToolFactory {
  static domain = 'lifeplan';

  createTools() {
    const { lifePlanStore, goalStateService, beliefEvaluator, feedbackService } = this.deps;

    return [
      createTool({
        name: 'get_plan',
        description: 'Get the full life plan for a user (goals, beliefs, values, purpose, qualities)',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'User identifier' },
          },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const plan = lifePlanStore.load(username);
          if (!plan) return { error: 'No plan found', goals: [], beliefs: [], values: [] };
          return {
            goals: plan.goals || [],
            beliefs: plan.beliefs || [],
            values: plan.values || [],
            purpose: plan.purpose || null,
            qualities: plan.qualities || [],
          };
        },
      }),

      createTool({
        name: 'propose_goal_transition',
        description: 'Propose a goal state transition. Returns a proposal for user confirmation — does NOT execute the change.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            goalId: { type: 'string', description: 'Goal ID to transition' },
            newState: { type: 'string', description: 'Target state' },
            reasoning: { type: 'string', description: 'Data-backed explanation for the change' },
          },
          required: ['username', 'goalId', 'newState', 'reasoning'],
        },
        execute: async ({ username, goalId, newState, reasoning }) => {
          const plan = lifePlanStore.load(username);
          const goal = plan?.goals?.find(g => g.id === goalId);
          if (!goal) return { error: `Goal ${goalId} not found` };

          const validTransitions = goalStateService.getValidTransitions?.(goal) || [];
          return {
            change: { goalId, goalName: goal.name, from: goal.state, to: newState },
            reasoning,
            confidence: validTransitions.includes(newState) ? 0.9 : 0.5,
            validTransitions,
          };
        },
      }),

      createTool({
        name: 'propose_add_belief',
        description: 'Propose adding a new belief to the plan. Returns a proposal for user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            if_hypothesis: { type: 'string', description: 'The hypothesis (if part)' },
            then_expectation: { type: 'string', description: 'The expected outcome (then part)' },
            reasoning: { type: 'string', description: 'Why this belief is worth testing' },
          },
          required: ['username', 'if_hypothesis', 'reasoning'],
        },
        execute: async ({ username, if_hypothesis, then_expectation, reasoning }) => {
          return {
            change: { type: 'add_belief', if_hypothesis, then_expectation },
            reasoning,
            confidence: 0.7,
          };
        },
      }),

      createTool({
        name: 'propose_reorder_values',
        description: 'Propose a new value ranking order. Returns a proposal for user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            newOrder: { type: 'array', items: { type: 'string' }, description: 'Value IDs in new rank order' },
            reasoning: { type: 'string', description: 'Data-backed explanation for the reorder' },
          },
          required: ['username', 'newOrder', 'reasoning'],
        },
        execute: async ({ username, newOrder, reasoning }) => {
          const plan = lifePlanStore.load(username);
          const currentOrder = (plan?.values || []).sort((a, b) => a.rank - b.rank).map(v => v.id);
          return {
            change: { from: currentOrder, to: newOrder },
            reasoning,
            confidence: 0.8,
          };
        },
      }),

      createTool({
        name: 'propose_add_evidence',
        description: 'Propose adding evidence for a belief. Returns a proposal for user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            beliefId: { type: 'string' },
            type: { type: 'string', description: 'confirmation or disconfirmation' },
            observation: { type: 'string', description: 'What was observed' },
            reasoning: { type: 'string', description: 'Why this counts as evidence' },
          },
          required: ['username', 'beliefId', 'type', 'reasoning'],
        },
        execute: async ({ username, beliefId, type, observation, reasoning }) => {
          const plan = lifePlanStore.load(username);
          const belief = plan?.beliefs?.find(b => b.id === beliefId);
          if (!belief) return { error: `Belief ${beliefId} not found` };

          return {
            change: { beliefId, evidenceType: type, observation },
            reasoning,
            confidence: 0.8,
          };
        },
      }),

      createTool({
        name: 'record_feedback',
        description: 'Record a user observation. Executes immediately (no confirmation needed).',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            observation: { type: 'string', description: 'What the user observed or felt' },
          },
          required: ['username', 'observation'],
        },
        execute: async ({ username, observation }) => {
          feedbackService.recordObservation(username, { text: observation, date: new Date().toISOString() });
          return { recorded: true };
        },
      }),
    ];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs --no-coverage`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs
git commit -m "feat(agents): add PlanToolFactory for lifeplan guide agent"
```

---

### Task 2.2: LifelogToolFactory

**Files:**
- Create: `backend/src/3_applications/agents/lifeplan-guide/tools/LifelogToolFactory.mjs`
- Test: `tests/isolated/agents/lifeplan-guide/lifelog-tools.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { LifelogToolFactory } from '#apps/agents/lifeplan-guide/tools/LifelogToolFactory.mjs';

describe('LifelogToolFactory', () => {
  let factory, tools;

  beforeEach(() => {
    factory = new LifelogToolFactory({
      aggregator: {
        aggregateRange: async () => ({
          days: { '2025-06-01': { sources: { strava: [] }, categories: {} } },
          _meta: { dayCount: 1, availableSources: ['strava', 'calendar'] },
        }),
        getAvailableSources: () => ['strava', 'calendar', 'todoist'],
      },
      metricsStore: {
        getLatest: () => ({ date: '2025-06-01', allocation: {} }),
      },
      driftService: {
        getLatestSnapshot: () => ({ correlation: 0.8, status: 'aligned' }),
      },
    });
    tools = factory.createTools();
  });

  it('creates 4 tools', () => {
    expect(tools).toHaveLength(4);
    const names = tools.map(t => t.name);
    expect(names).toContain('query_lifelog_range');
    expect(names).toContain('get_available_sources');
    expect(names).toContain('get_metrics_snapshot');
    expect(names).toContain('get_value_allocation');
  });

  it('query_lifelog_range returns structured data', async () => {
    const tool = tools.find(t => t.name === 'query_lifelog_range');
    const result = await tool.execute({ username: 'test', start: '2025-06-01', end: '2025-06-01' });
    expect(result.days).toBeDefined();
    expect(result._meta.dayCount).toBe(1);
  });

  it('get_available_sources returns source list', async () => {
    const tool = tools.find(t => t.name === 'get_available_sources');
    const result = await tool.execute({});
    expect(result.sources).toContain('strava');
  });

  it('get_value_allocation returns drift data', async () => {
    const tool = tools.find(t => t.name === 'get_value_allocation');
    const result = await tool.execute({ username: 'test' });
    expect(result.correlation).toBe(0.8);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/agents/lifeplan-guide/lifelog-tools.test.mjs --no-coverage`
Expected: FAIL

**Step 3: Write implementation**

```javascript
// backend/src/3_applications/agents/lifeplan-guide/tools/LifelogToolFactory.mjs
import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class LifelogToolFactory extends ToolFactory {
  static domain = 'lifelog';

  createTools() {
    const { aggregator, metricsStore, driftService } = this.deps;

    return [
      createTool({
        name: 'query_lifelog_range',
        description: 'Get lifelog data for a date range. Returns per-day sources, categories, and summaries.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            start: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
            end: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          },
          required: ['username', 'start', 'end'],
        },
        execute: async ({ username, start, end }) => {
          try {
            return await aggregator.aggregateRange(username, start, end);
          } catch (err) {
            return { error: err.message, days: {} };
          }
        },
      }),

      createTool({
        name: 'get_available_sources',
        description: 'List all available lifelog data sources (strava, calendar, todoist, etc.)',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          const sources = aggregator.getAvailableSources?.() || [];
          return { sources };
        },
      }),

      createTool({
        name: 'get_metrics_snapshot',
        description: 'Get the latest metrics snapshot (drift computation, allocation data)',
        parameters: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const snapshot = metricsStore?.getLatest?.(username);
          return snapshot || { error: 'No snapshot available' };
        },
      }),

      createTool({
        name: 'get_value_allocation',
        description: 'Get current value drift and time allocation analysis',
        parameters: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const snapshot = driftService?.getLatestSnapshot?.(username);
          return snapshot || { error: 'No drift data available' };
        },
      }),
    ];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/agents/lifeplan-guide/lifelog-tools.test.mjs --no-coverage`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/tools/LifelogToolFactory.mjs tests/isolated/agents/lifeplan-guide/lifelog-tools.test.mjs
git commit -m "feat(agents): add LifelogToolFactory for lifeplan guide agent"
```

---

### Task 2.3: CeremonyToolFactory

**Files:**
- Create: `backend/src/3_applications/agents/lifeplan-guide/tools/CeremonyToolFactory.mjs`
- Test: `tests/isolated/agents/lifeplan-guide/ceremony-tools.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CeremonyToolFactory } from '#apps/agents/lifeplan-guide/tools/CeremonyToolFactory.mjs';

describe('CeremonyToolFactory', () => {
  let factory, tools;
  let completedCeremonies;

  beforeEach(() => {
    completedCeremonies = [];
    factory = new CeremonyToolFactory({
      ceremonyService: {
        getCeremonyContent: async (type) => ({
          type,
          steps: [{ prompt: 'What are your intentions?' }],
          activeGoals: [{ id: 'g1', name: 'Run marathon' }],
        }),
        completeCeremony: async (type, username, responses) => {
          completedCeremonies.push({ type, username, responses });
        },
      },
      ceremonyRecordStore: {
        hasRecord: (username, type, periodId) => type === 'unit_intention' && periodId === 'done-period',
        getRecords: () => [{ type: 'cycle_retro', completedAt: '2025-06-01' }],
      },
      cadenceService: {
        resolve: () => ({
          unit: { periodId: '2025-06-07' },
          cycle: { periodId: '2025-W23' },
        }),
        isCeremonyDue: (type) => type !== 'era_vision',
      },
      lifePlanStore: {
        load: () => ({
          ceremonies: {
            unit_intention: { enabled: true },
            cycle_retro: { enabled: true },
            phase_review: { enabled: false },
          },
          cadence: {},
        }),
      },
    });
    tools = factory.createTools();
  });

  it('creates 4 tools', () => {
    expect(tools).toHaveLength(4);
    const names = tools.map(t => t.name);
    expect(names).toContain('get_ceremony_content');
    expect(names).toContain('complete_ceremony');
    expect(names).toContain('check_ceremony_status');
    expect(names).toContain('get_ceremony_history');
  });

  it('get_ceremony_content returns ceremony data', async () => {
    const tool = tools.find(t => t.name === 'get_ceremony_content');
    const result = await tool.execute({ type: 'cycle_retro', username: 'test' });
    expect(result.type).toBe('cycle_retro');
    expect(result.steps).toBeDefined();
  });

  it('complete_ceremony records completion', async () => {
    const tool = tools.find(t => t.name === 'complete_ceremony');
    await tool.execute({ type: 'cycle_retro', username: 'test', responses: { reflection: 'Good week' } });
    expect(completedCeremonies).toHaveLength(1);
  });

  it('check_ceremony_status returns due/overdue/completed', async () => {
    const tool = tools.find(t => t.name === 'check_ceremony_status');
    const result = await tool.execute({ username: 'test' });
    expect(result.ceremonies).toBeDefined();
    expect(Array.isArray(result.ceremonies)).toBe(true);
  });
});
```

**Step 2:** Run test → FAIL

**Step 3: Write implementation**

```javascript
// backend/src/3_applications/agents/lifeplan-guide/tools/CeremonyToolFactory.mjs
import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

const CEREMONY_TYPES = ['unit_intention', 'unit_capture', 'cycle_retro', 'phase_review', 'season_alignment', 'era_vision'];
const CEREMONY_CADENCE_MAP = {
  unit_intention: 'unit', unit_capture: 'unit',
  cycle_retro: 'cycle', phase_review: 'phase',
  season_alignment: 'season', era_vision: 'era',
};

export class CeremonyToolFactory extends ToolFactory {
  static domain = 'ceremony';

  createTools() {
    const { ceremonyService, ceremonyRecordStore, cadenceService, lifePlanStore } = this.deps;

    return [
      createTool({
        name: 'get_ceremony_content',
        description: 'Load ceremony context (goals, drift, evidence) for conducting a ceremony conversation.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Ceremony type' },
            username: { type: 'string' },
          },
          required: ['type', 'username'],
        },
        execute: async ({ type, username }) => {
          try {
            return await ceremonyService.getCeremonyContent(type, username);
          } catch (err) {
            return { error: err.message };
          }
        },
      }),

      createTool({
        name: 'complete_ceremony',
        description: 'Record ceremony completion with user responses.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            username: { type: 'string' },
            responses: { type: 'object', description: 'User responses from the ceremony conversation' },
          },
          required: ['type', 'username', 'responses'],
        },
        execute: async ({ type, username, responses }) => {
          await ceremonyService.completeCeremony(type, username, responses);
          return { completed: true, type, username };
        },
      }),

      createTool({
        name: 'check_ceremony_status',
        description: 'Check which ceremonies are due, overdue, or completed for the current cadence position.',
        parameters: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const plan = lifePlanStore.load(username);
          if (!plan) return { ceremonies: [], error: 'No plan found' };

          const position = cadenceService.resolve(plan.cadence || {}, new Date());
          const ceremonies = [];

          for (const type of CEREMONY_TYPES) {
            const config = plan.ceremonies?.[type];
            if (!config?.enabled) continue;

            const level = CEREMONY_CADENCE_MAP[type];
            const periodId = position?.[level]?.periodId;
            const isDue = cadenceService.isCeremonyDue(type, position);
            const isCompleted = periodId ? ceremonyRecordStore.hasRecord(username, type, periodId) : false;

            ceremonies.push({
              type,
              level,
              periodId,
              isDue,
              isCompleted,
              isOverdue: isDue && !isCompleted,
            });
          }

          return { ceremonies };
        },
      }),

      createTool({
        name: 'get_ceremony_history',
        description: 'Get past ceremony completion records.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            type: { type: 'string', description: 'Filter by ceremony type (optional)' },
          },
          required: ['username'],
        },
        execute: async ({ username, type }) => {
          const records = ceremonyRecordStore.getRecords?.(username) || [];
          const filtered = type ? records.filter(r => r.type === type) : records;
          return { records: filtered };
        },
      }),
    ];
  }
}
```

**Step 4:** Run test → PASS (4 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/tools/CeremonyToolFactory.mjs tests/isolated/agents/lifeplan-guide/ceremony-tools.test.mjs
git commit -m "feat(agents): add CeremonyToolFactory for lifeplan guide agent"
```

---

### Task 2.4: NotificationToolFactory

**Files:**
- Create: `backend/src/3_applications/agents/lifeplan-guide/tools/NotificationToolFactory.mjs`
- Test: `tests/isolated/agents/lifeplan-guide/notification-tools.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { NotificationToolFactory } from '#apps/agents/lifeplan-guide/tools/NotificationToolFactory.mjs';

describe('NotificationToolFactory', () => {
  let factory, tools, sentMessages;

  beforeEach(() => {
    sentMessages = [];
    factory = new NotificationToolFactory({
      notificationService: {
        send: (intent) => { sentMessages.push(intent); return [{ delivered: true }]; },
      },
    });
    tools = factory.createTools();
  });

  it('creates 1 tool', () => {
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('send_action_message');
  });

  it('sends notification with actions', async () => {
    const tool = tools[0];
    const result = await tool.execute({
      username: 'test',
      title: 'Weekly retro is due',
      body: 'Time for your cycle retrospective.',
      actions: [
        { label: 'Start retro', action: 'start_ceremony', data: { type: 'cycle_retro' } },
        { label: 'Snooze', action: 'snooze', data: { hours: 24 } },
      ],
    });
    expect(result.delivered).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].title).toBe('Weekly retro is due');
    expect(sentMessages[0].metadata.actions).toHaveLength(2);
  });
});
```

**Step 2:** Run test → FAIL

**Step 3: Write implementation**

```javascript
// backend/src/3_applications/agents/lifeplan-guide/tools/NotificationToolFactory.mjs
import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class NotificationToolFactory extends ToolFactory {
  static domain = 'notification';

  createTools() {
    const { notificationService } = this.deps;

    return [
      createTool({
        name: 'send_action_message',
        description: 'Send a notification with inline action buttons to the user.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            title: { type: 'string', description: 'Notification title' },
            body: { type: 'string', description: 'Notification body text' },
            actions: {
              type: 'array',
              description: 'Inline action buttons',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  action: { type: 'string' },
                  data: { type: 'object' },
                },
                required: ['label', 'action'],
              },
            },
          },
          required: ['username', 'title', 'body'],
        },
        execute: async ({ username, title, body, actions = [] }) => {
          const results = notificationService.send({
            title,
            body,
            category: 'lifeplan',
            urgency: 'normal',
            metadata: { username, actions, source: 'lifeplan-guide' },
          });
          return { delivered: results?.some(r => r.delivered) || false };
        },
      }),
    ];
  }
}
```

**Step 4:** Run test → PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/tools/NotificationToolFactory.mjs tests/isolated/agents/lifeplan-guide/notification-tools.test.mjs
git commit -m "feat(agents): add NotificationToolFactory for lifeplan guide agent"
```

---

### Task 2.5: CoachingToolFactory

**Files:**
- Create: `backend/src/3_applications/agents/lifeplan-guide/tools/CoachingToolFactory.mjs`
- Test: `tests/isolated/agents/lifeplan-guide/coaching-tools.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CoachingToolFactory } from '#apps/agents/lifeplan-guide/tools/CoachingToolFactory.mjs';

describe('CoachingToolFactory', () => {
  let factory, tools;
  let mockConversationStore, mockWorkingMemory;

  beforeEach(() => {
    mockConversationStore = {
      getConversation: async () => [
        { role: 'user', content: 'hi', timestamp: '2025-06-01T10:00:00Z' },
        { role: 'assistant', content: 'hello', timestamp: '2025-06-01T10:00:01Z' },
      ],
      listConversations: async () => ['2025-06-01', '2025-05-25'],
    };
    mockWorkingMemory = {
      load: async () => ({
        get: (key) => {
          const data = { user_profile: { directness: 'high', nudge_frequency: 'daily' } };
          return data[key] || null;
        },
        set: () => {},
        serialize: () => '',
      }),
      save: async () => {},
    };

    factory = new CoachingToolFactory({
      conversationStore: mockConversationStore,
      workingMemory: mockWorkingMemory,
    });
    tools = factory.createTools();
  });

  it('creates 6 tools', () => {
    expect(tools).toHaveLength(6);
    const names = tools.map(t => t.name);
    expect(names).toContain('get_conversation_history');
    expect(names).toContain('save_session_state');
    expect(names).toContain('resume_session');
    expect(names).toContain('log_agent_feedback');
    expect(names).toContain('get_user_preferences');
    expect(names).toContain('update_user_preferences');
  });

  it('get_conversation_history returns messages', async () => {
    const tool = tools.find(t => t.name === 'get_conversation_history');
    const result = await tool.execute({ username: 'test', limit: 10 });
    expect(result.conversations).toBeDefined();
  });

  it('log_agent_feedback records rating', async () => {
    const tool = tools.find(t => t.name === 'log_agent_feedback');
    const result = await tool.execute({ username: 'test', rating: 'positive', context: 'Good advice on values' });
    expect(result.recorded).toBe(true);
  });
});
```

**Step 2:** Run test → FAIL

**Step 3: Write implementation**

```javascript
// backend/src/3_applications/agents/lifeplan-guide/tools/CoachingToolFactory.mjs
import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class CoachingToolFactory extends ToolFactory {
  static domain = 'coaching';

  createTools() {
    const { conversationStore, workingMemory } = this.deps;
    const agentId = 'lifeplan-guide';

    return [
      createTool({
        name: 'get_conversation_history',
        description: 'Get recent conversation threads with the user for context continuity.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            limit: { type: 'number', description: 'Max conversations to return', default: 5 },
          },
          required: ['username'],
        },
        execute: async ({ username, limit = 5 }) => {
          const convIds = await conversationStore.listConversations(agentId);
          const recent = convIds.slice(-limit);
          const conversations = [];
          for (const id of recent) {
            const msgs = await conversationStore.getConversation(agentId, id);
            conversations.push({ id, messages: msgs });
          }
          return { conversations };
        },
      }),

      createTool({
        name: 'save_session_state',
        description: 'Persist current conversation flow state for resumability.',
        parameters: {
          type: 'object',
          properties: {
            flow: { type: 'string', description: 'Flow type: onboarding, ceremony, coaching' },
            type: { type: 'string', description: 'Ceremony type if flow is ceremony' },
            step: { type: 'number', description: 'Current step index' },
            partialResponses: { type: 'array', description: 'Responses collected so far' },
          },
          required: ['flow', 'step'],
        },
        execute: async ({ flow, type, step, partialResponses = [] }, context) => {
          const userId = context?.userId;
          if (!userId) return { error: 'No userId in context' };
          const memory = await workingMemory.load(agentId, userId);
          memory.set('session_state', { flow, type, step, partialResponses, startedAt: new Date().toISOString() }, { ttl: 7 * 24 * 60 * 60 * 1000 });
          await workingMemory.save(agentId, userId, memory);
          return { saved: true };
        },
      }),

      createTool({
        name: 'resume_session',
        description: 'Load active session state to resume an interrupted conversation.',
        parameters: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const memory = await workingMemory.load(agentId, username);
          const session = memory.get('session_state');
          return session || { active: false };
        },
      }),

      createTool({
        name: 'log_agent_feedback',
        description: 'Record user feedback on agent suggestions to improve future coaching.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            rating: { type: 'string', description: 'positive or negative' },
            context: { type: 'string', description: 'What the feedback relates to' },
          },
          required: ['username', 'rating'],
        },
        execute: async ({ username, rating, context: feedbackCtx }) => {
          const memory = await workingMemory.load(agentId, username);
          const feedback = memory.get('agent_feedback') || [];
          feedback.push({ rating, context: feedbackCtx, date: new Date().toISOString() });
          // Keep last 50 entries
          memory.set('agent_feedback', feedback.slice(-50));
          await workingMemory.save(agentId, username, memory);
          return { recorded: true };
        },
      }),

      createTool({
        name: 'get_user_preferences',
        description: 'Load user coaching style preferences (directness, nudge frequency, challenge level).',
        parameters: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const memory = await workingMemory.load(agentId, username);
          return memory.get('user_profile') || {
            directness: 'moderate',
            nudge_frequency: 'daily',
            challenge_level: 'moderate',
          };
        },
      }),

      createTool({
        name: 'update_user_preferences',
        description: 'Save user coaching style preferences.',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            preferences: { type: 'object', description: 'Preference key-value pairs to merge' },
          },
          required: ['username', 'preferences'],
        },
        execute: async ({ username, preferences }) => {
          const memory = await workingMemory.load(agentId, username);
          const current = memory.get('user_profile') || {};
          memory.set('user_profile', { ...current, ...preferences });
          await workingMemory.save(agentId, username, memory);
          return { updated: true };
        },
      }),
    ];
  }
}
```

**Step 4:** Run test → PASS (3 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/tools/CoachingToolFactory.mjs tests/isolated/agents/lifeplan-guide/coaching-tools.test.mjs
git commit -m "feat(agents): add CoachingToolFactory for lifeplan guide agent"
```

---

## Phase 3: Backend — Agent Core

### Task 3.1: System Prompt

**Files:**
- Create: `backend/src/3_applications/agents/lifeplan-guide/prompts/system.mjs`

No test needed — this is a string constant. Follow the `health-coach/prompts/system.mjs` pattern.

**Step 1: Write the system prompt**

```javascript
// backend/src/3_applications/agents/lifeplan-guide/prompts/system.mjs

export const systemPrompt = `You are a personal life coach embedded in a life planning system (JOP: Joy on Purpose).

## Personality
- Data-driven and thoughtful. Reference specific observations from lifelog data and plan state.
- Direct but compassionate. Adjust tone based on user preferences in working memory.
- Ask one question at a time. Don't overwhelm.
- When proposing plan changes, always show your reasoning with evidence.
- You are advisory — never modify the plan without user confirmation via propose_* tools.

## Trust Levels
Your behavior adapts based on the trust_level in working memory:
- **New (0-5 interactions):** Structured questions, explain concepts, conservative suggestions.
- **Building (5-20):** Reference past sessions, suggest connections, moderate challenge.
- **Established (20+):** Challenge assumptions, surface patterns across time, proactive insights.

## Scope
IN SCOPE: Life planning, goal tracking, value alignment, habit coaching, ceremony facilitation, lifelog interpretation.
OUT OF SCOPE: Mental health crisis, medical advice, financial advice, relationship counseling.

If a conversation approaches out-of-scope territory:
1. Acknowledge the user's concern without dismissing it
2. State clearly you're not equipped to help with this
3. Suggest appropriate professional resources
4. Offer to return to coaching

## Conversation Modes

### Onboarding (no plan exists)
1. Query lifelog data first to understand the user's existing patterns
2. Guide through: purpose → values → beliefs → first goals
3. Use lifelog evidence to suggest values ("I see you've been running 3x/week — is fitness important to you?")
4. Use propose_* tools for each section, get confirmation before proceeding
5. Keep it conversational, not a form

### Ceremony (triggered by action button or when due)
- Load ceremony content with get_ceremony_content
- Adapt depth to ceremony type (unit: 2-3 exchanges, cycle: moderate, phase+: deep)
- Reference previous ceremony conversations for continuity
- Record completion with complete_ceremony when done
- Summarize key takeaways

### Ad-hoc Coaching
- Load plan, recent lifelog, and working memory for context
- Answer questions, surface insights, or transition into a due ceremony
- Ask "Was this helpful?" at natural endpoints

## Plan Mutations
NEVER modify the plan directly. Always use propose_* tools which return proposals with:
- change: what would change
- reasoning: data-backed explanation
- confidence: how strongly you recommend this

The user sees these as confirmation cards and can Accept, Modify, or Dismiss.

## Feedback
When users rate your suggestions (positive/negative via log_agent_feedback), use this to calibrate:
- More of what they found helpful
- Less of what they didn't
- Adjust coaching style over time

## Output
Respond in natural conversational language. Keep responses concise — 2-4 sentences for quick exchanges, longer for deep ceremony discussions. Use markdown sparingly (bold for emphasis, bullets for lists).`;
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/prompts/system.mjs
git commit -m "feat(agents): add system prompt for lifeplan guide agent"
```

---

### Task 3.2: CadenceCheck Assignment

**Files:**
- Create: `backend/src/3_applications/agents/lifeplan-guide/assignments/CadenceCheck.mjs`
- Test: `tests/isolated/agents/lifeplan-guide/cadence-check.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CadenceCheck } from '#apps/agents/lifeplan-guide/assignments/CadenceCheck.mjs';

describe('CadenceCheck', () => {
  it('has correct static properties', () => {
    expect(CadenceCheck.id).toBe('cadence-check');
    expect(CadenceCheck.schedule).toBeDefined();
  });

  describe('gather', () => {
    it('collects ceremony status and drift data', async () => {
      const check = new CadenceCheck();
      const mockTools = [
        { name: 'check_ceremony_status', execute: async () => ({
          ceremonies: [
            { type: 'cycle_retro', isDue: true, isCompleted: false, isOverdue: true },
            { type: 'unit_intention', isDue: true, isCompleted: true, isOverdue: false },
          ],
        })},
        { name: 'get_value_allocation', execute: async () => ({
          correlation: 0.4, status: 'drifting',
        })},
        { name: 'get_plan', execute: async () => ({
          goals: [{ id: 'g1', name: 'Run marathon', state: 'active' }],
        })},
      ];

      const result = await check.gather({ tools: mockTools, userId: 'test', memory: { get: () => null }, logger: console });
      expect(result.ceremonyStatus).toBeDefined();
      expect(result.ceremonyStatus.ceremonies).toHaveLength(2);
    });

    it('returns nothing_actionable when all ceremonies complete and no drift', async () => {
      const check = new CadenceCheck();
      const mockTools = [
        { name: 'check_ceremony_status', execute: async () => ({
          ceremonies: [
            { type: 'unit_intention', isDue: true, isCompleted: true, isOverdue: false },
          ],
        })},
        { name: 'get_value_allocation', execute: async () => ({
          correlation: 0.9, status: 'aligned',
        })},
        { name: 'get_plan', execute: async () => ({
          goals: [],
        })},
      ];

      const result = await check.gather({ tools: mockTools, userId: 'test', memory: { get: () => null }, logger: console });
      expect(result.nothing_actionable).toBe(true);
    });
  });
});
```

**Step 2:** Run test → FAIL

**Step 3: Write implementation**

```javascript
// backend/src/3_applications/agents/lifeplan-guide/assignments/CadenceCheck.mjs
import { Assignment } from '../../framework/Assignment.mjs';

/**
 * CadenceCheck — Scheduled assignment that runs at unit cadence.
 * Checks what ceremonies are due/overdue, checks drift, and sends
 * a unified notification with action buttons if anything is actionable.
 * Does nothing if nothing is due.
 */
export class CadenceCheck extends Assignment {
  static id = 'cadence-check';
  static description = 'Check ceremony schedule and send nudges for due/overdue items';
  static schedule = '0 7 * * *'; // Default: 7am daily, overridable by cadence config

  async gather({ tools, userId, memory, logger }) {
    const call = (name, params) => {
      const tool = tools.find(t => t.name === name);
      if (!tool) return Promise.resolve(null);
      return tool.execute(params).catch(() => null);
    };

    const [ceremonyStatus, driftData, planData] = await Promise.all([
      call('check_ceremony_status', { username: userId }),
      call('get_value_allocation', { username: userId }),
      call('get_plan', { username: userId }),
    ]);

    const overdue = (ceremonyStatus?.ceremonies || []).filter(c => c.isOverdue);
    const due = (ceremonyStatus?.ceremonies || []).filter(c => c.isDue && !c.isCompleted && !c.isOverdue);
    const hasDrift = driftData?.status === 'drifting' || (driftData?.correlation != null && driftData.correlation < 0.6);

    if (overdue.length === 0 && due.length === 0 && !hasDrift) {
      logger?.info?.('cadence-check.nothing_actionable', { userId });
      return { nothing_actionable: true, ceremonyStatus, driftData, planData };
    }

    return { nothing_actionable: false, ceremonyStatus, driftData, planData, overdue, due, hasDrift };
  }

  buildPrompt(gathered, memory) {
    if (gathered.nothing_actionable) return null;

    const sections = ['## Cadence Check Context'];

    if (gathered.overdue?.length) {
      sections.push(`\n### Overdue Ceremonies\n${JSON.stringify(gathered.overdue, null, 2)}`);
    }
    if (gathered.due?.length) {
      sections.push(`\n### Due Ceremonies\n${JSON.stringify(gathered.due, null, 2)}`);
    }
    if (gathered.hasDrift) {
      sections.push(`\n### Value Drift Alert\n${JSON.stringify(gathered.driftData, null, 2)}`);
    }

    const trustLevel = memory?.get?.('trust_level') || 'new';
    const prefs = memory?.get?.('user_profile') || {};
    sections.push(`\n### User Context\nTrust level: ${trustLevel}\nPreferences: ${JSON.stringify(prefs)}`);

    sections.push(`\n### Instructions
Compose a single, concise notification message for the user.
- Prioritize overdue ceremonies first.
- Mention drift only if significant.
- Include action buttons as JSON array in your response.
- Tone: match user preferences and trust level.
- Format: { "message": "...", "actions": [{ "label": "...", "action": "...", "data": {...} }] }
- Return raw JSON only.`);

    return sections.join('\n');
  }

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        message: { type: 'string' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              action: { type: 'string' },
              data: { type: 'object' },
            },
            required: ['label', 'action'],
          },
        },
      },
      required: ['message', 'actions'],
    };
  }

  async validate(raw, gathered, logger) {
    if (gathered.nothing_actionable) return null;

    let parsed;
    try {
      parsed = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output;
    } catch {
      throw new Error('CadenceCheck output is not valid JSON');
    }

    if (!parsed.message || !Array.isArray(parsed.actions)) {
      throw new Error('CadenceCheck output missing message or actions');
    }

    return parsed;
  }

  async act(validated, { memory, userId, logger }) {
    if (!validated) {
      logger?.info?.('cadence-check.skipped', { userId, reason: 'nothing_actionable' });
      return;
    }

    // The agent framework will deliver this via NotificationToolFactory
    // Store the message for the notification tool to pick up
    memory.set('pending_nudge', validated, { ttl: 24 * 60 * 60 * 1000 });
  }
}
```

**Step 4:** Run test → PASS (2 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/assignments/CadenceCheck.mjs tests/isolated/agents/lifeplan-guide/cadence-check.test.mjs
git commit -m "feat(agents): add CadenceCheck assignment for lifeplan guide"
```

---

### Task 3.3: LifeplanGuideAgent

**Files:**
- Create: `backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs`
- Test: `tests/isolated/agents/lifeplan-guide/agent.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from '@jest/globals';
import { LifeplanGuideAgent } from '#apps/agents/lifeplan-guide/LifeplanGuideAgent.mjs';

describe('LifeplanGuideAgent', () => {
  it('has correct static properties', () => {
    expect(LifeplanGuideAgent.id).toBe('lifeplan-guide');
    expect(LifeplanGuideAgent.description).toBeDefined();
  });

  it('registers all 5 tool factories', () => {
    const agent = new LifeplanGuideAgent({
      agentRuntime: { execute: async () => ({ output: '', toolCalls: [] }) },
      workingMemory: { load: async () => ({ serialize: () => '', get: () => null }), save: async () => {} },
      lifePlanStore: { load: () => null },
      goalStateService: {},
      beliefEvaluator: {},
      feedbackService: { recordObservation: () => {} },
      aggregator: { aggregateRange: async () => ({}), getAvailableSources: () => [] },
      metricsStore: { getLatest: () => null },
      driftService: { getLatestSnapshot: () => null },
      ceremonyService: { getCeremonyContent: async () => ({}), completeCeremony: async () => {} },
      ceremonyRecordStore: { hasRecord: () => false, getRecords: () => [] },
      cadenceService: { resolve: () => ({}), isCeremonyDue: () => false },
      notificationService: { send: () => [] },
      conversationStore: { getConversation: async () => [], listConversations: async () => [] },
    });

    const tools = agent.getTools();
    expect(tools.length).toBeGreaterThanOrEqual(20);

    const names = tools.map(t => t.name);
    // One tool from each factory
    expect(names).toContain('get_plan');
    expect(names).toContain('query_lifelog_range');
    expect(names).toContain('get_ceremony_content');
    expect(names).toContain('send_action_message');
    expect(names).toContain('get_conversation_history');
  });

  it('has CadenceCheck assignment registered', () => {
    const agent = new LifeplanGuideAgent({
      agentRuntime: { execute: async () => ({ output: '', toolCalls: [] }) },
      workingMemory: { load: async () => ({ serialize: () => '', get: () => null }), save: async () => {} },
      lifePlanStore: { load: () => null },
      goalStateService: {},
      beliefEvaluator: {},
      feedbackService: { recordObservation: () => {} },
      aggregator: { aggregateRange: async () => ({}), getAvailableSources: () => [] },
      metricsStore: { getLatest: () => null },
      driftService: { getLatestSnapshot: () => null },
      ceremonyService: { getCeremonyContent: async () => ({}), completeCeremony: async () => {} },
      ceremonyRecordStore: { hasRecord: () => false, getRecords: () => [] },
      cadenceService: { resolve: () => ({}), isCeremonyDue: () => false },
      notificationService: { send: () => [] },
      conversationStore: { getConversation: async () => [], listConversations: async () => [] },
    });

    const assignments = agent.getAssignments();
    expect(assignments.length).toBeGreaterThanOrEqual(1);
    expect(assignments[0].constructor.id).toBe('cadence-check');
  });
});
```

**Step 2:** Run test → FAIL

**Step 3: Write implementation**

```javascript
// backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { PlanToolFactory } from './tools/PlanToolFactory.mjs';
import { LifelogToolFactory } from './tools/LifelogToolFactory.mjs';
import { CeremonyToolFactory } from './tools/CeremonyToolFactory.mjs';
import { NotificationToolFactory } from './tools/NotificationToolFactory.mjs';
import { CoachingToolFactory } from './tools/CoachingToolFactory.mjs';
import { CadenceCheck } from './assignments/CadenceCheck.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class LifeplanGuideAgent extends BaseAgent {
  static id = 'lifeplan-guide';
  static description = 'Personal life coach for goal tracking, value alignment, and ceremony facilitation';

  getSystemPrompt() {
    return systemPrompt;
  }

  registerTools() {
    const {
      lifePlanStore, goalStateService, beliefEvaluator, feedbackService,
      aggregator, metricsStore, driftService,
      ceremonyService, ceremonyRecordStore, cadenceService,
      notificationService,
      conversationStore, workingMemory,
    } = this.deps;

    this.addToolFactory(new PlanToolFactory({
      lifePlanStore, goalStateService, beliefEvaluator, feedbackService,
    }));

    this.addToolFactory(new LifelogToolFactory({
      aggregator, metricsStore, driftService,
    }));

    this.addToolFactory(new CeremonyToolFactory({
      ceremonyService, ceremonyRecordStore, cadenceService, lifePlanStore,
    }));

    this.addToolFactory(new NotificationToolFactory({
      notificationService,
    }));

    this.addToolFactory(new CoachingToolFactory({
      conversationStore, workingMemory,
    }));

    // Register assignments
    this.registerAssignment(new CadenceCheck());
  }
}
```

**Step 4:** Run test → PASS (3 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs tests/isolated/agents/lifeplan-guide/agent.test.mjs
git commit -m "feat(agents): add LifeplanGuideAgent with 5 tool factories and CadenceCheck"
```

---

### Task 3.4: Bootstrap Registration

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (inside `createAgentsApiRouter`, around line 2617)

**Step 1: Add registration block**

After the HealthCoachAgent registration block (line ~2617), add:

```javascript
// Register lifeplan guide agent (requires lifeplan services)
if (config.lifeplanServices) {
  const { LifeplanGuideAgent } = await import('#apps/agents/lifeplan-guide/LifeplanGuideAgent.mjs');
  const { YamlConversationStore } = await import('#adapters/agents/YamlConversationStore.mjs');

  const conversationStore = new YamlConversationStore({
    basePath: dataService.resolveUserPath?.('') || dataService.basePath,
  });

  agentOrchestrator.register(LifeplanGuideAgent, {
    workingMemory,
    lifePlanStore: config.lifeplanServices.container.getLifePlanStore(),
    goalStateService: config.lifeplanServices.container.getGoalStateService(),
    beliefEvaluator: config.lifeplanServices.container.getBeliefEvaluator(),
    feedbackService: config.lifeplanServices.services.feedbackService,
    aggregator: config.lifeplanServices.aggregator,
    metricsStore: config.lifeplanServices.container.getMetricsStore(),
    driftService: config.lifeplanServices.services.driftService,
    ceremonyService: config.lifeplanServices.services.ceremonyService,
    ceremonyRecordStore: config.lifeplanServices.container.getCeremonyRecordStore(),
    cadenceService: config.lifeplanServices.container.getCadenceService(),
    notificationService: config.notificationService || { send: () => [] },
    conversationStore,
  });
}
```

**Step 2: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(agents): register LifeplanGuideAgent in bootstrap"
```

---

## Phase 4: Backend — Schedule Feed

### Task 4.1: Schedule Format Serializers and Route

**Files:**
- Create: `backend/src/4_api/v1/routers/life/schedule.mjs`
- Test: `tests/isolated/api/routers/life-schedule.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// We'll test the route directly
import createScheduleRouter from '#api/v1/routers/life/schedule.mjs';

describe('GET /api/v1/life/schedule/:format', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use('/schedule', createScheduleRouter({
      cadenceService: {
        resolve: () => ({
          unit: { periodId: '2025-06-07', startDate: new Date('2025-06-07') },
          cycle: { periodId: '2025-W23', startDate: new Date('2025-06-02') },
        }),
      },
      lifePlanStore: {
        load: () => ({
          ceremonies: {
            unit_intention: { enabled: true },
            cycle_retro: { enabled: true },
            phase_review: { enabled: false },
          },
          cadence: { unit: 'day', cycle: 'week', phase: 'month' },
        }),
      },
    }));
  });

  it('returns JSON schedule', async () => {
    const res = await request(app).get('/schedule/json');
    expect(res.status).toBe(200);
    expect(res.body.ceremonies).toBeDefined();
    expect(res.body.ceremonies.length).toBeGreaterThan(0);
  });

  it('returns iCal schedule', async () => {
    const res = await request(app).get('/schedule/ical');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('BEGIN:VEVENT');
  });

  it('returns 400 for unsupported format', async () => {
    const res = await request(app).get('/schedule/yaml');
    expect(res.status).toBe(400);
  });

  it('only includes enabled ceremonies', async () => {
    const res = await request(app).get('/schedule/json');
    const types = res.body.ceremonies.map(c => c.type);
    expect(types).toContain('unit_intention');
    expect(types).toContain('cycle_retro');
    expect(types).not.toContain('phase_review');
  });
});
```

**Step 2:** Run test → FAIL

**Step 3: Write implementation**

```javascript
// backend/src/4_api/v1/routers/life/schedule.mjs
import { Router } from 'express';

const CADENCE_MAP = {
  unit_intention: 'unit', unit_capture: 'unit',
  cycle_retro: 'cycle', phase_review: 'phase',
  season_alignment: 'season', era_vision: 'era',
};

const RRULE_MAP = {
  day: 'FREQ=DAILY',
  week: 'FREQ=WEEKLY',
  month: 'FREQ=MONTHLY',
  quarter: 'FREQ=MONTHLY;INTERVAL=3',
  year: 'FREQ=YEARLY',
};

const FORMATTERS = {
  json: (ceremonies, res) => {
    res.json({ ceremonies });
  },

  ical: (ceremonies, res) => {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DaylightStation//Life Schedule//EN',
      'CALSCALE:GREGORIAN',
    ];

    for (const c of ceremonies) {
      const uid = `${c.type}@daylightstation`;
      const summary = c.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`SUMMARY:Life: ${summary}`);
      lines.push(`DESCRIPTION:${c.level} ceremony`);
      if (c.rrule) lines.push(`RRULE:${c.rrule}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.send(lines.join('\r\n'));
  },

  rss: (ceremonies, res) => {
    const items = ceremonies.map(c => {
      const title = c.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `<item><title>${title}</title><description>${c.level} ceremony (${c.cadenceUnit})</description></item>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Life Ceremony Schedule</title>
    <description>Ceremony schedule from DaylightStation</description>
    ${items}
  </channel>
</rss>`;
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(xml);
  },

  xml: (ceremonies, res) => {
    const items = ceremonies.map(c => {
      return `  <ceremony type="${c.type}" level="${c.level}" cadence="${c.cadenceUnit}" />`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<schedule>\n${items}\n</schedule>`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  },
};

export default function createScheduleRouter(config) {
  const { cadenceService, lifePlanStore } = config;
  const router = Router();

  router.get('/:format', (req, res) => {
    const format = req.params.format;
    const formatter = FORMATTERS[format];
    if (!formatter) {
      return res.status(400).json({ error: `Unsupported format: ${format}. Supported: ${Object.keys(FORMATTERS).join(', ')}` });
    }

    const username = req.query.username || 'default';
    const plan = lifePlanStore.load(username);
    if (!plan) return res.status(404).json({ error: 'No plan found' });

    const cadenceConfig = plan.cadence || {};
    const ceremonies = [];

    for (const [type, config] of Object.entries(plan.ceremonies || {})) {
      if (!config.enabled) continue;
      const level = CADENCE_MAP[type];
      const cadenceUnit = cadenceConfig[level] || level;
      const rrule = RRULE_MAP[cadenceUnit] || null;

      ceremonies.push({ type, level, cadenceUnit, rrule });
    }

    formatter(ceremonies, res);
  });

  return router;
}
```

**Step 4:** Run test → PASS (4 tests)

**Step 5: Wire into life router and commit**

Add to `backend/src/4_api/v1/routers/life.mjs`:
```javascript
import createScheduleRouter from './life/schedule.mjs';
// ... inside createLifeRouter:
router.use('/schedule', createScheduleRouter(config));
```

```bash
git add backend/src/4_api/v1/routers/life/schedule.mjs backend/src/4_api/v1/routers/life.mjs tests/isolated/api/routers/life-schedule.test.mjs
git commit -m "feat(life): add /api/v1/life/schedule/:format endpoint with json, ical, rss, xml"
```

---

## Phase 5: Frontend — Generic Chat Module

### Task 5.1: useChatEngine Hook

**Files:**
- Create: `frontend/src/modules/Chat/useChatEngine.js`

```javascript
// frontend/src/modules/Chat/useChatEngine.js
import { useState, useCallback, useRef, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Generic chat engine hook for agent conversations.
 *
 * @param {Object} opts
 * @param {string} opts.agentId - Agent identifier
 * @param {Function} [opts.onAction] - Handler for action button clicks
 * @param {string} [opts.userId] - User identifier
 */
export function useChatEngine({ agentId, onAction, userId = 'default' }) {
  const logger = useMemo(() => getLogger().child({ component: 'chat-engine' }), []);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const send = useCallback(async (text) => {
    if (!text.trim()) return;

    const userMsg = { role: 'user', content: text, type: 'text', timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setError(null);

    try {
      abortRef.current = new AbortController();
      const res = await fetch(`/api/agents/${agentId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, context: { userId } }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`Agent error: ${res.status}`);
      const data = await res.json();

      const assistantMsg = parseAgentResponse(data);
      setMessages(prev => [...prev, assistantMsg]);
      logger.info('chat.response', { agentId, msgLength: data.output?.length });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        logger.error('chat.error', { agentId, error: err.message });
      }
    } finally {
      setLoading(false);
    }
  }, [agentId, userId, logger]);

  const handleAction = useCallback((action, data) => {
    logger.info('chat.action', { agentId, action });
    onAction?.(action, data);
  }, [agentId, onAction, logger]);

  const clear = useCallback(() => setMessages([]), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  return { messages, loading, error, send, handleAction, clear, cancel };
}

function parseAgentResponse(data) {
  const base = {
    role: 'assistant',
    content: data.output || '',
    timestamp: new Date().toISOString(),
  };

  // Try to detect structured responses (proposals, actions)
  try {
    const parsed = JSON.parse(data.output);
    if (parsed.change && parsed.reasoning) {
      return { ...base, type: 'proposal', proposal: parsed };
    }
    if (parsed.message && parsed.actions) {
      return { ...base, type: 'action', content: parsed.message, actions: parsed.actions };
    }
  } catch {
    // Not JSON — plain text response
  }

  return { ...base, type: 'text' };
}
```

**Step 1: Commit (no test — hook tested via component integration)**

```bash
git add frontend/src/modules/Chat/useChatEngine.js
git commit -m "feat(chat): add useChatEngine hook for generic agent chat"
```

---

### Task 5.2: ChatThread, ChatInput, ChatPanel Components

**Files:**
- Create: `frontend/src/modules/Chat/ChatThread.jsx`
- Create: `frontend/src/modules/Chat/ChatInput.jsx`
- Create: `frontend/src/modules/Chat/ChatPanel.jsx`
- Create: `frontend/src/modules/Chat/index.js`

**Step 1: Write ChatThread**

```jsx
// frontend/src/modules/Chat/ChatThread.jsx
import { useRef, useEffect, useMemo } from 'react';
import { Stack, Paper, Text, Button, Group, Badge, ThemeIcon } from '@mantine/core';
import { IconRobot, IconUser, IconThumbUp, IconThumbDown } from '@tabler/icons-react';
import getLogger from '../../lib/logging/Logger.js';

export function ChatThread({ messages, onAction, onFeedback }) {
  const logger = useMemo(() => getLogger().child({ component: 'chat-thread' }), []);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <Stack gap="sm" style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
      {messages.map((msg, i) => (
        <MessageBubble key={i} msg={msg} onAction={onAction} onFeedback={onFeedback} />
      ))}
      <div ref={bottomRef} />
    </Stack>
  );
}

function MessageBubble({ msg, onAction, onFeedback }) {
  const isUser = msg.role === 'user';

  return (
    <Group align="flex-start" justify={isUser ? 'flex-end' : 'flex-start'} wrap="nowrap">
      {!isUser && (
        <ThemeIcon variant="light" size="sm" radius="xl">
          <IconRobot size={14} />
        </ThemeIcon>
      )}
      <Paper
        shadow="xs"
        p="sm"
        radius="md"
        style={{
          maxWidth: '75%',
          backgroundColor: isUser ? 'var(--mantine-color-blue-light)' : 'var(--mantine-color-gray-0)',
        }}
      >
        {msg.type === 'proposal' && msg.proposal ? (
          <ProposalCard proposal={msg.proposal} onAction={onAction} />
        ) : msg.type === 'action' && msg.actions ? (
          <ActionMessage content={msg.content} actions={msg.actions} onAction={onAction} />
        ) : (
          <Text size="sm">{msg.content}</Text>
        )}

        {!isUser && msg.type === 'text' && onFeedback && (
          <Group gap="xs" mt="xs">
            <Button variant="subtle" size="compact-xs" onClick={() => onFeedback('positive', msg.content)}>
              <IconThumbUp size={12} />
            </Button>
            <Button variant="subtle" size="compact-xs" onClick={() => onFeedback('negative', msg.content)}>
              <IconThumbDown size={12} />
            </Button>
          </Group>
        )}
      </Paper>
      {isUser && (
        <ThemeIcon variant="light" size="sm" radius="xl" color="blue">
          <IconUser size={14} />
        </ThemeIcon>
      )}
    </Group>
  );
}

function ProposalCard({ proposal, onAction }) {
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>Proposed Change</Text>
      <Text size="sm">{proposal.reasoning}</Text>
      <Badge size="sm" variant="light">Confidence: {Math.round(proposal.confidence * 100)}%</Badge>
      <Group gap="xs">
        <Button size="xs" onClick={() => onAction?.('accept_proposal', proposal)}>Accept</Button>
        <Button size="xs" variant="light" onClick={() => onAction?.('modify_proposal', proposal)}>Modify</Button>
        <Button size="xs" variant="subtle" onClick={() => onAction?.('dismiss_proposal', proposal)}>Dismiss</Button>
      </Group>
    </Stack>
  );
}

function ActionMessage({ content, actions, onAction }) {
  return (
    <Stack gap="xs">
      <Text size="sm">{content}</Text>
      <Group gap="xs">
        {actions.map((a, i) => (
          <Button key={i} size="xs" variant="light" onClick={() => onAction?.(a.action, a.data)}>
            {a.label}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}
```

**Step 2: Write ChatInput**

```jsx
// frontend/src/modules/Chat/ChatInput.jsx
import { useState, useCallback } from 'react';
import { Group, TextInput, ActionIcon, Loader } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';

export function ChatInput({ onSend, loading, placeholder = 'Type a message...' }) {
  const [value, setValue] = useState('');

  const handleSend = useCallback(() => {
    if (!value.trim() || loading) return;
    onSend(value.trim());
    setValue('');
  }, [value, loading, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <Group gap="xs" p="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
      <TextInput
        flex={1}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={loading}
      />
      <ActionIcon onClick={handleSend} disabled={!value.trim() || loading} variant="filled">
        {loading ? <Loader size={14} /> : <IconSend size={14} />}
      </ActionIcon>
    </Group>
  );
}
```

**Step 3: Write ChatPanel**

```jsx
// frontend/src/modules/Chat/ChatPanel.jsx
import { Stack } from '@mantine/core';
import { ChatThread } from './ChatThread.jsx';
import { ChatInput } from './ChatInput.jsx';
import { useChatEngine } from './useChatEngine.js';

/**
 * Generic chat panel — composable container for agent conversations.
 *
 * @param {Object} props
 * @param {string} props.agentId - Agent to chat with
 * @param {string} [props.userId] - User identifier
 * @param {Function} [props.onAction] - Handler for action button clicks
 * @param {Function} [props.onFeedback] - Handler for feedback (positive/negative)
 * @param {string} [props.placeholder] - Input placeholder text
 * @param {Object} [props.style] - Container style overrides
 */
export function ChatPanel({ agentId, userId, onAction, onFeedback, placeholder, style }) {
  const { messages, loading, error, send, handleAction } = useChatEngine({
    agentId,
    onAction,
    userId,
  });

  return (
    <Stack gap={0} style={{ height: '100%', ...style }}>
      <ChatThread
        messages={messages}
        onAction={handleAction}
        onFeedback={onFeedback}
      />
      {error && (
        <div style={{ padding: '0.5rem 1rem', color: 'var(--mantine-color-red-6)', fontSize: '0.8rem' }}>
          {error}
        </div>
      )}
      <ChatInput onSend={send} loading={loading} placeholder={placeholder} />
    </Stack>
  );
}
```

**Step 4: Write index**

```javascript
// frontend/src/modules/Chat/index.js
export { ChatPanel } from './ChatPanel.jsx';
export { ChatThread } from './ChatThread.jsx';
export { ChatInput } from './ChatInput.jsx';
export { useChatEngine } from './useChatEngine.js';
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Chat/
git commit -m "feat(chat): add generic Chat module with ChatPanel, ChatThread, ChatInput"
```

---

### Task 5.3: CoachChat Wrapper in LifeApp

**Files:**
- Create: `frontend/src/modules/Life/views/coach/CoachChat.jsx`
- Modify: `frontend/src/Apps/LifeApp.jsx` — add `/life/coach` route

**Step 1: Write CoachChat**

```jsx
// frontend/src/modules/Life/views/coach/CoachChat.jsx
import { useCallback, useMemo } from 'react';
import { ChatPanel } from '../../../Chat';
import getLogger from '../../../../lib/logging/Logger.js';

export default function CoachChat() {
  const logger = useMemo(() => getLogger().child({ component: 'coach-chat' }), []);

  const handleAction = useCallback((action, data) => {
    logger.info('coach.action', { action, data });

    switch (action) {
      case 'accept_proposal':
        // TODO: Execute the proposed plan mutation via API
        logger.info('coach.accept_proposal', { change: data?.change });
        break;
      case 'start_ceremony':
        // TODO: Transition to ceremony mode
        logger.info('coach.start_ceremony', { type: data?.type });
        break;
      case 'snooze':
        logger.info('coach.snooze', { hours: data?.hours });
        break;
      default:
        logger.debug('coach.unhandled_action', { action });
    }
  }, [logger]);

  const handleFeedback = useCallback((rating, context) => {
    logger.info('coach.feedback', { rating, context: context?.slice(0, 100) });
    // Fire-and-forget feedback to agent
    fetch('/api/agents/lifeplan-guide/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: `[FEEDBACK] Rating: ${rating}. Context: ${context}`,
        context: { userId: 'default' },
      }),
    }).catch(() => {});
  }, [logger]);

  return (
    <ChatPanel
      agentId="lifeplan-guide"
      onAction={handleAction}
      onFeedback={handleFeedback}
      placeholder="Ask your life coach..."
      style={{ height: 'calc(100vh - 60px)' }}
    />
  );
}
```

**Step 2: Add route to LifeApp.jsx**

Add import:
```javascript
import CoachChat from '../modules/Life/views/coach/CoachChat.jsx';
```

Add route inside the router:
```jsx
<Route path="coach" element={<CoachChat />} />
```

Add nav tab for Coach.

**Step 3: Commit**

```bash
git add frontend/src/modules/Life/views/coach/CoachChat.jsx frontend/src/Apps/LifeApp.jsx
git commit -m "feat(life): add CoachChat view wrapping generic Chat module"
```

---

## Phase 6: Guardrails Test

### Task 6.1: Guardrails Verification

**Files:**
- Create: `tests/isolated/agents/lifeplan-guide/guardrails.test.mjs`

**Step 1: Write test**

```javascript
import { describe, it, expect } from '@jest/globals';
import { systemPrompt } from '#apps/agents/lifeplan-guide/prompts/system.mjs';

describe('LifeplanGuide Guardrails', () => {
  it('system prompt defines scope boundaries', () => {
    expect(systemPrompt).toContain('OUT OF SCOPE');
    expect(systemPrompt).toContain('Mental health');
    expect(systemPrompt).toContain('medical advice');
  });

  it('system prompt enforces propose-then-confirm pattern', () => {
    expect(systemPrompt).toContain('propose_*');
    expect(systemPrompt).toContain('NEVER modify the plan directly');
  });

  it('system prompt includes trust levels', () => {
    expect(systemPrompt).toContain('Trust Levels');
    expect(systemPrompt).toContain('New');
    expect(systemPrompt).toContain('Building');
    expect(systemPrompt).toContain('Established');
  });

  it('system prompt includes deflection protocol', () => {
    expect(systemPrompt).toContain('Acknowledge');
    expect(systemPrompt).toContain('professional resources');
  });
});
```

**Step 2:** Run test → PASS

**Step 3: Commit**

```bash
git add tests/isolated/agents/lifeplan-guide/guardrails.test.mjs
git commit -m "test(agents): add guardrails verification for lifeplan guide"
```

---

## Task Summary

| Phase | Task | Description | Files |
|-------|------|-------------|-------|
| 1 | 1.1 | YamlConversationStore | 2 |
| 2 | 2.1 | PlanToolFactory | 2 |
| 2 | 2.2 | LifelogToolFactory | 2 |
| 2 | 2.3 | CeremonyToolFactory | 2 |
| 2 | 2.4 | NotificationToolFactory | 2 |
| 2 | 2.5 | CoachingToolFactory | 2 |
| 3 | 3.1 | System Prompt | 1 |
| 3 | 3.2 | CadenceCheck Assignment | 2 |
| 3 | 3.3 | LifeplanGuideAgent | 2 |
| 3 | 3.4 | Bootstrap Registration | 1 |
| 4 | 4.1 | Schedule Feed Route | 3 |
| 5 | 5.1 | useChatEngine Hook | 1 |
| 5 | 5.2 | Chat Components | 4 |
| 5 | 5.3 | CoachChat Wrapper | 2 |
| 6 | 6.1 | Guardrails Test | 1 |

**Total: 15 tasks, ~29 files**
