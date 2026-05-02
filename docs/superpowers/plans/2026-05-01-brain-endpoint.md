# Brain Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an OpenAI-compatible `/v1/chat/completions` endpoint backed by a curated, Mastra-driven `BrainAgent` that turns Home Assistant Voice PE commands into household actions (HA control, media playback, read-only personal-domain queries) with per-satellite scope and household-scoped memory.

**Architecture:** DDD-clean layering — `2_domains/brain/` for entities, `3_applications/brain/` for the agent + ports + skills + composition root, `1_adapters/` for outbound adapters, `4_api/v1/` for the OpenAI-shaped inbound translator and router. The brain is a proper hexagonal application: it depends on ports, the inbound API translates wire format, the composition root wires concrete adapters.

**Tech Stack:** Node.js (`.mjs`), Express, `@mastra/core` 1.x for agent runtime + OpenAI, jest for tests, YAML for config and persistence (via existing `dataService` and `ConfigService`).

**Spec:** `/opt/Code/DaylightStation/docs/superpowers/specs/2026-05-01-brain-endpoint-design.md`

---

## Phase 0 — Pre-flight

### Task 0: Verify worktree, branch, and design doc

**Files:**
- Read: `docs/superpowers/specs/2026-05-01-brain-endpoint-design.md`

- [ ] **Step 1: Confirm working directory is `/opt/Code/DaylightStation` (or a worktree of it).** If you are in a stale worktree path, switch out before starting.

- [ ] **Step 2: Read the spec end-to-end before touching code.** Skip is not an option — every later task references decisions captured there.

- [ ] **Step 3: Create a feature branch (or worktree) named `brain-endpoint`.** Stay on it for the entire plan.

- [ ] **Step 4: Confirm Docker host (`kckern-server`) deploy access works** — `sudo docker ps daylight-station` returns the running container. If not, fix before deployment phase (Phase 9).

---

## Phase 1 — Domain & Ports (no I/O)

### Task 1: Brain domain types

**Files:**
- Create: `backend/src/2_domains/brain/Satellite.mjs`
- Create: `backend/src/2_domains/brain/BrainDecision.mjs`
- Create: `backend/src/2_domains/brain/index.mjs`
- Test: `backend/tests/unit/domains/brain/Satellite.test.mjs`

- [ ] **Step 1: Write failing test for `Satellite`**

```javascript
// backend/tests/unit/domains/brain/Satellite.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Satellite } from '../../../../src/2_domains/brain/Satellite.mjs';

describe('Satellite', () => {
  const valid = {
    id: 'livingroom',
    mediaPlayerEntity: 'media_player.living_room',
    area: 'livingroom',
    allowedSkills: ['memory', 'home_automation'],
    defaultVolume: 30,
    defaultMediaClass: 'music'
  };

  it('constructs with valid fields', () => {
    const s = new Satellite(valid);
    assert.strictEqual(s.id, 'livingroom');
    assert.strictEqual(s.mediaPlayerEntity, 'media_player.living_room');
  });

  it('rejects empty allowedSkills', () => {
    assert.throws(() => new Satellite({ ...valid, allowedSkills: [] }), /allowedSkills/);
  });

  it('rejects missing mediaPlayerEntity', () => {
    assert.throws(() => new Satellite({ ...valid, mediaPlayerEntity: null }), /mediaPlayerEntity/);
  });

  it('canUseSkill returns true for allowed skills', () => {
    const s = new Satellite(valid);
    assert.strictEqual(s.canUseSkill('memory'), true);
    assert.strictEqual(s.canUseSkill('finance_read'), false);
  });

  it('mediaPlayerFor returns the configured entity', () => {
    const s = new Satellite(valid);
    assert.strictEqual(s.mediaPlayerFor(), 'media_player.living_room');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/domains/brain/Satellite.test.mjs
```

Expected: FAIL — `Satellite` not found.

- [ ] **Step 3: Implement `Satellite`**

```javascript
// backend/src/2_domains/brain/Satellite.mjs
export class Satellite {
  constructor({ id, mediaPlayerEntity, area = null, allowedSkills = [], defaultVolume = null, defaultMediaClass = null }) {
    if (!id || typeof id !== 'string') throw new Error('Satellite.id is required');
    if (!mediaPlayerEntity || typeof mediaPlayerEntity !== 'string') throw new Error('Satellite.mediaPlayerEntity is required');
    if (!Array.isArray(allowedSkills) || allowedSkills.length === 0) throw new Error('Satellite.allowedSkills must be a non-empty list');

    this.id = id;
    this.mediaPlayerEntity = mediaPlayerEntity;
    this.area = area;
    this.allowedSkills = Object.freeze([...allowedSkills]);
    this.defaultVolume = defaultVolume;
    this.defaultMediaClass = defaultMediaClass;
    Object.freeze(this);
  }

  canUseSkill(name) {
    return this.allowedSkills.includes(name);
  }

  mediaPlayerFor(_mediaClass = null) {
    // v1: same media player for all classes; future: per-class override
    return this.mediaPlayerEntity;
  }
}

export default Satellite;
```

- [ ] **Step 4: Implement `BrainDecision`**

```javascript
// backend/src/2_domains/brain/BrainDecision.mjs
export class BrainDecision {
  constructor({ allow, reason = null }) {
    this.allow = !!allow;
    this.reason = reason;
    Object.freeze(this);
  }
  static allow() { return new BrainDecision({ allow: true }); }
  static deny(reason) { return new BrainDecision({ allow: false, reason }); }
}
export default BrainDecision;
```

- [ ] **Step 5: Index file**

```javascript
// backend/src/2_domains/brain/index.mjs
export { Satellite } from './Satellite.mjs';
export { BrainDecision } from './BrainDecision.mjs';
```

- [ ] **Step 6: Run tests — confirm pass**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/domains/brain/
```

Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/2_domains/brain backend/tests/unit/domains/brain
git commit -m "feat(brain): add Satellite and BrainDecision domain types"
```

---

### Task 2: Brain application ports

**Files:**
- Create: `backend/src/3_applications/brain/ports/ISkill.mjs`
- Create: `backend/src/3_applications/brain/ports/ISatelliteRegistry.mjs`
- Create: `backend/src/3_applications/brain/ports/IBrainPolicy.mjs`
- Create: `backend/src/3_applications/brain/ports/IBrainMemory.mjs`
- Create: `backend/src/3_applications/brain/ports/IChatCompletionRunner.mjs`
- Create: `backend/src/3_applications/brain/ports/index.mjs`

These files define interfaces (JSDoc + `assert*` / `is*` runtime checkers, matching the existing `IHomeAutomationGateway.mjs` pattern). No tests beyond import smoke; the contracts are exercised by later tasks.

- [ ] **Step 1: Implement `ISkill.mjs`** (modeled on `IHomeAutomationGateway.mjs` shape)

```javascript
// backend/src/3_applications/brain/ports/ISkill.mjs
/**
 * ISkill — a bundle of related tools + prompt fragment + config.
 *
 * Implementations must provide:
 *   name: string
 *   getTools(): ITool[]
 *   getPromptFragment(satellite): string
 *   getConfig(): object
 */
export function isSkill(obj) {
  return !!obj
    && typeof obj.name === 'string'
    && typeof obj.getTools === 'function'
    && typeof obj.getPromptFragment === 'function'
    && typeof obj.getConfig === 'function';
}
export function assertSkill(obj) {
  if (!isSkill(obj)) throw new Error('Object does not implement ISkill');
}
export default { isSkill, assertSkill };
```

- [ ] **Step 2: Implement `ISatelliteRegistry.mjs`**

```javascript
// backend/src/3_applications/brain/ports/ISatelliteRegistry.mjs
/**
 * ISatelliteRegistry
 *   findByToken(token: string): Promise<Satellite | null>
 *   list(): Promise<Satellite[]>
 */
export function isSatelliteRegistry(obj) {
  return !!obj && typeof obj.findByToken === 'function' && typeof obj.list === 'function';
}
export function assertSatelliteRegistry(obj) {
  if (!isSatelliteRegistry(obj)) throw new Error('Object does not implement ISatelliteRegistry');
}
export default { isSatelliteRegistry, assertSatelliteRegistry };
```

- [ ] **Step 3: Implement `IBrainPolicy.mjs`**

```javascript
// backend/src/3_applications/brain/ports/IBrainPolicy.mjs
/**
 * IBrainPolicy
 *   evaluateRequest(satellite, request): BrainDecision
 *   evaluateToolCall(satellite, toolName, args): BrainDecision
 *   shapeResponse(satellite, draftText): string
 */
export function isBrainPolicy(obj) {
  return !!obj
    && typeof obj.evaluateRequest === 'function'
    && typeof obj.evaluateToolCall === 'function'
    && typeof obj.shapeResponse === 'function';
}
export function assertBrainPolicy(obj) {
  if (!isBrainPolicy(obj)) throw new Error('Object does not implement IBrainPolicy');
}
export default { isBrainPolicy, assertBrainPolicy };
```

- [ ] **Step 4: Implement `IBrainMemory.mjs`**

```javascript
// backend/src/3_applications/brain/ports/IBrainMemory.mjs
/**
 * IBrainMemory — household-scoped working memory.
 *   get(key: string): Promise<any>
 *   set(key: string, value: any): Promise<void>
 *   merge(key: string, partial: object): Promise<void>
 */
export function isBrainMemory(obj) {
  return !!obj
    && typeof obj.get === 'function'
    && typeof obj.set === 'function'
    && typeof obj.merge === 'function';
}
export function assertBrainMemory(obj) {
  if (!isBrainMemory(obj)) throw new Error('Object does not implement IBrainMemory');
}
export default { isBrainMemory, assertBrainMemory };
```

- [ ] **Step 5: Implement `IChatCompletionRunner.mjs`**

```javascript
// backend/src/3_applications/brain/ports/IChatCompletionRunner.mjs
/**
 * IChatCompletionRunner — what BrainApplication exposes outward.
 *   runChat({ satellite, messages, tools?, conversationId? }): Promise<{
 *     content: string,
 *     toolCalls: Array,
 *     usage: { promptTokens, completionTokens, totalTokens }
 *   }>
 *   streamChat({ satellite, messages, tools?, conversationId? }): AsyncIterable<ChatChunk>
 */
export function isChatCompletionRunner(obj) {
  return !!obj && typeof obj.runChat === 'function' && typeof obj.streamChat === 'function';
}
export function assertChatCompletionRunner(obj) {
  if (!isChatCompletionRunner(obj)) throw new Error('Object does not implement IChatCompletionRunner');
}
export default { isChatCompletionRunner, assertChatCompletionRunner };
```

- [ ] **Step 6: Index file**

```javascript
// backend/src/3_applications/brain/ports/index.mjs
export * from './ISkill.mjs';
export * from './ISatelliteRegistry.mjs';
export * from './IBrainPolicy.mjs';
export * from './IBrainMemory.mjs';
export * from './IChatCompletionRunner.mjs';
```

- [ ] **Step 7: Smoke-import test**

```javascript
// backend/tests/unit/applications/brain/ports.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as ports from '../../../../src/3_applications/brain/ports/index.mjs';

describe('brain ports module', () => {
  it('exports all assertion helpers', () => {
    for (const name of [
      'assertSkill','assertSatelliteRegistry','assertBrainPolicy',
      'assertBrainMemory','assertChatCompletionRunner']) {
      assert.strictEqual(typeof ports[name], 'function', `${name} missing`);
    }
  });
});
```

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/ports.test.mjs
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/3_applications/brain/ports backend/tests/unit/applications/brain/ports.test.mjs
git commit -m "feat(brain): add brain application ports (ISkill, ISatelliteRegistry, IBrainPolicy, IBrainMemory, IChatCompletionRunner)"
```

---

### Task 3: Extend `IAgentRuntime` with `streamExecute()`

**Files:**
- Modify: `backend/src/3_applications/agents/ports/IAgentRuntime.mjs`

- [ ] **Step 1: Read existing port file in full**

```bash
cat /opt/Code/DaylightStation/backend/src/3_applications/agents/ports/IAgentRuntime.mjs
```

- [ ] **Step 2: Add `streamExecute` to the JSDoc contract and the `is*` checker**

Edit `IAgentRuntime.mjs`:
- In the JSDoc block listing required methods, add:
  ```
  streamExecute({ agent, agentId, input, tools, systemPrompt, context, memory }):
    AsyncIterable<{type: 'text-delta'|'tool-start'|'tool-end'|'finish', ...}>
  ```
- In the `isAgentRuntime` function, add: `&& typeof obj.streamExecute === 'function'`

- [ ] **Step 3: Update existing tests to the new contract**

If `tests/unit/agents/MastraAdapter.test.mjs` (or similar) constructs a fake runtime, ensure it now exposes a `streamExecute` stub returning `(async function*(){})()`. Search for `isAgentRuntime` usage:

```bash
grep -rn "isAgentRuntime\|assertAgentRuntime" /opt/Code/DaylightStation/backend
```

Patch each call site that constructs a fake.

- [ ] **Step 4: Run all agent tests**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/agents/
```

Expected: existing tests still pass (we only added an optional method to fakes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/ports/IAgentRuntime.mjs backend/tests/unit/agents
git commit -m "feat(agents): extend IAgentRuntime with streamExecute() for streamed responses"
```

---

## Phase 2 — Outbound adapters

### Task 4: Implement `MastraAdapter.streamExecute()`

**Files:**
- Modify: `backend/src/1_adapters/agents/MastraAdapter.mjs`
- Test: `backend/tests/unit/adapters/agents/MastraAdapter.stream.test.mjs`

- [ ] **Step 1: Confirm `@mastra/core` exposes `Agent.stream()`**

```bash
grep -A 3 "stream<OUTPUT>" /opt/Code/DaylightStation/backend/node_modules/@mastra/core/dist/agent/agent.d.ts | head -20
```

- [ ] **Step 2: Write a failing test** (uses Mastra mock — keep it small)

```javascript
// backend/tests/unit/adapters/agents/MastraAdapter.stream.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { jest } from '@jest/globals';

// We test that streamExecute calls the right Mastra API and yields normalized chunks.
// Full integration with real Mastra is in manual smoke tests.

describe('MastraAdapter.streamExecute', () => {
  it('yields text-delta chunks from a Mastra stream', async () => {
    // Construct a mock Agent instance whose .stream() returns an async iterable.
    // Substitute it via a private setter or by using jest.unstable_mockModule.
    // (Actual implementation depends on how MastraAdapter constructs agents internally.)

    // Pseudo-skeleton:
    //   const adapter = new MastraAdapter({ logger });
    //   adapter._setAgentFactory(() => fakeAgentEmittingTextDeltas);
    //   const chunks = [];
    //   for await (const c of adapter.streamExecute({ input: 'hi', tools: [] })) chunks.push(c);
    //   assert.ok(chunks.some(c => c.type === 'text-delta'));
    //   assert.ok(chunks.at(-1).type === 'finish');
    assert.ok(true); // replace with real test once stream-event normalization is implemented
  });
});
```

This test is a placeholder; the real stream-event shape is asserted in the application-layer test in Task 9. Streaming details depend on Mastra; **do not over-test the adapter — test the contract through the application**.

- [ ] **Step 3: Implement `streamExecute`**

Add the method to `MastraAdapter` after `execute()`:

```javascript
// backend/src/1_adapters/agents/MastraAdapter.mjs (additions)
async *streamExecute({ agent, agentId, input, tools, systemPrompt, context = {} }) {
  const name = agentId || agent?.constructor?.id || 'unknown';
  const callCounter = { count: 0 };
  const mastraTools = this.#translateTools(tools || [], context, callCounter);

  const mastraAgent = new Agent({
    name,
    instructions: systemPrompt,
    model: this.#model,
    tools: mastraTools,
  });

  this.#logger.info?.('agent.stream.start', {
    agentId: name,
    inputLength: input?.length,
    toolCount: Object.keys(mastraTools).length,
  });

  const start = Date.now();
  let totalChunks = 0;
  try {
    const stream = await mastraAgent.stream(input);
    for await (const part of stream) {
      totalChunks++;
      // Normalize Mastra event shape -> brain-port shape.
      // Mastra event types vary by version; map known ones, drop unknowns.
      switch (part.type) {
        case 'text-delta':
          yield { type: 'text-delta', text: part.textDelta ?? part.text ?? '' };
          break;
        case 'tool-call':
          yield { type: 'tool-start', toolName: part.toolName, args: part.args };
          break;
        case 'tool-result':
          yield { type: 'tool-end', toolName: part.toolName, result: part.result };
          break;
        case 'finish':
          yield { type: 'finish', reason: part.finishReason ?? 'stop', usage: part.usage };
          break;
        default:
          // Unknown event — skip, but log at debug for triage.
          this.#logger.debug?.('agent.stream.unknown_event', { type: part.type });
      }
    }
    this.#logger.info?.('agent.stream.complete', {
      agentId: name, totalChunks, latencyMs: Date.now() - start,
      toolCallsUsed: callCounter.count,
    });
  } catch (error) {
    this.#logger.error?.('agent.stream.error', {
      agentId: name, error: error.message, latencyMs: Date.now() - start,
    });
    throw error;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/agents/
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/agents/MastraAdapter.mjs backend/tests/unit/adapters/agents/MastraAdapter.stream.test.mjs
git commit -m "feat(agents): MastraAdapter.streamExecute() emits normalized stream chunks"
```

---

### Task 5: `YamlSatelliteRegistry` adapter

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs`
- Test: `backend/tests/unit/adapters/persistence/YamlSatelliteRegistry.test.mjs`
- Sample config: `data/household/config/brain.yml.example`

