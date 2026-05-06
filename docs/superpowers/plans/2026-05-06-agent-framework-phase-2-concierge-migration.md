# Agent Framework Phase 2: Concierge Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `ConciergeAgent` onto `BaseAgent`, eliminating `ConciergeApplication`, `ConciergeTranscript`, `IConciergeMemory`, and `YamlConciergeMemoryAdapter`. Consolidate tool-bundle contracts, land `PolicyDecorator`, collapse to one `MastraAdapter` instance. The HA Voice wire format (`/v1/chat/completions`) stays **unchanged** — only the internal plumbing changes.

**Architecture:** `ConciergeAgent` becomes a `BaseAgent` subclass that overrides `buildPromptSections` and `buildToolDecorators`. Skills migrate from `ISkill` objects to `ToolBundle` classes. Memory migrates from `IConciergeMemory` to `IWorkingMemory` with `userId='household'`. The HTTP translator (`OpenAIChatCompletionsTranslator`) changes exactly one call: `runner.runChat/streamChat` → `orchestrator.run/streamExecute`. Everything HA Voice observes on the wire is identical.

**Tech Stack:** Node ESM (.mjs), Vitest, existing Mastra adapter, existing `AgentOrchestrator`.

**Prerequisites:** Phase 1 (Foundations) must be merged. This plan depends on `BaseAgent.buildPromptSections`, `AgentTranscript` optional fields, `ToolDecorator` interface, and `applyDecorators` pipeline.

**Audit reference:** Addresses DRY-H1, DRY-H2, DRY-H4, DRY-H5, DRY-M1, DRY-M2 from `docs/_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md`.

---

## Why this plan exists

Concierge predates the agent framework and was never refactored to use it. Today every concierge turn produces **two transcripts** written to two different directories (audit DRY-H1 + DRY-H5). There are two parallel composition roots — `ConciergeApplication` alongside `AgentOrchestrator` — and two memory port hierarchies backed by the same underlying YAML adapter (DRY-H4). The tool-bundle abstraction exists in two incompatible forms: `ISkill` (concierge, with prompt-fragment hook) and `ToolFactory` (framework, without it) — DRY-M1. Policy gating is woven into `SkillRegistry.#wrap`, making it invisible to the framework's decorator chain (DRY-H2).

Phase 1 placed the hooks. This plan pulls the concierge stack through them: `ToolBundle` replaces `ISkill`, `PolicyDecorator` is a first-class framework decorator, `ConciergeAgent` extends `BaseAgent` and registers via `agentOrchestrator.register`, one `MastraAdapter` instance serves all agents, and `AgentTranscript` (with its new optional fields) replaces `ConciergeTranscript`. The HA Voice wire is unchanged throughout.

---

## File structure

**New files:**

```
backend/src/3_applications/agents/framework/
  ToolBundle.mjs                         — unified ISkill replacement (name, createTools, getPromptFragment?, getConfig?)
  ToolBundle.test.mjs
  decorators/
    PolicyDecorator.mjs                  — (tool, context) => wrappedTool; reads context.policy.evaluateToolCall
    PolicyDecorator.test.mjs

backend/src/3_applications/agents/concierge/
  ConciergeAgent.mjs                     — extends BaseAgent; overrides buildPromptSections + buildToolDecorators
  prompts/                               — moved verbatim from concierge/prompts/
    system.mjs
  skills/                                — migrated from concierge/skills/
    MemoryBundle.mjs                     — MemorySkill rewritten as ToolBundle
    HomeAutomationBundle.mjs             — HomeAutomationSkill rewritten as ToolBundle
    MediaBundle.mjs                      — MediaSkill rewritten as ToolBundle
  policy/                                — moved verbatim from concierge/services/
    ConciergePolicyEvaluator.mjs
    PassThroughConciergePolicy.mjs
    scopeMatcher.mjs
    MediaPolicyGate.mjs
  services/
    MediaJudge.mjs                       — moved verbatim; unchanged
    YamlSatelliteRegistry.mjs            — moved verbatim; unchanged

tests/isolated/agents/concierge/
  ConciergeAgent.test.mjs                — BaseAgent subclass unit tests
  PolicyDecorator.test.mjs               — decorator unit tests (also in decorators/)
  MemoryBundle.test.mjs                  — ToolBundle migration tests
  concierge-smoke.test.mjs               — synthetic HA Voice end-to-end
```

**Modified files:**

```
backend/src/3_applications/agents/framework/BaseAgent.mjs
  + buildToolDecorators() hook (default: []) — subclass may override to add PolicyDecorator

backend/src/0_system/bootstrap.mjs
  - createConciergeServices() internals (ConciergeApplication, YamlConciergeMemoryAdapter, SkillRegistry)
  + agentOrchestrator.register(ConciergeAgent, deps)
  + single MastraAdapter shared between framework + concierge
  + OpenAIChatCompletionsTranslator receives orchestrator instead of ConciergeApplication

backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs
  - imports ConciergeTranscript
  - runner.runChat / runner.streamChat calls
  + orchestrator.run / orchestrator.streamExecute calls
  + AgentTranscript (with setSatelliteSnapshot + setRequestBody)
```

**Deleted files:**

```
backend/src/3_applications/concierge/ConciergeAgent.mjs
backend/src/3_applications/concierge/ConciergeApplication.mjs
backend/src/3_applications/concierge/services/SkillRegistry.mjs
backend/src/3_applications/concierge/services/ConciergeTranscript.mjs
backend/src/3_applications/concierge/ports/ISkill.mjs
backend/src/3_applications/concierge/ports/IConciergeMemory.mjs
backend/src/1_adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs
backend/src/3_applications/concierge/skills/CalendarReadSkill.mjs   — unwired, dead code
backend/src/3_applications/concierge/skills/FinanceReadSkill.mjs    — unwired, dead code
backend/src/3_applications/concierge/skills/FitnessReadSkill.mjs    — unwired, dead code
backend/src/3_applications/concierge/skills/LifelogReadSkill.mjs    — unwired, dead code
```

---

## Conventions

- Vitest. Run individual files with `npx vitest run <path>`.
- TDD: test → run-FAIL → impl → run-PASS → commit per task.
- Every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- After each task, run the **full agents test suite** to confirm no regression:
  ```bash
  cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
  ```
  Expected: all green throughout. If anything regresses, stop and fix before continuing.
- Tasks 1–6 are parallel-safe — they build new code without removing old code. The destructive deletions happen in Tasks 7–9.
- Do not delete `backend/src/3_applications/concierge/` until Task 9 confirms smoke tests pass.
- `context.policy` is only non-null on concierge agent turns. The `PolicyDecorator` is a no-op (pass-through) when `context.policy` is null.

---

## Task 1: `ToolBundle` interface

Define the unified bundle contract that replaces both `ISkill` and `ToolFactory`. This is an additive file — no existing code is touched.

**Files:**
- Create: `backend/src/3_applications/agents/framework/ToolBundle.mjs`
- Create: `backend/src/3_applications/agents/framework/ToolBundle.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// backend/src/3_applications/agents/framework/ToolBundle.test.mjs
import { describe, it, expect } from 'vitest';
import { isToolBundle, assertToolBundle, ToolBundle } from './ToolBundle.mjs';

describe('isToolBundle', () => {
  it('returns false for null', () => {
    expect(isToolBundle(null)).toBe(false);
  });

  it('returns false when name is missing', () => {
    expect(isToolBundle({ createTools: () => [] })).toBe(false);
  });

  it('returns false when createTools is not a function', () => {
    expect(isToolBundle({ name: 'x', createTools: 'nope' })).toBe(false);
  });

  it('returns true for minimal valid bundle', () => {
    expect(isToolBundle({ name: 'memory', createTools: () => [] })).toBe(true);
  });

  it('returns true when optional methods are present', () => {
    expect(isToolBundle({
      name: 'media',
      createTools: () => [],
      getPromptFragment: () => '## media',
      getConfig: () => ({}),
    })).toBe(true);
  });
});

describe('assertToolBundle', () => {
  it('throws on invalid bundle', () => {
    expect(() => assertToolBundle({})).toThrow('ToolBundle');
  });

  it('does not throw on valid bundle', () => {
    expect(() => assertToolBundle({ name: 'x', createTools: () => [] })).not.toThrow();
  });
});

describe('ToolBundle base class', () => {
  class ConcreteBundle extends ToolBundle {
    static bundleName = 'test';
    createTools() { return [{ name: 'noop', description: 'd', parameters: {}, execute: async () => ({}) }]; }
  }

  it('createTools returns the overridden tools', () => {
    const b = new ConcreteBundle({});
    expect(b.createTools()).toHaveLength(1);
    expect(b.createTools()[0].name).toBe('noop');
  });

  it('getPromptFragment returns null by default', () => {
    const b = new ConcreteBundle({});
    expect(b.getPromptFragment({})).toBeNull();
  });

  it('getConfig returns empty object by default', () => {
    const b = new ConcreteBundle({});
    expect(b.getConfig()).toEqual({});
  });

  it('name getter returns static bundleName', () => {
    const b = new ConcreteBundle({});
    expect(b.name).toBe('test');
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/3_applications/agents/framework/ToolBundle.test.mjs
```

- [ ] **Step 3: Implement `ToolBundle.mjs`**

