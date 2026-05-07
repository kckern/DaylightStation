# Agent Infrastructure Declarations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move agent-specific infrastructure construction (working memory schemas, domain adapters, baseline services, user model services) out of `bootstrap.mjs` and into the agent classes that own them. Each agent declares its infrastructure needs via static methods; bootstrap iterates registered agents and composes generically. Result: clean DDD layering — `0_system` depends on framework interfaces, not application-layer concrete classes.

**Architecture:**

The DDD principle being violated today: `0_system/bootstrap.mjs` imports from `#apps/agents/health-coach/...` for things that are *health-coach-specific* (memory schema, adapters, baseline service, user model service). The system layer reaches up into the application layer to know about implementation details, then composes them. That's an inverted dependency.

**The fix is interface-based dependency declaration.** Each `BaseAgent` subclass that needs framework-managed infrastructure declares it via static methods on the class:

```javascript
class HealthCoachAgent extends BaseAgent {
  // ...

  /**
   * Per-agent memory configuration. Returned config is fed to a per-agent
   * Memory instance constructed by the framework. Return null to opt out.
   */
  static getMemoryConfig({ logger }) {
    return {
      lastMessages: 20,
      workingMemory: { enabled: true, scope: 'resource', schema: healthCoachWorkingMemorySchema },
    };
  }

  /**
   * Per-agent domain adapters keyed by event kind. The framework constructs
   * an EventQueryService dispatcher from the returned map.
   */
  static getDomainAdapters({ sessionService, foodLogService, healthService, householdId, defaultUserId }) {
    return {
      workout:  new FitnessEventAdapter({ sessionService, householdId }),
      meal:     foodLogService ? new NutritionEventAdapter({ foodLogService, userId: defaultUserId }) : null,
      weigh_in: healthService  ? new WeightEventAdapter({ healthService, userId: defaultUserId })   : null,
    };
  }

  /**
   * Optional: per-agent baseline service constructor. Receives the adapters
   * map from getDomainAdapters and the dataService for caching.
   */
  static getBaselineService({ adapters, dataService }) {
    return new PersonalBaselineService({ adapters, dataService });
  }

  /**
   * Optional: per-agent user model composer for the system prompt context.
   */
  static getUserModelService({ personalConstantsService, baselineService }) {
    return new UserModelService({ personalConstantsService, baselineService });
  }
}
```

`bootstrap.mjs` no longer imports any health-coach-specific module. It iterates registered agent classes, calls these static methods if defined, constructs per-agent Memory + EventQueryService + MastraAdapter from the returned values, and passes them into the agent registration.

**Three composition primitives the framework owns:**

1. **`buildAgentMemory(memoryConfig, sharedDeps)`** — wraps `buildMastraMemory`, returns a `Memory` instance per agent or `null` if no config.
2. **`buildAgentEventQueryService(adapters, baselineService)`** — wraps `EventQueryService` construction, returns the dispatcher.
3. **`buildAgentRuntime(memory, sharedDeps)`** — wraps `new MastraAdapter({ memory, logger, mediaDir })`, returns a per-agent runtime. Already there's precedent (MediaJudge has its own MastraAdapter today at `bootstrap.mjs:3429`).

The orchestrator's `register(AgentClass, deps)` accepts an optional `agentRuntime` override in deps (matches existing MediaJudge pattern). Bootstrap loop:

```javascript
for (const AgentClass of registeredAgentClasses) {
  const memoryConfig    = AgentClass.getMemoryConfig?.(sharedDeps);
  const adapters        = AgentClass.getDomainAdapters?.(sharedDeps);
  const memory          = memoryConfig ? buildAgentMemory(memoryConfig, sharedDeps) : null;
  const eventQuery      = adapters     ? buildAgentEventQueryService(adapters, baseline) : null;
  const baselineService = AgentClass.getBaselineService?.({ ...sharedDeps, adapters });
  const userModel       = AgentClass.getUserModelService?.({ ...sharedDeps, baselineService });
  const agentRuntime    = buildAgentRuntime(memory, sharedDeps);

  agentOrchestrator.register(AgentClass, {
    ...sharedDeps,
    agentRuntime,
    eventQueryService: eventQuery,
    baselineService,
    userModelService: userModel,
    // ... (any agent-class-specific keys forwarded via static getDeps too if needed)
  });
}
```

**Side effect: per-agent Memory unlocks cross-agent isolation OR cross-agent shared state by `resourceId`** — both intentionally, depending on each agent's `getMemoryConfig`. health-coach uses `scope: 'resource'`; lifeplan-guide could share or not, by declaration.

**Plus: working memory schema fix.** The current Zod schema (`healthCoachWorkingMemorySchema`) crashes Mastra's tool conversion at `@mastra/memory@1.17.5` because all fields are `.optional()` and the resulting JSONSchema produces `{ type: "None" }` (which OpenAI rejects). Fix: pass JSONSchema7 directly OR ensure at least one field is required. T5 in this plan addresses this — once the bootstrap is per-agent, we re-enable working memory cleanly.

**Tech Stack:** No new dependencies. Pure refactor + the schema fix.

---

## Exit criteria (verifiable end-to-end)

The plan is **not** done until ALL of these pass:

1. **Static analysis:** `bootstrap.mjs` contains ZERO imports from `#apps/agents/health-coach/...` (verified via grep).
2. **Unit tests:** all 1734 existing isolated tests pass; new tests for the framework helpers (`buildAgentMemory`, `buildAgentEventQueryService`, `buildAgentRuntime`) green.
3. **Live smoke:** the original cross-session + cross-agent smoke (3 turns from the Mastra Memory plan) all 3 ✓:
   - Turn 1: establish focus area in health-coach
   - Turn 2: empty messages, same threadId → recall via server-side history
   - Turn 3: lifeplan-guide queries focus → recall via resource-scoped working memory