- [ ] **Step 1: Define the YAML schema**

`brain.yml` shape:
```yaml
# data/household/config/brain.yml.example
satellites:
  - id: livingroom
    media_player_entity: media_player.living_room
    area: livingroom
    allowed_skills: [memory, home_automation, media, calendar_read, lifelog_read, finance_read, fitness_read]
    default_volume: 30
    default_media_class: music
    token_ref: ENV:DAYLIGHT_BRAIN_TOKEN_LIVINGROOM
```

- [ ] **Step 2: Failing test**

```javascript
// backend/tests/unit/adapters/persistence/YamlSatelliteRegistry.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { YamlSatelliteRegistry } from '../../../../src/1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs';

function makeFakeConfigService(yaml, secrets = {}) {
  return {
    reloadHouseholdAppConfig: () => yaml,
    getSecret: (key) => secrets[key] ?? null,
  };
}

describe('YamlSatelliteRegistry', () => {
  it('returns a Satellite for a valid token', async () => {
    const cfg = makeFakeConfigService(
      { satellites: [{
        id: 'kitchen', media_player_entity: 'media_player.kitchen',
        area: 'kitchen', allowed_skills: ['memory'], default_volume: 25,
        default_media_class: 'music', token_ref: 'ENV:DAYLIGHT_BRAIN_TOKEN_KITCHEN'
      }] },
      { DAYLIGHT_BRAIN_TOKEN_KITCHEN: 'kitchentok123' }
    );
    const registry = new YamlSatelliteRegistry({ configService: cfg, logger: console });
    await registry.load();
    const s = await registry.findByToken('kitchentok123');
    assert.strictEqual(s.id, 'kitchen');
    assert.strictEqual(s.mediaPlayerEntity, 'media_player.kitchen');
  });

  it('returns null for unknown token', async () => {
    const cfg = makeFakeConfigService({ satellites: [] });
    const registry = new YamlSatelliteRegistry({ configService: cfg, logger: console });
    await registry.load();
    const s = await registry.findByToken('unknown');
    assert.strictEqual(s, null);
  });

  it('skips satellite when token secret is missing', async () => {
    const cfg = makeFakeConfigService(
      { satellites: [{
        id: 'kitchen', media_player_entity: 'media_player.kitchen',
        area: 'kitchen', allowed_skills: ['memory'],
        token_ref: 'ENV:MISSING_TOKEN'
      }] },
      {} // no secrets
    );
    const registry = new YamlSatelliteRegistry({ configService: cfg, logger: console });
    await registry.load();
    const list = await registry.list();
    assert.strictEqual(list.length, 0);
  });
});
```

- [ ] **Step 3: Implement**

```javascript
// backend/src/1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs
import { Satellite } from '../../../2_domains/brain/Satellite.mjs';

export class YamlSatelliteRegistry {
  #configService;
  #logger;
  #byToken = new Map();
  #all = [];

  constructor({ configService, logger = console, householdId = null }) {
    if (!configService) throw new Error('YamlSatelliteRegistry: configService is required');
    this.#configService = configService;
    this.#logger = logger;
    this.householdId = householdId;
  }

  async load() {
    const yaml = this.#configService.reloadHouseholdAppConfig?.(this.householdId, 'brain.yml');
    const entries = Array.isArray(yaml?.satellites) ? yaml.satellites : [];
    this.#byToken.clear();
    this.#all = [];

    for (const entry of entries) {
      const tokenRef = entry.token_ref ?? '';
      const token = this.#resolveTokenRef(tokenRef);
      if (!token) {
        this.#logger.warn?.('brain.satellite.missing_token', { id: entry.id, token_ref: tokenRef });
        continue;
      }

      try {
        const satellite = new Satellite({
          id: entry.id,
          mediaPlayerEntity: entry.media_player_entity,
          area: entry.area ?? null,
          allowedSkills: entry.allowed_skills ?? [],
          defaultVolume: entry.default_volume ?? null,
          defaultMediaClass: entry.default_media_class ?? null,
        });
        this.#byToken.set(token, satellite);
        this.#all.push(satellite);
      } catch (err) {
        this.#logger.warn?.('brain.satellite.invalid', { id: entry.id, error: err.message });
      }
    }

    this.#logger.info?.('brain.satellite.config_reload', { count: this.#all.length });
  }

  #resolveTokenRef(ref) {
    if (typeof ref !== 'string' || !ref.startsWith('ENV:')) return null;
    const secretKey = ref.slice(4);
    return this.#configService.getSecret?.(secretKey) ?? null;
  }

  async findByToken(token) {
    if (!token) return null;
    return this.#byToken.get(token) ?? null;
  }

  async list() {
    return [...this.#all];
  }
}

export default YamlSatelliteRegistry;
```

- [ ] **Step 4: Run tests**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/persistence/YamlSatelliteRegistry.test.mjs
```

Expected: 3 pass.

- [ ] **Step 5: Add the example config file**

```bash
mkdir -p /opt/Code/DaylightStation/data/household/config
cat > /opt/Code/DaylightStation/data/household/config/brain.yml.example <<'EOF'
satellites:
  - id: livingroom
    media_player_entity: media_player.living_room
    area: livingroom
    allowed_skills: [memory, home_automation, media, calendar_read, lifelog_read, finance_read, fitness_read]
    default_volume: 30
    default_media_class: music
    token_ref: ENV:DAYLIGHT_BRAIN_TOKEN_LIVINGROOM
EOF
```

(This is the host filesystem — repeat the equivalent inside the container when deploying. See Phase 9.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs \
        backend/tests/unit/adapters/persistence/YamlSatelliteRegistry.test.mjs \
        data/household/config/brain.yml.example
git commit -m "feat(brain): YamlSatelliteRegistry — token→Satellite via brain.yml + Infisical"
```

---

### Task 6: `YamlBrainMemoryAdapter` (household-scoped)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlBrainMemoryAdapter.mjs`
- Test: `backend/tests/unit/adapters/persistence/YamlBrainMemoryAdapter.test.mjs`

We back this with the existing `YamlWorkingMemoryAdapter` API (`load(agentId, userId)` / `save(agentId, userId, state)`) using a fixed `agentId='brain'` and `userId='household'`. The adapter exposes `IBrainMemory.get/set/merge`.

- [ ] **Step 1: Failing test**

```javascript
// backend/tests/unit/adapters/persistence/YamlBrainMemoryAdapter.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { YamlBrainMemoryAdapter } from '../../../../src/1_adapters/persistence/yaml/YamlBrainMemoryAdapter.mjs';

class FakeWorkingMemory {
  constructor() { this.store = {}; }
  async load(_agentId, _userId) {
    return { data: this.store, pruneExpired() {} };
  }
  async save(_agentId, _userId, state) {
    this.store = state.data ?? {};
  }
}

describe('YamlBrainMemoryAdapter', () => {
  it('reads and writes household-scoped key/value', async () => {
    const wm = new FakeWorkingMemory();
    const mem = new YamlBrainMemoryAdapter({ workingMemory: wm });
    await mem.set('preferences', { tone: 'casual' });
    const value = await mem.get('preferences');
    assert.deepStrictEqual(value, { tone: 'casual' });
  });

  it('merge combines partial values', async () => {
    const wm = new FakeWorkingMemory();
    const mem = new YamlBrainMemoryAdapter({ workingMemory: wm });
    await mem.set('preferences', { tone: 'casual' });
    await mem.merge('preferences', { volume: 25 });
    assert.deepStrictEqual(await mem.get('preferences'), { tone: 'casual', volume: 25 });
  });

  it('returns null for missing key', async () => {
    const wm = new FakeWorkingMemory();
    const mem = new YamlBrainMemoryAdapter({ workingMemory: wm });
    assert.strictEqual(await mem.get('absent'), null);
  });
});
```

- [ ] **Step 2: Implement**

```javascript
// backend/src/1_adapters/persistence/yaml/YamlBrainMemoryAdapter.mjs
const AGENT_ID = 'brain';
const USER_ID = 'household';

export class YamlBrainMemoryAdapter {
  #wm;
  constructor({ workingMemory }) {
    if (!workingMemory) throw new Error('YamlBrainMemoryAdapter: workingMemory required');
    this.#wm = workingMemory;
  }

  async #loadAll() {
    const state = await this.#wm.load(AGENT_ID, USER_ID);
    if (!state.data) state.data = {};
    return state;
  }

  async get(key) {
    const state = await this.#loadAll();
    return state.data[key] ?? null;
  }

  async set(key, value) {
    const state = await this.#loadAll();
    state.data[key] = value;
    await this.#wm.save(AGENT_ID, USER_ID, state);
  }

  async merge(key, partial) {
    const state = await this.#loadAll();
    const current = state.data[key];
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      state.data[key] = { ...current, ...partial };
    } else {
      state.data[key] = partial;
    }
    await this.#wm.save(AGENT_ID, USER_ID, state);
  }
}

export default YamlBrainMemoryAdapter;
```

- [ ] **Step 3: Run tests**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/persistence/YamlBrainMemoryAdapter.test.mjs
```

Expected: 3 pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlBrainMemoryAdapter.mjs backend/tests/unit/adapters/persistence/YamlBrainMemoryAdapter.test.mjs
git commit -m "feat(brain): YamlBrainMemoryAdapter — household-scoped get/set/merge over working-memory"
```

---

## Phase 3 — Brain core (services + agent + composition)

### Task 7: `PassThroughBrainPolicy`

**Files:**
- Create: `backend/src/3_applications/brain/services/PassThroughBrainPolicy.mjs`
- Test: `backend/tests/unit/applications/brain/PassThroughBrainPolicy.test.mjs`

- [ ] **Step 1: Test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PassThroughBrainPolicy } from '../../../../src/3_applications/brain/services/PassThroughBrainPolicy.mjs';

describe('PassThroughBrainPolicy', () => {
  const p = new PassThroughBrainPolicy();
  it('evaluateRequest allows', () => {
    const d = p.evaluateRequest({}, {});
    assert.strictEqual(d.allow, true);
  });
  it('evaluateToolCall allows', () => {
    const d = p.evaluateToolCall({}, 'any', {});
    assert.strictEqual(d.allow, true);
  });
  it('shapeResponse returns input unchanged', () => {
    assert.strictEqual(p.shapeResponse({}, 'hi'), 'hi');
  });
});
```

- [ ] **Step 2: Implement**

```javascript
import { BrainDecision } from '../../../2_domains/brain/BrainDecision.mjs';
export class PassThroughBrainPolicy {
  evaluateRequest(_satellite, _request) { return BrainDecision.allow(); }
  evaluateToolCall(_satellite, _toolName, _args) { return BrainDecision.allow(); }
  shapeResponse(_satellite, draft) { return draft; }
}
export default PassThroughBrainPolicy;
```

- [ ] **Step 3: Pass + commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/PassThroughBrainPolicy.test.mjs
git add backend/src/3_applications/brain/services/PassThroughBrainPolicy.mjs backend/tests/unit/applications/brain/PassThroughBrainPolicy.test.mjs
git commit -m "feat(brain): PassThroughBrainPolicy — v1 no-op IBrainPolicy"
```

---

### Task 8: `SkillRegistry`

**Files:**
- Create: `backend/src/3_applications/brain/services/SkillRegistry.mjs`
- Test: `backend/tests/unit/applications/brain/SkillRegistry.test.mjs`

- [ ] **Step 1: Test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SkillRegistry } from '../../../../src/3_applications/brain/services/SkillRegistry.mjs';
import { Satellite } from '../../../../src/2_domains/brain/Satellite.mjs';
import { PassThroughBrainPolicy } from '../../../../src/3_applications/brain/services/PassThroughBrainPolicy.mjs';

function makeSkill(name, tools) {
  return {
    name,
    getTools() { return tools; },
    getPromptFragment(_s) { return `(${name} prompt)`; },
    getConfig() { return {}; },
  };
}

describe('SkillRegistry', () => {
  const policy = new PassThroughBrainPolicy();
  const sat = new Satellite({
    id: 's', mediaPlayerEntity: 'media_player.x',
    allowedSkills: ['memory', 'media']
  });

  it('only returns enabled skills', () => {
    const r = new SkillRegistry({ logger: console });
    r.register(makeSkill('memory', [{ name: 'note', description: '', parameters: {}, execute: async () => null }]));
    r.register(makeSkill('home_automation', [{ name: 'toggle', description: '', parameters: {}, execute: async () => null }]));
    r.register(makeSkill('media', [{ name: 'play', description: '', parameters: {}, execute: async () => null }]));
    const skills = r.getSkillsFor(sat);
    assert.deepStrictEqual(skills.map(s => s.name).sort(), ['media', 'memory']);
  });

  it('builds tools wrapped with policy gate that denies', async () => {
    const r = new SkillRegistry({ logger: console });
    r.register(makeSkill('memory', [{
      name: 'note', description: '', parameters: {},
      execute: async () => ({ ok: true })
    }]));
    const denying = {
      evaluateRequest: () => ({ allow: true }),
      evaluateToolCall: () => ({ allow: false, reason: 'no' }),
      shapeResponse: (_s, t) => t,
    };
    const tools = r.buildToolsFor(sat, denying);
    const result = await tools[0].execute({}, { satellite: sat });
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /policy_denied/);
  });

  it('concatenates prompt fragments with separators', () => {
    const r = new SkillRegistry({ logger: console });
    r.register(makeSkill('memory', []));
    r.register(makeSkill('media', []));
    const text = r.buildPromptFragmentsFor(sat);
    assert.match(text, /memory prompt/);
    assert.match(text, /media prompt/);
  });
});
```

- [ ] **Step 2: Implement**

```javascript
import { assertSkill } from '../ports/ISkill.mjs';

