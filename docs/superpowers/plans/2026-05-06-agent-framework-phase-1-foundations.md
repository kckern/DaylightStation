# Agent Framework Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four no-behavior-change framework refactors (audit §7 steps 1–4) plus the EchoAgent cleanup (Q7), so that subsequent plans (concierge migration, HTTP unification, frontend convergence) have a clean substrate to build on.

**Architecture:** Five independent refactors inside `backend/src/3_applications/agents/` and `backend/src/1_adapters/agents/`. Each refactor has zero observable behavior change — the agent stack does exactly what it does today, but with more composable internals. Verification is the existing 1583-test suite continuing to pass.

**Tech Stack:** Node ESM (.mjs), Vitest, existing Mastra adapter.

**Audit reference:** Implements §7 steps 1–4 + Q7 from `docs/_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md`. Concierge files are read but NOT modified — concierge migration is Plan B.

---

## Why this plan exists

Three things in the current framework are tangled together inside `MastraAdapter.#translateTools`:

- `userId` injection (strips schema, merges from context)
- Per-call counter against `maxToolCalls`
- Per-call timing + transcript recording

They're a single 70-line method (`MastraAdapter.mjs:114-187`). Concierge wraps tools a *second* time in `SkillRegistry.#wrap` for a fourth concern: **policy gating** (`SkillRegistry.mjs:40-95`). Plan B will move concierge onto `BaseAgent`, but concierge's policy gate has no place to live in the current adapter — it's not the runtime's concern, but `BaseAgent` doesn't expose a wrap point either.

Plan A breaks `#translateTools` into a chain of four small `ToolDecorator` classes, adds a generic `buildPromptSections` hook on `BaseAgent`, and extends `AgentTranscript` with the optional fields concierge needs (policy decision per tool, satellite snapshot, raw HTTP body). After this plan lands:

- Plan B can register a `PolicyDecorator` on the concierge agent without touching the adapter.
- Plan B can write concierge transcripts through `AgentTranscript` (and delete `ConciergeTranscript`).
- Plan B can override `buildPromptSections` on the concierge subclass to insert satellite/personality/vocabulary sections.

Nothing in this plan changes runtime behavior. Every existing test should pass unchanged.

---

## File structure

**New files:**

```
backend/src/3_applications/agents/framework/utils/
  safeClone.mjs                       — single shared deep-clone helper
  safeClone.test.mjs

backend/src/3_applications/agents/framework/decorators/
  ToolDecorator.mjs                   — port (interface)
  UserIdInjector.mjs                  — strips userId from schema, injects from context
  CallLimiter.mjs                     — counter against maxToolCalls
  TranscriptRecorder.mjs              — timing + transcript.recordTool
  applyDecorators.mjs                 — pipeline runner
  decorators.test.mjs                 — unit tests for each decorator
  applyDecorators.test.mjs            — integration test for the chain

tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs
tests/isolated/agents/echo/EchoAgent.baseAgent.test.mjs
```

**Modified files:**

```
backend/src/3_applications/agents/framework/AgentTranscript.mjs
  + recordTool accepts optional policyDecision
  + setRequestBody(rawBody)
  + setSatelliteSnapshot({ id, area, allowedSkills })
  + filePathStrategy override (constructor option)
  - inline safeClone (deleted, imports from utils)

backend/src/1_adapters/agents/MastraAdapter.mjs
  - inline tool wrapping (deleted)
  + uses applyDecorators([UserIdInjector, CallLimiter, TranscriptRecorder])

backend/src/3_applications/agents/framework/BaseAgent.mjs
  + buildPromptSections(context, memory): Promise<Array<string|null>>
    default returns current four sections
  - #assemblePrompt body simplified to call buildPromptSections then join

backend/src/3_applications/agents/echo/EchoAgent.mjs
  - bespoke run() method (deleted)
  + extends BaseAgent properly, registerTools() returns no tools

tests/isolated/adapters/agents/MastraAdapter.test.mjs (existing)
  + tests confirming the decorator chain produces same wrapped tool behavior
```

**Deleted files:** none in this plan.

---

## Conventions

- Vitest. Run individual files with `npx vitest run <path>`.
- TDD: test → run-FAIL → impl → run-PASS → commit per task.
- Every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- After each task, run the **full agents test suite** to confirm no regression:
  ```bash
  cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
  ```
  Expected: all green throughout the plan. If anything regresses, stop and fix before continuing.
- Concierge code is **read-only** in this plan. Don't change `backend/src/3_applications/concierge/` or `backend/src/1_adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs`.

---

## Task 1: Hoist `safeClone` to shared util

`AgentTranscript.mjs:218-225` and `ConciergeTranscript.mjs:98-105` have identical `safeClone` implementations. Lift to a shared util that both files import. (Concierge file gets the import added but is otherwise untouched — when Plan B replaces `ConciergeTranscript` with `AgentTranscript`, this import disappears with it.)

**Files:**
- Create: `backend/src/3_applications/agents/framework/utils/safeClone.mjs`
- Create: `backend/src/3_applications/agents/framework/utils/safeClone.test.mjs`
- Modify: `backend/src/3_applications/agents/framework/AgentTranscript.mjs`
- Modify: `backend/src/3_applications/concierge/services/ConciergeTranscript.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// backend/src/3_applications/agents/framework/utils/safeClone.test.mjs
import { describe, it, expect } from 'vitest';
import { safeClone } from './safeClone.mjs';

describe('safeClone', () => {
  it('returns null for null', () => {
    expect(safeClone(null)).toBe(null);
  });

  it('returns undefined for undefined', () => {
    expect(safeClone(undefined)).toBe(undefined);
  });

  it('returns primitives unchanged', () => {
    expect(safeClone(42)).toBe(42);
    expect(safeClone('hello')).toBe('hello');
    expect(safeClone(true)).toBe(true);
  });

  it('deep-clones plain objects', () => {
    const orig = { a: 1, nested: { b: 2 } };
    const cloned = safeClone(orig);
    expect(cloned).toEqual(orig);
    expect(cloned).not.toBe(orig);
    expect(cloned.nested).not.toBe(orig.nested);
  });

  it('deep-clones arrays', () => {
    const orig = [1, [2, 3]];
    const cloned = safeClone(orig);
    expect(cloned).toEqual(orig);
    expect(cloned[1]).not.toBe(orig[1]);
  });

  it('returns a string fallback for circular structures', () => {
    const a = {};
    a.self = a;
    const result = safeClone(a);
    expect(typeof result).toBe('string');
    expect(result).toContain('safeClone');
  });

  it('handles BigInt by string-fallback', () => {
    expect(typeof safeClone(BigInt(1))).toBe('string');
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/3_applications/agents/framework/utils/safeClone.test.mjs
```

- [ ] **Step 3: Implement `safeClone.mjs`**

Read the current implementations first:

```bash
cd /opt/Code/DaylightStation && grep -n -A 8 "function safeClone" \
  backend/src/3_applications/agents/framework/AgentTranscript.mjs \
  backend/src/3_applications/concierge/services/ConciergeTranscript.mjs
```

The current implementations are functionally identical:

```javascript
// backend/src/3_applications/agents/framework/utils/safeClone.mjs
/**
 * Deep-clone a value via JSON. On failure (circular refs, BigInt, functions),
 * returns a string fallback "[safeClone failed: ...]" so transcript writers
 * never crash on weird tool results.
 */
export function safeClone(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return `[safeClone failed: ${err.message}]`;
  }
}

export default safeClone;
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/3_applications/agents/framework/utils/safeClone.test.mjs
```

- [ ] **Step 5: Update `AgentTranscript.mjs` to import the shared util**