```javascript
// backend/src/3_applications/agents/framework/ToolBundle.mjs

/**
 * ToolBundle — unified contract for a named group of tools.
 *
 * Replaces both `ISkill` (concierge, which had getPromptFragment) and
 * `ToolFactory` (framework, which did not). The prompt-fragment hook is now
 * optional — concierge bundles implement it; health-coach factories leave it
 * as the default null.
 *
 * Naming convention: concrete bundles declare a static `bundleName` string.
 * The base class exposes it via the `name` getter so duck-typed checks still
 * work without the caller needing to know whether they have an instance or
 * a plain object.
 */
export class ToolBundle {
  /** @type {string} — override in subclass */
  static bundleName = '';

  get name() { return this.constructor.bundleName || this.constructor.name; }

  /**
   * Return the ITool array for this bundle.
   * @returns {import('./ports/ITool.mjs').ITool[]}
   */
  createTools() {
    throw new Error(`${this.constructor.name}.createTools() must be implemented`);
  }

  /**
   * Optional prompt section injected before the memory block.
   * Return null (or undefined) to omit.
   * @param {object} context — agent context (may include satellite for concierge)
   * @returns {string|null}
   */
  getPromptFragment(_context) { return null; }

  /**
   * Optional config accessor — return any serialisable config the bundle wants
   * to expose for observability / logging.
   * @returns {object}
   */
  getConfig() { return {}; }
}

/**
 * Duck-typed guard — accepts class instances AND plain objects (for tests and
 * adapters that build plain-object bundles inline).
 */
export function isToolBundle(obj) {
  return !!obj
    && typeof obj.name === 'string'
    && obj.name.length > 0
    && typeof obj.createTools === 'function';
}

export function assertToolBundle(obj) {
  if (!isToolBundle(obj)) {
    throw new Error(
      `ToolBundle: object does not satisfy the ToolBundle contract. `
      + `Expected { name: string, createTools(): ITool[] }. Got: ${JSON.stringify(obj)}`
    );
  }
}

export default ToolBundle;
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/3_applications/agents/framework/ToolBundle.test.mjs
```

- [ ] **Step 5: Run full agent test suite — confirm zero regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/framework/ToolBundle.mjs \
        backend/src/3_applications/agents/framework/ToolBundle.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): ToolBundle interface — unified ISkill/ToolFactory replacement (audit DRY-M1)

Optional getPromptFragment + getConfig so concierge skills migrate without
losing their prompt-section hooks. Duck-typed isToolBundle guard accepts
plain objects for test ergonomics.

Plan / Phase 2 Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `PolicyDecorator`

Create the decorator that gates tool execution through `context.policy.evaluateToolCall`. When `context.policy` is null or absent, it is a strict pass-through — no other agent is affected.

**Files:**
- Create: `backend/src/3_applications/agents/framework/decorators/PolicyDecorator.mjs`
- Create: `backend/src/3_applications/agents/framework/decorators/PolicyDecorator.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// backend/src/3_applications/agents/framework/decorators/PolicyDecorator.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { policyDecorator } from './PolicyDecorator.mjs';

function makeTool(executeFn) {
  return {
    name: 'control_lights',
    description: 'Toggle lights',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: executeFn ?? vi.fn(async () => ({ ok: true })),
    defaultPolicy: 'open',
    getScopesFor: () => ['ha:lights'],
  };
}

function makePolicy({ allow = true, reason = null } = {}) {
  return {
    evaluateToolCall: vi.fn(() => ({ allow, reason })),
  };
}

describe('policyDecorator — pass-through when no policy', () => {
  it('calls original execute when context.policy is null', async () => {
    const innerExecute = vi.fn(async () => ({ ok: true }));
    const tool = makeTool(innerExecute);
    const wrapped = policyDecorator(tool, { policy: null });
    const result = await wrapped.execute({ brightness: 50 }, {});
    expect(innerExecute).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
  });

  it('calls original execute when context has no policy key', async () => {
    const innerExecute = vi.fn(async () => ({ ok: true }));
    const tool = makeTool(innerExecute);
    const wrapped = policyDecorator(tool, {});
    await wrapped.execute({}, {});
    expect(innerExecute).toHaveBeenCalledOnce();
  });
});

describe('policyDecorator — policy allow', () => {
  it('calls evaluateToolCall with the right arguments', async () => {
    const tool = makeTool();
    const policy = makePolicy({ allow: true });
    const satellite = { id: 'kitchen', area: 'kitchen' };
    const context = { policy, satellite };
    const wrapped = policyDecorator(tool, context);
    await wrapped.execute({ brightness: 80 }, context);
    expect(policy.evaluateToolCall).toHaveBeenCalledWith(
      satellite,
      'control_lights',
      { brightness: 80 },
      tool,
      null,   // skillName — not available at decorator level; null is correct
    );
  });

  it('forwards to inner execute when policy allows', async () => {
    const innerExecute = vi.fn(async () => ({ ok: true, state: 'on' }));
    const tool = makeTool(innerExecute);
    const context = { policy: makePolicy({ allow: true }), satellite: {} };
    const wrapped = policyDecorator(tool, context);
    const result = await wrapped.execute({}, context);
    expect(innerExecute).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, state: 'on' });
  });
});

describe('policyDecorator — policy deny', () => {
  it('returns denied envelope without calling inner execute', async () => {
    const innerExecute = vi.fn();
    const tool = makeTool(innerExecute);
    const policy = makePolicy({ allow: false, reason: 'uncovered:ha:lights' });
    const context = { policy, satellite: { id: 'tv' } };
    const wrapped = policyDecorator(tool, context);
    const result = await wrapped.execute({}, context);
    expect(innerExecute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/policy_denied/);
  });

  it('records policyDecision on context.transcript when provided', async () => {
    const tool = makeTool();
    const policy = makePolicy({ allow: false, reason: 'satellite:ha:*' });
    const transcript = { recordTool: vi.fn() };
    const context = { policy, satellite: { id: 'tv' }, transcript };
    const wrapped = policyDecorator(tool, context);
    await wrapped.execute({ scene: 'movie' }, context);
    expect(transcript.recordTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'control_lights',
      ok: false,
      policyDecision: { allowed: false, reason: 'satellite:ha:*' },
    }));
  });
});

describe('policyDecorator — tool field preservation', () => {
  it('preserves name, description, and parameters', () => {
    const tool = makeTool();
    const wrapped = policyDecorator(tool, {});
    expect(wrapped.name).toBe('control_lights');
    expect(wrapped.description).toBe('Toggle lights');
    expect(wrapped.parameters).toEqual(tool.parameters);
  });

  it('preserves defaultPolicy and getScopesFor', () => {
    const tool = makeTool();
    const wrapped = policyDecorator(tool, {});
    expect(wrapped.defaultPolicy).toBe('open');
    expect(typeof wrapped.getScopesFor).toBe('function');
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/3_applications/agents/framework/decorators/PolicyDecorator.test.mjs
```

- [ ] **Step 3: Implement `PolicyDecorator.mjs`**

```javascript
// backend/src/3_applications/agents/framework/decorators/PolicyDecorator.mjs

/**
 * policyDecorator — ToolDecorator that gates execution through context.policy.
 *
 * When context.policy is null/absent, returns the tool unchanged (pass-through).
 * This ensures health-coach and other non-policy agents are not affected.
 *
 * The decorator reads `tool.defaultPolicy` and `tool.getScopesFor` (concierge-
 * specific optional fields) and passes them to evaluateToolCall — the policy
 * implementation decides how to use them. Plain tools that lack these fields
 * still work: evaluateToolCall receives `undefined` for the fields and the
 * ConciergePolicyEvaluator treats missing `getScopesFor` as a fallback scope.
 *
 * @type {import('./ToolDecorator.mjs').ToolDecorator}
 */
export function policyDecorator(tool, context) {
  const policy = context?.policy ?? null;

  // No policy in context — strict pass-through. Do not wrap.
  if (!policy) return tool;

  const satellite = context.satellite ?? null;

  return {
    ...tool,
    execute: async (params, callCtx) => {
      const transcript = (callCtx ?? context)?.transcript ?? context?.transcript ?? null;
      const decision = policy.evaluateToolCall(
        satellite,
        tool.name,
        params,
        tool,
        null,   // skillName — not tracked at decorator level; policy uses fallback scope
      );

      if (!decision.allow) {
        const denied = {
          ok: false,
          reason: `policy_denied:${decision.reason ?? 'unspecified'}`,
        };
        transcript?.recordTool({
          name: tool.name,
          args: params,
          result: denied,
          ok: false,
          latencyMs: 0,
          policyDecision: { allowed: false, reason: decision.reason ?? null },
        });
        return denied;
      }

      // Allowed — let the next decorator (TranscriptRecorder → inner execute) run.
      // We do NOT record allowed calls here — TranscriptRecorder handles that, and
      // it will include policyDecision: { allowed: true } when it detects the field.
      return tool.execute(params, callCtx);
    },
  };
}

export default policyDecorator;
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/3_applications/agents/framework/decorators/PolicyDecorator.test.mjs
```

- [ ] **Step 5: Run full agent test suite — confirm zero regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/framework/decorators/PolicyDecorator.mjs \
        backend/src/3_applications/agents/framework/decorators/PolicyDecorator.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): PolicyDecorator — tool gate for context.policy (audit DRY-H2)

Pass-through when context.policy is null so no other agent is affected.
Reads tool.defaultPolicy + getScopesFor for concierge scope evaluation.
Records policyDecision on denied calls via context.transcript.

Plan / Phase 2 Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `BaseAgent.buildToolDecorators` hook

Add the override point so `ConciergeAgent` can inject `policyDecorator` into the chain. Default returns an empty array — existing agents are unaffected.

**Files:**
- Modify: `backend/src/3_applications/agents/framework/BaseAgent.mjs`
- Modify: `tests/isolated/agents/framework/` — add test for the hook (new file or extend existing)

- [ ] **Step 1: Read the current `BaseAgent.mjs` to locate the decorator chain call site**

```bash
cd /opt/Code/DaylightStation && grep -n "applyDecorators\|buildToolDecorators\|#decorators\|getTools\|decorat" \
  backend/src/3_applications/agents/framework/BaseAgent.mjs
```