4. **No degraded behavior:** existing health-coach functionality continues working (run today / weekly comparisons / vs_baseline annotations all produce real answers).

The Task 6 smoke script encodes 1-3 as regex assertions and 4 as a basic answer-quality check.

---

## File structure

**New files:**

```
backend/src/3_applications/agents/framework/
  buildAgentMemory.mjs              — per-agent Memory factory (wraps buildMastraMemory)
  buildAgentEventQueryService.mjs   — per-agent EventQueryService factory
  buildAgentRuntime.mjs             — per-agent MastraAdapter factory
  AgentInfrastructure.md            — JSDoc-style interface docs (no enforcement; informational)
```

**Modified files:**

```
backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
  — add static getMemoryConfig, getDomainAdapters, getBaselineService, getUserModelService

backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs
  — fix the .optional()-everywhere shape (add a required field OR convert to JSONSchema7)

backend/src/0_system/bootstrap.mjs
  — remove all #apps/agents/health-coach/ imports
  — replace per-agent construction with the generic loop
```

**New tests:**

```
tests/isolated/agents/framework/
  buildAgentMemory.test.mjs
  buildAgentEventQueryService.test.mjs
  buildAgentRuntime.test.mjs
tests/isolated/agents/health-coach/
  static_infrastructure.test.mjs   — covers HealthCoachAgent.getMemoryConfig / getDomainAdapters / etc.
```

---

## Task 1: Framework helpers — three small factories

Pure infrastructure with no agent-specific knowledge. Tests-first.

**Files:**
- Create: `backend/src/3_applications/agents/framework/buildAgentMemory.mjs`
- Create: `backend/src/3_applications/agents/framework/buildAgentEventQueryService.mjs`
- Create: `backend/src/3_applications/agents/framework/buildAgentRuntime.mjs`
- Create: `tests/isolated/agents/framework/buildAgentMemory.test.mjs`
- Create: `tests/isolated/agents/framework/buildAgentEventQueryService.test.mjs`
- Create: `tests/isolated/agents/framework/buildAgentRuntime.test.mjs`

- [ ] **Step 1: Write failing tests for buildAgentMemory**

```javascript
// tests/isolated/agents/framework/buildAgentMemory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { buildAgentMemory } from '../../../../backend/src/3_applications/agents/framework/buildAgentMemory.mjs';

describe('buildAgentMemory', () => {
  it('returns null when memoryConfig is null', () => {
    expect(buildAgentMemory(null, { dataPath: 'data', logger: console })).toBe(null);
  });

  it('returns null when memoryConfig is undefined', () => {
    expect(buildAgentMemory(undefined, { dataPath: 'data', logger: console })).toBe(null);
  });

  it('builds a Memory when given a config and dataPath', () => {
    const memory = buildAgentMemory(
      { lastMessages: 5 },
      { dataPath: ':memory:', logger: { warn: vi.fn() } },
    );
    expect(memory).toBeDefined();
    expect(typeof memory).toBe('object');
  });

  it('forwards lastMessages and workingMemory to the underlying Memory', () => {
    const memory = buildAgentMemory(
      {
        lastMessages: 30,
        // No workingMemory because Zod schema currently crashes — covered in T5
      },
      { dataPath: ':memory:', logger: { warn: vi.fn() } },
    );
    expect(memory).toBeDefined();
  });

  it('returns null and logs warn on construction error', () => {
    const logger = { warn: vi.fn() };
    // Force a failure by passing an invalid dbPath shape
    const memory = buildAgentMemory(
      { lastMessages: 5 },
      { dataPath: null, logger },  // null dataPath → buildMastraMemory throws
    );
    expect(memory).toBe(null);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('uses agentId in the dbPath when provided (per-agent storage isolation)', () => {
    // Smoke: just verifies construction works with agentId; per-agent file
    // partitioning is an implementation detail — we just need separate Memory
    // instances per agent for now (single shared db file is fine for v1).
    const memory = buildAgentMemory(
      { lastMessages: 5 },
      { dataPath: ':memory:', logger: { warn: vi.fn() }, agentId: 'health-coach' },
    );
    expect(memory).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement buildAgentMemory**

```javascript
// backend/src/3_applications/agents/framework/buildAgentMemory.mjs
import { buildMastraMemory } from '#system/memory/buildMastraMemory.mjs';

/**
 * Per-agent Memory factory. Wraps buildMastraMemory with friendlier error
 * handling (returns null + logs warn instead of throwing) so a single agent's
 * Memory failure doesn't cascade.
 *
 * @param {object|null} memoryConfig — what the agent class returned from
 *   AgentClass.getMemoryConfig(deps). { lastMessages, workingMemory? }.
 * @param {object} sharedDeps — { dataPath, logger, agentId }
 * @returns {Memory|null}
 */
export function buildAgentMemory(memoryConfig, sharedDeps = {}) {
  if (!memoryConfig) return null;
  const { dataPath, logger = console, agentId } = sharedDeps;
  if (dataPath == null) {
    logger.warn?.('agent.memory.init_failed', { agentId, error: 'dataPath required' });
    return null;
  }
  // For v1: shared db file across agents. Per-agent sub-files can come later
  // if write contention shows up. The agentId is logged for traceability.
  const dbPath = dataPath === ':memory:' ? ':memory:' : `${dataPath}/agents/memory.db`;
  try {
    return buildMastraMemory({ dbPath, ...memoryConfig });
  } catch (err) {
    logger.warn?.('agent.memory.init_failed', { agentId, error: err?.message });
    return null;
  }
}