In `backend/src/3_applications/agents/framework/AgentTranscript.mjs`, find the current `function safeClone(value)` definition (around line 218-225) and:
- Delete the function
- Add `import { safeClone } from './utils/safeClone.mjs';` at the top of the file alongside other imports

- [ ] **Step 6: Update `ConciergeTranscript.mjs` to import the shared util**

In `backend/src/3_applications/concierge/services/ConciergeTranscript.mjs` (around line 98-105):
- Delete the local `safeClone` function
- Add `import { safeClone } from '../../agents/framework/utils/safeClone.mjs';` at the top

- [ ] **Step 7: Run full agent test suite; confirm green**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/agents/ \
  tests/isolated/adapters/agents/ \
  backend/src/3_applications/agents/framework/utils/safeClone.test.mjs
```

Expected: all green. The transcripts use the same logic — there should be no behavior change.

- [ ] **Step 8: Commit**

```bash
git add backend/src/3_applications/agents/framework/utils/ \
        backend/src/3_applications/agents/framework/AgentTranscript.mjs \
        backend/src/3_applications/concierge/services/ConciergeTranscript.mjs
git commit -m "$(cat <<'EOF'
refactor(agents): hoist safeClone to shared util (audit DRY-M3)

Both AgentTranscript and ConciergeTranscript had identical inline
safeClone implementations. Lift to framework/utils/safeClone.mjs and
import from both call sites. No behavior change.

Plan / Foundations Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend `AgentTranscript` with optional fields

`ConciergeTranscript` records three things `AgentTranscript` doesn't:
- `policyDecision: { allowed, reason }` per tool call
- `satellite: { id, area, allowedSkills }` snapshot at request start
- `request: { messages, model, stream, conversation_id }` raw HTTP body

Add optional fields to `AgentTranscript` so when Plan B migrates concierge onto it, no concierge data is lost. The fields must be **optional** — current callers (every BaseAgent path) keep working unchanged.

Also add an injectable `filePathStrategy` so concierge can write to its own path layout when Plan B migrates it.

**Files:**
- Modify: `backend/src/3_applications/agents/framework/AgentTranscript.mjs`
- Modify: `tests/isolated/agents/framework/AgentTranscript.test.mjs` (extend existing)

- [ ] **Step 1: Read existing `AgentTranscript.mjs` and its test**

```bash
cd /opt/Code/DaylightStation && wc -l \
  backend/src/3_applications/agents/framework/AgentTranscript.mjs \
  tests/isolated/agents/framework/AgentTranscript.test.mjs
```

Read both. Identify:
- The current `recordTool({ name, args, result, ok, latencyMs, linkedAttachments })` signature
- How `flush()` builds the file path
- The existing `toJSON()` output

- [ ] **Step 2: Append failing tests**

In `tests/isolated/agents/framework/AgentTranscript.test.mjs`, add a new describe block:

```javascript
describe('AgentTranscript optional fields (Plan A Foundations)', () => {
  // helpers — match the existing test file's style
  const baseDeps = {
    agentId: 'test',
    userId: 'kc',
    turnId: '00000000-0000-0000-0000-000000000000',
    mediaDir: '/tmp/test',
    logger: { info: () => {}, error: () => {} },
  };

  it('recordTool accepts optional policyDecision and includes it in toJSON', () => {
    const t = new AgentTranscript(baseDeps);
    t.recordTool({
      name: 'remember_note',
      args: { text: 'hi' },
      result: { ok: true },
      ok: true,
      latencyMs: 5,
      policyDecision: { allowed: true, reason: null },
    });
    const json = t.toJSON();
    expect(json.toolCalls[0].policyDecision).toEqual({ allowed: true, reason: null });
  });

  it('toolCalls without policyDecision do not include the field', () => {
    const t = new AgentTranscript(baseDeps);
    t.recordTool({ name: 'foo', args: {}, result: {}, ok: true, latencyMs: 0 });
    const json = t.toJSON();
    expect(json.toolCalls[0]).not.toHaveProperty('policyDecision');
  });

  it('setRequestBody captures the raw HTTP body in toJSON', () => {
    const t = new AgentTranscript(baseDeps);
    const body = { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o', stream: true };
    t.setRequestBody(body);
    const json = t.toJSON();
    expect(json.requestBody).toEqual(body);
  });

  it('toJSON does not include requestBody when not set', () => {
    const t = new AgentTranscript(baseDeps);
    const json = t.toJSON();
    expect(json).not.toHaveProperty('requestBody');
  });

  it('setSatelliteSnapshot captures satellite info in toJSON', () => {
    const t = new AgentTranscript(baseDeps);
    t.setSatelliteSnapshot({ id: 'kitchen', area: 'kitchen', allowedSkills: ['memory', 'media'] });
    const json = t.toJSON();
    expect(json.satellite).toEqual({ id: 'kitchen', area: 'kitchen', allowedSkills: ['memory', 'media'] });
  });

  it('filePathStrategy option overrides default path generation', async () => {
    const calls = [];
    const writes = [];
    const fakeFs = {
      mkdir: async (path, opts) => { calls.push({ op: 'mkdir', path }); },
      writeFile: async (path, body) => { writes.push({ path, body }); },
    };

    const t = new AgentTranscript({
      ...baseDeps,
      filePathStrategy: (transcript) => `/custom/${transcript.agentId}/${transcript.turnId}.json`,
      fs: fakeFs,
    });
    t.complete('ok');
    await t.flush();

    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`/custom/${baseDeps.agentId}/${baseDeps.turnId}.json`);
  });

  it('default filePathStrategy uses logs/agents/{agentId}/{day}/{userId}/... layout', async () => {
    const writes = [];
    const fakeFs = {
      mkdir: async () => {},
      writeFile: async (path, body) => { writes.push(path); },
    };

    const t = new AgentTranscript({ ...baseDeps, fs: fakeFs });
    t.complete('ok');
    await t.flush();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/\/tmp\/test\/logs\/agents\/test\/\d{4}-\d{2}-\d{2}\/kc\/.+\.json$/);
  });
});
```

NOTE: The exact existing constructor option names (`mediaDir` vs `mediaLogsDir`, `fs` injection point) need to match what's in the file. Read the file first and adapt the test to its actual conventions. Also verify whether the existing tests already cover the default file-path layout — if so, the last test above is redundant.

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/AgentTranscript.test.mjs
```

- [ ] **Step 4: Update `AgentTranscript.mjs`**

```javascript
// In the constructor — accept new options
constructor({ agentId, userId, turnId, mediaDir, logger, fs, filePathStrategy } = {}) {
  // ... existing fields ...
  this.requestBody = null;
  this.satellite = null;
  this.filePathStrategy = filePathStrategy ?? defaultFilePathStrategy;
}

// New methods
setRequestBody(body) {
  this.requestBody = body ? safeClone(body) : null;
}

setSatelliteSnapshot(satellite) {
  this.satellite = satellite ? safeClone(satellite) : null;
}

// Update recordTool — add optional policyDecision
recordTool({ name, args, result, ok, latencyMs, linkedAttachments, policyDecision } = {}) {
  const entry = {
    name,
    args: safeClone(args),
    result: safeClone(result),
    ok: ok !== false,
    latencyMs: latencyMs ?? 0,
  };
  if (linkedAttachments !== undefined) entry.linkedAttachments = linkedAttachments;
  if (policyDecision !== undefined) entry.policyDecision = policyDecision;
  this.toolCalls.push(entry);
}

// Update toJSON — emit optional fields only when set
toJSON() {
  const json = {
    // ... existing fields (version, turnId, agentId, userId, etc.) ...
  };
  if (this.requestBody !== null) json.requestBody = this.requestBody;
  if (this.satellite !== null) json.satellite = this.satellite;
  return json;
}