Identify:
- Where `applyDecorators` is called (should be in `run` or the method that prepares tools for `agentRuntime.execute`)
- Current default decorator list (from Phase 1: `[UserIdInjector, CallLimiter, TranscriptRecorder]`)

- [ ] **Step 2: Write failing test**

```javascript
// tests/isolated/agents/framework/BaseAgent.buildToolDecorators.test.mjs
import { describe, it, expect, vi } from 'vitest';

// Concrete minimal subclass
class TestAgent extends BaseAgent {
  static id = 'test-agent';
  static description = 'test';
  registerTools() {}
}

class PolicyTestAgent extends BaseAgent {
  static id = 'policy-agent';
  static description = 'has policy';
  registerTools() {}

  buildToolDecorators() {
    // Returns a sentinel so the test can confirm override works
    return [sentinelDecorator];
  }
}

const sentinelDecorator = vi.fn((tool) => ({ ...tool, _sentinel: true }));

// Import BaseAgent — adjust path to match project aliases
// The test file will need to resolve BaseAgent; adapt import if needed.
// For now, declare the describe blocks and let the implementer wire the import.

describe('BaseAgent.buildToolDecorators default', () => {
  it('returns an empty array by default', () => {
    const agent = new TestAgent({ logger: console });
    expect(agent.buildToolDecorators()).toEqual([]);
  });
});

describe('BaseAgent.buildToolDecorators override', () => {
  it('subclass override is respected', () => {
    const agent = new PolicyTestAgent({ logger: console });
    const decorators = agent.buildToolDecorators();
    expect(decorators).toHaveLength(1);
    expect(decorators[0]).toBe(sentinelDecorator);
  });
});
```

NOTE: Read the existing `BaseAgent.test.mjs` (or `BaseAgent.buildPromptSections.test.mjs` from Phase 1) to confirm how `BaseAgent` is imported and instantiated in the test environment. Match that pattern exactly.

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/BaseAgent.buildToolDecorators.test.mjs
```

- [ ] **Step 4: Implement `buildToolDecorators` on `BaseAgent`**

In `backend/src/3_applications/agents/framework/BaseAgent.mjs`, add the public method:

```javascript
/**
 * buildToolDecorators — override in subclasses to inject additional ToolDecorators
 * into the chain before the framework defaults (UserIdInjector, CallLimiter, TranscriptRecorder).
 *
 * The returned decorators run BEFORE the framework defaults — i.e. they wrap
 * the raw tool first, and the framework defaults wrap the result. At call time,
 * the outermost decorator runs first.
 *
 * @returns {import('./decorators/ToolDecorator.mjs').ToolDecorator[]}
 */
buildToolDecorators() {
  return [];
}
```

Then update the site where `applyDecorators` is called (found in Step 1). Prepend the result of `this.buildToolDecorators()` to the framework default list:

```javascript
// Before (Phase 1 result):
const decoratedTools = tools.map(t =>
  applyDecorators(t, [UserIdInjector, CallLimiter, TranscriptRecorder], context)
);

// After:
const agentDecorators = this.buildToolDecorators();
const decoratedTools = tools.map(t =>
  applyDecorators(t, [...agentDecorators, UserIdInjector, CallLimiter, TranscriptRecorder], context)
);
```

CRITICAL: read the actual Phase 1 implementation of the decorator chain call before editing. The snippet above is illustrative — match the real call signature.

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/BaseAgent.buildToolDecorators.test.mjs
```

- [ ] **Step 6: Run full agent test suite — confirm zero regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/agents/framework/BaseAgent.mjs \
        tests/isolated/agents/framework/BaseAgent.buildToolDecorators.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): BaseAgent.buildToolDecorators hook — default empty, subclass override point

Prepended to the framework decorator chain (UserIdInjector → CallLimiter →
TranscriptRecorder). Concierge will override to inject PolicyDecorator.
No behavior change on existing agents.

Plan / Phase 2 Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Migrate `MemorySkill` → `MemoryBundle`

Rewrite `MemorySkill` as a `ToolBundle`. The key behavior change: tools mutate an in-memory `WorkingMemoryState` passed in via `context.memory` instead of calling `memory.get/set` per-tool (which round-trips the YAML file on every call). Memory is loaded once per turn and saved once at turn end by `BaseAgent.run` — exactly the health-coach pattern.

**Files:**
- Create: `backend/src/3_applications/agents/concierge/skills/MemoryBundle.mjs`
- Create: `tests/isolated/agents/concierge/MemoryBundle.test.mjs`

- [ ] **Step 1: Read `WorkingMemoryState` API**

```bash
cd /opt/Code/DaylightStation && grep -n "class WorkingMemoryState\|get(\|set(\|remove(\|getAll\|serialize\|pruneExpired" \
  backend/src/3_applications/agents/framework/WorkingMemory.mjs | head -25
```

Identify: `state.get(key)`, `state.set(key, value)`, `state.remove(key)`.

- [ ] **Step 2: Write failing test**

```javascript
// tests/isolated/agents/concierge/MemoryBundle.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryBundle } from '../../../backend/src/3_applications/agents/concierge/skills/MemoryBundle.mjs';

// Minimal WorkingMemoryState stand-in
function makeMemoryState(initial = {}) {
  const data = { ...initial };
  return {
    get: (key) => data[key] ?? null,
    set: (key, value) => { data[key] = value; },
    remove: (key) => { delete data[key]; },
    _data: data,
  };
}

describe('MemoryBundle', () => {
  it('satisfies ToolBundle contract', () => {
    const bundle = new MemoryBundle({});
    expect(typeof bundle.name).toBe('string');
    expect(typeof bundle.createTools).toBe('function');
  });

  it('name is "memory"', () => {
    expect(new MemoryBundle({}).name).toBe('memory');
  });

  it('getPromptFragment returns a non-empty string', () => {
    const frag = new MemoryBundle({}).getPromptFragment({});
    expect(typeof frag).toBe('string');
    expect(frag.length).toBeGreaterThan(0);
  });

  describe('remember_note tool', () => {
    let tool, state, context;
    beforeEach(() => {
      state = makeMemoryState();
      context = { memory: state };
      tool = new MemoryBundle({}).createTools().find(t => t.name === 'remember_note');
    });

    it('appends a note to context.memory', async () => {
      const result = await tool.execute({ content: 'Dogs are allowed' }, context);
      expect(result.ok).toBe(true);
      const notes = state.get('notes');
      expect(Array.isArray(notes)).toBe(true);
      expect(notes[0].content).toBe('Dogs are allowed');
    });

    it('trims content to 280 characters', async () => {
      const longContent = 'x'.repeat(400);
      await tool.execute({ content: longContent }, context);
      const notes = state.get('notes');
      expect(notes[0].content.length).toBe(280);
    });

    it('returns ok: false for empty content', async () => {
      const result = await tool.execute({ content: '' }, context);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('empty_note');
    });

    it('caps notes at maxNotes', async () => {
      const bundle = new MemoryBundle({ config: { maxNotes: 3 } });
      const t = bundle.createTools().find(t => t.name === 'remember_note');
      for (let i = 0; i < 5; i++) {
        await t.execute({ content: `note ${i}` }, context);
      }
      expect(state.get('notes')).toHaveLength(3);
    });
  });

  describe('recall_note tool', () => {
    it('returns the last N notes', async () => {
      const state = makeMemoryState({ notes: [
        { content: 'a', t: '2026-01-01T00:00:00Z' },
        { content: 'b', t: '2026-01-02T00:00:00Z' },
        { content: 'c', t: '2026-01-03T00:00:00Z' },
      ]});
      const context = { memory: state };
      const tool = new MemoryBundle({}).createTools().find(t => t.name === 'recall_note');
      const result = await tool.execute({ limit: 2 }, context);
      expect(result.notes).toHaveLength(2);
      expect(result.notes[0].content).toBe('b');
      expect(result.notes[1].content).toBe('c');
    });

    it('returns empty array when no notes saved', async () => {
      const context = { memory: makeMemoryState() };
      const tool = new MemoryBundle({}).createTools().find(t => t.name === 'recall_note');
      const result = await tool.execute({}, context);
      expect(result.notes).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/concierge/MemoryBundle.test.mjs
```

- [ ] **Step 4: Implement `MemoryBundle.mjs`**

```javascript
// backend/src/3_applications/agents/concierge/skills/MemoryBundle.mjs
import { ToolBundle } from '../../framework/ToolBundle.mjs';

/**
 * MemoryBundle — replaces MemorySkill.
 *
 * Tools operate on context.memory (a WorkingMemoryState already loaded by
 * BaseAgent.run). No per-tool YAML round-trips. BaseAgent saves automatically
 * at turn end.
 */
export class MemoryBundle extends ToolBundle {
  static bundleName = 'memory';

  #maxNotes;

  constructor({ config = {} } = {}) {
    super();
    this.#maxNotes = config.maxNotes ?? 200;
  }

  getConfig() { return { maxNotes: this.#maxNotes }; }

  getPromptFragment(_context) {
    return `## Memory
You may use \`remember_note\` to store a short fact about the household for future conversations
(preferences, allergies, schedules, plans). Use \`recall_note\` to read the most recent notes.
Do not use this for transient context; the messages array already carries the active turn.`;
  }

  createTools() {
    const maxNotes = this.#maxNotes;

    return [
      {
        name: 'remember_note',
        description: 'Save a short note about the household for long-term memory.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The note text (under 280 chars).' },
          },
          required: ['content'],
        },
        async execute({ content }, context) {
          const trimmed = String(content ?? '').slice(0, 280);
          if (!trimmed) return { ok: false, reason: 'empty_note' };
          const memory = context?.memory;
          if (!memory) return { ok: false, reason: 'no_memory_context' };
          const notes = (memory.get('notes')) ?? [];
          notes.push({ content: trimmed, t: new Date().toISOString() });
          while (notes.length > maxNotes) notes.shift();
          memory.set('notes', notes);
          return { ok: true, count: notes.length };
        },
      },
      {
        name: 'recall_note',
        description: 'Read the most recent notes about the household.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of notes to return (default 5).' },
          },
        },
        async execute({ limit = 5 }, context) {
          const memory = context?.memory;
          if (!memory) return { notes: [] };
          const notes = (memory.get('notes')) ?? [];
          return { notes: notes.slice(-Math.max(1, Math.min(50, limit))) };
        },
      },
    ];
  }
}