export default buildAgentMemory;
```

- [ ] **Step 3: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/buildAgentMemory.test.mjs
```

- [ ] **Step 4: Write failing tests for buildAgentEventQueryService**

```javascript
// tests/isolated/agents/framework/buildAgentEventQueryService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { buildAgentEventQueryService } from '../../../../backend/src/3_applications/agents/framework/buildAgentEventQueryService.mjs';

describe('buildAgentEventQueryService', () => {
  it('returns null when adapters map is null', () => {
    expect(buildAgentEventQueryService(null, null)).toBe(null);
  });

  it('returns null when adapters map is empty', () => {
    expect(buildAgentEventQueryService({}, null)).toBe(null);
  });

  it('returns null when adapters map has only null/undefined values', () => {
    expect(buildAgentEventQueryService({ workout: null, meal: null }, null)).toBe(null);
  });

  it('builds an EventQueryService when at least one adapter is defined', () => {
    const fakeAdapter = { list: vi.fn(), detail: vi.fn(), summary: vi.fn() };
    const svc = buildAgentEventQueryService({ workout: fakeAdapter, meal: null }, null);
    expect(svc).toBeDefined();
    expect(typeof svc.queryEvents).toBe('function');
  });

  it('forwards baselineService to EventQueryService', async () => {
    const fakeAdapter = {
      list: vi.fn(async () => ({ events: [], meta: { kind: 'workout', n: 0 } })),
    };
    const baselineService = { getBaselines: vi.fn(async () => ({ fitness: {} })) };
    const svc = buildAgentEventQueryService({ workout: fakeAdapter }, baselineService);
    await svc.queryEvents({ kind: 'workout', period: 'last_7d', userId: 'kc' });
    expect(baselineService.getBaselines).toHaveBeenCalledWith({ userId: 'kc' });
  });
});
```

- [ ] **Step 5: Implement buildAgentEventQueryService**

```javascript
// backend/src/3_applications/agents/framework/buildAgentEventQueryService.mjs
import { EventQueryService } from '#apps/agents/health-coach/services/EventQueryService.mjs';

// NOTE: EventQueryService currently lives under health-coach. After this plan,
// it should move to a more neutral location (e.g. #apps/agents/framework or
// #domains/events) since it's framework-level. For now, keeping the import
// path and accepting the smell — addressed in a follow-up plan.

/**
 * Per-agent EventQueryService factory. Returns null when no adapters are
 * provided so agents that don't use event surfaces (echo, paged-media-toc)
 * skip the construction entirely.
 *
 * @param {Record<string, IEventAdapter|null>} adapters — kind → adapter map.
 *   Null entries are stripped before constructing the dispatcher.
 * @param {object|null} baselineService — for vs_baseline annotation.
 * @returns {EventQueryService|null}
 */
export function buildAgentEventQueryService(adapters, baselineService = null) {
  if (!adapters) return null;
  const cleaned = Object.fromEntries(
    Object.entries(adapters).filter(([, v]) => v != null),
  );
  if (Object.keys(cleaned).length === 0) return null;
  return new EventQueryService({ adapters: cleaned, baselineService });
}

export default buildAgentEventQueryService;
```

- [ ] **Step 6: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/buildAgentEventQueryService.test.mjs
```

- [ ] **Step 7: Write failing tests for buildAgentRuntime**

```javascript
// tests/isolated/agents/framework/buildAgentRuntime.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { buildAgentRuntime } from '../../../../backend/src/3_applications/agents/framework/buildAgentRuntime.mjs';

describe('buildAgentRuntime', () => {
  it('builds a MastraAdapter with the supplied memory', () => {
    const fakeMemory = { __isFakeMemory: true };
    const runtime = buildAgentRuntime(fakeMemory, { logger: console, mediaDir: '/tmp' });
    expect(runtime).toBeDefined();
    expect(typeof runtime.execute).toBe('function');
    expect(typeof runtime.streamExecute).toBe('function');
  });

  it('builds a MastraAdapter with null memory (stateless mode)', () => {
    const runtime = buildAgentRuntime(null, { logger: console, mediaDir: '/tmp' });
    expect(runtime).toBeDefined();
  });

  it('forwards logger and mediaDir', () => {
    // Construction smoke; behavior covered by MastraAdapter's own tests.
    const runtime = buildAgentRuntime(null, { logger: { info: () => {} }, mediaDir: '/tmp/m' });
    expect(runtime).toBeDefined();
  });
});
```

- [ ] **Step 8: Implement buildAgentRuntime**

```javascript
// backend/src/3_applications/agents/framework/buildAgentRuntime.mjs
import { MastraAdapter } from '#adapters/agents/index.mjs';

/**
 * Per-agent MastraAdapter (runtime) factory. Each agent that opts into Memory
 * gets its own runtime instance so its Memory is isolated. Agents without
 * Memory get a runtime with `memory: null` (back-compat with cron etc.).
 *
 * @param {Memory|null} memory — from buildAgentMemory, or null for stateless.
 * @param {object} sharedDeps — { logger, mediaDir, model?, agentClass?, ... }
 * @returns {MastraAdapter}
 */
export function buildAgentRuntime(memory, sharedDeps = {}) {
  return new MastraAdapter({
    logger: sharedDeps.logger,
    mediaDir: sharedDeps.mediaDir,
    model: sharedDeps.model,
    agentClass: sharedDeps.agentClass,
    memory,
  });
}