// Update flush() to use filePathStrategy
async flush() {
  const path = this.filePathStrategy(this);
  // ... existing fs.mkdir + fs.writeFile ...
}

// At the bottom (or in a private function)
function defaultFilePathStrategy(transcript) {
  // Existing logic from current flush() — extracted verbatim
  const date = new Date(transcript.startedAt).toISOString().slice(0, 10);
  const filenameTs = /* ... existing */;
  const turnIdShort = /* ... existing */;
  return `${transcript.mediaDir}/logs/agents/${transcript.agentId}/${date}/${transcript.userId}/${filenameTs}-${turnIdShort}.json`;
}
```

CRITICAL: Read the actual file's flush() body to extract the path-building logic verbatim — don't reinvent the timestamp formatting. The default strategy must produce *exactly* the same path as today.

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/AgentTranscript.test.mjs
```

- [ ] **Step 6: Run full agent test suite — confirm zero regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/agents/ \
  tests/isolated/adapters/agents/
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/agents/framework/AgentTranscript.mjs \
        tests/isolated/agents/framework/AgentTranscript.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): AgentTranscript optional fields (audit DRY-H5)

Adds three optional capture points + injectable file-path strategy:
- recordTool({...policyDecision}) — concierge policy decision per tool
- setRequestBody(rawBody) — concierge raw OpenAI body
- setSatelliteSnapshot({id, area, allowedSkills}) — concierge satellite info
- filePathStrategy option for custom path layouts

All optional. toJSON() emits each field only when set. Existing
callers keep working unchanged.

Sets up Plan B to delete ConciergeTranscript.

Plan / Foundations Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `ToolDecorator` interface

Create the contract that all decorators implement. A decorator is `(tool, context) => wrappedTool` — pure function over `ITool`.

**Files:**
- Create: `backend/src/3_applications/agents/framework/decorators/ToolDecorator.mjs`

- [ ] **Step 1: Write the interface**

```javascript
// backend/src/3_applications/agents/framework/decorators/ToolDecorator.mjs

/**
 * ToolDecorator — interface contract for tool wrappers.
 *
 * A decorator transforms an ITool into another ITool, typically by replacing
 * `execute` with a wrapped version that adds cross-cutting behavior (logging,
 * timing, policy gates, schema rewriting).
 *
 * Decorators compose: applyDecorators([A, B, C]) wraps the tool with A first,
 * then B around A's output, then C around B's output. The outermost decorator
 * runs first when execute() is called.
 *
 * @typedef {import('../ports/ITool.mjs').ITool} ITool
 * @typedef {object} ToolContext
 * @property {string} [agentId]
 * @property {string} [userId]
 * @property {object} [transcript]
 * @property {object} [memory]
 * @property {object} [satellite]   — concierge only (Plan B)
 * @property {object} [policy]      — concierge only (Plan B)
 *
 * @typedef {(tool: ITool, context: ToolContext) => ITool} ToolDecorator
 */

/**
 * No-op decorator — returns the tool unchanged. Useful as a default in tests
 * and as a contract example.
 */
export const identityDecorator = (tool) => tool;

/**
 * Type guard: a decorator is a function of arity 2.
 */
export function isToolDecorator(value) {
  return typeof value === 'function' && value.length <= 2;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/3_applications/agents/framework/decorators/ToolDecorator.mjs
git commit -m "feat(agents): ToolDecorator interface

Plan / Foundations Task 3. Pure-function contract for tool wrappers.
Composes via applyDecorators (Task 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `UserIdInjector` decorator

Extract the userId injection logic from `MastraAdapter.#translateTools` into its own decorator.

**Files:**
- Create: `backend/src/3_applications/agents/framework/decorators/UserIdInjector.mjs`
- Create: `backend/src/3_applications/agents/framework/decorators/UserIdInjector.test.mjs`

- [ ] **Step 1: Read `MastraAdapter.#translateTools` (lines 114-187) for the current logic**

```bash
cd /opt/Code/DaylightStation && sed -n '114,187p' backend/src/1_adapters/agents/MastraAdapter.mjs
```

The current behavior to extract:
1. Strip `userId` from JSON Schema's `required` and `properties`
2. Inside the wrapped `execute(args)`: `if (context.userId) args.userId = context.userId;`

- [ ] **Step 2: Write failing test**

```javascript
// backend/src/3_applications/agents/framework/decorators/UserIdInjector.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { userIdInjector, stripUserIdFromSchema } from './UserIdInjector.mjs';

describe('stripUserIdFromSchema', () => {
  it('removes userId from properties', () => {
    const schema = {
      type: 'object',
      properties: { userId: { type: 'string' }, query: { type: 'string' } },
      required: ['userId', 'query'],
    };
    const result = stripUserIdFromSchema(schema);
    expect(result.properties).not.toHaveProperty('userId');
    expect(result.properties).toHaveProperty('query');
    expect(result.required).toEqual(['query']);
  });

  it('returns the schema unchanged when no userId', () => {
    const schema = { type: 'object', properties: { x: {} }, required: ['x'] };
    expect(stripUserIdFromSchema(schema)).toEqual(schema);
  });

  it('handles missing required array', () => {
    const schema = { type: 'object', properties: { userId: {} } };
    const result = stripUserIdFromSchema(schema);
    expect(result.properties).not.toHaveProperty('userId');
  });

  it('returns null/undefined unchanged', () => {
    expect(stripUserIdFromSchema(null)).toBe(null);
    expect(stripUserIdFromSchema(undefined)).toBe(undefined);
  });
});

describe('userIdInjector decorator', () => {
  function makeTool() {
    return {
      name: 'get_weight',
      description: 'Get user weight',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' }, date: { type: 'string' } },
        required: ['userId', 'date'],
      },
      execute: vi.fn(async (args) => ({ weight: 170, args })),
    };
  }

  it('strips userId from the wrapped tool parameters', () => {
    const wrapped = userIdInjector(makeTool(), { userId: 'kc' });
    expect(wrapped.parameters.properties).not.toHaveProperty('userId');
  });

  it('injects context.userId into args at execute time', async () => {
    const tool = makeTool();
    const wrapped = userIdInjector(tool, { userId: 'kc' });
    const result = await wrapped.execute({ date: '2026-05-06' });
    expect(tool.execute).toHaveBeenCalledWith(
      { date: '2026-05-06', userId: 'kc' },
      { userId: 'kc' }
    );
    expect(result.args.userId).toBe('kc');
  });

  it('does not inject when context.userId is null', async () => {
    const tool = makeTool();
    const wrapped = userIdInjector(tool, { userId: null });
    await wrapped.execute({ date: '2026-05-06' });
    expect(tool.execute).toHaveBeenCalledWith(
      { date: '2026-05-06' },
      { userId: null }
    );
  });

  it('preserves other tool fields (name, description)', () => {
    const tool = makeTool();
    const wrapped = userIdInjector(tool, { userId: 'kc' });
    expect(wrapped.name).toBe('get_weight');
    expect(wrapped.description).toBe('Get user weight');
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/3_applications/agents/framework/decorators/UserIdInjector.test.mjs
```

- [ ] **Step 4: Implement**