export default MemoryBundle;
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/concierge/MemoryBundle.test.mjs
```

- [ ] **Step 6: Run full agent test suite — confirm zero regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/agents/concierge/skills/MemoryBundle.mjs \
        tests/isolated/agents/concierge/MemoryBundle.test.mjs
git commit -m "$(cat <<'EOF'
feat(concierge): MemoryBundle — MemorySkill migrated to ToolBundle (audit DRY-H4, DRY-M1)

Tools mutate context.memory (WorkingMemoryState) directly — no per-tool
YAML round-trips. Memory saved once at turn end by BaseAgent.run.

Plan / Phase 2 Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Migrate `HomeAutomationSkill` → `HomeAutomationBundle`

Wrap the existing tool implementations in the `ToolBundle` shape. This is largely a structural rename; the HA gateway calls are untouched.

**Files:**
- Create: `backend/src/3_applications/agents/concierge/skills/HomeAutomationBundle.mjs`
- No separate test file needed — the bundle is covered by the concierge smoke test in Task 12.

- [ ] **Step 1: Read `HomeAutomationSkill.mjs`**

```bash
cd /opt/Code/DaylightStation && cat backend/src/3_applications/concierge/skills/HomeAutomationSkill.mjs
```

Read in full. Identify:
- Constructor dependencies (typically `haGateway`, `logger`, `config`)
- The `getPromptFragment` string
- Each tool: `name`, `parameters`, `execute` body

- [ ] **Step 2: Implement `HomeAutomationBundle.mjs`**

Create `backend/src/3_applications/agents/concierge/skills/HomeAutomationBundle.mjs` following this skeleton. Fill tool bodies verbatim from `HomeAutomationSkill.getTools()` — do not paraphrase or simplify the execute logic:

```javascript
// backend/src/3_applications/agents/concierge/skills/HomeAutomationBundle.mjs
import { ToolBundle } from '../../framework/ToolBundle.mjs';

export class HomeAutomationBundle extends ToolBundle {
  static bundleName = 'home_automation';

  #haGateway;
  #logger;
  #config;

  constructor({ haGateway, logger = console, config = {} }) {
    super();
    if (!haGateway) throw new Error('HomeAutomationBundle: haGateway required');
    this.#haGateway = haGateway;
    this.#logger = logger;
    this.#config = config;
  }