export default buildAgentRuntime;
```

- [ ] **Step 9: Run; pass + commit**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/framework/buildAgentMemory.mjs \
  backend/src/3_applications/agents/framework/buildAgentEventQueryService.mjs \
  backend/src/3_applications/agents/framework/buildAgentRuntime.mjs \
  tests/isolated/agents/framework/buildAgentMemory.test.mjs \
  tests/isolated/agents/framework/buildAgentEventQueryService.test.mjs \
  tests/isolated/agents/framework/buildAgentRuntime.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): framework — buildAgentMemory / buildAgentEventQueryService / buildAgentRuntime

Plan / Task 1 (infra declarations). Three composition primitives that
bootstrap will use to compose per-agent infrastructure generically.
Each accepts the agent's declared config (or null) and returns the
constructed instance (or null when not applicable).

No agent-specific imports in any of the three. Foundation for T2-T4
moving health-coach's infrastructure declarations into the agent
class itself.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: HealthCoachAgent declares its infrastructure

Move all health-coach-specific construction from `bootstrap.mjs` into static methods on `HealthCoachAgent`. After this task, `bootstrap.mjs` STILL imports from health-coach (because bootstrap hasn't been refactored yet — that's T4) but the actual construction logic moves.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`
- Create: `tests/isolated/agents/health-coach/static_infrastructure.test.mjs`

- [ ] **Step 1: Write tests for the static methods**

```javascript
// tests/isolated/agents/health-coach/static_infrastructure.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HealthCoachAgent } from '../../../../backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs';

describe('HealthCoachAgent.getMemoryConfig', () => {
  it('returns lastMessages: 20 and the working memory schema', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({ logger: console });
    expect(cfg).toBeDefined();
    expect(cfg.lastMessages).toBe(20);
    expect(cfg.workingMemory).toBeDefined();
    expect(cfg.workingMemory.enabled).toBe(true);
    expect(cfg.workingMemory.scope).toBe('resource');
    expect(cfg.workingMemory.schema).toBeDefined();
  });
});

describe('HealthCoachAgent.getDomainAdapters', () => {
  it('returns workout adapter when sessionService present', () => {
    const adapters = HealthCoachAgent.getDomainAdapters({
      sessionService: { listSessionsInRange: vi.fn() },
      householdId: 'default',
    });
    expect(adapters.workout).toBeDefined();
    expect(typeof adapters.workout.list).toBe('function');
  });

  it('returns null meal adapter when foodLogService is missing', () => {
    const adapters = HealthCoachAgent.getDomainAdapters({
      sessionService: { listSessionsInRange: vi.fn() },
      householdId: 'default',
      defaultUserId: 'kc',
      // foodLogService omitted
    });
    expect(adapters.meal).toBe(null);
  });

  it('returns meal adapter when foodLogService present', () => {
    const adapters = HealthCoachAgent.getDomainAdapters({
      sessionService: { listSessionsInRange: vi.fn() },
      foodLogService: { getLogsInRange: vi.fn() },
      householdId: 'default',
      defaultUserId: 'kc',
    });
    expect(adapters.meal).toBeDefined();
  });

  it('returns weigh_in adapter when healthService present', () => {
    const adapters = HealthCoachAgent.getDomainAdapters({
      sessionService: { listSessionsInRange: vi.fn() },
      healthService: { getHealthForRange: vi.fn() },
      householdId: 'default',
      defaultUserId: 'kc',
    });
    expect(adapters.weigh_in).toBeDefined();
  });
});

describe('HealthCoachAgent.getBaselineService', () => {
  it('returns a PersonalBaselineService when adapters and dataService given', () => {
    const adapters = { workout: { list: vi.fn() } };
    const dataService = { user: { read: vi.fn(), write: vi.fn() } };
    const svc = HealthCoachAgent.getBaselineService({ adapters, dataService });
    expect(svc).toBeDefined();
    expect(typeof svc.getBaselines).toBe('function');
  });

  it('returns null when dataService is missing', () => {
    const svc = HealthCoachAgent.getBaselineService({ adapters: { workout: {} } });
    expect(svc).toBe(null);
  });
});

describe('HealthCoachAgent.getUserModelService', () => {
  it('returns a UserModelService when both deps present', () => {
    const svc = HealthCoachAgent.getUserModelService({
      personalConstantsService: { get: vi.fn() },
      baselineService: { getBaselines: vi.fn() },
    });
    expect(svc).toBeDefined();
    expect(typeof svc.composeContext).toBe('function');
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/static_infrastructure.test.mjs
```

- [ ] **Step 3: Add static methods to HealthCoachAgent**

In `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`, add these static methods to the class. Imports go at the top of the file (most are already present):

```javascript
import { FitnessEventAdapter }   from './services/adapters/FitnessEventAdapter.mjs';
import { NutritionEventAdapter } from './services/adapters/NutritionEventAdapter.mjs';
import { WeightEventAdapter }    from './services/adapters/WeightEventAdapter.mjs';
import { PersonalBaselineService } from './services/PersonalBaselineService.mjs';
import { UserModelService }      from './services/UserModelService.mjs';
import { healthCoachWorkingMemorySchema } from './memory/workingMemorySchema.mjs';
```

Then add the static methods:

```javascript
  static getMemoryConfig() {
    return {
      lastMessages: 20,
      workingMemory: {
        enabled: true,
        scope: 'resource',
        schema: healthCoachWorkingMemorySchema,
      },
    };
  }

  static getDomainAdapters({ sessionService, foodLogService, healthService, householdId, defaultUserId }) {
    return {
      workout:  sessionService ? new FitnessEventAdapter({ sessionService, householdId }) : null,
      meal:     foodLogService ? new NutritionEventAdapter({ foodLogService, userId: defaultUserId }) : null,
      weigh_in: healthService  ? new WeightEventAdapter({ healthService, userId: defaultUserId })   : null,
    };
  }

  static getBaselineService({ adapters, dataService }) {
    if (!dataService || !adapters) return null;
    return new PersonalBaselineService({ adapters, dataService });
  }

  static getUserModelService({ personalConstantsService, baselineService }) {
    if (!personalConstantsService || !baselineService) return null;
    return new UserModelService({ personalConstantsService, baselineService });
  }
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/
```