```javascript
// backend/src/3_applications/agents/framework/decorators/UserIdInjector.mjs

/**
 * Strip userId from a JSON Schema (object schema). Idempotent — returns the
 * schema unchanged if userId is absent. Returns null/undefined unchanged.
 */
export function stripUserIdFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (!schema.properties || !('userId' in schema.properties)) return schema;
  const { userId: _, ...rest } = schema.properties;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((k) => k !== 'userId')
    : schema.required;
  return { ...schema, properties: rest, ...(required !== undefined ? { required } : {}) };
}

/**
 * UserIdInjector — wraps a tool so that:
 * 1. The wrapped tool's parameters schema has `userId` removed (LLM doesn't
 *    have to pass it).
 * 2. At execute time, `context.userId` is injected into args before calling
 *    the underlying tool.
 *
 * @type {import('./ToolDecorator.mjs').ToolDecorator}
 */
export function userIdInjector(tool, context = {}) {
  return {
    ...tool,
    parameters: stripUserIdFromSchema(tool.parameters),
    execute: async (args, ctx) => {
      const merged = { ...args };
      if (context.userId) merged.userId = context.userId;
      return tool.execute(merged, { ...ctx, userId: context.userId });
    },
  };
}

export default userIdInjector;
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/3_applications/agents/framework/decorators/UserIdInjector.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/framework/decorators/UserIdInjector.mjs \
        backend/src/3_applications/agents/framework/decorators/UserIdInjector.test.mjs
git commit -m "feat(agents): UserIdInjector decorator

Plan / Foundations Task 4. Extracts userId-strip-from-schema +
inject-from-context out of MastraAdapter.#translateTools into a
standalone decorator. Same behavior, smaller seams.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `CallLimiter` decorator

Extract the per-call counter against `maxToolCalls`.

**Files:**
- Create: `backend/src/3_applications/agents/framework/decorators/CallLimiter.mjs`
- Create: `backend/src/3_applications/agents/framework/decorators/CallLimiter.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// backend/src/3_applications/agents/framework/decorators/CallLimiter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { createCallLimiter } from './CallLimiter.mjs';

function makeTool() {
  return {
    name: 'foo',
    description: 'd',
    parameters: { type: 'object' },
    execute: vi.fn(async () => ({ ok: true })),
  };
}