  getConfig() { return { ...this.#config }; }

  getPromptFragment(_context) {
    // Copy verbatim from HomeAutomationSkill.getPromptFragment()
    return `## Home Automation
// ... (paste verbatim from source file) ...`;
  }

  createTools() {
    const haGateway = this.#haGateway;
    const logger = this.#logger;
    // Paste all tools from HomeAutomationSkill.getTools() verbatim.
    // No logic changes — just structural placement inside createTools().
    return [
      // ... tools verbatim ...
    ];
  }
}

export default HomeAutomationBundle;
```

CRITICAL: Copy tool execute bodies **verbatim** from `HomeAutomationSkill.getTools()`. Do not summarize or rephrase. The bundle is functionally identical to the old skill; only the container changes.

- [ ] **Step 3: Run full agent test suite — confirm no accidental import side-effects**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/agents/concierge/skills/HomeAutomationBundle.mjs
git commit -m "$(cat <<'EOF'
feat(concierge): HomeAutomationBundle — HomeAutomationSkill migrated to ToolBundle (audit DRY-M1)

Structural rename only. HA gateway calls are verbatim from the old skill.
Old HomeAutomationSkill.mjs remains in place until Task 9 cleanup.

Plan / Phase 2 Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate `MediaSkill` → `MediaBundle`

The largest skill. `MediaJudge` is a separately-configured `MastraAdapter` call — it stays as-is. The bundle wraps the existing tool implementations unchanged.

**Files:**
- Create: `backend/src/3_applications/agents/concierge/skills/MediaBundle.mjs`

- [ ] **Step 1: Read `MediaSkill.mjs` in full**

```bash
cd /opt/Code/DaylightStation && cat backend/src/3_applications/concierge/skills/MediaSkill.mjs
```

Identify:
- Constructor dependencies (typically `contentQueryService`, `playMediaUseCase`, `mediaPolicyGate`, `judge`, `logger`, `config`)
- `getPromptFragment` content
- All tools: `name`, `parameters`, `execute` bodies
- How `judge` (the `MediaJudge` instance) is used inside tool execute bodies

- [ ] **Step 2: Implement `MediaBundle.mjs`**

```javascript
// backend/src/3_applications/agents/concierge/skills/MediaBundle.mjs
import { ToolBundle } from '../../framework/ToolBundle.mjs';

export class MediaBundle extends ToolBundle {
  static bundleName = 'media';

  #contentQueryService;
  #playMediaUseCase;
  #mediaPolicyGate;
  #judge;
  #logger;
  #config;

  constructor({ contentQueryService, playMediaUseCase, mediaPolicyGate = null, judge = null, logger = console, config = {} }) {
    super();
    if (!contentQueryService) throw new Error('MediaBundle: contentQueryService required');
    if (!playMediaUseCase) throw new Error('MediaBundle: playMediaUseCase required');
    this.#contentQueryService = contentQueryService;
    this.#playMediaUseCase = playMediaUseCase;
    this.#mediaPolicyGate = mediaPolicyGate;
    this.#judge = judge;
    this.#logger = logger;
    this.#config = config;
  }

  getConfig() { return { hasJudge: !!this.#judge, ...this.#config }; }

  getPromptFragment(_context) {
    // Copy verbatim from MediaSkill.getPromptFragment()
    return `## Media Control
// ... (paste verbatim from source file) ...`;
  }

  createTools() {
    const contentQueryService = this.#contentQueryService;
    const playMediaUseCase = this.#playMediaUseCase;
    const mediaPolicyGate = this.#mediaPolicyGate;
    const judge = this.#judge;
    const logger = this.#logger;

    // Paste all tools from MediaSkill.getTools() verbatim.
    // The judge sub-agent call inside execute bodies stays exactly as-is.
    return [
      // ... tools verbatim ...
    ];
  }
}

export default MediaBundle;
```

CRITICAL: Copy tool execute bodies **verbatim** from `MediaSkill.getTools()`. Pay special attention to how `judge` is invoked — do not change its call site. The MediaJudge stays as a separate `MastraAdapter` instance (addressed in Task 8).

- [ ] **Step 3: Run full agent test suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/agents/concierge/skills/MediaBundle.mjs
git commit -m "$(cat <<'EOF'
feat(concierge): MediaBundle — MediaSkill migrated to ToolBundle (audit DRY-M1)

Structural rename only. MediaJudge sub-agent reference preserved verbatim
in execute bodies. Old MediaSkill.mjs remains until Task 9 cleanup.

Plan / Phase 2 Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `ConciergeAgent extends BaseAgent`

The central migration task. Create the new `ConciergeAgent` at `backend/src/3_applications/agents/concierge/ConciergeAgent.mjs`. It overrides `buildPromptSections` (returns the 6 concierge sections) and `buildToolDecorators` (adds `policyDecorator`). It drops `runChat`/`streamChat` — it inherits `run`/`runStream` from `BaseAgent`.

**Files:**
- Create: `backend/src/3_applications/agents/concierge/ConciergeAgent.mjs`
- Create: `tests/isolated/agents/concierge/ConciergeAgent.test.mjs`
- Create: `backend/src/3_applications/agents/concierge/prompts/system.mjs` (move verbatim from old location)

- [ ] **Step 1: Read the current prompt functions**

```bash
cd /opt/Code/DaylightStation && cat backend/src/3_applications/concierge/prompts/system.mjs
```

Note: `BASE_PROMPT`, `satellitePrompt(satellite)`, `memoryPrompt(snapshot)`, `vocabularyPrompt(vocab)`, `personalityPrompt(text)`. These are moved verbatim — no changes.

- [ ] **Step 2: Write failing test**

```javascript
// tests/isolated/agents/concierge/ConciergeAgent.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConciergeAgent } from '../../../backend/src/3_applications/agents/concierge/ConciergeAgent.mjs';
import { policyDecorator } from '../../../backend/src/3_applications/agents/framework/decorators/PolicyDecorator.mjs';

// Minimal ToolBundle stub
function makeBundle(name, tools = []) {
  return { name, createTools: () => tools, getPromptFragment: () => `## ${name}`, getConfig: () => ({}) };
}

// Minimal satellite
function makeSatellite(allowedSkills = ['memory']) {
  return {
    id: 'kitchen',
    area: 'kitchen',
    allowedSkills,
    canUseSkill: (name) => allowedSkills.includes(name),
    scopes_allowed: [],
    scopes_denied: [],
  };
}

function makeDeps(overrides = {}) {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    memory: { load: vi.fn(async () => ({ get: () => null, set: vi.fn(), serialize: () => '' })), save: vi.fn() },
    policy: { evaluateRequest: () => ({ allow: true }), evaluateToolCall: () => ({ allow: true }), shapeResponse: (_s, d) => d },
    toolBundles: [makeBundle('memory')],
    vocabulary: null,
    personality: null,
    ...overrides,
  };
}

describe('ConciergeAgent', () => {
  it('has static id = "concierge"', () => {
    expect(ConciergeAgent.id).toBe('concierge');
  });

  it('extends BaseAgent (inherits run method)', () => {
    const agent = new ConciergeAgent(makeDeps());
    expect(typeof agent.run).toBe('function');
  });

  it('buildToolDecorators includes policyDecorator', () => {
    const agent = new ConciergeAgent(makeDeps());
    const decorators = agent.buildToolDecorators();
    expect(decorators).toContain(policyDecorator);
  });

  describe('buildPromptSections', () => {
    it('returns an array with at least BASE_PROMPT, satellite, and memory sections', async () => {
      const agent = new ConciergeAgent(makeDeps());
      const satellite = makeSatellite();
      const memState = { get: () => null, set: vi.fn(), serialize: () => '' };
      const sections = await agent.buildPromptSections(
        { satellite, conversationId: null },
        memState
      );
      expect(Array.isArray(sections)).toBe(true);
      // BASE_PROMPT is always present
      expect(sections.some(s => typeof s === 'string' && s.length > 10)).toBe(true);
    });

    it('returns null for personality section when personality is null', async () => {
      const agent = new ConciergeAgent(makeDeps({ personality: null }));
      const satellite = makeSatellite();
      const memState = { get: () => null, set: vi.fn() };
      const sections = await agent.buildPromptSections({ satellite }, memState);
      // The sections array should contain nulls for omitted sections;
      // the framework's join(.filter(Boolean)) removes them.
      // Assert the personality slot is null or absent.
      const hasPersonality = sections.some(s => s && s.includes('personality'));
      expect(hasPersonality).toBe(false);
    });

    it('includes skill prompt fragments for allowed bundles', async () => {
      const bundle = makeBundle('memory');
      const agent = new ConciergeAgent(makeDeps({ toolBundles: [bundle] }));
      const satellite = makeSatellite(['memory']);
      const memState = { get: () => null, set: vi.fn() };
      const sections = await agent.buildPromptSections({ satellite }, memState);
      expect(sections.some(s => s && s.includes('## memory'))).toBe(true);
    });

    it('omits skill fragments for bundles not in satellite.allowedSkills', async () => {
      const bundle = makeBundle('media');
      const agent = new ConciergeAgent(makeDeps({ toolBundles: [bundle] }));
      const satellite = makeSatellite(['memory']); // media not allowed
      const memState = { get: () => null, set: vi.fn() };
      const sections = await agent.buildPromptSections({ satellite }, memState);
      expect(sections.some(s => s && s.includes('## media'))).toBe(false);
    });
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/concierge/ConciergeAgent.test.mjs
```

- [ ] **Step 4: Copy prompts verbatim**

```bash
mkdir -p /opt/Code/DaylightStation/backend/src/3_applications/agents/concierge/prompts
cp /opt/Code/DaylightStation/backend/src/3_applications/concierge/prompts/system.mjs \
   /opt/Code/DaylightStation/backend/src/3_applications/agents/concierge/prompts/system.mjs
```

Verify the copy:

```bash
diff /opt/Code/DaylightStation/backend/src/3_applications/concierge/prompts/system.mjs \
     /opt/Code/DaylightStation/backend/src/3_applications/agents/concierge/prompts/system.mjs
```

Expected: no diff.

- [ ] **Step 5: Implement `ConciergeAgent.mjs`**

```javascript
// backend/src/3_applications/agents/concierge/ConciergeAgent.mjs
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { policyDecorator } from '../framework/decorators/PolicyDecorator.mjs';
import {
  BASE_PROMPT,
  satellitePrompt,
  memoryPrompt,
  vocabularyPrompt,
  personalityPrompt,
} from './prompts/system.mjs';

/**
 * ConciergeAgent — household voice assistant agent.
 *
 * Consumed exclusively by HA Voice satellites via the OpenAI Chat Completions
 * HTTP surface (/v1/chat/completions). No frontend UI.
 *
 * Overrides:
 *   buildPromptSections — 6-section prompt (base, personality, satellite,
 *                          skill fragments, vocabulary, memory snapshot)
 *   buildToolDecorators  — prepends PolicyDecorator before framework defaults
 *   registerTools        — registers concierge ToolBundles for allowed skills
 */
export class ConciergeAgent extends BaseAgent {
  static id = 'concierge';
  static description = 'Household voice assistant — consumed by HA Voice satellites';

  #policy;
  #toolBundles;   // Map<bundleName, ToolBundle>
  #vocabulary;
  #personality;

  constructor({
    policy,
    toolBundles = [],
    vocabulary = null,
    personality = null,
    logger = console,
    ...baseDeps
  }) {
    super({ logger, ...baseDeps });
    if (!policy) throw new Error('ConciergeAgent: policy required');
    this.#policy = policy;
    this.#toolBundles = new Map(toolBundles.map(b => [b.name, b]));
    this.#vocabulary = vocabulary;
    this.#personality = personality;
  }

  // --- ToolDecorators ---

  buildToolDecorators() {
    return [policyDecorator];
  }

  // --- Tool registration ---

  registerTools() {
    // Tools are assembled per-turn from bundles via buildPromptSections + getTools.
    // We expose them here as a flat list; BaseAgent.getTools() will iterate.
    // Bundles for ALL skills are registered; the satellite filter is applied in
    // buildPromptSections and at tool-list assembly time via #bundlesFor.
    for (const bundle of this.#toolBundles.values()) {
      this.addToolBundle(bundle);
    }
  }

  // --- Prompt sections ---

  async buildPromptSections(context, memory) {
    const satellite = context?.satellite ?? null;
    const memorySnapshot = this.#snapshotMemory(memory);

    const skillFragments = satellite
      ? [...this.#toolBundles.values()]
          .filter(b => satellite.canUseSkill?.(b.name))
          .map(b => b.getPromptFragment?.(context) ?? null)
          .filter(Boolean)
          .join('\n\n')
      : null;

    return [
      BASE_PROMPT,
      personalityPrompt(this.#personality),
      satellite ? satellitePrompt(satellite) : null,
      skillFragments || null,
      vocabularyPrompt(this.#vocabulary),
      memorySnapshot ? memoryPrompt(memorySnapshot) : null,
    ];
    // BaseAgent joins with '\n\n' after .filter(Boolean)
  }

  // --- Memory snapshot (for prompt injection only) ---

  #snapshotMemory(memoryState) {
    if (!memoryState) return null;
    const notes = memoryState.get?.('notes') ?? [];
    const prefs = memoryState.get?.('preferences') ?? {};
    return { notes_recent: notes.slice(-5), preferences: prefs };
  }

  // --- Context forwarding ---

  /**
   * ConciergeAgent.run is called by AgentOrchestrator with:
   *   orchestrator.run('concierge', input, { satellite, conversationId, transcript })
   *
   * The policy request-level gate runs here before BaseAgent.run proceeds.
   * If denied, we return the refusal directly without touching the LLM.
   */
  async run(input, { context = {}, ...rest } = {}) {
    const satellite = context?.satellite ?? null;
    if (satellite && this.#policy) {
      const decision = this.#policy.evaluateRequest(satellite, {});
      if (!decision.allow) {
        const reason = decision.reason;
        this.deps?.logger?.warn?.('concierge.policy.request_denied', { satellite_id: satellite.id, reason });
        return {
          output: `I can't do that right now${reason ? ` — ${reason}` : ''}.`,
          toolCalls: [],
          usage: null,
        };
      }
    }
    return super.run(input, { context, ...rest });
  }

  async *runStream(input, { context = {}, ...rest } = {}) {
    const satellite = context?.satellite ?? null;
    if (satellite && this.#policy) {
      const decision = this.#policy.evaluateRequest(satellite, {});
      if (!decision.allow) {
        const reason = decision.reason;
        yield { type: 'text-delta', text: `I can't do that right now${reason ? ` — ${reason}` : ''}.` };
        yield { type: 'finish', reason: 'policy' };
        return;
      }
    }
    yield* super.runStream(input, { context, ...rest });
  }
}

export default ConciergeAgent;
```

NOTE: `addToolBundle` may not exist on `BaseAgent` yet. Read `BaseAgent.mjs` to confirm whether it has `addToolBundle` or only `addToolFactory`. If only `addToolFactory` exists, adapt `registerTools()` to use the existing API — the ToolBundle satisfies the ToolFactory contract since both have `createTools()`.

- [ ] **Step 6: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/concierge/ConciergeAgent.test.mjs
```

- [ ] **Step 7: Run full agent test suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/3_applications/agents/concierge/ \
        tests/isolated/agents/concierge/ConciergeAgent.test.mjs
git commit -m "$(cat <<'EOF'
feat(concierge): ConciergeAgent extends BaseAgent (audit DRY-H2, DRY-H3)

6-section buildPromptSections, PolicyDecorator in buildToolDecorators,
request-level policy gate before super.run. Drops runChat/streamChat —
inherits run/runStream from BaseAgent.

Prompts copied verbatim. Old ConciergeAgent untouched until Task 9.

Plan / Phase 2 Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Bootstrap rewire — register ConciergeAgent, collapse MastraAdapter

Update `bootstrap.mjs` to register `ConciergeAgent` via `agentOrchestrator.register` and share the single framework `MastraAdapter` instance. Delete the separate `conciergeAgentRuntime` and `conciergeMemory` wiring. Keep `MediaJudge` on its own separately-configured adapter — that is expected and documented.

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Read the concierge bootstrap block**

```bash
cd /opt/Code/DaylightStation && sed -n '3180,3430p' backend/src/0_system/bootstrap.mjs
```

Map the full `createConciergeServices()` function: inputs, outputs, and what gets returned for the router mount.

- [ ] **Step 2: Rewrite the concierge bootstrap wiring**

The changes within `createConciergeServices()` (or the equivalent inline block):

**Remove:**
- `const conciergeAgentRuntime = new MastraAdapter(...)` — delete; use the shared framework `agentRuntime` passed in as a dep.
- `const conciergeWorkingMemory = new YamlWorkingMemoryAdapter(...)` — delete; the shared working memory adapter covers concierge (it's keyed by `agentId + userId`).
- `const conciergeMemory = new YamlConciergeMemoryAdapter(...)` — delete entirely.
- `import YamlConciergeMemoryAdapter` — delete.
- `const registry = new SkillRegistry(...)` / `for (const skill of skills) registry.register(skill)` — delete.
- `import SkillRegistry` — delete.
- `new ConciergeApplication(...)` — delete.
- `import ConciergeApplication` — delete.
- `import { MemorySkill }` / `import { HomeAutomationSkill }` / `import { MediaSkill }` from old paths — delete.

**Add:**
- `import { ConciergeAgent } from '#applications/agents/concierge/ConciergeAgent.mjs';`
- `import { MemoryBundle } from '#applications/agents/concierge/skills/MemoryBundle.mjs';`
- `import { HomeAutomationBundle } from '#applications/agents/concierge/skills/HomeAutomationBundle.mjs';`
- `import { MediaBundle } from '#applications/agents/concierge/skills/MediaBundle.mjs';`

Assemble `toolBundles` where `conciergeSkills` was assembled. Pass `agentRuntime` (the shared framework instance, passed in from the outer bootstrap scope) rather than creating a new one. Pass the shared `workingMemory` adapter.

Register: `agentOrchestrator.register(ConciergeAgent, { policy: conciergePolicy, toolBundles, vocabulary: conciergeVocabulary, personality: personalityText });`

**MediaJudge stays on its own adapter:** The judge adapter is a separate config (cheap model, `maxToolCalls: 1`, short timeout). Keep:

```javascript
const judgeRuntime = new MastraAdapter({
  model: mediaConfig.judge_model,
  maxToolCalls: 1,
  timeoutMs: 8000,
  mediaDir: conciergeMediaDir,
  logger: logger.child({ component: 'concierge.media.judge' }),
});
const judge = new MediaJudge({ agentRuntime: judgeRuntime, ... });
```

This is explicitly documented in the Notes section — MediaJudge is a sub-agent tool, not a top-level registered agent.

**What `createConciergeRouter` receives:** Change `chatCompletionRunner: conciergeApp` → `chatCompletionRunner: { runChat: ..., streamChat: ... }` where those methods delegate to `agentOrchestrator.run/streamExecute`. This is a bridge object — Task 9 will formalize it in the translator. For now, construct the bridge here:

```javascript
const conciergeBridge = {
  async runChat({ satellite, messages, conversationId, transcript }) {
    const input = lastUserMessage(messages);  // helper stays in bootstrap
    return agentOrchestrator.run(
      ConciergeAgent.id,
      input,
      { satellite, conversationId, transcript, userId: 'household' }
    );
  },
  async *streamChat({ satellite, messages, conversationId, transcript }) {
    const input = lastUserMessage(messages);
    yield* agentOrchestrator.streamExecute(
      ConciergeAgent.id,
      input,
      { satellite, conversationId, transcript, userId: 'household' }
    );
  },
};

const router = createConciergeRouter({
  satelliteRegistry: conciergeSatelliteRegistry,
  chatCompletionRunner: conciergeBridge,
  ...
});
```

- [ ] **Step 3: Verify the server starts**

```bash
cd /opt/Code/DaylightStation && node --input-type=module --eval "
import('./backend/src/0_system/bootstrap.mjs').then(() => {
  process.stdout.write('bootstrap import OK\n');
  process.exit(0);
}).catch(e => { process.stderr.write(e.stack + '\n'); process.exit(1); });
" 2>&1 | head -20
```

If that's not the right entry point, use `npm run dev` in background and check the log:

```bash
cd /opt/Code/DaylightStation && timeout 15 npm run dev 2>&1 | head -40 || true
```

Expected: no import errors.

- [ ] **Step 4: Run full agent test suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "$(cat <<'EOF'
refactor(bootstrap): register ConciergeAgent via agentOrchestrator, collapse MastraAdapter (audit DRY-H1)

Shared MastraAdapter for concierge + framework agents. MediaJudge retains
its own adapter (separate model/timeoutMs config). SkillRegistry and
ConciergeApplication removed from bootstrap. YamlConciergeMemoryAdapter
removed. Bridge object wires orchestrator.run/streamExecute to the
existing concierge router shape temporarily.

Plan / Phase 2 Task 8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Translator rewire — `AgentTranscript` replaces `ConciergeTranscript`

Update `OpenAIChatCompletionsTranslator` to use `AgentTranscript` (with satellite snapshot + request body) instead of `ConciergeTranscript`, and call `agentOrchestrator.run/streamExecute` directly instead of `runner.runChat/streamChat`.

**Files:**
- Modify: `backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs`

- [ ] **Step 1: Read the translator in full**

```bash
cd /opt/Code/DaylightStation && cat backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs
```

Map:
- Line where `new ConciergeTranscript(...)` is constructed
- Where `runner.runChat(...)` is called (non-stream path)
- Where `runner.streamChat(...)` is called (stream path — the `#stream` private method)
- How transcript is flushed in both paths

- [ ] **Step 2: Rewrite the translator**

Key changes only — all other logic (OpenAI envelope construction, SSE chunk writing, error handling) stays verbatim:

```javascript
// Before:
import { ConciergeTranscript } from '../../../3_applications/concierge/services/ConciergeTranscript.mjs';

// After:
import { AgentTranscript } from '../../../3_applications/agents/framework/AgentTranscript.mjs';
```

```javascript
// Before:
const transcript = new ConciergeTranscript({
  satellite,
  request: { model, stream, conversation_id: conversationId, messages },
  mediaLogsDir: this.#mediaLogsDir,
  logger: this.#logger,
});

// After:
const transcript = new AgentTranscript({
  agentId: 'concierge',
  userId: 'household',
  mediaDir: this.#mediaLogsDir,
  logger: this.#logger,
  filePathStrategy: (t) => {
    const day = new Date(t.startedAt).toISOString().slice(0, 10);
    const satId = satellite?.id ?? 'unknown';
    const ts = new Date(t.startedAt).toISOString().replace(/[:.]/g, '-');
    return `${t.mediaDir}/concierge/${day}/${satId}/${ts}-${t.turnId}.json`;
  },
});
transcript.setSatelliteSnapshot({
  id: satellite.id,
  area: satellite.area,
  allowedSkills: satellite.allowedSkills,
});
transcript.setRequestBody({ model, stream, conversation_id: conversationId, messages });
```

The `runner.runChat/streamChat` calls stay as-is in the translator itself — they now hit the bridge object from Task 8. The translator does not need to know about `agentOrchestrator` directly. The constructor still accepts `runner` — the bootstrap passes the bridge.

NOTE: Read `AgentTranscript`'s constructor signature from the Phase 1 implementation before writing these lines. Match the field names exactly (`mediaDir` vs `mediaLogsDir`, `turnId` auto-generation, etc.).

- [ ] **Step 3: Verify transcript file paths**

Write a one-shot unit test confirming the `filePathStrategy` produces the same directory layout as the old `ConciergeTranscript.flush()`:

```javascript
// tests/isolated/agents/concierge/concierge-transcript-path.test.mjs
import { describe, it, expect } from 'vitest';
import { AgentTranscript } from '../../../backend/src/3_applications/agents/framework/AgentTranscript.mjs';

describe('concierge transcript path strategy', () => {
  it('produces {mediaDir}/concierge/{day}/{satId}/{ts}-{turnId}.json', async () => {
    const writes = [];
    const fakeFs = {
      mkdir: async () => {},
      writeFile: async (path) => { writes.push(path); },
    };
    const satellite = { id: 'kitchen', area: 'kitchen', allowedSkills: ['memory'] };
    const t = new AgentTranscript({
      agentId: 'concierge',
      userId: 'household',
      mediaDir: '/test/media',
      logger: { warn: () => {} },
      fs: fakeFs,
      filePathStrategy: (tr) => {
        const day = new Date(tr.startedAt).toISOString().slice(0, 10);
        const satId = satellite?.id ?? 'unknown';
        const ts = new Date(tr.startedAt).toISOString().replace(/[:.]/g, '-');
        return `${tr.mediaDir}/concierge/${day}/${satId}/${ts}-${tr.turnId}.json`;
      },
    });
    t.complete('ok');
    await t.flush();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/\/test\/media\/concierge\/\d{4}-\d{2}-\d{2}\/kitchen\/.+\.json$/);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/agents/concierge/concierge-transcript-path.test.mjs \
  tests/isolated/agents/ \
  tests/isolated/adapters/agents/
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs \
        tests/isolated/agents/concierge/concierge-transcript-path.test.mjs
git commit -m "$(cat <<'EOF'
refactor(concierge): translator uses AgentTranscript, drops ConciergeTranscript (audit DRY-H5)

setSatelliteSnapshot + setRequestBody populate the optional fields added in
Phase 1. filePathStrategy preserves the existing concierge/{day}/{satId}/...
directory layout. ConciergeTranscript is now unused.

Plan / Phase 2 Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Delete dead code — `ConciergeApplication`, `ConciergeTranscript`, `IConciergeMemory`, `YamlConciergeMemoryAdapter`, old skills

Now that the migration is complete and tests pass, remove the old concierge stack and the four unwired skills.

**Files deleted:**

```
backend/src/3_applications/concierge/ConciergeAgent.mjs
backend/src/3_applications/concierge/ConciergeApplication.mjs
backend/src/3_applications/concierge/services/SkillRegistry.mjs
backend/src/3_applications/concierge/services/ConciergeTranscript.mjs
backend/src/3_applications/concierge/ports/ISkill.mjs
backend/src/3_applications/concierge/ports/IConciergeMemory.mjs
backend/src/1_adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs
backend/src/3_applications/concierge/skills/MemorySkill.mjs
backend/src/3_applications/concierge/skills/HomeAutomationSkill.mjs
backend/src/3_applications/concierge/skills/MediaSkill.mjs
backend/src/3_applications/concierge/skills/CalendarReadSkill.mjs
backend/src/3_applications/concierge/skills/FinanceReadSkill.mjs
backend/src/3_applications/concierge/skills/FitnessReadSkill.mjs
backend/src/3_applications/concierge/skills/LifelogReadSkill.mjs
```

- [ ] **Step 1: Confirm no remaining imports of deleted files**

```bash
cd /opt/Code/DaylightStation && grep -rn \
  "ConciergeApplication\|ConciergeTranscript\|IConciergeMemory\|YamlConciergeMemoryAdapter\|SkillRegistry\|ISkill\|MemorySkill\|HomeAutomationSkill\|MediaSkill\|CalendarReadSkill\|FinanceReadSkill\|FitnessReadSkill\|LifelogReadSkill" \
  backend/src/ tests/ \
  --include="*.mjs" --include="*.js" \
  | grep -v "node_modules" \
  | grep -v "3_applications/concierge/skills/" \
  | grep -v "3_applications/concierge/ConciergeAgent\|ConciergeApplication\|services/SkillRegistry\|services/ConciergeTranscript\|ports/ISkill\|ports/IConciergeMemory"
```

Expected: no output. If any import appears, resolve it before deleting.

- [ ] **Step 2: Delete files**

```bash
cd /opt/Code/DaylightStation && \
  rm backend/src/3_applications/concierge/ConciergeAgent.mjs \
     backend/src/3_applications/concierge/ConciergeApplication.mjs \
     backend/src/3_applications/concierge/services/SkillRegistry.mjs \
     backend/src/3_applications/concierge/services/ConciergeTranscript.mjs \
     backend/src/3_applications/concierge/ports/ISkill.mjs \
     backend/src/3_applications/concierge/ports/IConciergeMemory.mjs \
     backend/src/1_adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs \
     backend/src/3_applications/concierge/skills/MemorySkill.mjs \
     backend/src/3_applications/concierge/skills/HomeAutomationSkill.mjs \
     backend/src/3_applications/concierge/skills/MediaSkill.mjs \
     backend/src/3_applications/concierge/skills/CalendarReadSkill.mjs \
     backend/src/3_applications/concierge/skills/FinanceReadSkill.mjs \
     backend/src/3_applications/concierge/skills/FitnessReadSkill.mjs \
     backend/src/3_applications/concierge/skills/LifelogReadSkill.mjs
```

- [ ] **Step 3: Run full agent test suite — confirm zero regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -u   # stage all deletions
git commit -m "$(cat <<'EOF'
chore(concierge): delete replaced stack — ConciergeApplication, ConciergeTranscript, ISkill, IConciergeMemory, YamlConciergeMemoryAdapter (audit DRY-H1/H2/H4/H5/M1)

Also deletes the 4 unwired skills (Calendar/Finance/Fitness/Lifelog) — they
were never wired in bootstrap, have no callers, and are dead code. Verified
via grep before deletion.

Plan / Phase 2 Task 10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Delete `_friendlyName.mjs` if unused; move surviving concierge files to new location

Move the remaining `concierge/` files (policy, services, ports that survived) to `agents/concierge/`. Verify nothing imports from the old `3_applications/concierge/` path.

**Files to move or verify:**

```
backend/src/3_applications/concierge/services/ConciergePolicyEvaluator.mjs  → agents/concierge/policy/
backend/src/3_applications/concierge/services/PassThroughConciergePolicy.mjs → agents/concierge/policy/
backend/src/3_applications/concierge/services/MediaJudge.mjs                 → agents/concierge/services/
backend/src/3_applications/concierge/services/MediaPolicyGate.mjs             → agents/concierge/services/
backend/src/3_applications/concierge/services/scopeMatcher.mjs                → agents/concierge/policy/
backend/src/3_applications/concierge/ports/ISatelliteRegistry.mjs             → agents/concierge/ports/
backend/src/3_applications/concierge/adapters/YamlSatelliteRegistry.mjs       → agents/concierge/adapters/ (if it exists)
backend/src/3_applications/concierge/skills/_friendlyName.mjs                 → agents/concierge/skills/ or delete
```

- [ ] **Step 1: List what remains in the old directory**

```bash
find /opt/Code/DaylightStation/backend/src/3_applications/concierge -name "*.mjs" | sort
```

- [ ] **Step 2: Check which files have external callers**

```bash
cd /opt/Code/DaylightStation && for f in $(find backend/src/3_applications/concierge -name "*.mjs" | sed 's|backend/src/3_applications/concierge/||'); do
  echo "--- $f ---"
  grep -rn "concierge/$f\|concierge/$(basename $f .mjs)" backend/src/ --include="*.mjs" | grep -v "3_applications/concierge/$f"
done
```

- [ ] **Step 3: Move files with updated imports**

For each surviving file, move it to the new `agents/concierge/` subtree and update all import paths in callers. Use `grep -rn` to find callers before moving.

- [ ] **Step 4: Verify no `3_applications/concierge/` imports remain in non-concierge files**

```bash
cd /opt/Code/DaylightStation && grep -rn "3_applications/concierge/" backend/src/ tests/ --include="*.mjs" \
  | grep -v "3_applications/agents/concierge/"
```

Expected: empty.

- [ ] **Step 5: Run full agent test suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 6: Commit**

```bash
git add -A   # capture moves
git commit -m "$(cat <<'EOF'
refactor(concierge): consolidate surviving files to agents/concierge/ subtree

PolicyEvaluator, MediaJudge, MediaPolicyGate, SatelliteRegistry, scopeMatcher
moved from 3_applications/concierge/ to 3_applications/agents/concierge/.
No logic changes — path updates only.

Plan / Phase 2 Task 11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Live HA Voice smoke test

Synthetic end-to-end test that mimics one HA Voice `POST /v1/chat/completions` request through the full stack. Verifies: transcript writes, tool calls fire, policy decisions recorded, response envelope is valid OpenAI-shaped JSON.

**Files:**
- Create: `tests/isolated/agents/concierge/concierge-smoke.test.mjs`

- [ ] **Step 1: Write smoke test**

```javascript
// tests/isolated/agents/concierge/concierge-smoke.test.mjs
/**
 * Synthetic HA Voice smoke test.
 *
 * Does NOT start a real HTTP server. Creates the translator + orchestrator +
 * agent with minimal stubs, sends a synthetic request, asserts on the response
 * shape and side-effects (transcript written, tool call recorded).
 *
 * Scope:
 *   - Non-stream path (stream path covered separately if time allows)
 *   - MemoryBundle remember_note tool call
 *   - Policy: allow-all (PassThroughConciergePolicy)
 *   - AgentTranscript written to a temp dir with satellite snapshot populated
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---- Minimal stubs ----

function makeOrchestrator(agent) {
  return {
    register() {},
    async run(agentId, input, context) {
      return agent.run(input, { context });
    },
    async *streamExecute(agentId, input, context) {
      yield* agent.runStream(input, { context });
    },
  };
}

function makeSatellite(allowedSkills = ['memory']) {
  return {
    id: 'kitchen',
    area: 'kitchen',
    allowedSkills,
    canUseSkill: (n) => allowedSkills.includes(n),
    scopes_allowed: [],
    scopes_denied: [],
  };
}

// Stub MastraAdapter that immediately returns a canned remember_note tool call
function makeRuntime(toolCallOverride = null) {
  return {
    async execute({ tools, agentId, input, systemPrompt, context }) {
      // If there's a tool to call, simulate calling it
      if (toolCallOverride) {
        const tool = tools.find(t => t.name === toolCallOverride.name);
        const result = tool ? await tool.execute(toolCallOverride.args, context) : null;
        return {
          output: 'I have saved your note.',
          toolCalls: [{ name: toolCallOverride.name, args: toolCallOverride.args, result }],
          usage: { promptTokens: 50, completionTokens: 10 },
        };
      }
      return { output: 'Hello from concierge.', toolCalls: [], usage: null };
    },
    async *streamExecute() {
      yield { type: 'text-delta', text: 'Hello.' };
      yield { type: 'finish', reason: 'stop' };
    },
  };
}

// ---- Test setup ----

let tmpDir;
beforeAll(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'concierge-smoke-')); });
afterAll(async () => { await rm(tmpDir, { recursive: true, force: true }); });

describe('concierge smoke — non-stream path', () => {
  it('returns a valid OpenAI chat.completion envelope', async () => {
    const { ConciergeAgent } = await import('../../../backend/src/3_applications/agents/concierge/ConciergeAgent.mjs');
    const { MemoryBundle } = await import('../../../backend/src/3_applications/agents/concierge/skills/MemoryBundle.mjs');
    const { OpenAIChatCompletionsTranslator } = await import('../../../backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs');

    const PassThroughPolicy = {
      evaluateRequest: () => ({ allow: true }),
      evaluateToolCall: () => ({ allow: true }),
      shapeResponse: (_s, d) => d,
    };

    const workingMemory = {
      load: vi.fn(async () => ({ get: () => null, set: vi.fn(), serialize: () => '' })),
      save: vi.fn(),
    };

    const runtime = makeRuntime({ name: 'remember_note', args: { content: 'Dogs are allowed' } });

    const agent = new ConciergeAgent({
      policy: PassThroughPolicy,
      toolBundles: [new MemoryBundle({})],
      agentRuntime: runtime,
      workingMemory,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const orchestrator = makeOrchestrator(agent);

    const bridge = {
      async runChat({ satellite, messages, conversationId, transcript }) {
        const input = messages.findLast(m => m.role === 'user')?.content ?? '';
        return orchestrator.run(ConciergeAgent.id, input, { satellite, conversationId, transcript, userId: 'household' });
      },
    };

    const translator = new OpenAIChatCompletionsTranslator({
      runner: bridge,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      mediaLogsDir: tmpDir,
    });

    const satellite = makeSatellite();
    const req = {
      body: {
        model: 'daylight-house',
        stream: false,
        messages: [{ role: 'user', content: 'Please remember that dogs are allowed.' }],
      },
    };

    let responseBody = null;
    const res = {
      status: vi.fn(() => res),
      json: vi.fn((body) => { responseBody = body; }),
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };

    await translator.handle(req, res, satellite);

    // OpenAI envelope shape
    expect(responseBody).toBeTruthy();
    expect(responseBody.object).toBe('chat.completion');
    expect(Array.isArray(responseBody.choices)).toBe(true);
    expect(responseBody.choices[0].message.role).toBe('assistant');
    expect(typeof responseBody.choices[0].message.content).toBe('string');
  });

  it('writes a transcript file with satellite snapshot', async () => {
    // Wait a tick for async flush
    await new Promise(r => setTimeout(r, 50));

    const files = await readdir(join(tmpDir, 'concierge'), { recursive: true }).catch(() => []);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    expect(jsonFiles.length).toBeGreaterThan(0);

    // Read the most recent transcript
    const lastFile = jsonFiles.sort().at(-1);
    const fullPath = join(tmpDir, 'concierge', lastFile);
    const transcript = JSON.parse(await readFile(fullPath, 'utf8'));

    // satellite block populated
    expect(transcript.satellite).toBeTruthy();
    expect(transcript.satellite.id).toBe('kitchen');
    expect(Array.isArray(transcript.satellite.allowedSkills)).toBe(true);
  });
});

describe('concierge smoke — policy deny path', () => {
  it('returns refusal without calling the LLM when request is denied', async () => {
    const { ConciergeAgent } = await import('../../../backend/src/3_applications/agents/concierge/ConciergeAgent.mjs');
    const { OpenAIChatCompletionsTranslator } = await import('../../../backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs');

    const DenyAllPolicy = {
      evaluateRequest: () => ({ allow: false, reason: 'test_deny' }),
      evaluateToolCall: () => ({ allow: false }),
      shapeResponse: (_s, d) => d,
    };

    const runtimeExecute = vi.fn();
    const runtime = { execute: runtimeExecute, streamExecute: async function* () {} };

    const agent = new ConciergeAgent({
      policy: DenyAllPolicy,
      toolBundles: [],
      agentRuntime: runtime,
      workingMemory: { load: vi.fn(async () => ({ get: () => null, set: vi.fn() })), save: vi.fn() },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const orchestrator = makeOrchestrator(agent);
    const bridge = {
      async runChat({ satellite, messages, conversationId }) {
        const input = messages.findLast(m => m.role === 'user')?.content ?? '';
        return orchestrator.run(ConciergeAgent.id, input, { satellite, conversationId, userId: 'household' });
      },
    };

    const translator = new OpenAIChatCompletionsTranslator({
      runner: bridge,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      mediaLogsDir: tmpDir,
    });

    const satellite = makeSatellite();
    const req = { body: { model: 'daylight-house', stream: false, messages: [{ role: 'user', content: 'test' }] } };
    let responseBody = null;
    const res = { status: vi.fn(() => res), json: vi.fn(b => { responseBody = b; }), setHeader: vi.fn(), write: vi.fn(), end: vi.fn() };

    await translator.handle(req, res, satellite);

    expect(runtimeExecute).not.toHaveBeenCalled();
    expect(responseBody.choices[0].message.content).toMatch(/can't do that/i);
  });
});
```

- [ ] **Step 2: Run; FAIL (ConciergeAgent not wired yet — should fail on imports, not logic)**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/concierge/concierge-smoke.test.mjs
```

After Tasks 7-11 complete, re-run this step — it should pass.

- [ ] **Step 3: Run; pass (after Tasks 7-11)**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/concierge/concierge-smoke.test.mjs
```

- [ ] **Step 4: Run full agent test suite — final green bar for Phase 2**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 5: Commit**

```bash
git add tests/isolated/agents/concierge/concierge-smoke.test.mjs
git commit -m "$(cat <<'EOF'
test(concierge): HA Voice smoke test — transcript, policy deny, OpenAI envelope

Synthetic non-stream path: verifies satellite snapshot in transcript,
refusal without LLM call on deny, and valid chat.completion JSON shape.

Plan / Phase 2 Task 12.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Audit finding | Task that addresses it |
|---|---|
| DRY-H1 (two MastraAdapter instances) | Task 8 (collapse to shared instance; MediaJudge retains its own) |
| DRY-H2 (ConciergeAgent doesn't extend BaseAgent) | Task 7 |
| DRY-H3 (two prompt-assembly functions) | Task 7 (buildPromptSections override) |
| DRY-H4 (two memory ports, same adapter) | Tasks 4, 8, 10 (migrate to IWorkingMemory; delete IConciergeMemory) |
| DRY-H5 (two transcript classes) | Tasks 9, 10 (AgentTranscript replaces ConciergeTranscript) |
| DRY-M1 (ISkill vs ToolFactory) | Tasks 1, 4, 5, 6 (ToolBundle unifies both) |
| DRY-M2 (tool shape convergence) | Tasks 4, 5, 6 (createTool with optional defaultPolicy/getScopesFor) |
| Q1 (collapse transcript paths) | Task 9 (filePathStrategy → concierge/{day}/{sat}/) |
| Q2 (PolicyEvaluator actually used?) | Task 2 (PolicyDecorator wires it in; note evaluateRequest is still no-op) |
| Q3 (BaseAgent before router restructure?) | Decision: BaseAgent-first. Future router → role-agent split gets BaseAgent for free |
| Q6 (4 unwired skills) | Task 10 (deleted — no callers, confirmed via grep) |
| Q9 (IConciergeMemory.merge callers?) | Task 10 (verified no callers before deletion) |
| Q10 (dual MastraAdapter state sharing risk) | Task 8 (no per-instance state beyond config; MediaJudge keeps own config) |

---

## Notes for the implementer

1. **HA Voice smoke test gates Phase 2 completion.** The smoke test (Task 12) is the acceptance criterion. Until it passes with a real transcript JSON file on disk, the migration is not done. Run it after every task from Task 7 onward.

2. **MediaJudge stays on its own `MastraAdapter` instance — this is correct and expected.** It uses a different model, `maxToolCalls: 1`, and an 8-second timeout. These are genuine per-call config differences, not duplication. The audit (Q10) confirms this. Do not merge MediaJudge into the shared adapter.

3. **`userId='household'` means memory is not user-scoped for concierge.** When `agentOrchestrator.run('concierge', ...)` resolves `userId`, pass `'household'` explicitly. The `YamlWorkingMemoryAdapter` keys on `(agentId, userId)` — concierge's key will be `('concierge', 'household')`, which is exactly what `YamlConciergeMemoryAdapter` was pinned to.

4. **The four unwired skills (Calendar/Finance/Fitness/Lifelog) are dead code.** They are not wired in `bootstrap.mjs` and have no callers anywhere in the codebase. Confirm this with `grep -rn "CalendarReadSkill\|FinanceReadSkill\|FitnessReadSkill\|LifelogReadSkill" backend/` before deleting. If any caller surfaces, stop and investigate before proceeding with Task 10.

5. **`PolicyDecorator` records denied calls itself; `TranscriptRecorder` records allowed calls.** Do not double-record. The denied path in `policyDecorator` writes directly to `context.transcript`. The allowed path returns to the next decorator in the chain (`TranscriptRecorder`), which writes its own record. Confirm the decorator chain order in Phase 1's `applyDecorators` to verify `PolicyDecorator` runs before `TranscriptRecorder`.

6. **`buildPromptSections` returns a sparse array; the framework join drops nulls.** The Phase 1 `BaseAgent` change joins with `'\n\n'.filter(Boolean)`. Verify this is what your Phase 1 implementation does before writing the concierge override. If the base class calls `.filter(Boolean)` before joining, nulls in the returned array are safe.

7. **The HTTP wire is frozen in Phase 2.** `/v1/chat/completions`, `/v1/models`, bearer-token auth, `chat.completion` and `chat.completion.chunk` envelopes, `[DONE]` SSE terminator — none of these change. Phase 3 is the HTTP unification plan. Do not touch `createConciergeRouter` except to update the `chatCompletionRunner` arg it receives.

8. **Double-transcript bug disappears automatically.** Once `ConciergeAgent` runs through `BaseAgent.run → MastraAdapter.execute`, only one `AgentTranscript` is created (by the translator, with the satellite file path strategy). The `MastraAdapter` no longer creates its own transcript for concierge because `ConciergeAgent` inherits `BaseAgent`'s transcript wiring — the translator's transcript is passed through `context.transcript` and the MastraAdapter's `TranscriptRecorder` decorator uses that existing instance rather than creating a new one. Verify this is the case by inspecting how `AgentTranscript` flows in the Phase 1 decorator chain.

---

## What comes next (Phase 3)

Phase 3 builds `mountAgentHttp(app, options)` — a unified HTTP mounting function that replaces `createConciergeRouter`, `OpenAIChatCompletionsTranslator`, `createAgentsRouter`, and `createAgentsStreamRouter` with a single entry point that accepts a `wireFormat` option (`'native'` or `'openai-chat-completions'`). After Phase 2, the concierge router is already wired to `agentOrchestrator` via the bridge object from Task 8. Phase 3 formalizes that bridge as the first concrete `openai-chat-completions` wire format handler, moves bearer-token auth into the `authMiddleware` option slot, and migrates the framework agents' router into the `native` wire format handler. The result is a single place where all agents are mounted on HTTP, observable and configurable from a single function.