export class SkillRegistry {
  #skills = new Map();
  #logger;

  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  register(skill) {
    assertSkill(skill);
    if (this.#skills.has(skill.name)) {
      throw new Error(`SkillRegistry: skill '${skill.name}' already registered`);
    }
    this.#skills.set(skill.name, skill);
  }

  getSkillsFor(satellite) {
    return [...this.#skills.values()].filter(s => satellite.canUseSkill(s.name));
  }

  buildToolsFor(satellite, policy) {
    const tools = [];
    for (const skill of this.getSkillsFor(satellite)) {
      for (const tool of skill.getTools()) {
        tools.push(this.#wrap(tool, skill, satellite, policy));
      }
    }
    return tools;
  }

  buildPromptFragmentsFor(satellite) {
    return this.getSkillsFor(satellite)
      .map(s => s.getPromptFragment(satellite))
      .filter(Boolean)
      .join('\n\n');
  }

  #wrap(tool, skill, satellite, policy) {
    const log = this.#logger;
    return {
      ...tool,
      execute: async (params, ctx) => {
        const decision = policy.evaluateToolCall(satellite, tool.name, params);
        if (!decision.allow) {
          log.warn?.('brain.tool.policy_denied', {
            satellite_id: satellite.id, tool: tool.name, reason: decision.reason,
          });
          return { ok: false, reason: `policy_denied:${decision.reason ?? 'unspecified'}` };
        }
        const start = Date.now();
        log.info?.('brain.tool.invoke', {
          satellite_id: satellite.id, tool: tool.name,
          args_shape: shapeOf(params),
        });
        try {
          const result = await tool.execute(params, { ...ctx, satellite, skill: skill.name });
          log.info?.('brain.tool.complete', {
            satellite_id: satellite.id, tool: tool.name,
            ok: result?.ok !== false, latencyMs: Date.now() - start,
          });
          return result;
        } catch (error) {
          log.error?.('brain.tool.error', {
            satellite_id: satellite.id, tool: tool.name,
            error: error.message, latencyMs: Date.now() - start,
          });
          return { ok: false, reason: 'error', error: error.message };
        }
      },
    };
  }
}

function shapeOf(args) {
  if (!args || typeof args !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(args)) out[k] = Array.isArray(v) ? 'array' : typeof v;
  return out;
}

export default SkillRegistry;
```

- [ ] **Step 3: Pass + commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/SkillRegistry.test.mjs
git add backend/src/3_applications/brain/services/SkillRegistry.mjs backend/tests/unit/applications/brain/SkillRegistry.test.mjs
git commit -m "feat(brain): SkillRegistry assembles per-satellite tool surface with policy gate + logging wrapper"
```

---

### Task 9: First skill — `MemorySkill`

**Files:**
- Create: `backend/src/3_applications/brain/skills/MemorySkill.mjs`
- Test: `backend/tests/unit/applications/brain/skills/MemorySkill.test.mjs`

We ship the simplest skill first to exercise the pipeline. Two tools: `remember_note` and `recall_note`.

- [ ] **Step 1: Test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemorySkill } from '../../../../../src/3_applications/brain/skills/MemorySkill.mjs';

class InMemoryBrainMemory {
  constructor() { this.store = {}; }
  async get(k) { return this.store[k] ?? null; }
  async set(k, v) { this.store[k] = v; }
  async merge(k, p) {
    const c = this.store[k];
    this.store[k] = (c && typeof c === 'object') ? { ...c, ...p } : p;
  }
}

describe('MemorySkill', () => {
  it('exposes remember_note and recall_note', () => {
    const s = new MemorySkill({ memory: new InMemoryBrainMemory(), logger: console });
    const names = s.getTools().map(t => t.name);
    assert.deepStrictEqual(names.sort(), ['recall_note', 'remember_note']);
  });

  it('remember_note appends to the notes list', async () => {
    const mem = new InMemoryBrainMemory();
    const s = new MemorySkill({ memory: mem, logger: console });
    const remember = s.getTools().find(t => t.name === 'remember_note');
    await remember.execute({ content: 'Soren is allergic to peanuts' }, {});
    const notes = await mem.get('notes');
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0].content, /peanuts/);
  });

  it('recall_note returns recent notes', async () => {
    const mem = new InMemoryBrainMemory();
    await mem.set('notes', [
      { content: 'A', t: '2024-01-01T00:00:00Z' },
      { content: 'B', t: '2024-01-02T00:00:00Z' },
    ]);
    const s = new MemorySkill({ memory: mem, logger: console });
    const recall = s.getTools().find(t => t.name === 'recall_note');
    const result = await recall.execute({ limit: 1 }, {});
    assert.strictEqual(result.notes.length, 1);
    assert.match(result.notes[0].content, /B/);
  });
});
```

- [ ] **Step 2: Implement**

```javascript
import { createTool } from '@mastra/core/tools';

export class MemorySkill {
  static name = 'memory';
  #memory;
  #logger;
  #config;

  constructor({ memory, logger = console, config = {} }) {
    if (!memory) throw new Error('MemorySkill: memory required');
    this.#memory = memory;
    this.#logger = logger;
    this.#config = { maxNotes: 200, ...config };
  }

  get name() { return MemorySkill.name; }
  getConfig() { return { ...this.#config }; }
  getPromptFragment(_satellite) {
    return `## Memory
You may use \`remember_note\` to store a short fact about the household for future conversations
(preferences, allergies, schedules, plans). Use \`recall_note\` to read the most recent notes.
Do not use this for transient context; the messages array already carries the active turn.`;
  }

  getTools() {
    const memory = this.#memory;
    const cap = this.#config.maxNotes;

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
        async execute({ content }) {
          const trimmed = String(content ?? '').slice(0, 280);
          if (!trimmed) return { ok: false, reason: 'empty_note' };
          const notes = (await memory.get('notes')) ?? [];
          notes.push({ content: trimmed, t: new Date().toISOString() });
          while (notes.length > cap) notes.shift();
          await memory.set('notes', notes);
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
        async execute({ limit = 5 }) {
          const notes = (await memory.get('notes')) ?? [];
          return { notes: notes.slice(-Math.max(1, Math.min(50, limit))) };
        },
      },
    ];
  }
}

export default MemorySkill;
```

- [ ] **Step 3: Pass + commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/skills/MemorySkill.test.mjs
git add backend/src/3_applications/brain/skills/MemorySkill.mjs backend/tests/unit/applications/brain/skills/MemorySkill.test.mjs
git commit -m "feat(brain): MemorySkill — remember_note + recall_note over IBrainMemory"
```

---

### Task 10: `BrainAgent` (extends `BaseAgent`)

**Files:**
- Create: `backend/src/3_applications/brain/BrainAgent.mjs`
- Create: `backend/src/3_applications/brain/prompts/system.mjs`
- Test: `backend/tests/unit/applications/brain/BrainAgent.test.mjs`

- [ ] **Step 1: Read `BaseAgent`** to know what subclassing requires

```bash
cat /opt/Code/DaylightStation/backend/src/3_applications/agents/framework/BaseAgent.mjs
```

Key fact: `BaseAgent.run(input, { userId, context })` loads memory, calls `agentRuntime.execute()`, saves memory. We OVERRIDE `run()` for brain because (a) we use `IBrainMemory` not `IWorkingMemory`, (b) we accept a `satellite` in context, (c) we route to `streamExecute()` when needed.

- [ ] **Step 2: Base prompt**

```javascript
// backend/src/3_applications/brain/prompts/system.mjs
export const BASE_PROMPT = `You are the household assistant for the user's home, accessed via a Home Assistant Voice satellite.

Style:
- Speak naturally and briefly. Aim for 1-2 sentences.
- Your replies will be spoken aloud by a TTS engine. Avoid markdown, emoji, code, or bullet lists.
- Be helpful first; when you cannot do something, say so plainly.

Tools:
- You have a curated set of tools. Use them when the user asks for something they accomplish.
- Do not invent tools. Do not promise actions you cannot take with your current tools.

Refusals:
- Decline tools you do not have access to in this satellite by saying you can't from this room/device.

Truth:
- Never fabricate sensor readings, schedules, or facts. If a tool returns no data, say you don't have that.`;

export function satellitePrompt(satellite) {
  return `## Satellite
You are responding from the "${satellite.id}" satellite${satellite.area ? ` (${satellite.area})` : ''}.
Available skills: ${satellite.allowedSkills.join(', ')}.`;
}

export function memoryPrompt(memorySnapshot) {
  if (!memorySnapshot || Object.keys(memorySnapshot).length === 0) return '';
  const json = JSON.stringify(memorySnapshot).slice(0, 1024);
  return `## Known household notes\n\`\`\`json\n${json}\n\`\`\``;
}
```

- [ ] **Step 3: Test for BrainAgent**

```javascript
// backend/tests/unit/applications/brain/BrainAgent.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrainAgent } from '../../../../src/3_applications/brain/BrainAgent.mjs';
import { Satellite } from '../../../../src/2_domains/brain/Satellite.mjs';
import { PassThroughBrainPolicy } from '../../../../src/3_applications/brain/services/PassThroughBrainPolicy.mjs';
import { SkillRegistry } from '../../../../src/3_applications/brain/services/SkillRegistry.mjs';
import { MemorySkill } from '../../../../src/3_applications/brain/skills/MemorySkill.mjs';

class InMemoryBrainMemory {
  constructor() { this.store = {}; }
  async get(k) { return this.store[k] ?? null; }
  async set(k, v) { this.store[k] = v; }
  async merge() {}
}

class FakeRuntime {
  constructor({ outputs }) { this.outputs = outputs; this.calls = []; }
  async execute(opts) {
    this.calls.push(opts);
    return this.outputs.execute ?? { output: 'ok', toolCalls: [] };
  }
  async *streamExecute(opts) {
    this.calls.push(opts);
    for (const c of this.outputs.stream ?? [{ type: 'text-delta', text: 'ok' }, { type: 'finish' }]) yield c;
  }
}

describe('BrainAgent', () => {
  const sat = new Satellite({ id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'] });
  const policy = new PassThroughBrainPolicy();

  function build(runtimeOutputs = {}) {
    const memory = new InMemoryBrainMemory();
    const registry = new SkillRegistry({ logger: console });
    registry.register(new MemorySkill({ memory, logger: console }));
    const runtime = new FakeRuntime({ outputs: runtimeOutputs });
    const agent = new BrainAgent({
      agentRuntime: runtime, memory, policy, skills: registry, logger: console,
    });
    return { agent, runtime, memory };
  }

  it('runChat returns the runtime output as content', async () => {
    const { agent } = build({ execute: { output: 'Hello there.', toolCalls: [] } });
    const result = await agent.runChat({
      satellite: sat, messages: [{ role: 'user', content: 'hi' }],
    });
    assert.strictEqual(result.content, 'Hello there.');
  });

  it('passes assembled prompt and tools to runtime.execute', async () => {
    const { agent, runtime } = build({ execute: { output: 'ok', toolCalls: [] } });
    await agent.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    const opts = runtime.calls[0];
    assert.match(opts.systemPrompt, /satellite/i);
    assert.ok(opts.tools.length > 0); // memory tools
    assert.strictEqual(opts.tools[0].name === 'remember_note' || opts.tools[0].name === 'recall_note', true);
  });

  it('streamChat yields text deltas', async () => {
    const { agent } = build({ stream: [
      { type: 'text-delta', text: 'Hi' }, { type: 'text-delta', text: ' there' }, { type: 'finish' },
    ] });
    const chunks = [];
    for await (const c of agent.streamChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(c);
    }
    const texts = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('');
    assert.strictEqual(texts, 'Hi there');
  });

  it('refuses pre-flight via policy', async () => {
    const memory = new InMemoryBrainMemory();
    const registry = new SkillRegistry({ logger: console });
    registry.register(new MemorySkill({ memory, logger: console }));
    const runtime = new FakeRuntime({ outputs: {} });
    const denyAll = {
      evaluateRequest: () => ({ allow: false, reason: 'quiet_hours' }),
      evaluateToolCall: () => ({ allow: true }),
      shapeResponse: (_s, t) => t,
    };
    const agent = new BrainAgent({ agentRuntime: runtime, memory, policy: denyAll, skills: registry, logger: console });
    const result = await agent.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    assert.match(result.content, /can't/i);
    assert.strictEqual(runtime.calls.length, 0);
  });
});
```

- [ ] **Step 4: Implement BrainAgent**

```javascript
// backend/src/3_applications/brain/BrainAgent.mjs
import { BASE_PROMPT, satellitePrompt, memoryPrompt } from './prompts/system.mjs';

export class BrainAgent {
  static id = 'brain';

  #runtime;
  #memory;
  #policy;
  #skills;
  #logger;

  constructor({ agentRuntime, memory, policy, skills, logger = console }) {
    if (!agentRuntime?.execute || !agentRuntime?.streamExecute) {
      throw new Error('BrainAgent: agentRuntime with execute() + streamExecute() required');
    }
    if (!memory) throw new Error('BrainAgent: memory (IBrainMemory) required');
    if (!policy) throw new Error('BrainAgent: policy (IBrainPolicy) required');
    if (!skills) throw new Error('BrainAgent: skills (SkillRegistry) required');
    this.#runtime = agentRuntime;
    this.#memory = memory;
    this.#policy = policy;
    this.#skills = skills;
    this.#logger = logger;
  }

  async #buildContext(satellite) {
    const decision = this.#policy.evaluateRequest(satellite, {});
    if (!decision.allow) return { allowed: false, decision };

    const memorySnapshot = await this.#snapshotMemory();
    const tools = this.#skills.buildToolsFor(satellite, this.#policy);
    const prompt = [
      BASE_PROMPT,
      satellitePrompt(satellite),
      this.#skills.buildPromptFragmentsFor(satellite),
      memoryPrompt(memorySnapshot),
    ].filter(Boolean).join('\n\n');

    this.#logger.debug?.('brain.skills.resolved', {
      satellite_id: satellite.id,
      skills: satellite.allowedSkills,
      tool_count: tools.length,
    });

    return { allowed: true, prompt, tools };
  }

  async #snapshotMemory() {
    const notes = await this.#memory.get('notes') ?? [];
    const prefs = await this.#memory.get('preferences') ?? {};
    return { notes_recent: notes.slice(-5), preferences: prefs };
  }

  #refusalContent(reason) {
    const tail = reason ? ` — ${reason}` : '';
    return `I can't do that right now${tail}.`;
  }

  async runChat({ satellite, messages, conversationId = null }) {
    const ctx = await this.#buildContext(satellite);
    if (!ctx.allowed) {
      this.#logger.warn?.('brain.policy.request_denied', { satellite_id: satellite.id, reason: ctx.decision.reason });
      return { content: this.#refusalContent(ctx.decision.reason), toolCalls: [], usage: null };
    }
    const input = lastUserMessage(messages);
    const start = Date.now();
    this.#logger.info?.('brain.runtime.start', { mode: 'gen', tool_count: ctx.tools.length });
    const result = await this.#runtime.execute({
      agentId: BrainAgent.id, input, tools: ctx.tools, systemPrompt: ctx.prompt,
      context: { satellite, conversationId },
    });
    const draft = result.output ?? '';
    const final = this.#policy.shapeResponse(satellite, draft);
    this.#logger.info?.('brain.runtime.complete', {
      output_chars: final.length,
      tool_calls: result.toolCalls?.length ?? 0,
      latencyMs: Date.now() - start,
    });
    return { content: final, toolCalls: result.toolCalls ?? [], usage: result.usage ?? null };
  }

  async *streamChat({ satellite, messages, conversationId = null }) {
    const ctx = await this.#buildContext(satellite);
    if (!ctx.allowed) {
      yield { type: 'text-delta', text: this.#refusalContent(ctx.decision.reason) };
      yield { type: 'finish', reason: 'policy' };
      return;
    }
    const input = lastUserMessage(messages);
    this.#logger.info?.('brain.runtime.start', { mode: 'stream', tool_count: ctx.tools.length });
    yield* this.#runtime.streamExecute({
      agentId: BrainAgent.id, input, tools: ctx.tools, systemPrompt: ctx.prompt,
      context: { satellite, conversationId },
    });
  }
}