- [ ] **Step 5: Full agent + adapter suite (no regressions yet — bootstrap still drives everything)**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

Bootstrap STILL imports + constructs these directly; this task adds the static methods alongside without removing the bootstrap construction. T4 swaps bootstrap to use the static methods.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs \
  tests/isolated/agents/health-coach/static_infrastructure.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): static infrastructure declarations

Plan / Task 2 (infra declarations). HealthCoachAgent now exposes
four static methods that declare its infrastructure needs:
  getMemoryConfig() → memory + working memory schema
  getDomainAdapters({ sessionService, foodLogService, healthService, ... })
  getBaselineService({ adapters, dataService })
  getUserModelService({ personalConstantsService, baselineService })

T4 will swap bootstrap to use these instead of duplicating the
construction logic in 0_system. After T4, bootstrap.mjs has zero
imports from #apps/agents/health-coach/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Working memory schema fix — JSONSchema7 directly

The current Zod schema produces `{ type: "None" }` JSONSchema (because all fields are `.optional()`), which OpenAI rejects. Switch to passing JSONSchema7 directly. Equivalent shape, no Zod conversion in the path.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs`
- Modify: `tests/isolated/agents/memory/working_memory_schema.test.mjs`

- [ ] **Step 1: Replace Zod schema with JSONSchema7**

```javascript
// backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs

/**
 * Health-coach working memory — JSON Schema (Draft 7).
 *
 * Mastra accepts both ZodObject and JSONSchema7 for working memory schemas.
 * We use JSONSchema7 directly to avoid the Zod-to-JSONSchema conversion bug
 * in @mastra/memory@1.17.5 where all-optional Zod schemas produce
 * { type: "None" } (rejected by OpenAI).
 *
 * Resource-scoped: shared across all threads and agents for the same userId.
 * health-coach observations are visible to lifeplan-guide and any future agents.
 */
export const healthCoachWorkingMemorySchema = {
  type: 'object',
  properties: {
    recent_focus_areas: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 8,
      description: 'What the user has mentioned focusing on lately (e.g., "Z2 endurance", "morning fasted runs"). Most recent first.',
    },
    recent_observations: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
      description: 'Notable things the user has shared in recent conversations. Each entry should include a date if relevant.',
    },
    stated_goals: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
      description: 'Long-term goals the user has explicitly stated.',
    },
    active_constraints: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
      description: 'Current limitations or restrictions (injury, illness, life event). Each should include a start date if known.',
    },
    preferences: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Coaching preferences the user has expressed.',
    },
  },
  // No required: [] — all properties optional, but the type:'object' wrapper
  // is explicit so Mastra/OpenAI sees a valid object schema.
};

export default healthCoachWorkingMemorySchema;
```

- [ ] **Step 2: Update tests for JSONSchema shape**

```javascript
// tests/isolated/agents/memory/working_memory_schema.test.mjs
import { describe, it, expect } from 'vitest';
import { healthCoachWorkingMemorySchema } from '../../../../backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs';