describe('createCallLimiter', () => {
  it('allows calls up to maxToolCalls', async () => {
    const limiter = createCallLimiter({ maxToolCalls: 3 });
    const wrapped = limiter(makeTool(), {});
    const r1 = await wrapped.execute({});
    const r2 = await wrapped.execute({});
    const r3 = await wrapped.execute({});
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
  });

  it('returns an error envelope after maxToolCalls is exceeded', async () => {
    const limiter = createCallLimiter({ maxToolCalls: 2 });
    const wrapped = limiter(makeTool(), {});
    await wrapped.execute({});
    await wrapped.execute({});
    const r3 = await wrapped.execute({});
    expect(r3.error).toMatch(/limit reached/i);
  });

  it('shares the counter across multiple wrapped tools', async () => {
    const limiter = createCallLimiter({ maxToolCalls: 2 });
    const t1 = limiter(makeTool(), {});
    const t2 = limiter(makeTool(), {});
    await t1.execute({});
    await t2.execute({});
    const r3 = await t1.execute({});
    expect(r3.error).toMatch(/limit reached/i);
  });

  it('does not call underlying execute when limit exceeded', async () => {
    const limiter = createCallLimiter({ maxToolCalls: 1 });
    const tool = makeTool();
    const wrapped = limiter(tool, {});
    await wrapped.execute({});
    await wrapped.execute({});  // exceeds limit
    expect(tool.execute).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```javascript
// backend/src/3_applications/agents/framework/decorators/CallLimiter.mjs

/**
 * Create a CallLimiter decorator factory. The factory returns a decorator
 * that shares a counter across all tools it wraps in one call. Wrapping a
 * tool twice (or wrapping multiple tools in one chain) shares the counter.
 *
 * @param {{ maxToolCalls: number }} opts
 * @returns {import('./ToolDecorator.mjs').ToolDecorator}
 */
export function createCallLimiter({ maxToolCalls = 50 } = {}) {
  const counter = { count: 0 };

  return function callLimiter(tool, context = {}) {
    return {
      ...tool,
      execute: async (args, ctx) => {
        counter.count += 1;
        if (counter.count > maxToolCalls) {
          return {
            error: `Tool call limit reached (${maxToolCalls}). Refusing further tool calls this turn.`,
          };
        }
        return tool.execute(args, ctx);
      },
    };
  };
}

export default createCallLimiter;
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/decorators/CallLimiter.mjs \
        backend/src/3_applications/agents/framework/decorators/CallLimiter.test.mjs
git commit -m "feat(agents): CallLimiter decorator factory

Plan / Foundations Task 5. Extracts maxToolCalls counter from
MastraAdapter.#translateTools. Counter is per-factory-call, so all
tools wrapped in one chain share the same limit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `TranscriptRecorder` decorator

Extract per-call timing + `transcript.recordTool` from `MastraAdapter.#translateTools`.

**Files:**
- Create: `backend/src/3_applications/agents/framework/decorators/TranscriptRecorder.mjs`
- Create: `backend/src/3_applications/agents/framework/decorators/TranscriptRecorder.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// backend/src/3_applications/agents/framework/decorators/TranscriptRecorder.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { transcriptRecorder } from './TranscriptRecorder.mjs';

function makeTool(execImpl) {
  return {
    name: 'foo',
    description: 'd',
    parameters: { type: 'object' },
    execute: vi.fn(execImpl ?? (async () => ({ ok: true }))),
  };
}

function makeFakeTranscript() {
  return {
    calls: [],
    recordTool(entry) { this.calls.push(entry); },
  };
}

describe('transcriptRecorder decorator', () => {
  it('records a tool call on success', async () => {
    const transcript = makeFakeTranscript();
    const wrapped = transcriptRecorder(makeTool(), { transcript });
    await wrapped.execute({ x: 1 });
    expect(transcript.calls).toHaveLength(1);
    expect(transcript.calls[0]).toMatchObject({
      name: 'foo',
      args: { x: 1 },
      ok: true,
    });
    expect(transcript.calls[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records ok=false when result has an "error" key', async () => {
    const transcript = makeFakeTranscript();
    const wrapped = transcriptRecorder(makeTool(async () => ({ error: 'oops' })), { transcript });
    await wrapped.execute({});
    expect(transcript.calls[0].ok).toBe(false);
  });

  it('records and re-throws when execute throws', async () => {
    const transcript = makeFakeTranscript();
    const tool = makeTool(async () => { throw new Error('boom'); });
    const wrapped = transcriptRecorder(tool, { transcript });
    await expect(wrapped.execute({ x: 1 })).rejects.toThrow('boom');
    expect(transcript.calls).toHaveLength(1);
    expect(transcript.calls[0].ok).toBe(false);
    expect(transcript.calls[0].result).toMatchObject({ error: 'boom' });
  });

  it('is a no-op when transcript is null', async () => {
    const wrapped = transcriptRecorder(makeTool(), { transcript: null });
    const r = await wrapped.execute({});
    expect(r.ok).toBe(true);
  });

  it('passes through context to the underlying tool', async () => {
    const tool = makeTool();
    const transcript = makeFakeTranscript();
    const wrapped = transcriptRecorder(tool, { transcript, userId: 'kc' });
    await wrapped.execute({}, { foo: 'bar' });
    expect(tool.execute).toHaveBeenCalledWith({}, { foo: 'bar' });
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```javascript
// backend/src/3_applications/agents/framework/decorators/TranscriptRecorder.mjs

/**
 * TranscriptRecorder — wraps a tool so every execute() call is recorded on
 * the active transcript with timing and ok/error status.
 *
 * @type {import('./ToolDecorator.mjs').ToolDecorator}
 */
export function transcriptRecorder(tool, context = {}) {
  const { transcript } = context;
  if (!transcript) return tool;

  return {
    ...tool,
    execute: async (args, ctx) => {
      const startedAt = Date.now();
      try {
        const result = await tool.execute(args, ctx);
        const ok = !(result && typeof result === 'object' && 'error' in result);
        transcript.recordTool({
          name: tool.name,
          args,
          result,
          ok,
          latencyMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        const errResult = { error: error.message };
        transcript.recordTool({
          name: tool.name,
          args,
          result: errResult,
          ok: false,
          latencyMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
  };
}

export default transcriptRecorder;
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/decorators/TranscriptRecorder.mjs \
        backend/src/3_applications/agents/framework/decorators/TranscriptRecorder.test.mjs
git commit -m "feat(agents): TranscriptRecorder decorator

Plan / Foundations Task 6. Extracts timing + transcript.recordTool
from MastraAdapter.#translateTools. No-op when no transcript in
context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `applyDecorators` pipeline runner

The function that takes a list of decorators and a list of tools and produces the wrapped tools.

**Files:**
- Create: `backend/src/3_applications/agents/framework/decorators/applyDecorators.mjs`
- Create: `backend/src/3_applications/agents/framework/decorators/applyDecorators.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// backend/src/3_applications/agents/framework/decorators/applyDecorators.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { applyDecorators } from './applyDecorators.mjs';

function makeTool(name) {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object' },
    execute: vi.fn(async () => ({ ok: true })),
  };
}

describe('applyDecorators', () => {
  it('returns tools unchanged when decorators array is empty', () => {
    const tools = [makeTool('a'), makeTool('b')];
    const wrapped = applyDecorators(tools, [], {});
    expect(wrapped).toHaveLength(2);
    expect(wrapped[0].name).toBe('a');
  });

  it('applies a single decorator to each tool', () => {
    const trace = [];
    const tagger = (tool) => ({ ...tool, name: `tagged:${tool.name}` });
    const wrapped = applyDecorators([makeTool('a'), makeTool('b')], [tagger], {});
    expect(wrapped[0].name).toBe('tagged:a');
    expect(wrapped[1].name).toBe('tagged:b');
  });

  it('composes decorators left-to-right (outermost runs first)', async () => {
    const order = [];
    const decoratorA = (tool) => ({
      ...tool,
      execute: async (args, ctx) => {
        order.push('A:before');
        const r = await tool.execute(args, ctx);
        order.push('A:after');
        return r;
      },
    });
    const decoratorB = (tool) => ({
      ...tool,
      execute: async (args, ctx) => {
        order.push('B:before');
        const r = await tool.execute(args, ctx);
        order.push('B:after');
        return r;
      },
    });
    const tool = makeTool('t');
    const [wrapped] = applyDecorators([tool], [decoratorA, decoratorB], {});
    await wrapped.execute({});
    expect(order).toEqual(['B:before', 'A:before', 'A:after', 'B:after']);
  });

  it('passes context to every decorator', () => {
    const ctx = { userId: 'kc', transcript: { recordTool() {} } };
    const seen = [];
    const recorder = (tool, context) => {
      seen.push(context);
      return tool;
    };
    applyDecorators([makeTool('a'), makeTool('b')], [recorder], ctx);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(ctx);
    expect(seen[1]).toBe(ctx);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```javascript
// backend/src/3_applications/agents/framework/decorators/applyDecorators.mjs

/**
 * Apply a list of decorators to each tool in order. Decorators compose
 * left-to-right — the rightmost decorator wraps closest to the original
 * tool, the leftmost wraps outermost.
 *
 * Equivalent to: `decorators.reduceRight((wrapped, dec) => dec(wrapped, ctx), tool)`
 *
 * @template T
 * @param {Array<T>} tools
 * @param {Array<import('./ToolDecorator.mjs').ToolDecorator>} decorators
 * @param {object} context — passed to every decorator invocation
 * @returns {Array<T>}
 */
export function applyDecorators(tools, decorators, context) {
  return tools.map((tool) =>
    decorators.reduceRight((wrapped, decorator) => decorator(wrapped, context), tool)
  );
}

export default applyDecorators;
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/decorators/applyDecorators.mjs \
        backend/src/3_applications/agents/framework/decorators/applyDecorators.test.mjs
git commit -m "feat(agents): applyDecorators pipeline runner

Plan / Foundations Task 7. Composes a list of ToolDecorators over a
list of tools. Left-to-right composition — outermost decorator runs
first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Refactor `MastraAdapter.#translateTools` to use the decorator chain

Now wire the decorators into `MastraAdapter`. The Mastra-specific bit (JSON Schema → Zod, `mastraCreateTool({...})`) stays in the adapter; everything generic moves to decorators.

**Files:**
- Modify: `backend/src/1_adapters/agents/MastraAdapter.mjs`
- Modify: `tests/isolated/adapters/agents/MastraAdapter.test.mjs` (extend existing — verify behavior unchanged)

- [ ] **Step 1: Read the current `#translateTools` (lines 114-187)**

```bash
cd /opt/Code/DaylightStation && sed -n '110,190p' backend/src/1_adapters/agents/MastraAdapter.mjs
```

Note exactly:
- The order of operations (counter check, userId inject, transcript record, error wrap)
- What goes into `context` for the underlying tool
- The exact log event names and shapes

- [ ] **Step 2: Write a regression test that asserts the new code produces the same wrapped behavior**

In `tests/isolated/adapters/agents/MastraAdapter.test.mjs` (or create `MastraAdapter.decoratorChain.test.mjs` if the existing file is large), add:

```javascript
describe('MastraAdapter decorator chain (Plan A Foundations)', () => {
  it('userId is stripped from translated parameters and injected at execute', async () => {
    const tool = {
      name: 'get_weight',
      description: 'd',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' }, date: { type: 'string' } },
        required: ['userId', 'date'],
      },
      execute: vi.fn(async (args) => ({ ok: true, args })),
    };
    // ... build a MastraAdapter, call execute, verify execution chain ...
    // (use the existing test fixtures' patterns for setting up the adapter)
  });

  it('exceeds maxToolCalls returns error envelope', async () => {
    // Same shape as before — verify the existing limiter-test passes
  });

  it('records each tool call on the transcript with latency', async () => {
    // Same shape as before — verify TranscriptRecorder integration
  });

  it('errors thrown by tools become {error: ...} envelopes and are recorded', async () => {
    // Same shape as before
  });
});
```

CRITICAL: Look at the existing `MastraAdapter.test.mjs` first. Whatever existing tests already cover these behaviors, verify they still pass with the new code — don't duplicate them. Only add new tests where there's a coverage gap revealed by reading the existing suite.

- [ ] **Step 3: Run existing tests; confirm they pass before refactor**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/adapters/agents/MastraAdapter.test.mjs
```

Capture the pass count.

- [ ] **Step 4: Refactor `#translateTools` to use the decorator chain**

Replace the body of `#translateTools` (or its caller — judgment call) with:

```javascript
import { applyDecorators } from '../../3_applications/agents/framework/decorators/applyDecorators.mjs';
import { userIdInjector } from '../../3_applications/agents/framework/decorators/UserIdInjector.mjs';
import { createCallLimiter } from '../../3_applications/agents/framework/decorators/CallLimiter.mjs';
import { transcriptRecorder } from '../../3_applications/agents/framework/decorators/TranscriptRecorder.mjs';
// jsonSchemaToZod import unchanged

#translateTools(tools, context, transcript) {
  const callLimiter = createCallLimiter({ maxToolCalls: this.#maxToolCalls });
  const decorated = applyDecorators(
    tools,
    [userIdInjector, callLimiter, transcriptRecorder],
    { ...context, transcript }
  );

  const mastraTools = {};
  for (const tool of decorated) {
    mastraTools[tool.name] = mastraCreateTool({
      id: tool.name,
      description: tool.description,
      inputSchema: jsonSchemaToZod(tool.parameters),
      execute: async ({ context: _ctx } = {}, args) => {
        // The Mastra runtime calls execute({ context }) where context contains the args.
        // Match the original code's signature here exactly — read the existing impl.
        return tool.execute(/* args extracted per existing code */, context);
      },
    });
  }
  return mastraTools;
}
```

CRITICAL: Match the **exact** log event names and the **exact** Mastra adapter invocation pattern from the original. The decorator chain replaces the *behavior* of `#translateTools`, but the Mastra-specific glue (`mastraCreateTool({ id, description, inputSchema, execute })`) and the way args are routed through Mastra must stay identical.

If the existing logger emits `tool.execute.call` and `tool.execute.complete` events, decide:
- Keep those at the adapter level (outside decorators), OR
- Move them into a fourth decorator (`logger`)

Recommend keeping logger at adapter level for this plan — moving logging is scope creep.

- [ ] **Step 5: Run all adapter + agent tests; confirm same pass count as Step 3**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/adapters/agents/ \
  tests/isolated/agents/
```

Expected: same pass count, no new failures. If any test fails, the decorator chain doesn't perfectly replicate the original — fix the chain, don't change the test.

- [ ] **Step 6: Live smoke test — run the deployed health-coach end-to-end**

```bash
curl -X POST http://localhost:3111/api/v1/agents/health-coach/run \
  -H "Content-Type: application/json" \
  -d '{"input":"What is my current weight?","context":{"userId":"kckern"}}' \
  | head -c 300
```

Expected: a real response with tool-call output. If this fails, something fundamental broke.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/agents/MastraAdapter.mjs \
        tests/isolated/adapters/agents/
git commit -m "$(cat <<'EOF'
refactor(agents): MastraAdapter wraps tools via decorator chain

Plan / Foundations Task 8. The 70-line #translateTools that did
userId injection, call limiting, transcript recording, and error
wrapping is now applyDecorators([UserIdInjector, CallLimiter,
TranscriptRecorder]) producing the same wrapped tools. Mastra-specific
glue (jsonSchemaToZod + mastraCreateTool) stays in the adapter.

No behavior change — same wrapped tools, same log events, same
transcript writes, same error envelopes.

Sets up Plan B to register a PolicyDecorator for concierge tools
without touching the adapter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `BaseAgent.buildPromptSections` hook

Extract the four-section prompt assembly out of `BaseAgent.#assemblePrompt` so subclasses can override.

**Files:**
- Modify: `backend/src/3_applications/agents/framework/BaseAgent.mjs`
- Create: `tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs`

- [ ] **Step 1: Read the current `#assemblePrompt` (lines 144-156)**

```bash
cd /opt/Code/DaylightStation && sed -n '140,160p' backend/src/3_applications/agents/framework/BaseAgent.mjs
```

Confirm the current four sections:
1. `await this.getSystemPrompt(context)`
2. `## Active User\n...` if `context.userId`
3. `await this.formatAttachments(context.attachments)` if non-empty
4. `## Working Memory\n${memory.serialize()}` if memory present

- [ ] **Step 2: Write failing test**

```javascript
// tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs
import { describe, it, expect } from 'vitest';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';
import { WorkingMemoryState } from '../../../../backend/src/3_applications/agents/framework/WorkingMemory.mjs';

class FakeAgent extends BaseAgent {
  static id = 'fake';
  async getSystemPrompt() { return 'BASE'; }
}

describe('BaseAgent.buildPromptSections (default)', () => {
  it('returns base prompt when no context or memory', async () => {
    const agent = new FakeAgent({
      agentRuntime: { execute: async () => ({}) },
      workingMemory: { load: async () => null, save: async () => {} },
    });
    const sections = await agent.buildPromptSections({}, null);
    expect(sections.filter(Boolean)).toEqual(['BASE']);
  });

  it('includes "## Active User" section when userId present', async () => {
    const agent = new FakeAgent({
      agentRuntime: { execute: async () => ({}) },
      workingMemory: { load: async () => null, save: async () => {} },
    });
    const sections = await agent.buildPromptSections({ userId: 'kckern' }, null);
    const userSection = sections.find(s => s?.includes('Active User'));
    expect(userSection).toMatch(/kckern/);
  });

  it('includes "## Working Memory" section when memory present', async () => {
    const agent = new FakeAgent({
      agentRuntime: { execute: async () => ({}) },
      workingMemory: { load: async () => null, save: async () => {} },
    });
    const memory = new WorkingMemoryState();
    memory.set('note', 'remember this');
    const sections = await agent.buildPromptSections({}, memory);
    const memSection = sections.find(s => s?.includes('Working Memory'));
    expect(memSection).toMatch(/remember this/);
  });
});

describe('BaseAgent.buildPromptSections (override)', () => {
  it('subclass can replace sections entirely', async () => {
    class CustomAgent extends FakeAgent {
      async buildPromptSections() {
        return ['CUSTOM_BASE', null, '## Custom Section\nhello'];
      }
    }
    const agent = new CustomAgent({
      agentRuntime: { execute: async () => ({}) },
      workingMemory: { load: async () => null, save: async () => {} },
    });
    const sections = await agent.buildPromptSections({});
    expect(sections.filter(Boolean)).toEqual(['CUSTOM_BASE', '## Custom Section\nhello']);
  });
});

describe('BaseAgent.run uses buildPromptSections to assemble system prompt', () => {
  it('passes joined sections (filtered, joined by \\n\\n) to agentRuntime.execute', async () => {
    let captured;
    class CapturingAgent extends FakeAgent {
      async buildPromptSections() {
        return ['SECTION_1', null, 'SECTION_2'];
      }
    }
    const agent = new CapturingAgent({
      agentRuntime: { execute: async (args) => { captured = args; return { output: 'ok' }; } },
      workingMemory: { load: async () => null, save: async () => {} },
    });
    await agent.run('hi', { context: { userId: 'kc' } });
    expect(captured.systemPrompt).toBe('SECTION_1\n\nSECTION_2');
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs
```

- [ ] **Step 4: Refactor `BaseAgent`**

In `backend/src/3_applications/agents/framework/BaseAgent.mjs`, add the new hook and reduce `#assemblePrompt` to a thin caller:

```javascript
/**
 * Build the array of prompt sections that get joined to form the system
 * prompt. Override to add, remove, or reorder sections in subclasses.
 *
 * Default returns four sections (any may be null/empty — they're filtered):
 * 1. Base prompt from getSystemPrompt(context)
 * 2. "## Active User" if context.userId present
 * 3. "## User Mentions" from formatAttachments() if attachments present
 * 4. "## Working Memory" from memory.serialize() if memory present
 *
 * @param {object} context
 * @param {WorkingMemoryState|null} memory
 * @returns {Promise<Array<string|null>>}
 */
async buildPromptSections(context = {}, memory = null) {
  const sections = [await this.getSystemPrompt(context)];
  if (context.userId) {
    sections.push(`## Active User\nThe user you are assisting is: **${context.userId}**`);
  }
  const attachmentsBlock = await this.formatAttachments(context.attachments);
  if (attachmentsBlock) sections.push(attachmentsBlock);
  if (memory) sections.push(`## Working Memory\n${memory.serialize()}`);
  return sections;
}

async #assemblePrompt(memory, context = {}) {
  const sections = await this.buildPromptSections(context, memory);
  return sections.filter(Boolean).join('\n\n');
}
```

CRITICAL: `#assemblePrompt` is private. The tests above access the assembled prompt indirectly through `agentRuntime.execute`. If the existing test suite has direct tests on `#assemblePrompt`, they'll need to call through `run` / `runStream` — verify before assuming the existing tests still pass.

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs \
  tests/isolated/agents/
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/framework/BaseAgent.mjs \
        tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): BaseAgent.buildPromptSections hook (audit DRY-H3)

Subclasses can now override the prompt section list to add satellite,
personality, vocabulary, etc. — Plan B will use this for concierge.
Default returns the current four sections; #assemblePrompt becomes a
thin filter+join over the section array.

No behavior change for existing agents.

Plan / Foundations Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `EchoAgent extends BaseAgent` (Q7 cleanup)

`EchoAgent.mjs` currently has its own `run()` method that mirrors `BaseAgent.run` instead of inheriting. With Task 9's `buildPromptSections` hook in place, EchoAgent can drop its bespoke `run` entirely.

**Files:**
- Modify: `backend/src/3_applications/agents/echo/EchoAgent.mjs`
- Create: `tests/isolated/agents/echo/EchoAgent.baseAgent.test.mjs`

- [ ] **Step 1: Read the current EchoAgent**

```bash
cd /opt/Code/DaylightStation && cat backend/src/3_applications/agents/echo/EchoAgent.mjs
```

Identify exactly what its `run` method does that's different from `BaseAgent.run`. Likely it's just synthesizing a fixed echo response without going through Mastra. If that's the case, EchoAgent can either:
(a) Use a fake `agentRuntime` injected at construction that returns the echo, OR
(b) Override `run` to return the echo directly without calling the runtime.

Option (a) is more consistent with the framework. But EchoAgent's purpose is partly to be a no-LLM smoke-test agent — calling the runtime defeats that. Option (b) is right.

- [ ] **Step 2: Write failing tests**

```javascript
// tests/isolated/agents/echo/EchoAgent.baseAgent.test.mjs
import { describe, it, expect } from 'vitest';
import EchoAgent from '../../../../backend/src/3_applications/agents/echo/EchoAgent.mjs';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

describe('EchoAgent extends BaseAgent', () => {
  it('is a subclass of BaseAgent', () => {
    expect(EchoAgent.prototype instanceof BaseAgent || EchoAgent === BaseAgent).toBe(false);
    // The above is wrong — fix: just verify inheritance positively
    expect(Object.getPrototypeOf(EchoAgent.prototype)).toBe(BaseAgent.prototype);
  });

  it('inherits buildPromptSections from BaseAgent', () => {
    const agent = new EchoAgent({
      workingMemory: { load: async () => null, save: async () => {} },
    });
    expect(typeof agent.buildPromptSections).toBe('function');
  });

  it('still echoes its input', async () => {
    const agent = new EchoAgent({
      workingMemory: { load: async () => null, save: async () => {} },
    });
    const result = await agent.run('hello world', { context: { userId: 'kc' } });
    expect(result.output).toMatch(/hello world/);
  });

  it('still works through the orchestrator', async () => {
    // Use the existing orchestrator test fixtures if available — verify
    // orchestrator.run('echo', 'hi', {}) still returns the echo output.
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/echo/EchoAgent.baseAgent.test.mjs
```

- [ ] **Step 4: Refactor EchoAgent**

```javascript
// backend/src/3_applications/agents/echo/EchoAgent.mjs
import { BaseAgent } from '../framework/BaseAgent.mjs';

class EchoAgent extends BaseAgent {
  static id = 'echo';
  static description = 'Diagnostic echo agent — returns its input verbatim, no LLM';

  async getSystemPrompt() {
    return 'You are an echo agent. Return the user input verbatim.';
  }

  registerTools() {
    // No tools.
  }

  /**
   * Override BaseAgent.run to skip the LLM round-trip. EchoAgent's purpose
   * is to validate the orchestrator + transcript + memory plumbing without
   * any external dependencies.
   */
  async run(input, { userId, context = {} } = {}) {
    const output = `Echo: ${input}`;
    return {
      output,
      toolCalls: [],
      usage: null,
    };
  }
}

export default EchoAgent;
```

CRITICAL: Read the existing EchoAgent first. It may already export differently (named vs default), and may have a transcript/memory lifecycle that this simplification skips. If it does, the override should still load+save memory the way BaseAgent.run does — call `super.run` is not viable because that goes through the runtime.

If the existing EchoAgent does NOTHING with memory or transcript and just returns an echo, the simplified version above is fine. Otherwise, copy the memory load/save lifecycle (without the runtime call) into the override.

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/
```

Expected: all tests including existing EchoAgent tests still pass. If any existing EchoAgent test fails because it asserted bespoke behavior we removed (e.g., checking that the agent has a `_internal_log` field), evaluate whether the test is still meaningful.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/echo/EchoAgent.mjs \
        tests/isolated/agents/echo/EchoAgent.baseAgent.test.mjs
git commit -m "$(cat <<'EOF'
refactor(agents): EchoAgent extends BaseAgent (audit Q7)

EchoAgent had its own run() mirroring BaseAgent.run logic. Now it
inherits from BaseAgent — registerTools() is a no-op, getSystemPrompt
returns the echo instructions, and run() is overridden to skip the
LLM round-trip (which is the whole point of EchoAgent — diagnostic
plumbing test, no external deps).

Plan / Foundations Task 10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run the full agents test suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/agents/ \
  tests/isolated/adapters/agents/ \
  backend/src/3_applications/agents/framework/ \
  tests/isolated/api/routers/agents.runStream.test.mjs
```

Expected: all green. The pre-Plan-A snapshot was 1502 tests passing in `tests/isolated/agents/`; the post-Plan-A count should be that plus the new tests added in Tasks 1-10 (roughly +30-50 tests).

- [ ] **Step 2: Live smoke test against the deployed instance**

```bash
# Echo agent — sanity check the orchestrator path
curl -X POST http://localhost:3111/api/v1/agents/echo/run \
  -H "Content-Type: application/json" \
  -d '{"input":"hello","context":{"userId":"kckern"}}'

# Health-coach agent — sanity check the full stack including tools
curl -X POST http://localhost:3111/api/v1/agents/health-coach/run \
  -H "Content-Type: application/json" \
  -d '{"input":"What is my current weight?","context":{"userId":"kckern"}}' \
  | head -c 500

# SSE — sanity check the streaming path
curl -N -X POST http://localhost:3111/api/v1/agents/health-coach/run-stream \
  -H "Content-Type: application/json" \
  -d '{"input":"hi","context":{"userId":"kckern"}}' | head -20
```

Expected: all three return valid responses.

- [ ] **Step 3: Concierge sanity (read-only verification)**

Concierge wasn't touched by this plan, but verify it still works since it shares `MastraAdapter`:

```bash
# Concierge requires a satellite bearer token — get one from the registry config
# Skip this check if a satellite-tokened curl isn't easily reproducible from this env;
# instead verify by reading docker logs after a HA Voice satellite call
sudo docker logs daylight-station --since 5m 2>&1 | grep -i 'concierge' | tail -10
```

If concierge has been used recently (HA Voice traffic), confirm the logs still show successful tool calls and transcript writes. If no concierge traffic, that's fine — Plan B will exercise it heavily.

- [ ] **Step 4: Final empty commit marking Plan A complete**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(agents): Plan A foundations complete

Five no-behavior-change refactors landed:
- safeClone hoisted (DRY-M3)
- AgentTranscript optional fields (DRY-H5 setup)
- ToolDecorator chain in MastraAdapter (DRY-H2 setup)
- BaseAgent.buildPromptSections hook (DRY-H3 setup)
- EchoAgent extends BaseAgent (Q7)

Substrate ready for Plan B (concierge migration), Plan C (HTTP
unification), Plan D (frontend convergence).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Audit finding | Plan A task | Status after Plan A |
|---|---|---|
| **DRY-M3** safeClone duplicated | Task 1 | Resolved (concierge import lands; concierge file deleted in Plan B) |
| **DRY-H5** Two transcript classes | Task 2 (extends `AgentTranscript`) | Substrate ready; concierge migration in Plan B |
| **DRY-H2** ConciergeAgent reimplements BaseAgent | Tasks 3–8 (decorators) + Task 9 (prompt sections) | Substrate ready; concierge subclass in Plan B |
| **DRY-H3** Two prompt-assembly functions | Task 9 | Substrate ready |
| **Q7** EchoAgent doesn't extend BaseAgent | Task 10 | Resolved |
| DRY-H1 Two `MastraAdapter` instances | — | Plan B (consolidates when concierge registers via orchestrator) |
| DRY-H4 Two memory ports backed by same adapter | — | Plan B (deletes `YamlConciergeMemoryAdapter`) |
| DRY-H6 Two backend HTTP layers | — | Plan C (`mountAgentHttp`) |
| DRY-H7 Three frontend chat surfaces | — | Plan D (`<AgentChatSurface>`) |
| DRY-M1 ISkill vs ToolFactory | — | Plan B (ToolBundle migration) |
| DRY-M2 Tool object shape divergence | — | Plan B (concierge tools migrate to `createTool({...defaultPolicy?})`) |
| DRY-M4 Two SSE consumers | — | Plan D (lift `parseSSE`) |
| DRY-M5 Per-turn timing/log emit pattern | Tasks 5–6 (now in TranscriptRecorder; logger event names unified by Plan B if needed) | Partial — log events still emit at adapter level; concierge unification in Plan B |
| DRY-M6 Logger-child component propagation | — | Cosmetic; defer or address in Plan B |

---

## Notes for the implementer

- **Concierge files are read-only.** This plan reads from `backend/src/3_applications/concierge/` to verify shapes and identify duplication, but only `ConciergeTranscript.mjs` gets the safeClone import added (Task 1) — nothing else in concierge changes. If you find yourself wanting to modify a concierge file, stop and reconsider — that's Plan B's job.

- **Behavior preservation is the test.** Throughout this plan, the existing 1500+ test suite is the regression gate. If a test fails, it's a sign the refactor isn't behavior-preserving, not a sign the test is wrong (with very rare exceptions where a test asserts an internal field name the refactor removes — judge case-by-case).

- **Logger event names.** The current `MastraAdapter` emits `tool.execute.call` and `tool.execute.complete` events around every tool call. Task 8's decorator chain might tempt you to move logging into a fourth decorator — don't. Keep logger emission at the adapter level (around the `mastraCreateTool` call), so the event name and shape stays exactly the same. Plan B can revisit this when concierge merges in.

- **Decorator order matters.** The chain `[UserIdInjector, CallLimiter, TranscriptRecorder]` produces this execution order: UserIdInjector wraps outermost (runs first / closes last), TranscriptRecorder wraps innermost (runs last / closes first). When `execute({ date })` is called:
  1. UserIdInjector adds `userId: 'kc'` to args → forwards
  2. CallLimiter increments counter, checks limit → forwards
  3. TranscriptRecorder starts timer → forwards to underlying tool
  4. Tool runs, returns result
  5. TranscriptRecorder records call → returns
  6. CallLimiter returns
  7. UserIdInjector returns

  Matches the original code's order. If you change the order, you change semantics (e.g., transcript no longer sees userId injection).

- **Mastra `execute` signature.** Mastra's `mastraCreateTool({ execute })` signature is something like `execute({ context }) => result` where `context` is the LLM-supplied args. The current `MastraAdapter.#translateTools` adapts this to the `ITool` signature `execute(args, context) => result`. Keep this adaptation in the adapter — decorators expect the `ITool` signature. The decorator chain's `execute(args, ctx)` is **not** the Mastra signature; the adapter has to translate.

- **Don't introduce new ports.** `ToolDecorator` is a callable shape, not a port — no `IToolDecorator.mjs` port file is needed. Decorators are functions; type-check by signature.

- **Decorator state.** `CallLimiter` has shared state (the counter). `UserIdInjector` and `TranscriptRecorder` are stateless — they read context fresh on every call. If you find yourself wanting to add stateful decorators, reconsider — the chain is meant to be re-buildable per turn, not per-agent.

- **`buildPromptSections` is not async-friendly inside the section array.** Each section is a string (or null), not a Promise. `buildPromptSections` itself is async because `getSystemPrompt` and `formatAttachments` are async. Inside the array, every entry is already-resolved. Test cases reflect this.

- **EchoAgent edge case.** If the existing EchoAgent has an existing test that exercises specific log events (e.g., `agents.echo.run` or `agents.echo.complete`), those events may move when EchoAgent inherits from BaseAgent. Read the existing tests carefully and either preserve the events (by emitting them in EchoAgent's overridden `run`) or update the tests if the events were never useful.

---

## What comes next (preview of Plans B/C/D)

**Plan B — Concierge Migration** (audit §7 steps 5–8). After Plan A:
- Concierge skills migrate `ISkill → ToolBundle` (with optional `getPromptFragment`)
- `ConciergeAgent extends BaseAgent`, overrides `buildPromptSections` to add satellite/personality/vocab/skill-fragments/memory-snapshot sections
- `ConciergePolicyEvaluator` wires in via a new `policyDecorator` registered on the concierge agent's `buildToolDecorators()` chain
- `ConciergeTranscript` deleted; `AgentTranscript` with `setRequestBody`/`setSatelliteSnapshot` used instead
- `IConciergeMemory`/`YamlConciergeMemoryAdapter` deleted; concierge uses `IWorkingMemory` with `userId='household'`
- `ConciergeApplication` deleted; concierge registers via `agentOrchestrator.register(ConciergeAgent, deps)` like every other agent
- Two `MastraAdapter` instances collapse to one (DRY-H1) — except the MediaJudge sub-runtime, which can stay as a per-skill request for a separately-configured runtime
- **Risk:** end-to-end HA Voice testing required; rollback plan = revert single commit
- **Estimated tasks:** ~12

**Plan C — HTTP Unification** (audit §7 step 9). After Plan B:
- New `mountAgentHttp(orchestrator, agentId, app, { wireFormat, mountPath, authMiddleware, contextExtractor })` wires up an agent's HTTP surface
- Two wire-format presets: `'native'` (current `agents.mjs` JSON) and `'openai-chat-completions'` (current concierge SSE wire)
- `agents.mjs`, `agents-stream.mjs`, `concierge.mjs`, `OpenAIChatCompletionsTranslator` all deleted
- Bootstrap calls `mountAgentHttp` once per registered agent
- **Risk:** Any HA Voice client behavior that depends on translator quirks (response framing, tool-event suppression) needs a regression test
- **Estimated tasks:** ~10

**Plan D — Frontend Convergence** (audit §7 step 10). Independent of B/C — could land in parallel:
- Lift `parseSSE` to `frontend/src/lib/sse/parseSSE.js`
- Build `<AgentChatSurface agentId, userId, mentions?>` based on `Health/CoachChat` (assistant-ui primitives)
- Migrate `Health/CoachChat` to a thin wrapper passing health-specific `mentions` config
- Delete `Chat/ChatPanel.jsx`, `Chat/useChatEngine.js` (broken — wrong URL prefix)
- Replace `Life/views/coach/CoachChat.jsx` with `<AgentChatSurface agentId='lifeplan-guide' />`
- **Risk:** frontend regression in the lifeplan view (currently broken, so blast radius is limited)
- **Estimated tasks:** ~8