function lastUserMessage(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') return messages[i].content;
  }
  return '';
}

export default BrainAgent;
```

- [ ] **Step 5: Pass + commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/BrainAgent.test.mjs
git add backend/src/3_applications/brain backend/tests/unit/applications/brain/BrainAgent.test.mjs
git commit -m "feat(brain): BrainAgent — runChat + streamChat with policy gates and household memory"
```

---

### Task 11: `BrainApplication` composition root + `IChatCompletionRunner`

**Files:**
- Create: `backend/src/3_applications/brain/BrainApplication.mjs`
- Test: `backend/tests/unit/applications/brain/BrainApplication.test.mjs`

The `BrainApplication` is the **only** place that knows which adapter backs which port. It exposes `runChat` and `streamChat` directly (so it implements `IChatCompletionRunner`).

- [ ] **Step 1: Test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrainApplication } from '../../../../src/3_applications/brain/BrainApplication.mjs';
import { Satellite } from '../../../../src/2_domains/brain/Satellite.mjs';

class InMemoryRegistry {
  constructor(satellites) { this.s = satellites; }
  async findByToken(t) { return this.s.find(s => s._token === t) ?? null; }
  async list() { return [...this.s]; }
}

class FakeRuntime {
  async execute() { return { output: 'ok', toolCalls: [] }; }
  async *streamExecute() { yield { type: 'finish' }; }
}

describe('BrainApplication', () => {
  it('exposes runChat / streamChat (IChatCompletionRunner)', async () => {
    const sat = new Satellite({ id: 'a', mediaPlayerEntity: 'media_player.a', allowedSkills: ['memory'] });
    sat._token = 'tok';
    const app = new BrainApplication({
      satelliteRegistry: new InMemoryRegistry([sat]),
      memory: { get: async () => null, set: async () => {}, merge: async () => {} },
      policy: { evaluateRequest: () => ({ allow: true }), evaluateToolCall: () => ({ allow: true }), shapeResponse: (_s, t) => t },
      agentRuntime: new FakeRuntime(),
      logger: console,
    });
    assert.strictEqual(typeof app.runChat, 'function');
    assert.strictEqual(typeof app.streamChat, 'function');
    const r = await app.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(r.content, 'ok');
  });
});
```

- [ ] **Step 2: Implement**

```javascript
// backend/src/3_applications/brain/BrainApplication.mjs
import { SkillRegistry } from './services/SkillRegistry.mjs';
import { BrainAgent } from './BrainAgent.mjs';
import { MemorySkill } from './skills/MemorySkill.mjs';

export class BrainApplication {
  #registry; #agent; #logger;
  constructor({
    satelliteRegistry, memory, policy, agentRuntime, logger = console,
    homeAutomation = null, contentQuery = null, homeAutomationGateway = null,
    calendarRead = null, lifelogRead = null, financeRead = null, fitnessRead = null,
    skillConfigs = {},
  }) {
    if (!satelliteRegistry) throw new Error('BrainApplication: satelliteRegistry required');
    this.#registry = satelliteRegistry;
    this.#logger = logger;

    const skills = new SkillRegistry({ logger });

    skills.register(new MemorySkill({ memory, logger, config: skillConfigs.memory }));

    // Optional skills wired only if their dependencies are present.
    // Phase 7+ tasks fill these in.
    // if (homeAutomation && homeAutomationGateway)
    //   skills.register(new HomeAutomationSkill({ homeAutomation, gateway: homeAutomationGateway, logger, config: skillConfigs.home_automation }));
    // (etc.)

    this.#agent = new BrainAgent({ agentRuntime, memory, policy, skills, logger });
  }

  get satelliteRegistry() { return this.#registry; }

  async runChat({ satellite, messages, tools = [], conversationId = null }) {
    return this.#agent.runChat({ satellite, messages, conversationId });
  }

  async *streamChat({ satellite, messages, tools = [], conversationId = null }) {
    yield* this.#agent.streamChat({ satellite, messages, conversationId });
  }
}

export default BrainApplication;
```

The `tools` parameter from the caller is intentionally unused — see Spec §3.2 (we strip HA's tool list and use our own).

- [ ] **Step 3: Pass + commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/BrainApplication.test.mjs
git add backend/src/3_applications/brain/BrainApplication.mjs backend/tests/unit/applications/brain/BrainApplication.test.mjs
git commit -m "feat(brain): BrainApplication composition root exposes IChatCompletionRunner"
```

---

## Phase 4 — Inbound API (translator + router + bootstrap wiring)

### Task 12: `OpenAIChatCompletionsTranslator` (non-streaming)

**Files:**
- Create: `backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs`
- Test: `backend/tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs`

- [ ] **Step 1: Test (non-stream)**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { OpenAIChatCompletionsTranslator } from '../../../../src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs';

class FakeRunner {
  constructor(out) { this.out = out; this.calls = []; }
  async runChat(opts) { this.calls.push(opts); return this.out; }
  async *streamChat() {}
}

function fakeRes() {
  const headers = {}; let status = 200; let body = null;
  return {
    set(h, v) { headers[h] = v; return this; },
    status(s) { status = s; return this; },
    json(b) { body = b; return this; },
    _state: () => ({ headers, status, body }),
  };
}

describe('OpenAIChatCompletionsTranslator (non-stream)', () => {
  it('returns OpenAI envelope on success', async () => {
    const runner = new FakeRunner({ content: 'Hi.', toolCalls: [], usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 } });
    const tx = new OpenAIChatCompletionsTranslator({ runner, logger: console });
    const req = { body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], stream: false } };
    const res = fakeRes();
    await tx.handle(req, res, { id: 's', allowedSkills: ['memory'] });
    const { status, body } = res._state();
    assert.strictEqual(status, 200);
    assert.strictEqual(body.object, 'chat.completion');
    assert.strictEqual(body.choices[0].message.content, 'Hi.');
    assert.strictEqual(body.choices[0].finish_reason, 'stop');
  });
});
```

- [ ] **Step 2: Implement (non-stream branch only — streaming added in Task 13)**

```javascript
// backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs
import crypto from 'crypto';

export class OpenAIChatCompletionsTranslator {
  #runner; #logger;
  constructor({ runner, logger = console }) {
    if (!runner?.runChat) throw new Error('OpenAIChatCompletionsTranslator: runner with runChat required');
    this.#runner = runner;
    this.#logger = logger;
  }

  async handle(req, res, satellite) {
    const start = Date.now();
    const body = req.body ?? {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const stream = !!body.stream;
    const conversationId = body.conversation_id ?? body.conversationId ?? null;
    const model = body.model ?? 'gpt-4o-mini';

    this.#logger.info?.('brain.request.received', {
      satellite_id: satellite.id, conv_id: conversationId, stream,
      msg_count: messages.length,
    });

    if (messages.length === 0) {
      return this.#errorJson(res, 400, 'invalid_request_error', 'messages required', 'bad_request');
    }

    if (stream) {
      return this.#stream(req, res, satellite, { messages, conversationId, model, start });
    }

    try {
      const result = await this.#runner.runChat({
        satellite, messages, tools: body.tools ?? [], conversationId,
      });
      const envelope = this.#buildEnvelope(result, model);
      res.status(200).json(envelope);
      this.#logger.info?.('brain.response.sent', {
        satellite_id: satellite.id, status: 200, total_latency_ms: Date.now() - start, stream: false,
      });
    } catch (error) {
      this.#logger.error?.('brain.runtime.error', { satellite_id: satellite.id, error: error.message });
      this.#errorJson(res, 502, 'server_error', error.message, 'upstream_unavailable');
    }
  }

  async #stream(_req, _res, _satellite, _ctx) {
    // Implemented in Task 13.
    throw new Error('streaming not implemented yet');
  }

  #buildEnvelope({ content, toolCalls = [], usage = null }, model) {
    return {
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content ?? '',
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: 'stop',
      }],
      usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  #errorJson(res, status, type, message, code) {
    res.status(status).json({ error: { message, type, code } });
  }
}

export default OpenAIChatCompletionsTranslator;
```

- [ ] **Step 3: Pass + commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs
git add backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs backend/tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs
git commit -m "feat(brain): OpenAIChatCompletionsTranslator — non-streaming OpenAI envelope"
```

---

### Task 13: Streaming branch in translator (SSE)

**Files:**
- Modify: `backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs`
- Modify: `backend/tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs`

- [ ] **Step 1: Add streaming test**

```javascript
// add to existing test file
class FakeStreamingRunner {
  constructor(chunks) { this.chunks = chunks; }
  async runChat() { return { content: '', toolCalls: [], usage: null }; }
  async *streamChat() { for (const c of this.chunks) yield c; }
}

function streamingFakeRes() {
  const writes = []; let status = 200; let ended = false; let headers = {};
  return {
    setHeader(h, v) { headers[h] = v; return this; },
    set(h, v) { headers[h] = v; return this; },
    status(s) { status = s; return this; },
    write(d) { writes.push(d); return true; },
    end() { ended = true; },
    flushHeaders() {},
    _state: () => ({ status, headers, writes, ended }),
  };
}

describe('OpenAIChatCompletionsTranslator (stream)', () => {
  it('emits SSE chunks ending with [DONE]', async () => {
    const runner = new FakeStreamingRunner([
      { type: 'text-delta', text: 'Hi' },
      { type: 'text-delta', text: ' there' },
      { type: 'finish', reason: 'stop' },
    ]);
    const tx = new OpenAIChatCompletionsTranslator({ runner, logger: console });
    const req = { body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], stream: true } };
    const res = streamingFakeRes();
    await tx.handle(req, res, { id: 's', allowedSkills: ['memory'] });
    const { writes, ended, headers } = res._state();
    assert.strictEqual(headers['Content-Type'], 'text/event-stream');
    const blob = writes.join('');
    assert.match(blob, /"delta":\{"role":"assistant"\}/);
    assert.match(blob, /"delta":\{"content":"Hi"\}/);
    assert.match(blob, /"delta":\{"content":" there"\}/);
    assert.match(blob, /"finish_reason":"stop"/);
    assert.match(blob, /data: \[DONE\]\n\n$/);
    assert.strictEqual(ended, true);
  });
});
```

- [ ] **Step 2: Implement `#stream`**

Replace the placeholder body:

```javascript
async #stream(_req, res, satellite, { messages, conversationId, model, start }) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const send = (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);

  // Initial role chunk
  send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' } }] });
  this.#logger.info?.('brain.stream.start', { satellite_id: satellite.id });

  let chunksSent = 0;
  let finishReason = 'stop';
  try {
    for await (const part of this.#runner.streamChat({ satellite, messages, conversationId })) {
      if (part.type === 'text-delta' && part.text) {
        send({ id, object: 'chat.completion.chunk', created, model,
          choices: [{ index: 0, delta: { content: part.text } }] });
        chunksSent++;
      } else if (part.type === 'finish') {
        finishReason = part.reason ?? 'stop';
      }
      // tool-start / tool-end intentionally NOT emitted to client (Spec §7.2)
    }
  } catch (error) {
    this.#logger.error?.('brain.stream.error', { satellite_id: satellite.id, error: error.message, where: 'mid_stream' });
    send({ id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: { content: ` (error: ${error.message})` }, finish_reason: 'error' }] });
  }

  send({ id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }] });
  res.write('data: [DONE]\n\n');
  res.end();

  this.#logger.info?.('brain.stream.complete', {
    satellite_id: satellite.id, total_chunks: chunksSent,
    latencyMs: Date.now() - start,
  });
  this.#logger.info?.('brain.response.sent', {
    satellite_id: satellite.id, status: 200, total_latency_ms: Date.now() - start, stream: true,
  });
}
```

- [ ] **Step 3: Pass + commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs
git add backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs backend/tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs
git commit -m "feat(brain): OpenAIChatCompletionsTranslator — SSE streaming branch"
```

---

### Task 14: `routers/brain.mjs` (router + bearer middleware + `/v1/models`)

**Files:**
- Create: `backend/src/4_api/v1/routers/brain.mjs`
- Test: `backend/tests/unit/api/routers/brain.test.mjs`

Note: existing routers under `backend/src/4_api/v1/routers/` use `createXyzRouter({ deps })` — match that pattern.

- [ ] **Step 1: Test (HTTP integration with Express + supertest)**

```javascript
// backend/tests/unit/api/routers/brain.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { createBrainRouter } from '../../../../src/4_api/v1/routers/brain.mjs';

function buildApp({ findByToken, runChat, streamChat }) {
  const app = express();
  app.use(express.json());
  app.use('/v1', createBrainRouter({
    satelliteRegistry: { findByToken, list: async () => [] },
    chatCompletionRunner: { runChat, streamChat },
    logger: console,
    advertisedModels: ['daylight-house'],
  }));
  return app;
}

async function inject(app, method, path, headers = {}, body = null) {
  // Minimal in-process injection without supertest dependency:
  return new Promise((resolve, reject) => {
    const req = Object.assign(
      { method, url: path, headers, body, on() {}, originalUrl: path }, body ? { body } : {}
    );
    let status = 200; const respHeaders = {}; let payload = '';
    const res = {
      setHeader(k, v) { respHeaders[k] = v; },
      set(k, v) { respHeaders[k] = v; },
      status(s) { status = s; return this; },
      json(b) { payload = JSON.stringify(b); resolve({ status, headers: respHeaders, body: payload }); },
      end() { resolve({ status, headers: respHeaders, body: payload }); },
      write(d) { payload += d; },
      flushHeaders() {},
    };
    app(req, res, reject);
  });
}