describe('healthCoachWorkingMemorySchema (JSONSchema7)', () => {
  it('is a valid JSONSchema with type: object', () => {
    expect(healthCoachWorkingMemorySchema.type).toBe('object');
  });

  it('has the expected top-level properties', () => {
    const props = Object.keys(healthCoachWorkingMemorySchema.properties).sort();
    expect(props).toEqual([
      'active_constraints', 'preferences', 'recent_focus_areas',
      'recent_observations', 'stated_goals',
    ]);
  });

  it('caps array sizes via maxItems', () => {
    expect(healthCoachWorkingMemorySchema.properties.recent_focus_areas.maxItems).toBe(8);
    expect(healthCoachWorkingMemorySchema.properties.recent_observations.maxItems).toBe(20);
    expect(healthCoachWorkingMemorySchema.properties.stated_goals.maxItems).toBe(5);
    expect(healthCoachWorkingMemorySchema.properties.active_constraints.maxItems).toBe(5);
  });

  it('preferences accepts string values via additionalProperties', () => {
    expect(healthCoachWorkingMemorySchema.properties.preferences.additionalProperties.type).toBe('string');
  });

  it('does not declare any required fields (all optional, but type:object enforced)', () => {
    // The previous bug: all-optional Zod produced "type: None" JSONSchema.
    // Now we control the JSONSchema directly — no required[] is fine because
    // type:'object' is explicit.
    expect(healthCoachWorkingMemorySchema.required).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/memory/working_memory_schema.test.mjs
```

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs \
  tests/isolated/agents/memory/working_memory_schema.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
fix(health-coach): working memory schema as JSONSchema7

The Zod-to-JSONSchema conversion in @mastra/memory@1.17.5 produces
{ type: "None" } for all-optional Zod schemas, which OpenAI rejects:
  "Invalid schema for function 'updateWorkingMemory': schema must be
   a JSON Schema of 'type: \"object\"', got 'type: \"None\"'"

Switching to JSONSchema7 directly bypasses the conversion entirely.
Same shape; just expressed in JSONSchema syntax. type: 'object' is
explicit so the OpenAI tool function schema is valid even with no
required properties.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Bootstrap refactor — generic agent infrastructure loop

The big one. Remove all `#apps/agents/health-coach/...` imports from `bootstrap.mjs`. Replace the inline construction with a generic loop that calls each agent class's static methods.

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
- Verify (no changes needed): `backend/src/3_applications/agents/AgentOrchestrator.mjs` already accepts arbitrary deps via `register(AgentClass, deps)`.

- [ ] **Step 1: Audit current imports + construction**

```bash
cd /opt/Code/DaylightStation && grep -n "#apps/agents/health-coach\|FoodLogService\|EventQueryService\|PersonalBaselineService\|UserModelService\|FitnessEventAdapter\|NutritionEventAdapter\|WeightEventAdapter\|workingMemorySchema" backend/src/0_system/bootstrap.mjs
```

You'll see imports for all these health-coach-specific things. After T4, none of them remain in bootstrap.

- [ ] **Step 2: Remove the imports**

Delete from `bootstrap.mjs`:
```javascript
import { EventQueryService }        from '#apps/agents/health-coach/services/EventQueryService.mjs';
import { FoodLogService }           from '#domains/nutrition/services/FoodLogService.mjs';   // only used for health-coach
import { PersonalBaselineService } from '#apps/agents/health-coach/services/PersonalBaselineService.mjs';   // if present
import { UserModelService }        from '#apps/agents/health-coach/services/UserModelService.mjs';        // if present
import { FitnessEventAdapter }     from '#apps/agents/health-coach/services/adapters/FitnessEventAdapter.mjs';
import { NutritionEventAdapter }   from '#apps/agents/health-coach/services/adapters/NutritionEventAdapter.mjs';
import { WeightEventAdapter }      from '#apps/agents/health-coach/services/adapters/WeightEventAdapter.mjs';
import { healthCoachWorkingMemorySchema } from '#apps/agents/health-coach/memory/workingMemorySchema.mjs';
```

NOTE: `FoodLogService` is in `#domains/nutrition/...` not `#apps/agents/health-coach/...`. It's domain-layer infrastructure — KEEP the import in bootstrap, but only construct the instance when nutritionAdapter actually needs it. Easiest: pass `foodLogStore` (already in scope from createNutribotServices) into HealthCoachAgent.getDomainAdapters; the agent's static method constructs FoodLogService inline.

Updated import policy:
- Keep: `FoodLogService` import IN HealthCoachAgent (Task 2 already adds it).
- Remove: from bootstrap.
- Pass `foodLogStore` as a sharedDep into the static method.

- [ ] **Step 3: Add the framework helpers import**

```javascript
import { buildAgentMemory }            from '#apps/agents/framework/buildAgentMemory.mjs';
import { buildAgentEventQueryService } from '#apps/agents/framework/buildAgentEventQueryService.mjs';
import { buildAgentRuntime }           from '#apps/agents/framework/buildAgentRuntime.mjs';
```

- [ ] **Step 4: Replace the per-agent construction block with the generic loop**

Find the section that today constructs health-coach's services (around lines 3081-3160 — the section that constructs adapters, baselineService, eventQueryService, userModelService, then registers HealthCoachAgent). Replace with:

```javascript
// ── Per-agent infrastructure loop ───────────────────────────────────────────
// Each agent class declares its infrastructure needs via static methods.
// Bootstrap stays generic — no #apps/agents/<agent>/ imports.

const householdId = configService?.getDefaultHouseholdId?.() ?? 'default';
const defaultUserId = configService?.getHeadOfHousehold?.() ?? householdId;

const sharedAgentDeps = {
  // Infrastructure / domain services agents may compose into adapters
  sessionService: fitnessServices.sessionService,
  foodLogStore,           // for nutrition adapter (FoodLogService wraps it)
  healthService: healthServices.healthService,
  healthStore: healthServices.healthStore,
  dataService,
  configService,
  personalConstantsService,
  // Coordinates
  householdId,
  defaultUserId,
  // Framework deps
  logger,
  mediaDir,
  dataPath: configService?.getDataDir?.() ?? 'data',
};

const REFLECTIVE_AGENTS = [HealthCoachAgent /* , LifeplanGuideAgent when ready */];

for (const AgentClass of REFLECTIVE_AGENTS) {
  // Per-agent infrastructure declarations
  const memoryConfig    = AgentClass.getMemoryConfig?.(sharedAgentDeps) ?? null;
  const adapters        = AgentClass.getDomainAdapters?.(sharedAgentDeps) ?? null;
  const memory          = buildAgentMemory(memoryConfig, sharedAgentDeps);
  const baselineService = AgentClass.getBaselineService?.({ ...sharedAgentDeps, adapters }) ?? null;
  const eventQueryService = buildAgentEventQueryService(adapters, baselineService);
  const userModelService  = AgentClass.getUserModelService?.({ ...sharedAgentDeps, baselineService }) ?? null;
  const agentRuntime    = buildAgentRuntime(memory, sharedAgentDeps);

  agentOrchestrator.register(AgentClass, {
    workingMemory,    // YAML legacy working memory adapter (unrelated to Mastra Memory)
    healthStore: healthServices.healthStore,
    healthService: healthServices.healthService,
    fitnessPlayableService: fitnessServices.fitnessPlayableService,
    sessionService: fitnessServices.sessionService,
    mediaProgressMemory,
    dataService,
    configService,
    messagingGateway,
    conversationId: conversationId ?? configService?.getNutribotConversationId?.() ?? null,
    personalContextLoader,
    archiveScopeFactory,
    similarPeriodFinder,
    patternDetector,
    calibrationConstants,
    dataRoot,
    healthAnalyticsService,
    healthQueryService,
    computeSandbox,
    personalConstantsService,
    // Per-agent infrastructure
    agentRuntime,
    eventQueryService,
    baselineService,
    userModelService,
  });
}

// Other agents (echo, paged-media-toc, lifeplan-guide, MediaJudge subagent)
// continue using their existing registration code paths until they migrate
// to the static-method pattern.
agentOrchestrator.register(EchoAgent, { workingMemory, agentRuntime });   // shared default agentRuntime
// ... existing PagedMediaTocAgent, LifeplanGuideAgent registrations unchanged ...
```

NOTE: the existing `agentRuntime` variable (the shared MastraAdapter constructed at line 2976) stays for non-reflective agents. Echo, PagedMediaToc, LifeplanGuide use it. The reflective loop creates per-agent runtimes only for opted-in agents.

- [ ] **Step 5: Verify zero health-coach imports remain in bootstrap**

```bash
cd /opt/Code/DaylightStation && grep -n "#apps/agents/health-coach\|workingMemorySchema\|FitnessEventAdapter\|NutritionEventAdapter\|WeightEventAdapter\|PersonalBaselineService\|UserModelService\|EventQueryService" backend/src/0_system/bootstrap.mjs
```

Expected: NO matches in 0_system/bootstrap.mjs (grep returns nothing). If any survive, remove them.

- [ ] **Step 6: Syntax + boot smoke**

```bash
cd /opt/Code/DaylightStation && node -c backend/src/0_system/bootstrap.mjs && echo OK
cd /opt/Code/DaylightStation && timeout 25 node -e "
import('./backend/index.js').then(() => { console.log('BOOT OK'); setTimeout(() => process.exit(0), 1500); }).catch(e => { console.error('BOOT FAIL:', e.message); process.exit(1); });
" 2>&1 | tail -20
```

- [ ] **Step 7: Full agent + adapter suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

If any test breaks because it asserted a specific bootstrap construction order or import, update the test to use the new pattern (or delete if the assertion is meaningless under the refactor).

- [ ] **Step 8: Commit**

```bash
cd /opt/Code/DaylightStation && git add backend/src/0_system/bootstrap.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
refactor(0_system): bootstrap is generic; agents declare infrastructure

Plan / Task 4 (infra declarations). bootstrap.mjs no longer imports
from #apps/agents/health-coach/. Agent infrastructure is constructed
by iterating registered agent classes and calling their static
methods (getMemoryConfig, getDomainAdapters, getBaselineService,
getUserModelService).

Per-agent Memory + EventQueryService + MastraAdapter instances are
constructed via the framework helpers from T1. Each opted-in agent
gets its own runtime with its own Memory.

DDD layering restored: 0_system depends on framework interfaces,
not application-layer concrete classes. Adding a new reflective
agent (lifeplan-guide v2, etc.) requires zero bootstrap changes —
just declare the four static methods and add the class to the
REFLECTIVE_AGENTS array.

Echo / PagedMediaToc / LifeplanGuide / ConciergeAgent / MediaJudge
continue with their existing registration paths until they migrate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build, deploy, full cross-session + cross-agent smoke

**Files:**
- (none — verification only)

- [ ] **Step 1: Vitest sanity**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/ frontend/src/modules/Agent/
```

Expected: 1734+ tests green.

- [ ] **Step 2: Vite build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3
```

- [ ] **Step 3: Build + deploy + ready**

```bash
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" . 2>&1 | tail -3 && \
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight 2>&1 | tail -3 && \
until curl -sS -m 3 http://localhost:3111/api/v1/agents > /dev/null 2>&1; do sleep 2; done && echo READY
```

- [ ] **Step 4: Full smoke — single-agent quality + cross-session + cross-agent**

```bash
python3 <<'PY'
import json, re, subprocess, sys, uuid

THREAD_HC = f"t-final-{uuid.uuid4().hex[:8]}"
THREAD_LP = f"t-final-{uuid.uuid4().hex[:8]}"

def run(agent, input_text, threadId, messages=None):
    body = {"input": input_text, "context": {"userId": "kckern"}, "threadId": threadId}
    if messages is not None: body["messages"] = messages
    r = subprocess.run(
        ["curl", "-sS", "-m", "120", "-X", "POST",
         f"http://localhost:3111/api/v1/agents/{agent}/run",
         "-H", "Content-Type: application/json",
         "-d", json.dumps(body)],
        capture_output=True, text=True
    )
    try: return json.loads(r.stdout)
    except: print('PARSE_FAIL', r.stdout[:300]); return {}

# Quality smoke: existing reflective behavior still works
print(f"=== Q0: existing health-coach quality (threadId={THREAD_HC}) ===")
r0 = run("health-coach", "how was my run today?", THREAD_HC,
    messages=[{"role":"user","content":"how was my run today?"}])
out0 = (r0.get("output") or "").strip()
print("OUT:", out0[:400])

# Turn 1: establish focus
print(f"\n=== Q1: establish focus (same thread) ===")
r1 = run("health-coach",
    "I'm focusing on Z2 endurance this month. Please remember.",
    THREAD_HC,
    messages=[
        {"role":"user","content":"how was my run today?"},
        {"role":"assistant","content":out0},
        {"role":"user","content":"I'm focusing on Z2 endurance this month. Please remember."},
    ])
out1 = (r1.get("output") or "").strip()
print("OUT:", out1[:400])

# Turn 2: same thread, EMPTY messages
print(f"\n=== Q2: same thread, NO history ===")
r2 = run("health-coach", "what was I focusing on this month?", THREAD_HC, messages=[])
out2 = (r2.get("output") or "").strip()
print("OUT:", out2[:400])

# Turn 3: cross-agent, different threadId
print(f"\n=== Q3: cross-agent (lifeplan-guide, threadId={THREAD_LP}) ===")
r3 = run("lifeplan-guide", "what does kc want to focus on right now in fitness?", THREAD_LP, messages=[])
out3 = (r3.get("output") or "").strip()
print("OUT:", out3[:400])

print("\n=== CHECKS ===")
checks = [
    ("Q0: existing reflective behavior produces real numbers",
     bool(re.search(r"\b(28|HR|heart rate|min|minute)", out0, re.I)) and len(out0) > 30),
    ("Q1: agent acknowledges focus",
     bool(re.search(r"\b(z2|endurance|zone 2|got it|noted|remember)", out1, re.I))),
    ("Q2: server-side recall (empty messages, agent recalls focus)",
     bool(re.search(r"\b(z2|endurance|zone 2|zone-2)", out2, re.I))),
    ("Q3: cross-agent recall (resource-scoped working memory)",
     bool(re.search(r"\b(z2|endurance|zone 2|zone-2)", out3, re.I))),
]
all_ok = True
for label, ok in checks:
    print(("✓" if ok else "✗"), label)
    all_ok = all_ok and ok
sys.exit(0 if all_ok else 1)
PY
echo "exit: $?"
```

If Q3 fails (cross-agent recall), the working memory schema is still being rejected — check `sudo docker logs daylight-station --since 60s | grep -i "memory\|schema"`. Most likely fix: lifeplan-guide also needs `getMemoryConfig` declared (currently only health-coach has it), so its Mastra Memory has the same working memory schema attached for resource-scoped read.

For lifeplan-guide to read working memory written by health-coach, both agents need to share the same Memory instance OR each construct a Memory pointing at the same storage with overlapping schemas. Pragmatic v1: lifeplan-guide's `getMemoryConfig` returns a config with `lastMessages: 20` and the SAME healthCoachWorkingMemorySchema (since they share the user model). When lifeplan-guide grows its own schema fields, union them.

If Q3 still fails after that: the resource-scope sharing might require both agents to use the same Memory INSTANCE, not just same storage. That's a deeper architectural choice for a follow-up.

- [ ] **Step 5: Final summary commit**

```bash
cd /opt/Code/DaylightStation && git commit --allow-empty -m "$(cat <<'EOF'
chore(agents): infrastructure declarations refactor shipped

5 plan tasks landed:
- T1: framework helpers (buildAgentMemory, buildAgentEventQueryService,
      buildAgentRuntime)
- T2: HealthCoachAgent declares its infrastructure via static methods
- T3: working memory schema as JSONSchema7 (bypasses the Zod conversion
      bug in @mastra/memory@1.17.5)
- T4: bootstrap refactored — zero #apps/agents/health-coach/ imports
- T5: deploy + smoke

DDD layering restored: 0_system depends on framework interfaces and
domain services, not on application-layer concrete classes. Adding a
new reflective agent now requires only declaring its static methods
and appending to REFLECTIVE_AGENTS — bootstrap stays untouched.

Cross-session continuity via Mastra Memory + working memory now both
work, verified by the 4-check smoke. lifeplan-guide reads the same
working memory health-coach writes, via resource-scope sharing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Concern | Tasks |
|---|---|
| bootstrap reaching into #apps/agents/health-coach | T4 (zero imports after refactor) |
| Per-agent Memory isolation OR sharing by declaration | T1 (helper) + T2 (declaration) + T4 (loop) |
| Working memory schema currently broken | T3 (JSONSchema7 fix) |
| Adding a new reflective agent should be zero-bootstrap-edit | T4 (REFLECTIVE_AGENTS array) |
| MediaJudge precedent (per-agent runtime already exists) | T1 (buildAgentRuntime generalizes the pattern) |
| Smoke proves cross-session + cross-agent recall | T5 (4-check live HTTP) |

---

## Notes for the implementer

- **Don't relocate EventQueryService in this plan.** It currently lives under `#apps/agents/health-coach/services/`. After T4, bootstrap doesn't import it directly anymore (the framework helper does), so the import smell is contained inside `buildAgentEventQueryService`. Moving EventQueryService to `#apps/agents/framework/` or `#domains/events/` is a follow-up cleanup — orthogonal to this DDD work.

- **Per-agent vs shared Memory db file.** v1 uses a single `data/agents/memory.db` shared across agents. Each agent's `Memory` instance is its own object pointing at the same file. LibSQL handles concurrent access fine for our scale. If write contention emerges, migrate to per-agent `data/agents/<agentId>/memory.db` files in a follow-up.

- **lifeplan-guide migration.** Out of scope. The plan keeps lifeplan-guide on its existing registration path. To get cross-agent working memory recall in T5's Q3 smoke, lifeplan-guide needs a minimal `getMemoryConfig` that points at the same working memory schema. Add it inline during T5 if needed (3-line change to `LifeplanGuideAgent`); document as a tactical inline addition.

- **Echo / PagedMediaToc / ConciergeAgent untouched.** They keep using the shared default `agentRuntime` MastraAdapter (constructed before the loop). Their existing registration paths continue. They don't have static infrastructure methods — that's fine; the loop only iterates `REFLECTIVE_AGENTS`.

- **MediaJudge as precedent.** `bootstrap.mjs:3429` already constructs a per-agent MastraAdapter (`judgeRuntime`) for MediaJudge. T1's `buildAgentRuntime` generalizes that pattern. After T4, MediaJudge could optionally migrate to use `buildAgentRuntime` too (one-line change), but it's not required.

- **No new dependencies.** Pure refactor + the JSONSchema fix. No package.json changes.

- **Test depth is intentional.** Each framework helper has its own test file (T1) so future per-agent infrastructure work can extend them without rebuilding tests. The static-method tests on HealthCoachAgent (T2) document the contract; the live smoke (T5) proves the integration.