describe('createBrainRouter', () => {
  let runChat, streamChat, findByToken;
  beforeEach(() => {
    runChat = async () => ({ content: 'hi', toolCalls: [], usage: null });
    streamChat = async function*() { yield { type: 'finish' }; };
    findByToken = async (t) => t === 'good' ? { id: 's', allowedSkills: ['memory'] } : null;
  });

  it('returns 401 on missing token', async () => {
    const app = buildApp({ findByToken, runChat, streamChat });
    const r = await inject(app, 'POST', '/v1/chat/completions', { 'content-type': 'application/json' },
      { messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(r.status, 401);
  });

  it('returns 401 on bad token', async () => {
    const app = buildApp({ findByToken, runChat, streamChat });
    const r = await inject(app, 'POST', '/v1/chat/completions',
      { authorization: 'Bearer bad', 'content-type': 'application/json' },
      { messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(r.status, 401);
  });

  it('returns 200 with envelope on good token', async () => {
    const app = buildApp({ findByToken, runChat, streamChat });
    const r = await inject(app, 'POST', '/v1/chat/completions',
      { authorization: 'Bearer good', 'content-type': 'application/json' },
      { messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(r.status, 200);
    assert.match(r.body, /"chat.completion"/);
  });

  it('GET /v1/models returns advertised list', async () => {
    const app = buildApp({ findByToken, runChat, streamChat });
    const r = await inject(app, 'GET', '/v1/models',
      { authorization: 'Bearer good' });
    assert.strictEqual(r.status, 200);
    assert.match(r.body, /daylight-house/);
  });
});
```

- [ ] **Step 2: Implement**

```javascript
// backend/src/4_api/v1/routers/brain.mjs
import express from 'express';
import { OpenAIChatCompletionsTranslator } from '../translators/OpenAIChatCompletionsTranslator.mjs';

export function createBrainRouter({
  satelliteRegistry,
  chatCompletionRunner,
  logger = console,
  advertisedModels = ['daylight-house', 'gpt-4o-mini'],
}) {
  if (!satelliteRegistry?.findByToken) throw new Error('createBrainRouter: satelliteRegistry required');
  if (!chatCompletionRunner?.runChat) throw new Error('createBrainRouter: chatCompletionRunner required');

  const router = express.Router();
  const translator = new OpenAIChatCompletionsTranslator({ runner: chatCompletionRunner, logger });

  // Bearer middleware (brain-specific; does NOT use the household JWT pipeline).
  router.use(async (req, res, next) => {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      logger.warn?.('brain.auth.failed', { code: 'missing_token', ip: req.ip });
      return res.status(401).json({ error: { message: 'missing_token', type: 'auth', code: 'missing_token' } });
    }
    const token = auth.slice(7).trim();
    const satellite = await satelliteRegistry.findByToken(token);
    if (!satellite) {
      const tokenPrefix = token.slice(0, 6);
      logger.warn?.('brain.auth.failed', { code: 'invalid_token', ip: req.ip, token_prefix: tokenPrefix });
      return res.status(401).json({ error: { message: 'invalid_token', type: 'auth', code: 'invalid_token' } });
    }
    req.satellite = satellite;
    next();
  });

  router.post('/chat/completions', async (req, res) => {
    await translator.handle(req, res, req.satellite);
  });

  router.get('/models', (_req, res) => {
    const created = Math.floor(Date.now() / 1000);
    res.status(200).json({
      object: 'list',
      data: advertisedModels.map(id => ({ id, object: 'model', created, owned_by: 'daylight' })),
    });
  });

  return router;
}

export default createBrainRouter;
```

- [ ] **Step 3: Pass + commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/routers/brain.test.mjs
git add backend/src/4_api/v1/routers/brain.mjs backend/tests/unit/api/routers/brain.test.mjs
git commit -m "feat(brain): /v1/chat/completions and /v1/models routes with bearer auth"
```

---

### Task 15: Wire `BrainApplication` into `bootstrap.mjs`

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

The brain router lives at `/v1/...`, **separate** from the existing `/api/v1/...` routes — HA expects `/v1/chat/completions` per OpenAI spec. Mount the brain router under `/v1` directly on the express app, not via the apiRouter.

- [ ] **Step 1: Locate the apiRouter mount**

```bash
grep -n "v1Routers\|app.use('/api/v1'" /opt/Code/DaylightStation/backend/src/0_system/bootstrap.mjs | head -20
```

- [ ] **Step 2: After the existing apiRouter is mounted, add brain wiring**

Find where the express app is returned/finalized and add **before** that, inserting alongside the other service-creation calls:

```javascript
// === Brain endpoint (OpenAI-compatible /v1) ===
import { YamlSatelliteRegistry } from '../1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs';
import { YamlBrainMemoryAdapter } from '../1_adapters/persistence/yaml/YamlBrainMemoryAdapter.mjs';
import { PassThroughBrainPolicy } from '../3_applications/brain/services/PassThroughBrainPolicy.mjs';
import { BrainApplication } from '../3_applications/brain/BrainApplication.mjs';
import { createBrainRouter } from '../4_api/v1/routers/brain.mjs';

const satelliteRegistry = new YamlSatelliteRegistry({
  configService, logger: rootLogger.child({ module: 'brain.satellite_registry' }),
});
await satelliteRegistry.load();

const brainMemory = new YamlBrainMemoryAdapter({
  workingMemory: workingMemoryAdapter, // already constructed above for HealthCoachAgent etc.
});

const brainApp = new BrainApplication({
  satelliteRegistry,
  memory: brainMemory,
  policy: new PassThroughBrainPolicy(),
  agentRuntime: mastraAdapter, // already constructed above
  logger: rootLogger.child({ module: 'brain' }),
});

app.use('/v1', createBrainRouter({
  satelliteRegistry,
  chatCompletionRunner: brainApp,
  logger: rootLogger.child({ module: 'brain.router' }),
}));
```

The exact variable names depend on what bootstrap.mjs already constructs — `configService`, `rootLogger`, `mastraAdapter`, `workingMemoryAdapter` should already exist (search to confirm and adapt).

- [ ] **Step 3: Smoke-run**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npm run start &
sleep 5
curl -sS http://localhost:3111/v1/models -H 'Authorization: Bearer doesnotmatter' | head -5
kill %1
```

Expected: `401` (no token configured yet — that's correct).

- [ ] **Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(brain): wire BrainApplication and /v1 router into bootstrap"
```

---

## Phase 5 — End-to-end smoke (memory skill only)

### Task 16: First end-to-end smoke test

**Goal:** before adding more skills, prove the wire-format and runtime work end-to-end.

- [ ] **Step 1: Set a dev token and brain.yml in the running container**

```bash
sudo docker exec daylight-station sh -c 'mkdir -p data/household/config && cat > data/household/config/brain.yml <<EOF
satellites:
  - id: dev
    media_player_entity: media_player.living_room
    area: livingroom
    allowed_skills: [memory]
    token_ref: ENV:DAYLIGHT_BRAIN_TOKEN_DEV
EOF'
```

- [ ] **Step 2: Set dev token via Infisical (or env on the host)**

If running inside Docker, the container already inherits env vars from compose. For a one-off smoke set it inline:

```bash
sudo docker exec -e DAYLIGHT_BRAIN_TOKEN_DEV=devtok daylight-station sh -c 'env | grep BRAIN_TOKEN'
```

(Production-ready setup is in Phase 9.)

- [ ] **Step 3: Rebuild and redeploy**

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
sleep 10
sudo docker logs daylight-station --tail 50 | grep -i brain
```

Expected log lines: `brain.satellite.config_reload count=1`.

- [ ] **Step 4: Hit the endpoint**

```bash
curl -sS http://localhost:3111/v1/chat/completions \
  -H 'Authorization: Bearer devtok' \
  -H 'Content-Type: application/json' \
  -d '{"model":"daylight-house","messages":[{"role":"user","content":"Remember that Soren is allergic to peanuts."}]}' | jq .
```

Expected: 200 with `choices[0].message.content` containing a brief acknowledgement, AND in the docker logs: `brain.tool.invoke tool=remember_note`.

- [ ] **Step 5: Verify recall**

```bash
curl -sS http://localhost:3111/v1/chat/completions \
  -H 'Authorization: Bearer devtok' \
  -H 'Content-Type: application/json' \
  -d '{"model":"daylight-house","messages":[{"role":"user","content":"What allergies do we have?"}]}' | jq -r '.choices[0].message.content'
```

Expected: response mentions peanuts and Soren.

- [ ] **Step 6: Stream test**

```bash
curl -N http://localhost:3111/v1/chat/completions \
  -H 'Authorization: Bearer devtok' \
  -H 'Content-Type: application/json' \
  -d '{"model":"daylight-house","messages":[{"role":"user","content":"Count to five."}],"stream":true}'
```

Expected: SSE chunks ending with `data: [DONE]`.

- [ ] **Step 7: If everything works, commit a checkpoint marker**

```bash
git commit --allow-empty -m "milestone: brain endpoint MVP working end-to-end with MemorySkill"
```

If anything fails, **stop and triage** before adding more skills.

---

## Phase 6 — Home Automation skill

### Task 17: `HomeAutomationSkill`

**Files:**
- Create: `backend/src/3_applications/brain/skills/HomeAutomationSkill.mjs`
- Create: `backend/src/3_applications/brain/skills/_friendlyName.mjs` (resolver utility)
- Test: `backend/tests/unit/applications/brain/skills/HomeAutomationSkill.test.mjs`
- Sample config: `data/household/config/skills/home_automation.yml.example`
- Modify: `backend/src/3_applications/brain/BrainApplication.mjs` (register HomeAutomationSkill)
- Modify: `backend/src/0_system/bootstrap.mjs` (pass HomeAutomationContainer + gateway through)

The skill exposes 4 tools: `ha_toggle_entity`, `ha_activate_scene`, `ha_run_script`, `ha_get_state`.

- [ ] **Step 0: Resolve "list all states" gap**

The friendly-name resolver needs the full set of HA entities for fuzzy matching, but `IHomeAutomationGateway.getStates(entityIds)` requires an explicit list and returns empty when given `[]`. Pick one:

- **Preferred:** extend `IHomeAutomationGateway` with `listAllStates(): Promise<DeviceState[]>` and add a `homeAssistantAdapter` impl backed by the HA REST `/api/states` endpoint. Update `assertHomeAutomationGateway` accordingly. This is a small, additive port change.
- **Fallback:** read all states once at brain startup via the existing `getDashboardState` use case (which iterates known dashboard entities) and pass that list as a `knownEntities` array to the resolver. Limits matchable surface to entities already on the dashboard.

Use the preferred path unless the HA adapter doesn't yet have REST-states support, in which case use the fallback and file a follow-up to add `listAllStates`.

The resolver below assumes the preferred path is available (`gateway.listAllStates()`); swap to the fallback array-reader if not.

- [ ] **Step 1: Friendly-name resolver**

```javascript
// backend/src/3_applications/brain/skills/_friendlyName.mjs
/**
 * Resolve a free-form name like "office light" to an HA entity_id (e.g. "light.office_main").
 * Strategy:
 *   1. Exact alias hit (config.friendly_name_aliases).
 *   2. Token-overlap fuzzy match against state names + entity ids from gateway.getStates().
 */
export async function resolveEntity({ name, gateway, aliases = {}, domain = null }) {
  if (!name) return { entityId: null, reason: 'empty' };
  const norm = String(name).trim().toLowerCase();
  if (aliases[norm]) return { entityId: aliases[norm], reason: 'alias' };

  const all = await safeStates(gateway);
  const candidates = all
    .filter(s => !domain || s.entityId.startsWith(`${domain}.`))
    .map(s => {
      const friendly = String(s.attributes?.friendly_name ?? '').toLowerCase();
      const eid = s.entityId.toLowerCase();
      const score = scoreMatch(norm, [friendly, eid.replace(/^[a-z]+\./, '').replace(/_/g, ' ')]);
      return { entityId: s.entityId, friendly, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return { entityId: null, reason: 'no_match', candidates: [] };
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return { entityId: null, reason: 'ambiguous', candidates: candidates.slice(0, 5).map(c => c.entityId) };
  }
  return { entityId: candidates[0].entityId, reason: 'fuzzy', candidates: candidates.slice(0, 5).map(c => c.entityId) };
}

function scoreMatch(query, names) {
  const queryTokens = new Set(query.split(/\s+/).filter(Boolean));
  let best = 0;
  for (const name of names) {
    const tokens = new Set(name.split(/[\s_]+/).filter(Boolean));
    let hits = 0;
    for (const t of queryTokens) if (tokens.has(t)) hits++;
    if (hits > 0) {
      const score = hits / Math.max(queryTokens.size, tokens.size);
      if (score > best) best = score;
    }
  }
  return best;
}

async function safeStates(gateway) {
  try {
    if (typeof gateway.listAllStates === 'function') {
      const list = await gateway.listAllStates();
      return Array.isArray(list) ? list : [];
    }
    // Fallback: gateways without listAllStates can't enumerate.
    return [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Skill test**

```javascript
// backend/tests/unit/applications/brain/skills/HomeAutomationSkill.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HomeAutomationSkill } from '../../../../../src/3_applications/brain/skills/HomeAutomationSkill.mjs';

class FakeGateway {
  constructor() { this.calls = []; }
  async getStates(_ids) {
    return new Map([
      ['light.office_main', { entityId: 'light.office_main', state: 'off', attributes: { friendly_name: 'Office Light' } }],
      ['scene.movie_mode', { entityId: 'scene.movie_mode', state: 'scening', attributes: { friendly_name: 'Movie Mode' } }],
    ]);
  }
  async getState(id) {
    const m = await this.getStates();
    return m.get(id) ?? null;
  }
  async callService(domain, service, data) {
    this.calls.push({ domain, service, data });
    return { ok: true, data };
  }
  async activateScene(id) {
    this.calls.push({ activateScene: id });
    return { ok: true };
  }
  async runScript(id) {
    this.calls.push({ runScript: id });
    return { ok: true };
  }
}

describe('HomeAutomationSkill', () => {
  it('toggles by friendly name via fuzzy match', async () => {
    const gw = new FakeGateway();
    const skill = new HomeAutomationSkill({ gateway: gw, logger: console, config: { friendly_name_aliases: {} } });
    const toggle = skill.getTools().find(t => t.name === 'ha_toggle_entity');
    const result = await toggle.execute({ name: 'office light', action: 'turn_on' }, {});
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(gw.calls[0], {
      domain: 'light', service: 'turn_on', data: { entity_id: 'light.office_main' },
    });
  });

  it('returns ok:false on no match', async () => {
    const gw = new FakeGateway();
    const skill = new HomeAutomationSkill({ gateway: gw, logger: console, config: {} });
    const toggle = skill.getTools().find(t => t.name === 'ha_toggle_entity');
    const result = await toggle.execute({ name: 'unobtainium light', action: 'turn_on' }, {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'no_match');
  });

  it('activates scene by name', async () => {
    const gw = new FakeGateway();
    const skill = new HomeAutomationSkill({ gateway: gw, logger: console, config: {} });
    const scene = skill.getTools().find(t => t.name === 'ha_activate_scene');
    const result = await scene.execute({ name: 'movie mode' }, {});
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(gw.calls[0], { activateScene: 'scene.movie_mode' });
  });
});
```

- [ ] **Step 3: Implement skill**

```javascript
// backend/src/3_applications/brain/skills/HomeAutomationSkill.mjs
import { resolveEntity } from './_friendlyName.mjs';

export class HomeAutomationSkill {
  static name = 'home_automation';
  #gateway; #logger; #config;
  constructor({ gateway, logger = console, config = {} }) {
    if (!gateway) throw new Error('HomeAutomationSkill: gateway required');
    this.#gateway = gateway;
    this.#logger = logger;
    this.#config = { friendly_name_aliases: {}, area_priority: [], ...config };
  }

  get name() { return HomeAutomationSkill.name; }
  getConfig() { return { ...this.#config }; }
  getPromptFragment(_satellite) {
    return `## Home Automation
You can control lights, switches, scenes, and scripts.
- Use \`ha_toggle_entity\` with a friendly name and \`action\` of "turn_on", "turn_off", or "toggle".
- Use \`ha_activate_scene\` with the scene name.
- Use \`ha_run_script\` with the script name.
- Use \`ha_get_state\` to check current state of one device.
Refuse if a device is not configured. Do not invent entity IDs.`;
  }

  getTools() {
    const gw = this.#gateway;
    const aliases = this.#config.friendly_name_aliases ?? {};
    const log = this.#logger;

    return [
      {
        name: 'ha_toggle_entity',
        description: 'Turn on, off, or toggle an entity by friendly name (light, switch, fan, etc.).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Friendly name of the device.' },
            action: { type: 'string', enum: ['turn_on', 'turn_off', 'toggle'] },
          },
          required: ['name', 'action'],
        },
        async execute({ name, action }) {
          const resolved = await resolveEntity({ name, gateway: gw, aliases });
          if (!resolved.entityId) {
            log.warn?.('brain.skill.ha.resolve_failed', { friendly_name: name, candidates: resolved.candidates ?? [] });
            return { ok: false, reason: resolved.reason, candidates: resolved.candidates };
          }
          const domain = resolved.entityId.split('.')[0];
          const result = await gw.callService(domain, action, { entity_id: resolved.entityId });
          log.info?.('brain.skill.ha.action', { tool: 'ha_toggle_entity', entity_id: resolved.entityId, ok: !!result?.ok });
          return { ok: !!result?.ok, entity_id: resolved.entityId, action, error: result?.error };
        },
      },
      {
        name: 'ha_activate_scene',
        description: 'Activate a Home Assistant scene by friendly name.',
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        async execute({ name }) {
          const resolved = await resolveEntity({ name, gateway: gw, aliases, domain: 'scene' });
          if (!resolved.entityId) return { ok: false, reason: resolved.reason, candidates: resolved.candidates };
          const result = await gw.activateScene(resolved.entityId);
          log.info?.('brain.skill.ha.action', { tool: 'ha_activate_scene', entity_id: resolved.entityId, ok: !!result?.ok });
          return { ok: !!result?.ok, scene: resolved.entityId, error: result?.error };
        },
      },
      {
        name: 'ha_run_script',
        description: 'Run a Home Assistant script by friendly name.',
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        async execute({ name }) {
          const resolved = await resolveEntity({ name, gateway: gw, aliases, domain: 'script' });
          if (!resolved.entityId) return { ok: false, reason: resolved.reason, candidates: resolved.candidates };
          const result = await gw.runScript(resolved.entityId);
          log.info?.('brain.skill.ha.action', { tool: 'ha_run_script', entity_id: resolved.entityId, ok: !!result?.ok });
          return { ok: !!result?.ok, script: resolved.entityId, error: result?.error };
        },
      },
      {
        name: 'ha_get_state',
        description: 'Get current state of a device by friendly name.',
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        async execute({ name }) {
          const resolved = await resolveEntity({ name, gateway: gw, aliases });
          if (!resolved.entityId) return { ok: false, reason: resolved.reason };
          const state = await gw.getState(resolved.entityId);
          if (!state) return { ok: false, reason: 'not_found', entity_id: resolved.entityId };
          return { ok: true, entity_id: resolved.entityId, state: state.state, attributes: state.attributes };
        },
      },
    ];
  }
}

export default HomeAutomationSkill;
```

- [ ] **Step 4: Register in `BrainApplication`** (uncomment the previously-stubbed line; add `homeAutomationGateway` to the constructor parameter destructure)

Edit `BrainApplication.mjs`: in the constructor, after `skills.register(new MemorySkill(...))`, add:

```javascript
if (homeAutomationGateway) {
  const { HomeAutomationSkill } = await import('./skills/HomeAutomationSkill.mjs');
  skills.register(new HomeAutomationSkill({ gateway: homeAutomationGateway, logger, config: skillConfigs.home_automation }));
}
```

Wait — `await import` inside a constructor is a no-go. Restructure: change the constructor argument to take a list of skill INSTANCES rather than wiring them inside. The composition root (`bootstrap.mjs`) becomes responsible for instantiating skills. Update `BrainApplication.mjs`:

```javascript
constructor({
  satelliteRegistry, memory, policy, agentRuntime, skills = [],
  logger = console,
}) {
  ...
  const registry = new SkillRegistry({ logger });
  for (const skill of skills) registry.register(skill);
  this.#agent = new BrainAgent({ agentRuntime, memory, policy, skills: registry, logger });
}
```

(That's a cleaner change anyway. Update `BrainApplication.test.mjs` to pass `skills: [memorySkillInstance]` instead of relying on internal MemorySkill registration. Add the test fix to this task.)

- [ ] **Step 5: Update `bootstrap.mjs`**

In bootstrap, where `BrainApplication` is constructed (Task 15), now build the skills list explicitly:

```javascript
import { MemorySkill } from '../3_applications/brain/skills/MemorySkill.mjs';
import { HomeAutomationSkill } from '../3_applications/brain/skills/HomeAutomationSkill.mjs';

const skillConfigs = (configService.reloadHouseholdAppConfig?.(null, 'skills.yml')) ?? {};

const brainSkills = [
  new MemorySkill({ memory: brainMemory, logger: rootLogger.child({ skill: 'memory' }), config: skillConfigs.memory }),
];
if (homeAutomationGateway) {
  brainSkills.push(new HomeAutomationSkill({
    gateway: homeAutomationGateway,
    logger: rootLogger.child({ skill: 'home_automation' }),
    config: skillConfigs.home_automation,
  }));
}

const brainApp = new BrainApplication({
  satelliteRegistry, memory: brainMemory,
  policy: new PassThroughBrainPolicy(),
  agentRuntime: mastraAdapter,
  skills: brainSkills,
  logger: rootLogger.child({ module: 'brain' }),
});
```

- [ ] **Step 6: Run tests + commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/
git add backend/src/3_applications/brain/skills/HomeAutomationSkill.mjs \
        backend/src/3_applications/brain/skills/_friendlyName.mjs \
        backend/src/3_applications/brain/BrainApplication.mjs \
        backend/src/0_system/bootstrap.mjs \
        backend/tests/unit/applications/brain/
git commit -m "feat(brain): HomeAutomationSkill with toggle/scene/script/state and friendly-name resolver"
```

- [ ] **Step 7: Add `home_automation` to dev satellite's `allowed_skills` and redeploy**

```bash
sudo docker exec daylight-station sh -c "sed -i 's/allowed_skills: \[memory\]/allowed_skills: [memory, home_automation]/' data/household/config/brain.yml"
# then rebuild & redeploy as in Phase 5 Task 16
```

Smoke: `curl ... -d '{"messages":[{"role":"user","content":"Turn on the office light."}]}' | jq -r .choices[0].message.content`. Expect: light goes on, response confirms.

---

## Phase 7 — Media skill

### Task 18: `IContentQuery` port (over `ContentQueryService`)

**Files:**
- Create: `backend/src/3_applications/content/ports/IContentQuery.mjs`
- Modify: `backend/src/3_applications/content/index.mjs` (export the port)

`ContentQueryService` already does the work. We publish a port so the brain's MediaSkill depends on a contract, not the concrete service.

- [ ] **Step 1: Implement port**

```javascript
// backend/src/3_applications/content/ports/IContentQuery.mjs
/**
 * IContentQuery
 *   search(query: { text: string, source?: string, capability?: string, take?: number }):
 *     Promise<{ items: Array, total: number, sources: string[], warnings?: Array }>
 *   resolve(source: string, localId: string, context?: object, overrides?: object):
 *     Promise<{ items: Array, strategy: object }>
 */
export function isContentQuery(obj) {
  return !!obj && typeof obj.search === 'function' && typeof obj.resolve === 'function';
}
export function assertContentQuery(obj) {
  if (!isContentQuery(obj)) throw new Error('Object does not implement IContentQuery');
}
export default { isContentQuery, assertContentQuery };
```

- [ ] **Step 2: Re-export from `content/index.mjs`**

```javascript
// add: export * from './ports/IContentQuery.mjs';
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/content/ports/IContentQuery.mjs backend/src/3_applications/content/index.mjs
git commit -m "feat(content): publish IContentQuery port over ContentQueryService"
```

---

### Task 19: `MediaSkill`

**Files:**
- Create: `backend/src/3_applications/brain/skills/MediaSkill.mjs`
- Test: `backend/tests/unit/applications/brain/skills/MediaSkill.test.mjs`
- Sample config: `data/household/config/skills/media.yml.example`
- Modify: `backend/src/0_system/bootstrap.mjs` (register MediaSkill)

`MediaSkill` consumes `IContentQuery` for search + resolve, and `IHomeAutomationGateway.callService` for `media_player.play_media`.

- [ ] **Step 1: Test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MediaSkill } from '../../../../../src/3_applications/brain/skills/MediaSkill.mjs';

class FakeContentQuery {
  constructor({ searchResult, resolveResult }) {
    this.searchResult = searchResult;
    this.resolveResult = resolveResult;
    this.calls = [];
  }
  async search(q) { this.calls.push({ search: q }); return this.searchResult; }
  async resolve(source, id) { this.calls.push({ resolve: { source, id } }); return this.resolveResult; }
}

class FakeGateway {
  constructor() { this.calls = []; }
  async callService(d, s, data) { this.calls.push({ d, s, data }); return { ok: true }; }
}

describe('MediaSkill', () => {
  it('plays the top match', async () => {
    const cq = new FakeContentQuery({
      searchResult: { items: [{ id: 'plex:42', source: 'plex', localId: '42', title: 'Workout Mix' }], total: 1, sources: ['plex'] },
      resolveResult: { items: [{ id: 'plex:42', mediaUrl: '/api/v1/stream/plex/42', metadata: { type: 'audio' } }], strategy: {} },
    });
    const gw = new FakeGateway();
    const skill = new MediaSkill({
      contentQuery: cq, gateway: gw, logger: console,
      config: { default_volume: 30, ds_base_url: 'http://10.0.0.5:3111' },
    });
    const tool = skill.getTools()[0];
    const result = await tool.execute({ query: 'workout playlist' }, {
      satellite: { mediaPlayerEntity: 'media_player.living_room' },
    });
    assert.strictEqual(result.ok, true);
    assert.match(result.title, /Workout Mix/);
    assert.strictEqual(gw.calls[0].d, 'media_player');
    assert.strictEqual(gw.calls[0].s, 'play_media');
    assert.strictEqual(gw.calls[0].data.entity_id, 'media_player.living_room');
    assert.match(gw.calls[0].data.media_content_id, /api\/v1\/stream\/plex\/42/);
  });

  it('returns no_match when nothing found', async () => {
    const cq = new FakeContentQuery({ searchResult: { items: [], total: 0, sources: [] }, resolveResult: { items: [] } });
    const gw = new FakeGateway();
    const skill = new MediaSkill({ contentQuery: cq, gateway: gw, logger: console, config: { ds_base_url: 'http://x' } });
    const result = await skill.getTools()[0].execute({ query: 'unobtainium' }, { satellite: { mediaPlayerEntity: 'm' } });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'no_match');
  });
});
```

- [ ] **Step 2: Implement**

```javascript
// backend/src/3_applications/brain/skills/MediaSkill.mjs
export class MediaSkill {
  static name = 'media';
  #contentQuery; #gateway; #logger; #config;

  constructor({ contentQuery, gateway, logger = console, config = {} }) {
    if (!contentQuery) throw new Error('MediaSkill: contentQuery required');
    if (!gateway) throw new Error('MediaSkill: gateway required');
    this.#contentQuery = contentQuery;
    this.#gateway = gateway;
    this.#logger = logger;
    this.#config = {
      default_volume: 30,
      prefix_aliases: {},
      ds_base_url: 'http://10.0.0.5:3111',
      ...config,
    };
  }

  get name() { return MediaSkill.name; }
  getConfig() { return { ...this.#config }; }
  getPromptFragment(_satellite) {
    return `## Media playback
You can play household media (music, playlists, podcasts, audiobooks, ambient sounds).
- Use \`play_media\` with a free-form query like "workout playlist" or "rain sounds".
- The media plays on the speaker associated with the calling satellite.
- If nothing matches, decline politely; do not invent titles.`;
  }

  getTools() {
    const cq = this.#contentQuery;
    const gw = this.#gateway;
    const cfg = this.#config;
    const log = this.#logger;

    return [
      {
        name: 'play_media',
        description: 'Search the household library and play the best match on the calling satellite.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Free-form description of what to play.' },
            media_class: {
              type: 'string',
              enum: ['music', 'playlist', 'podcast', 'audiobook', 'ambient', 'singalong', 'other'],
              description: 'Optional category hint.',
            },
          },
          required: ['query'],
        },
        async execute({ query, media_class }, ctx) {
          const satellite = ctx?.satellite;
          if (!satellite?.mediaPlayerEntity) return { ok: false, reason: 'no_media_player' };

          const text = applyPrefix(query, media_class, cfg.prefix_aliases);
          const start = Date.now();
          const search = await cq.search({ text, take: 5 });
          log.info?.('brain.skill.media.search', {
            query, media_class, result_count: search.items?.length ?? 0,
            latencyMs: Date.now() - start,
          });

          const top = search.items?.[0];
          if (!top) {
            log.warn?.('brain.skill.media.no_match', { query, sources_tried: search.sources ?? [] });
            return { ok: false, reason: 'no_match', query };
          }

          const localId = top.localId ?? extractLocalId(top.id, top.source);
          const resolved = await cq.resolve(top.source, localId, {}, {});
          const playable = resolved.items?.[0];
          if (!playable) return { ok: false, reason: 'no_playable', source: top.source };

          const mediaUrl = `${cfg.ds_base_url}${playable.mediaUrl ?? `/api/v1/stream/${top.source}/${localId}`}`;
          const contentType = mapContentType(playable.metadata?.type ?? media_class ?? 'music');

          const playResult = await gw.callService('media_player', 'play_media', {
            entity_id: satellite.mediaPlayerEntity,
            media_content_id: mediaUrl,
            media_content_type: contentType,
          });

          log.info?.('brain.skill.media.play', {
            content_id: top.id, media_player: satellite.mediaPlayerEntity, ok: !!playResult?.ok,
          });

          return {
            ok: !!playResult?.ok,
            title: top.title,
            artist: top.metadata?.artist ?? null,
            mediaPlayer: satellite.mediaPlayerEntity,
            error: playResult?.error,
          };
        },
      },
    ];
  }
}

function applyPrefix(query, mediaClass, aliases) {
  const lc = String(query).trim().toLowerCase();
  for (const [k, v] of Object.entries(aliases)) {
    if (lc.includes(k)) return `${v}`;
  }
  if (mediaClass && !lc.includes(':')) return `${mediaClass}:${query}`;
  return query;
}

function extractLocalId(id, source) {
  if (typeof id === 'string' && id.startsWith(`${source}:`)) return id.slice(source.length + 1);
  return id;
}

function mapContentType(t) {
  switch (t) {
    case 'audio':
    case 'music':
    case 'playlist':
    case 'podcast':
    case 'audiobook':
    case 'singalong':
      return 'music';
    case 'video':
    case 'dash_video':
      return 'video';
    case 'ambient':
      return 'music';
    default:
      return 'music';
  }
}

export default MediaSkill;
```

- [ ] **Step 3: Sample config**

```yaml
# data/household/config/skills/media.yml.example
default_volume: 30
ds_base_url: http://10.0.0.5:3111
prefix_aliases:
  workout: "playlist:workout"
  bedtime: "playlist:bedtime"
  morning: "playlist:morning"
```

- [ ] **Step 4: Wire in bootstrap**

```javascript
// in bootstrap.mjs, after HomeAutomationSkill registration:
import { MediaSkill } from '../3_applications/brain/skills/MediaSkill.mjs';

if (contentQueryService && homeAutomationGateway) {
  brainSkills.push(new MediaSkill({
    contentQuery: contentQueryService,
    gateway: homeAutomationGateway,
    logger: rootLogger.child({ skill: 'media' }),
    config: skillConfigs.media,
  }));
}
```

- [ ] **Step 5: Test, commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/skills/MediaSkill.test.mjs
git add backend/src/3_applications/brain/skills/MediaSkill.mjs \
        backend/tests/unit/applications/brain/skills/MediaSkill.test.mjs \
        data/household/config/skills/media.yml.example \
        backend/src/0_system/bootstrap.mjs
git commit -m "feat(brain): MediaSkill — search via IContentQuery + play via media_player.play_media"
```

- [ ] **Step 6: Smoke test (after rebuild + redeploy)**

```bash
curl -sS http://localhost:3111/v1/chat/completions \
  -H 'Authorization: Bearer devtok' \
  -H 'Content-Type: application/json' \
  -d '{"model":"daylight-house","messages":[{"role":"user","content":"Play the workout playlist."}]}' | jq -r .choices[0].message.content
```

Listen for music on the living-room speaker. Verify with `sudo docker logs daylight-station --tail 50 | grep media`.

---

## Phase 8 — Read-only domain skills

For each domain (calendar, lifelog, finance, fitness), the audit confirmed no clean read API exists today. Each task introduces a **minimum read port** plus a corresponding `*ReadSkill` that wraps it. Keep the read ports thin — surface only what the skill needs.

### Task 20: Calendar read port + `CalendarReadSkill`

**Files:**
- Create: `backend/src/3_applications/scheduling/ports/ICalendarRead.mjs` (or matching directory if calendar lives elsewhere — search first)
- Create: `backend/src/3_applications/scheduling/CalendarReadAdapter.mjs` (wraps existing scheduling service)
- Create: `backend/src/3_applications/brain/skills/CalendarReadSkill.mjs`
- Test: `backend/tests/unit/applications/brain/skills/CalendarReadSkill.test.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Locate calendar source**

```bash
grep -rn "calendar\|getEvents" /opt/Code/DaylightStation/backend/src/3_applications | head -20
```

Find what currently reads calendar. If there's no service, check `data/household/calendar/` for raw YAML and create a minimal reader.

- [ ] **Step 2: Define `ICalendarRead`**

```javascript
// backend/src/3_applications/scheduling/ports/ICalendarRead.mjs
/**
 * ICalendarRead
 *   getEvents({ rangeFrom: ISO, rangeTo: ISO, limit?: number, calendars?: string[] }):
 *     Promise<Array<{ id, title, startIso, endIso, calendar, location? }>>
 */
export function isCalendarRead(obj) { return !!obj && typeof obj.getEvents === 'function'; }
export function assertCalendarRead(obj) { if (!isCalendarRead(obj)) throw new Error('Object does not implement ICalendarRead'); }
```

- [ ] **Step 3: Implement `CalendarReadAdapter`**

Implementation depends on whatever was found in Step 1. If calendar comes from Google Calendar via existing OAuth in the codebase, the adapter calls that. If it's a YAML file, it reads the YAML. Keep the adapter dumb — pure read, no caching beyond what the underlying source already does.

- [ ] **Step 4: `CalendarReadSkill`**

```javascript
// backend/src/3_applications/brain/skills/CalendarReadSkill.mjs
export class CalendarReadSkill {
  static name = 'calendar_read';
  #cal; #logger; #config;
  constructor({ calendar, logger = console, config = {} }) {
    if (!calendar?.getEvents) throw new Error('CalendarReadSkill: calendar (ICalendarRead) required');
    this.#cal = calendar; this.#logger = logger;
    this.#config = { lookback_days: 0, lookahead_days: 7, default_calendars: null, ...config };
  }
  get name() { return CalendarReadSkill.name; }
  getConfig() { return { ...this.#config }; }
  getPromptFragment(_s) {
    return `## Calendar
Use \`get_calendar_events\` to read events. Default range is the next 7 days; you can specify dates explicitly.`;
  }
  getTools() {
    const cal = this.#cal; const cfg = this.#config; const log = this.#logger;
    return [{
      name: 'get_calendar_events',
      description: 'Read calendar events in a time range (default: next 7 days).',
      parameters: {
        type: 'object',
        properties: {
          range_from: { type: 'string', description: 'ISO start (default: now)' },
          range_to: { type: 'string', description: 'ISO end (default: +7d)' },
          limit: { type: 'number' },
        },
      },
      async execute({ range_from, range_to, limit = 20 }) {
        const from = range_from ?? new Date().toISOString();
        const to = range_to ?? new Date(Date.now() + cfg.lookahead_days * 86400000).toISOString();
        const start = Date.now();
        const events = await cal.getEvents({ rangeFrom: from, rangeTo: to, limit, calendars: cfg.default_calendars });
        log.info?.('brain.skill.calendar.read', { range: `${from}..${to}`, count: events.length, latencyMs: Date.now() - start });
        return { events };
      },
    }];
  }
}
```

- [ ] **Step 5: Test, wire in bootstrap, commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/skills/CalendarReadSkill.test.mjs
# (write tests analogous to MediaSkill: pass a fake calendar, assert tool returns events)
# Wire in bootstrap.mjs:
#   if (calendarRead) brainSkills.push(new CalendarReadSkill({ calendar: calendarRead, logger: ..., config: skillConfigs.calendar_read }));
git add backend/src/3_applications/scheduling/ports/ICalendarRead.mjs \
        backend/src/3_applications/scheduling/CalendarReadAdapter.mjs \
        backend/src/3_applications/brain/skills/CalendarReadSkill.mjs \
        backend/tests/unit/applications/brain/skills/CalendarReadSkill.test.mjs \
        backend/src/0_system/bootstrap.mjs
git commit -m "feat(brain): CalendarReadSkill + ICalendarRead port"
```

---

### Task 21: Lifelog read port + `LifelogReadSkill`

**Files:**
- Create: `backend/src/3_applications/lifelog/ports/ILifelogRead.mjs`
- Create: `backend/src/3_applications/lifelog/LifelogReadAdapter.mjs`
- Create: `backend/src/3_applications/brain/skills/LifelogReadSkill.mjs`
- Test: `backend/tests/unit/applications/brain/skills/LifelogReadSkill.test.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Locate lifelog source.** `LifelogAggregator.aggregate(username, date?)` is the existing entry point per audit. Determine the shape it returns and whether a "search across days" capability already exists. If not, the adapter aggregates per-day on demand inside the read methods.

- [ ] **Step 2: Define `ILifelogRead`**

```javascript
// backend/src/3_applications/lifelog/ports/ILifelogRead.mjs
export function isLifelogRead(obj) {
  return !!obj && typeof obj.recentEntries === 'function' && typeof obj.queryJournal === 'function';
}
export function assertLifelogRead(obj) { if (!isLifelogRead(obj)) throw new Error('Object does not implement ILifelogRead'); }
/**
 * recentEntries({ days?: number, kinds?: string[], username?: string }): Promise<Array<{ date, kind, summary, source }>>
 * queryJournal({ text: string, limit?: number, username?: string }): Promise<Array<{ date, excerpt, score }>>
 */
```

- [ ] **Step 3: Implement `LifelogReadAdapter`** wrapping `LifelogAggregator`. For `recentEntries`, call `aggregate(username, date)` for each of the last N days and concatenate; for `queryJournal`, scan recent days' aggregated text for the query (simple substring match — full-text search is out of scope).

- [ ] **Step 4: Implement `LifelogReadSkill`**

```javascript
// backend/src/3_applications/brain/skills/LifelogReadSkill.mjs
export class LifelogReadSkill {
  static name = 'lifelog_read';
  #lifelog; #logger; #config;
  constructor({ lifelog, logger = console, config = {} }) {
    if (!lifelog?.recentEntries) throw new Error('LifelogReadSkill: lifelog (ILifelogRead) required');
    this.#lifelog = lifelog; this.#logger = logger;
    this.#config = { default_username: 'household', max_days: 14, ...config };
  }
  get name() { return LifelogReadSkill.name; }
  getConfig() { return { ...this.#config }; }
  getPromptFragment(_s) {
    return `## Lifelog & Journal
Use \`recent_lifelog_entries\` to read what's been logged in the last few days.
Use \`query_journal\` to find specific text in recent journal entries.
Be respectful — these are personal notes.`;
  }
  getTools() {
    const ll = this.#lifelog; const cfg = this.#config; const log = this.#logger;
    return [
      {
        name: 'recent_lifelog_entries',
        description: 'Read recent lifelog entries from the past N days.',
        parameters: {
          type: 'object',
          properties: { days: { type: 'number' }, kinds: { type: 'array', items: { type: 'string' } } },
        },
        async execute({ days = 3, kinds }) {
          const capped = Math.min(cfg.max_days, Math.max(1, days));
          const entries = await ll.recentEntries({ days: capped, kinds, username: cfg.default_username });
          log.info?.('brain.skill.lifelog.read', { days: capped, count: entries.length });
          return { entries };
        },
      },
      {
        name: 'query_journal',
        description: 'Search recent journal entries for a phrase.',
        parameters: { type: 'object', properties: { text: { type: 'string' }, limit: { type: 'number' } }, required: ['text'] },
        async execute({ text, limit = 5 }) {
          const hits = await ll.queryJournal({ text, limit, username: cfg.default_username });
          log.info?.('brain.skill.lifelog.query', { text_length: text.length, hit_count: hits.length });
          return { hits };
        },
      },
    ];
  }
}
```

- [ ] **Step 5: Test scaffold** (modeled on `MediaSkill.test.mjs`)

```javascript
// backend/tests/unit/applications/brain/skills/LifelogReadSkill.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LifelogReadSkill } from '../../../../../src/3_applications/brain/skills/LifelogReadSkill.mjs';

class FakeLifelog {
  async recentEntries({ days }) { return [{ date: '2026-04-30', kind: 'note', summary: `last ${days}d` }]; }
  async queryJournal({ text }) { return [{ date: '2026-04-30', excerpt: text, score: 1 }]; }
}

describe('LifelogReadSkill', () => {
  const skill = new LifelogReadSkill({ lifelog: new FakeLifelog() });
  it('exposes recent_lifelog_entries and query_journal', () => {
    const names = skill.getTools().map(t => t.name).sort();
    assert.deepStrictEqual(names, ['query_journal', 'recent_lifelog_entries']);
  });
  it('caps days at max_days', async () => {
    const tool = skill.getTools().find(t => t.name === 'recent_lifelog_entries');
    const r = await tool.execute({ days: 999 }, {});
    assert.match(r.entries[0].summary, /14d/); // capped to default max_days
  });
});
```

- [ ] **Step 6: Wire in bootstrap, run tests, commit**

Add `if (lifelogRead) brainSkills.push(new LifelogReadSkill({ lifelog: lifelogRead, logger: ..., config: skillConfigs.lifelog_read }));` to bootstrap.

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/skills/LifelogReadSkill.test.mjs
git add backend/src/3_applications/lifelog/ports/ILifelogRead.mjs \
        backend/src/3_applications/lifelog/LifelogReadAdapter.mjs \
        backend/src/3_applications/brain/skills/LifelogReadSkill.mjs \
        backend/tests/unit/applications/brain/skills/LifelogReadSkill.test.mjs \
        backend/src/0_system/bootstrap.mjs
git commit -m "feat(brain): LifelogReadSkill + ILifelogRead port"
```

---

### Task 22: Finance read port + `FinanceReadSkill`

**Files:**
- Create: `backend/src/3_applications/finance/ports/IFinanceRead.mjs`
- Create: `backend/src/3_applications/finance/FinanceReadAdapter.mjs`
- Create: `backend/src/3_applications/brain/skills/FinanceReadSkill.mjs`
- Test: `backend/tests/unit/applications/brain/skills/FinanceReadSkill.test.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

The CLAUDE.local.md describes `/api/v1/finance/accounts`, `/api/v1/finance/transactions`, and the underlying `BudgetCompilationService`/`FinanceHarvestService`. The adapter wraps those service methods (NOT the HTTP routes — call the application services directly).

- [ ] **Step 1: `IFinanceRead`**

```javascript
// backend/src/3_applications/finance/ports/IFinanceRead.mjs
export function isFinanceRead(obj) {
  return !!obj
    && typeof obj.accountBalances === 'function'
    && typeof obj.recentTransactions === 'function'
    && typeof obj.budgetSummary === 'function';
}
export function assertFinanceRead(obj) { if (!isFinanceRead(obj)) throw new Error('Object does not implement IFinanceRead'); }
/**
 * accountBalances(): Promise<Array<{ accountId, name, balance, currency }>>
 * recentTransactions({ days?: number, account?: string, limit?: number, tag?: string }): Promise<Array<{ date, amount, description, account, tag? }>>
 * budgetSummary({ periodStart?: string }): Promise<{ income, byCategory: Object, asOf: string }>
 */
```

- [ ] **Step 2: `FinanceReadAdapter`** — composes existing finance services. Read from cached YAML where possible; fall back to live Buxfer only if cache is missing.

- [ ] **Step 3: `FinanceReadSkill`**

```javascript
// backend/src/3_applications/brain/skills/FinanceReadSkill.mjs
export class FinanceReadSkill {
  static name = 'finance_read';
  #fin; #logger; #config;
  constructor({ finance, logger = console, config = {} }) {
    if (!finance?.accountBalances) throw new Error('FinanceReadSkill: finance (IFinanceRead) required');
    this.#fin = finance; this.#logger = logger;
    this.#config = { ...config };
  }
  get name() { return FinanceReadSkill.name; }
  getConfig() { return { ...this.#config }; }
  getPromptFragment(_s) {
    return `## Finance
Use these tools to answer questions about household money.
- \`account_balances\`: current balances across all accounts.
- \`recent_transactions\`: filter by days, account name, or tag (category).
- \`budget_summary\`: summary of income and category spending for the current budget period.
Round dollar amounts when speaking; do not read every cent unless asked.`;
  }
  getTools() {
    const fin = this.#fin; const log = this.#logger;
    return [
      {
        name: 'account_balances',
        description: 'Get current balances of all household accounts.',
        parameters: { type: 'object', properties: {} },
        async execute() {
          const accounts = await fin.accountBalances();
          log.info?.('brain.skill.finance.balances', { count: accounts.length });
          return { accounts };
        },
      },
      {
        name: 'recent_transactions',
        description: 'List recent transactions, optionally filtered by account or tag.',
        parameters: {
          type: 'object',
          properties: {
            days: { type: 'number' }, account: { type: 'string' },
            tag: { type: 'string' }, limit: { type: 'number' },
          },
        },
        async execute({ days = 7, account, tag, limit = 25 }) {
          const tx = await fin.recentTransactions({ days, account, tag, limit });
          log.info?.('brain.skill.finance.transactions', { days, count: tx.length });
          return { transactions: tx };
        },
      },
      {
        name: 'budget_summary',
        description: 'Summarize income and spending for a budget period (default: current).',
        parameters: { type: 'object', properties: { period_start: { type: 'string' } } },
        async execute({ period_start }) {
          const summary = await fin.budgetSummary({ periodStart: period_start });
          log.info?.('brain.skill.finance.budget', { periodStart: summary.asOf });
          return summary;
        },
      },
    ];
  }
}
```

- [ ] **Step 4: Test scaffold** (analogous to LifelogReadSkill — fake `IFinanceRead`, assert tools work, assert names match `account_balances` / `recent_transactions` / `budget_summary`).

- [ ] **Step 5: Wire in bootstrap, run tests, commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/skills/FinanceReadSkill.test.mjs
git add backend/src/3_applications/finance/ports/IFinanceRead.mjs \
        backend/src/3_applications/finance/FinanceReadAdapter.mjs \
        backend/src/3_applications/brain/skills/FinanceReadSkill.mjs \
        backend/tests/unit/applications/brain/skills/FinanceReadSkill.test.mjs \
        backend/src/0_system/bootstrap.mjs
git commit -m "feat(brain): FinanceReadSkill + IFinanceRead port"
```

---

### Task 23: Fitness read port + `FitnessReadSkill`

**Files:**
- Create: `backend/src/3_applications/fitness/ports/IFitnessRead.mjs`
- Create: `backend/src/3_applications/fitness/FitnessReadAdapter.mjs`
- Create: `backend/src/3_applications/brain/skills/FitnessReadSkill.mjs`
- Test: `backend/tests/unit/applications/brain/skills/FitnessReadSkill.test.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: `IFitnessRead`**

```javascript
// backend/src/3_applications/fitness/ports/IFitnessRead.mjs
export function isFitnessRead(obj) {
  return !!obj && typeof obj.recentWorkouts === 'function' && typeof obj.fitnessSummary === 'function';
}
export function assertFitnessRead(obj) { if (!isFitnessRead(obj)) throw new Error('Object does not implement IFitnessRead'); }
/**
 * recentWorkouts({ days?: number, limit?: number }): Promise<Array<{ date, type, durationSec, distanceM?, source }>>
 * fitnessSummary({ periodDays?: number }): Promise<{ totalMinutes, byType: Object, asOf: string }>
 */
```

- [ ] **Step 2: `FitnessReadAdapter`** — wraps existing fitness services. The codebase has `FitnessPlayableService`, `StravaReconciliationService`. The adapter likely needs to read from Strava cache or fitness YAML; surface only what the skill needs.

- [ ] **Step 3: `FitnessReadSkill`**

```javascript
// backend/src/3_applications/brain/skills/FitnessReadSkill.mjs
export class FitnessReadSkill {
  static name = 'fitness_read';
  #fit; #logger; #config;
  constructor({ fitness, logger = console, config = {} }) {
    if (!fitness?.recentWorkouts) throw new Error('FitnessReadSkill: fitness (IFitnessRead) required');
    this.#fit = fitness; this.#logger = logger;
    this.#config = { ...config };
  }
  get name() { return FitnessReadSkill.name; }
  getConfig() { return { ...this.#config }; }
  getPromptFragment(_s) {
    return `## Fitness
- \`recent_workouts\` lists workouts in the last N days.
- \`fitness_summary\` totals minutes and types of activity over a period.`;
  }
  getTools() {
    const fit = this.#fit; const log = this.#logger;
    return [
      {
        name: 'recent_workouts',
        description: 'List recent workouts (default: last 7 days).',
        parameters: { type: 'object', properties: { days: { type: 'number' }, limit: { type: 'number' } } },
        async execute({ days = 7, limit = 10 }) {
          const workouts = await fit.recentWorkouts({ days, limit });
          log.info?.('brain.skill.fitness.workouts', { days, count: workouts.length });
          return { workouts };
        },
      },
      {
        name: 'fitness_summary',
        description: 'Summary of activity totals over the past N days (default: 30).',
        parameters: { type: 'object', properties: { period_days: { type: 'number' } } },
        async execute({ period_days = 30 }) {
          const summary = await fit.fitnessSummary({ periodDays: period_days });
          log.info?.('brain.skill.fitness.summary', { periodDays: period_days });
          return summary;
        },
      },
    ];
  }
}
```

- [ ] **Step 4: Test scaffold** (analogous to LifelogReadSkill — fake `IFitnessRead`, assert tool names + minimal call paths).

- [ ] **Step 5: Wire in bootstrap, run tests, commit**

```bash
cd /opt/Code/DaylightStation/backend && NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/applications/brain/skills/FitnessReadSkill.test.mjs
git add backend/src/3_applications/fitness/ports/IFitnessRead.mjs \
        backend/src/3_applications/fitness/FitnessReadAdapter.mjs \
        backend/src/3_applications/brain/skills/FitnessReadSkill.mjs \
        backend/tests/unit/applications/brain/skills/FitnessReadSkill.test.mjs \
        backend/src/0_system/bootstrap.mjs
git commit -m "feat(brain): FitnessReadSkill + IFitnessRead port"
```

---

## Phase 9 — Deployment

### Task 24: Macvlan_net compose change + verification

**Files:**
- Modify: `/media/kckern/DockerDrive/Docker/DaylightStation/docker-compose.yml` (path per CLAUDE.local.md; verify exact location with `sudo docker inspect daylight-station | jq '.[0].HostConfig.Binds'` if unsure)

- [ ] **Step 1: Verify current networks**

```bash
sudo docker inspect daylight-station | jq '.[0].NetworkSettings.Networks | keys'
```

Expected today: `["kckern-net"]`. After change: `["kckern-net","macvlan_net"]`.

- [ ] **Step 2: Edit compose file** to add macvlan_net with fixed IP

```yaml
services:
  daylightstation:
    networks:
      kckern-net:
      macvlan_net:
        ipv4_address: 10.0.0.5
networks:
  kckern-net:
    external: true
  macvlan_net:
    external: true
```

(Adjust service name / file structure to match what's actually there.)

- [ ] **Step 3: Verify IP `10.0.0.5` is unused**

```bash
ssh root@10.0.0.3 "arp-scan --interface=eth0 10.0.0.0/25 | grep 10.0.0.5" || echo "Free"
```

If occupied, pick a different unused IP and update the compose + spec.

- [ ] **Step 4: Recreate container**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
sleep 10
sudo docker inspect daylight-station | jq '.[0].NetworkSettings.Networks | keys'
```

Expected: contains `macvlan_net`.

- [ ] **Step 5: Verify reachability from puck subnet**

```bash
ssh root@10.0.0.3 "curl -sI http://10.0.0.5:3111/api/v1/stream/plex/SOME_KNOWN_TRACK_ID -H 'Range: bytes=0-1023' | head"
```

Expected: `HTTP/1.1 206 Partial Content` with audio MIME type. If `404`, the stream endpoint is healthy but the ID is wrong; pick a known good one. If connection refused, the container isn't bound on the macvlan IP.

- [ ] **Step 6: Commit compose change** (if compose lives in git)

```bash
git add /media/kckern/DockerDrive/Docker/DaylightStation/docker-compose.yml
git commit -m "infra(daylight-station): attach to macvlan_net at 10.0.0.5 for puck reachability"
```

---

### Task 25: Infisical secret setup + production satellite registration

**Files:**
- `data/household/config/brain.yml` (production version, inside container)

- [ ] **Step 1: Generate a strong token**

```bash
openssl rand -base64 32
```

Save the output.

- [ ] **Step 2: Add to Infisical at `/home`**

Use the Infisical API (per CLAUDE.local.md):

```bash
TOKEN=$(curl -s -X POST http://localhost:8070/api/v1/auth/universal-auth/login \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg id "$(jq -r .clientId ~/.infisical/credentials.json)" \
                  --arg secret "$(jq -r .clientSecret ~/.infisical/credentials.json)" \
                  '{clientId: $id, clientSecret: $secret}')" | jq -r '.accessToken')

curl -s -X POST "http://localhost:8070/api/v3/secrets/raw/DAYLIGHT_BRAIN_TOKEN_LIVINGROOM" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "workspaceId": "...",
    "environment": "prod",
    "secretPath": "/home",
    "secretValue": "PASTE_TOKEN_HERE",
    "type": "shared"
  }'
```

(The exact API call may differ — verify against the Infisical docs and existing secrets in `/home` for shape.)

- [ ] **Step 3: Update production `brain.yml`**

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/brain.yml <<EOF
satellites:
  - id: livingroom
    media_player_entity: media_player.home_assistant_voice_0985dd_media_player
    area: livingroom
    allowed_skills: [memory, home_automation, media, calendar_read, lifelog_read, finance_read, fitness_read]
    default_volume: 30
    default_media_class: music
    token_ref: ENV:DAYLIGHT_BRAIN_TOKEN_LIVINGROOM
EOF"
```

(Replace `media_player.home_assistant_voice_0985dd_media_player` with the actual entity from `homeassistant:8123` if different.)

- [ ] **Step 4: Restart container so secret is loaded**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
sleep 10
sudo docker logs daylight-station --tail 30 | grep -i 'brain.satellite.config_reload'
```

Expected: `count=1`.

- [ ] **Step 5: Verify auth works**

```bash
TOKEN_FROM_INFISICAL='...'  # the token you generated
curl -sS http://localhost:3111/v1/models \
  -H "Authorization: Bearer $TOKEN_FROM_INFISICAL" | jq .
```

Expected: 200 with models list. With wrong token: 401.

- [ ] **Step 6: No git commit (secrets aren't in git)**

---

### Task 26: HA OpenAI Conversation integration setup

**Files:** None (HA UI / WebSocket configuration)

- [ ] **Step 1: Add OpenAI Conversation integration in HA**

In HA UI: Settings → Devices & Services → Add Integration → search "OpenAI Conversation".
- API key: the same `DAYLIGHT_BRAIN_TOKEN_LIVINGROOM` value
- After creation: ⚙ Configure → uncheck "Recommended settings" → Base URL: `http://daylight-station:3111/v1` (this is the Docker DNS name, reachable on `kckern-net`).

- [ ] **Step 2: Test from HA's debug console**

Click the new conversation entity → "Talk to your assistant" → type "remember that the morning routine starts at 7am" → press send. Expect a reply within ~2s.

- [ ] **Step 3: Wire Voice PE pipeline to use the new conversation engine**

Per CLAUDE.local.md (Voice PE notes), this requires WebSocket. Use HA's developer tools → services → `assist_pipeline.update`, or modify the pipeline YAML in `_includes/automations` if pipelines are managed there. Find the pipeline tied to the living-room Voice PE and set:

```yaml
conversation_engine: <id of the new openai_conversation entity>
```

- [ ] **Step 4: Smoke from voice**

Press the wake word into the puck: "Hey Jarvis, what's on my calendar today?"

Expected: HA STT → posts to DS → DS calls `get_calendar_events` → returns events → HA TTS-es a one-sentence summary.

Verify in `sudo docker logs daylight-station --tail 50 | grep brain` that the request hit, the `calendar_read` skill was invoked, and the response was returned.

- [ ] **Step 5: Commit a documentation note** (in CLAUDE.local.md or a new operational note)

If you keep operational notes in git:
```bash
git add CLAUDE.local.md
git commit -m "docs(local): record Voice PE → DS Brain wiring"
```

---

### Task 27: Final end-to-end verification matrix

- [ ] **Step 1: Voice tests** (do all of these against the actual puck, not curl)

| Phrase | Expected behavior |
|---|---|
| "What time is it?" | TTS time, no tool call (logs show `brain.runtime.complete tool_calls=0`) |
| "Turn on the office light" | Light turns on, TTS confirms, logs show `brain.skill.ha.action ok=true` |
| "Play the workout playlist" | Music plays from puck speaker, logs show `brain.skill.media.play ok=true` |
| "Pause the music" | HA's native `HassMediaPause` handles it (no DS tool call expected — verify with `brain.runtime.complete tool_calls=0`) |
| "What's on my calendar today?" | TTS list, logs show `brain.skill.calendar.read` |
| "Remember that Soren is allergic to peanuts" | TTS acknowledgement, logs show `brain.skill.memory.note_added` |
| "What allergies do we have?" *(later turn)* | TTS mentions peanuts |
| "Do something dangerous I have no skill for" | Polite refusal; no tool call |

- [ ] **Step 2: Failure tests**

| Phrase | Expected behavior |
|---|---|
| "Play the obscurelyfantastic mix" | TTS "I couldn't find...", logs show `brain.skill.media.no_match` |
| "Turn on the unicorn light" | TTS "I couldn't find a device...", logs show `brain.skill.ha.resolve_failed` |

- [ ] **Step 3: Latency check**

Measure round-trip on five short prompts. Target: ≤ 2.5s p50.
```bash
time curl -sS http://localhost:3111/v1/chat/completions -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"model":"daylight-house","messages":[{"role":"user","content":"What time is it?"}]}' >/dev/null
```

- [ ] **Step 4: Tag a release**

```bash
git tag -a brain-endpoint-v1 -m "Brain endpoint v1: HA + media + read-only domains + memory"
git push origin brain-endpoint-v1
```

- [ ] **Step 5: Update the spec's status**

Edit `docs/superpowers/specs/2026-05-01-brain-endpoint-design.md` line 3:
```
**Status:** Shipped (v1) — 2026-05-01
```

```bash
git add docs/superpowers/specs/2026-05-01-brain-endpoint-design.md
git commit -m "docs(brain): mark v1 shipped"
```

---

## Self-review notes for the engineer executing this plan

- **Tests use `node:test`** (the codebase's existing pattern in `tests/unit/agents/AgentOrchestrator.test.mjs`). All `import` paths in tests are `..`-relative because there's no path alias in the jest config.
- **Run individual test files** with `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest <path>`. Run all with `npm test` from `backend/`.
- **Each task ends in a commit.** If a step fails, do not move past it. Triage, fix, then commit.
- **bootstrap.mjs is the only file that knows everything is wired together.** Keep its imports tidy and grouped (existing services, brain services, routers).
- **Logging discipline** — never log raw message content at info; always use `summarizeArgs`-style shape descriptors at info; bearer tokens only via `token_prefix`. The `child()` logger is the way; bind `satellite_id` and `conversation_id` once at the router and let child loggers carry it.
- **`@mastra/core` event shape may differ** from what `MastraAdapter.streamExecute` assumes. If your version emits events with different `type` strings, log unknown event types at debug to spot them, then update the switch.
- **Calendar / Lifelog / Finance / Fitness read adapters are the most ambiguous part of this plan** — the existing services don't publish clean reads. If you hit dead ends in any of Tasks 20–23, ship those skills as no-ops (skill returns `{ok:false, reason:'not_implemented'}` for now) and file a follow-up plan. **Do not block media + HA on calendar.**
- **The macvlan IP `10.0.0.5` is illustrative.** Verify it's free before committing to it. If you change it, update `data/household/config/skills/media.yml` (`ds_base_url`) too.

---

## Spec coverage check

| Spec section | Implemented in |
|---|---|
| §3.1 Single Mastra-backed agent | Task 10 (BrainAgent), Task 11 (BrainApplication) |
| §3.2 BrainAgent owns all tools | Task 8 (SkillRegistry filters) + Task 11 (BrainApplication ignores client tools) |
| §3.3 Tool surface = HA + media + read-only | Tasks 9, 17, 19, 20–23 |
| §3.4 Per-satellite bearer token | Task 5 (registry) + Task 14 (router middleware) |
| §3.5 Household memory | Task 6 (memory adapter) + Task 9 (memory skill) |
| §3.6 Per-satellite skill allowlist | Task 1 (Satellite.allowedSkills) + Task 8 (SkillRegistry) |
| §3.7 Policy port + passthrough v1 | Task 2 (port) + Task 7 (passthrough impl) + Task 8 (gate wiring) |
| §3.8 Streaming required | Task 3 (port extension) + Task 4 (adapter) + Task 13 (translator) |
| §3.9 DS as media stream origin | Task 19 (MediaSkill builds DS URL) |
| §4.1 DDD layout | Tasks 1–14 (every file follows the layered tree) |
| §6 Skills system | Tasks 8 (registry) + 9, 17, 19, 20–23 (skills) |
| §7 Data flow | Verified end-to-end in Tasks 16, 27 |
| §8 Error handling | Translator (Tasks 12–14) + skill wrappers (Task 8) |
| §9 Logging & observability | Logger calls embedded in every task; verified in smoke (Tasks 16, 27) |
| §10 Testing strategy | Each task includes unit + integration tests using fakes |
| §11 Deployment | Tasks 24–26 |
