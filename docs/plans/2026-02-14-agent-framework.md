# Agent Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build generic agent infrastructure (BaseAgent, ToolFactory, WorkingMemory, Assignment, OutputValidator, Scheduler) that the health coach agent and all future agents build on.

**Architecture:** Six framework components in `3_applications/agents/framework/`, one persistence adapter in `1_adapters/agents/`, extensions to the existing AgentOrchestrator and agents API router. TDD throughout — tests use `node:test` with `assert`, mocks for agentRuntime/logger/DataService.

**Tech Stack:** Node.js (ESM), `node:test`, `ajv` (JSON Schema validation), `node-cron` (scheduling), `yaml` (already installed), DataService (existing YAML read/write)

**Design spec:** `docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md` — Agent Framework section (line ~475)

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install ajv and node-cron**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npm install ajv node-cron`

Expected: Both packages added to `dependencies` in `package.json`

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ajv and node-cron dependencies for agent framework"
```

---

### Task 2: WorkingMemoryState

**Files:**
- Create: `backend/src/3_applications/agents/framework/WorkingMemory.mjs`
- Test: `backend/tests/unit/agents/framework/WorkingMemoryState.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/framework/WorkingMemoryState.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('WorkingMemoryState', () => {
  let memory;

  beforeEach(() => {
    memory = new WorkingMemoryState();
  });

  describe('set/get', () => {
    it('should store and retrieve a value', () => {
      memory.set('key1', 'value1');
      assert.strictEqual(memory.get('key1'), 'value1');
    });

    it('should return undefined for missing key', () => {
      assert.strictEqual(memory.get('nonexistent'), undefined);
    });

    it('should overwrite existing key', () => {
      memory.set('key1', 'old');
      memory.set('key1', 'new');
      assert.strictEqual(memory.get('key1'), 'new');
    });

    it('should store complex values', () => {
      const obj = { nested: { data: [1, 2, 3] } };
      memory.set('complex', obj);
      assert.deepStrictEqual(memory.get('complex'), obj);
    });
  });

  describe('TTL expiry', () => {
    it('should return value before TTL expires', () => {
      memory.set('temp', 'data', { ttl: 60000 });
      assert.strictEqual(memory.get('temp'), 'data');
    });

    it('should return undefined after TTL expires', () => {
      // Set with TTL of 0ms (already expired)
      memory.set('temp', 'data', { ttl: 0 });
      // Need a tiny delay for Date.now() to advance past expiresAt
      assert.strictEqual(memory.get('temp'), undefined);
    });

    it('should persist entries without TTL indefinitely', () => {
      memory.set('permanent', 'stays');
      // No TTL = no expiry
      assert.strictEqual(memory.get('permanent'), 'stays');
    });
  });

  describe('remove', () => {
    it('should remove an existing key', () => {
      memory.set('key1', 'value1');
      memory.remove('key1');
      assert.strictEqual(memory.get('key1'), undefined);
    });

    it('should not throw when removing nonexistent key', () => {
      assert.doesNotThrow(() => memory.remove('nonexistent'));
    });
  });

  describe('getAll', () => {
    it('should return all non-expired entries', () => {
      memory.set('a', 1);
      memory.set('b', 2);
      memory.set('expired', 3, { ttl: 0 });
      const all = memory.getAll();
      assert.deepStrictEqual(all, { a: 1, b: 2 });
    });

    it('should return empty object when empty', () => {
      assert.deepStrictEqual(memory.getAll(), {});
    });
  });

  describe('serialize', () => {
    it('should return "(empty)" when no entries', () => {
      assert.strictEqual(memory.serialize(), '(empty)');
    });

    it('should group persistent and expiring entries', () => {
      memory.set('permanent', 'stays');
      memory.set('temp', 'goes', { ttl: 60000 });
      const serialized = memory.serialize();
      assert.ok(serialized.includes('### Persistent'));
      assert.ok(serialized.includes('### Expiring'));
      assert.ok(serialized.includes('permanent'));
      assert.ok(serialized.includes('temp'));
    });

    it('should omit section header when no entries of that type', () => {
      memory.set('only_permanent', 'value');
      const serialized = memory.serialize();
      assert.ok(serialized.includes('### Persistent'));
      assert.ok(!serialized.includes('### Expiring'));
    });
  });

  describe('pruneExpired', () => {
    it('should remove expired entries', () => {
      memory.set('expired1', 'a', { ttl: 0 });
      memory.set('expired2', 'b', { ttl: 0 });
      memory.set('alive', 'c', { ttl: 60000 });
      memory.pruneExpired();
      assert.strictEqual(memory.get('expired1'), undefined);
      assert.strictEqual(memory.get('expired2'), undefined);
      assert.strictEqual(memory.get('alive'), 'c');
    });
  });

  describe('toJSON / fromJSON', () => {
    it('should round-trip through JSON serialization', () => {
      memory.set('persistent', 'value1');
      memory.set('expiring', 'value2', { ttl: 60000 });

      const json = memory.toJSON();
      const restored = WorkingMemoryState.fromJSON(json);

      assert.strictEqual(restored.get('persistent'), 'value1');
      assert.strictEqual(restored.get('expiring'), 'value2');
    });

    it('should prune expired entries on toJSON', () => {
      memory.set('expired', 'gone', { ttl: 0 });
      memory.set('alive', 'here');
      const json = memory.toJSON();
      assert.ok(!json.expired);
      assert.ok(json.alive);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/framework/WorkingMemoryState.test.mjs`

Expected: FAIL — cannot find module `WorkingMemory.mjs`

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/framework/WorkingMemory.mjs

/**
 * WorkingMemoryState - In-memory key-value store with optional TTL per entry.
 *
 * Entries without TTL persist until explicitly removed.
 * Entries with TTL are lazily pruned on read.
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — WorkingMemory section
 */
export class WorkingMemoryState {
  #entries = new Map(); // key → { value, createdAt, expiresAt }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, { ttl } = {}) {
    this.#entries.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt: ttl != null ? Date.now() + ttl : null,
    });
  }

  remove(key) {
    this.#entries.delete(key);
  }

  getAll() {
    this.#pruneExpired();
    return Object.fromEntries(
      [...this.#entries.entries()].map(([k, v]) => [k, v.value])
    );
  }

  serialize() {
    this.#pruneExpired();
    if (!this.#entries.size) return '(empty)';

    const persistent = [];
    const expiring = [];

    for (const [key, entry] of this.#entries) {
      const line = `- **${key}**: ${JSON.stringify(entry.value)}`;
      if (entry.expiresAt) expiring.push(line);
      else persistent.push(line);
    }

    const sections = [];
    if (persistent.length) sections.push('### Persistent\n' + persistent.join('\n'));
    if (expiring.length) sections.push('### Expiring\n' + expiring.join('\n'));
    return sections.join('\n\n');
  }

  pruneExpired() {
    this.#pruneExpired();
  }

  #pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt && now >= entry.expiresAt) this.#entries.delete(key);
    }
  }

  toJSON() {
    this.#pruneExpired();
    return Object.fromEntries(
      [...this.#entries.entries()].map(([k, v]) => [k, v])
    );
  }

  static fromJSON(data) {
    const state = new WorkingMemoryState();
    for (const [key, entry] of Object.entries(data)) {
      state.#entries.set(key, entry);
    }
    return state;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test backend/tests/unit/agents/framework/WorkingMemoryState.test.mjs`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/WorkingMemory.mjs backend/tests/unit/agents/framework/WorkingMemoryState.test.mjs
git commit -m "feat(agents): add WorkingMemoryState with TTL-based expiry"
```

---

### Task 3: IWorkingMemory port

**Files:**
- Create: `backend/src/3_applications/agents/framework/ports/IWorkingMemory.mjs`

**Step 1: Write the port interface**

```javascript
// backend/src/3_applications/agents/framework/ports/IWorkingMemory.mjs

/**
 * Port interface for working memory persistence (framework-agnostic)
 * @interface IWorkingMemory
 *
 * Implementations handle storage (YAML files, database, etc).
 * The application layer uses this to load/save WorkingMemoryState.
 */
export const IWorkingMemory = {
  /**
   * Load working memory state for an agent + user
   * @param {string} agentId - Agent identifier
   * @param {string} userId - User identifier
   * @returns {Promise<WorkingMemoryState>} Hydrated state (empty if no prior state)
   */
  async load(agentId, userId) {},

  /**
   * Save working memory state for an agent + user
   * @param {string} agentId - Agent identifier
   * @param {string} userId - User identifier
   * @param {WorkingMemoryState} state - State to persist
   * @returns {Promise<void>}
   */
  async save(agentId, userId, state) {},
};

/**
 * Type guard for IWorkingMemory
 * @param {any} obj
 * @returns {boolean}
 */
export function isWorkingMemoryStore(obj) {
  return obj && typeof obj.load === 'function' && typeof obj.save === 'function';
}
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/framework/ports/IWorkingMemory.mjs
git commit -m "feat(agents): add IWorkingMemory port interface"
```

---

### Task 4: YamlWorkingMemoryAdapter

**Files:**
- Create: `backend/src/1_adapters/agents/YamlWorkingMemoryAdapter.mjs`
- Test: `backend/tests/unit/agents/framework/YamlWorkingMemoryAdapter.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/framework/YamlWorkingMemoryAdapter.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { YamlWorkingMemoryAdapter } from '../../../../src/1_adapters/agents/YamlWorkingMemoryAdapter.mjs';

describe('YamlWorkingMemoryAdapter', () => {
  let adapter;
  let mockDataService;
  let storedData;

  beforeEach(() => {
    storedData = {};

    mockDataService = {
      user: {
        read(relativePath, username) {
          return storedData[`${username}:${relativePath}`] || null;
        },
        write(relativePath, data, username) {
          storedData[`${username}:${relativePath}`] = data;
          return true;
        },
      },
    };

    adapter = new YamlWorkingMemoryAdapter({ dataService: mockDataService });
  });

  describe('load', () => {
    it('should return empty WorkingMemoryState when no file exists', async () => {
      const state = await adapter.load('health-coach', 'kevin');
      assert.deepStrictEqual(state.getAll(), {});
    });

    it('should hydrate state from stored data', async () => {
      storedData['kevin:agents/health-coach/working-memory'] = {
        coaching_style: {
          value: 'direct feedback',
          createdAt: Date.now(),
          expiresAt: null,
        },
      };

      const state = await adapter.load('health-coach', 'kevin');
      assert.strictEqual(state.get('coaching_style'), 'direct feedback');
    });

    it('should prune expired entries on load', async () => {
      storedData['kevin:agents/health-coach/working-memory'] = {
        expired_item: {
          value: 'gone',
          createdAt: Date.now() - 120000,
          expiresAt: Date.now() - 60000,
        },
        alive_item: {
          value: 'here',
          createdAt: Date.now(),
          expiresAt: null,
        },
      };

      const state = await adapter.load('health-coach', 'kevin');
      assert.strictEqual(state.get('expired_item'), undefined);
      assert.strictEqual(state.get('alive_item'), 'here');
    });
  });

  describe('save', () => {
    it('should persist state via DataService', async () => {
      const state = await adapter.load('health-coach', 'kevin');
      state.set('my_key', 'my_value');

      await adapter.save('health-coach', 'kevin', state);

      const saved = storedData['kevin:agents/health-coach/working-memory'];
      assert.ok(saved);
      assert.strictEqual(saved.my_key.value, 'my_value');
    });
  });

  describe('constructor', () => {
    it('should throw if dataService is not provided', () => {
      assert.throws(
        () => new YamlWorkingMemoryAdapter({}),
        /dataService is required/
      );
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/framework/YamlWorkingMemoryAdapter.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/1_adapters/agents/YamlWorkingMemoryAdapter.mjs

import { WorkingMemoryState } from '#apps/agents/framework/WorkingMemory.mjs';

/**
 * YamlWorkingMemoryAdapter - Persists WorkingMemoryState via DataService YAML files.
 *
 * Storage path: data/household/users/{userId}/agents/{agentId}/working-memory.yml
 *
 * Implements IWorkingMemory port.
 * @see backend/src/3_applications/agents/framework/ports/IWorkingMemory.mjs
 */
export class YamlWorkingMemoryAdapter {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    if (!dataService) {
      throw new Error('dataService is required');
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  /**
   * @param {string} agentId
   * @param {string} userId
   * @returns {Promise<WorkingMemoryState>}
   */
  async load(agentId, userId) {
    const relativePath = `agents/${agentId}/working-memory`;
    const data = this.#dataService.user.read(relativePath, userId);

    if (!data) {
      this.#logger.info?.('workingMemory.load.empty', { agentId, userId });
      return new WorkingMemoryState();
    }

    const state = WorkingMemoryState.fromJSON(data);
    state.pruneExpired();

    this.#logger.info?.('workingMemory.load.ok', {
      agentId,
      userId,
      entryCount: Object.keys(state.getAll()).length,
    });

    return state;
  }

  /**
   * @param {string} agentId
   * @param {string} userId
   * @param {WorkingMemoryState} state
   * @returns {Promise<void>}
   */
  async save(agentId, userId, state) {
    const relativePath = `agents/${agentId}/working-memory`;
    const data = state.toJSON();

    this.#dataService.user.write(relativePath, data, userId);

    this.#logger.info?.('workingMemory.save.ok', {
      agentId,
      userId,
      entryCount: Object.keys(data).length,
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test backend/tests/unit/agents/framework/YamlWorkingMemoryAdapter.test.mjs`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/agents/YamlWorkingMemoryAdapter.mjs backend/tests/unit/agents/framework/YamlWorkingMemoryAdapter.test.mjs
git commit -m "feat(agents): add YamlWorkingMemoryAdapter for memory persistence"
```

---

### Task 5: ToolFactory

**Files:**
- Create: `backend/src/3_applications/agents/framework/ToolFactory.mjs`
- Test: `backend/tests/unit/agents/framework/ToolFactory.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/framework/ToolFactory.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ToolFactory } from '../../../../src/3_applications/agents/framework/ToolFactory.mjs';
import { createTool } from '../../../../src/3_applications/agents/ports/ITool.mjs';

describe('ToolFactory', () => {
  it('should throw if createTools is not implemented', () => {
    const factory = new ToolFactory({});
    assert.throws(
      () => factory.createTools(),
      /Subclass must implement/
    );
  });

  it('should allow subclass to create tools from deps', () => {
    class TestToolFactory extends ToolFactory {
      static domain = 'test';

      createTools() {
        return [
          createTool({
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
            execute: async () => ({ result: this.deps.mockValue }),
          }),
        ];
      }
    }

    const factory = new TestToolFactory({ mockValue: 42 });
    const tools = factory.createTools();

    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0].name, 'test_tool');
  });

  it('should expose static domain on subclass', () => {
    class HealthFactory extends ToolFactory {
      static domain = 'health';
      createTools() { return []; }
    }

    assert.strictEqual(HealthFactory.domain, 'health');
  });

  it('should pass deps through to tool execute functions', async () => {
    class ServiceFactory extends ToolFactory {
      static domain = 'service';

      createTools() {
        const { myService } = this.deps;
        return [
          createTool({
            name: 'call_service',
            description: 'Calls a service',
            parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
            execute: async ({ input }) => myService.process(input),
          }),
        ];
      }
    }

    const mockService = { process: (x) => `processed: ${x}` };
    const factory = new ServiceFactory({ myService: mockService });
    const tools = factory.createTools();
    const result = await tools[0].execute({ input: 'hello' });

    assert.strictEqual(result, 'processed: hello');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/framework/ToolFactory.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/framework/ToolFactory.mjs

/**
 * ToolFactory - Base class for grouped tool creation by domain.
 *
 * Subclasses receive domain service dependencies at construction
 * and produce ITool[] via createTools().
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — ToolFactory section
 */
export class ToolFactory {
  static domain; // subclass sets: 'health', 'fitness-content'

  constructor(deps) {
    this.deps = deps;
  }

  createTools() {
    throw new Error('Subclass must implement createTools()');
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test backend/tests/unit/agents/framework/ToolFactory.test.mjs`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/ToolFactory.mjs backend/tests/unit/agents/framework/ToolFactory.test.mjs
git commit -m "feat(agents): add ToolFactory base class"
```

---

### Task 6: OutputValidator

**Files:**
- Create: `backend/src/3_applications/agents/framework/OutputValidator.mjs`
- Test: `backend/tests/unit/agents/framework/OutputValidator.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/framework/OutputValidator.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { OutputValidator } from '../../../../src/3_applications/agents/framework/OutputValidator.mjs';

const testSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    score: { type: 'number' },
  },
  required: ['title', 'score'],
};

describe('OutputValidator', () => {
  describe('validate', () => {
    it('should return valid for correct object', () => {
      const result = OutputValidator.validate({ title: 'test', score: 5 }, testSchema);
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.data, { title: 'test', score: 5 });
      assert.deepStrictEqual(result.errors, []);
    });

    it('should return valid for correct JSON string', () => {
      const result = OutputValidator.validate('{"title":"test","score":5}', testSchema);
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.data, { title: 'test', score: 5 });
    });

    it('should return invalid for missing required field', () => {
      const result = OutputValidator.validate({ title: 'test' }, testSchema);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.data, null);
      assert.ok(result.errors.length > 0);
    });

    it('should return invalid for wrong type', () => {
      const result = OutputValidator.validate({ title: 'test', score: 'not a number' }, testSchema);
      assert.strictEqual(result.valid, false);
    });

    it('should return invalid for unparseable string', () => {
      const result = OutputValidator.validate('not json at all', testSchema);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].message.includes('not valid JSON'));
    });
  });

  describe('validateWithRetry', () => {
    it('should return valid on first try if output is correct', async () => {
      const result = await OutputValidator.validateWithRetry(
        { title: 'test', score: 5 },
        testSchema,
        { agentRuntime: null, systemPrompt: '', tools: [], logger: null }
      );
      assert.strictEqual(result.valid, true);
    });

    it('should retry and succeed when LLM corrects output', async () => {
      let callCount = 0;
      const mockRuntime = {
        execute: async () => {
          callCount++;
          return { output: { title: 'fixed', score: 10 } };
        },
      };

      const result = await OutputValidator.validateWithRetry(
        { title: 'test' }, // missing score
        testSchema,
        { agentRuntime: mockRuntime, systemPrompt: 'fix it', tools: [], maxRetries: 2, logger: null }
      );

      assert.strictEqual(result.valid, true);
      assert.strictEqual(callCount, 1);
      assert.deepStrictEqual(result.data, { title: 'fixed', score: 10 });
    });

    it('should return invalid after exhausting retries', async () => {
      const mockRuntime = {
        execute: async () => {
          return { output: { title: 'still broken' } }; // still missing score
        },
      };

      const result = await OutputValidator.validateWithRetry(
        { title: 'bad' }, // missing score
        testSchema,
        { agentRuntime: mockRuntime, systemPrompt: '', tools: [], maxRetries: 2, logger: null }
      );

      assert.strictEqual(result.valid, false);
    });

    it('should not retry if maxRetries is 0', async () => {
      let callCount = 0;
      const mockRuntime = {
        execute: async () => { callCount++; return { output: {} }; },
      };

      await OutputValidator.validateWithRetry(
        { bad: true },
        testSchema,
        { agentRuntime: mockRuntime, systemPrompt: '', tools: [], maxRetries: 0, logger: null }
      );

      assert.strictEqual(callCount, 0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/framework/OutputValidator.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/framework/OutputValidator.mjs

import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

/**
 * OutputValidator - JSON Schema validation with LLM self-correction retry.
 *
 * Used by Assignment between the reason and act phases.
 * Structural validation is handled here; domain validation (e.g., content ID existence)
 * stays in the assignment's validate() method.
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — OutputValidator section
 */
export class OutputValidator {
  /**
   * Validate output against JSON Schema.
   * @param {any} output - Raw LLM output (string or object)
   * @param {Object} schema - JSON Schema
   * @returns {{ valid: boolean, data: any, errors: Array }}
   */
  static validate(output, schema) {
    let parsed;
    try {
      parsed = typeof output === 'string' ? JSON.parse(output) : output;
    } catch (e) {
      return {
        valid: false,
        data: null,
        errors: [{ message: 'Output is not valid JSON', raw: output }],
      };
    }

    const validate = ajv.compile(schema);
    const valid = validate(parsed);
    return {
      valid,
      data: valid ? parsed : null,
      errors: valid ? [] : validate.errors,
    };
  }

  /**
   * Validate with retry — feeds validation errors back to the LLM for self-correction.
   * @param {any} output - Raw LLM output
   * @param {Object} schema - JSON Schema
   * @param {Object} opts
   * @param {Object} opts.agentRuntime - IAgentRuntime implementation
   * @param {string} opts.systemPrompt - Agent system prompt
   * @param {Array} opts.tools - Available tools
   * @param {number} [opts.maxRetries=2] - Max correction attempts
   * @param {Object} [opts.logger] - Logger
   * @returns {Promise<{ valid: boolean, data: any, errors: Array }>}
   */
  static async validateWithRetry(output, schema, { agentRuntime, systemPrompt, tools, maxRetries = 2, logger }) {
    let result = OutputValidator.validate(output, schema);
    let attempts = 0;

    while (!result.valid && attempts < maxRetries) {
      attempts++;
      logger?.warn?.('output.validation.retry', { attempt: attempts, errors: result.errors });

      const correctionPrompt =
        `Your previous output failed validation.\n\n` +
        `## Errors\n${JSON.stringify(result.errors, null, 2)}\n\n` +
        `## Your Previous Output\n${JSON.stringify(output)}\n\n` +
        `Fix the errors and return valid output.`;

      const retryResult = await agentRuntime.execute({
        input: correctionPrompt,
        tools,
        systemPrompt,
      });

      output = retryResult.output;
      result = OutputValidator.validate(output, schema);
    }

    return result;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test backend/tests/unit/agents/framework/OutputValidator.test.mjs`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/OutputValidator.mjs backend/tests/unit/agents/framework/OutputValidator.test.mjs
git commit -m "feat(agents): add OutputValidator with JSON Schema validation and LLM retry"
```

---

### Task 7: Assignment

**Files:**
- Create: `backend/src/3_applications/agents/framework/Assignment.mjs`
- Test: `backend/tests/unit/agents/framework/Assignment.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/framework/Assignment.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Assignment } from '../../../../src/3_applications/agents/framework/Assignment.mjs';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('Assignment', () => {
  describe('base class', () => {
    it('should throw if subclass methods are not implemented', async () => {
      const assignment = new Assignment();
      await assert.rejects(() => assignment.gather({}), /implement/);
      assert.throws(() => assignment.buildPrompt(), /implement/);
      assert.throws(() => assignment.getOutputSchema(), /implement/);
      await assert.rejects(() => assignment.validate(), /implement/);
      await assert.rejects(() => assignment.act(), /implement/);
    });
  });

  describe('execute lifecycle', () => {
    it('should call phases in order: load → gather → prompt → reason → validate → act → save', async () => {
      const callOrder = [];

      class TestAssignment extends Assignment {
        static id = 'test-assignment';

        async gather({ tools, userId, memory }) {
          callOrder.push('gather');
          return { data: 'gathered' };
        }

        buildPrompt(gathered, memory) {
          callOrder.push('buildPrompt');
          return `Process: ${JSON.stringify(gathered)}`;
        }

        getOutputSchema() {
          return { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] };
        }

        async validate(raw) {
          callOrder.push('validate');
          return raw.output;
        }

        async act(validated, { memory }) {
          callOrder.push('act');
          memory.set('acted', true);
        }
      }

      const mockMemoryState = new WorkingMemoryState();
      const mockWorkingMemory = {
        load: async () => { callOrder.push('load'); return mockMemoryState; },
        save: async () => { callOrder.push('save'); },
      };

      const mockRuntime = {
        execute: async ({ input }) => {
          callOrder.push('reason');
          return { output: { result: 'done' }, toolCalls: [] };
        },
      };

      const assignment = new TestAssignment();
      await assignment.execute({
        agentRuntime: mockRuntime,
        workingMemory: mockWorkingMemory,
        tools: [],
        systemPrompt: 'test',
        agentId: 'test-agent',
        userId: 'kevin',
        context: {},
        logger: { info: () => {} },
      });

      assert.deepStrictEqual(callOrder, ['load', 'gather', 'buildPrompt', 'reason', 'validate', 'act', 'save']);
    });

    it('should pass gathered data to buildPrompt', async () => {
      let capturedGathered;

      class TestAssignment extends Assignment {
        static id = 'test';
        async gather() { return { items: [1, 2, 3] }; }
        buildPrompt(gathered) { capturedGathered = gathered; return 'prompt'; }
        getOutputSchema() { return { type: 'object' }; }
        async validate(raw) { return raw.output; }
        async act() {}
      }

      const assignment = new TestAssignment();
      await assignment.execute({
        agentRuntime: { execute: async () => ({ output: {}, toolCalls: [] }) },
        workingMemory: {
          load: async () => new WorkingMemoryState(),
          save: async () => {},
        },
        tools: [],
        systemPrompt: '',
        agentId: 'test',
        userId: 'user',
        context: {},
        logger: { info: () => {} },
      });

      assert.deepStrictEqual(capturedGathered, { items: [1, 2, 3] });
    });

    it('should save memory after act phase', async () => {
      let savedState;

      class TestAssignment extends Assignment {
        static id = 'test';
        async gather() { return {}; }
        buildPrompt() { return 'prompt'; }
        getOutputSchema() { return { type: 'object' }; }
        async validate(raw) { return raw.output; }
        async act(validated, { memory }) {
          memory.set('written_in_act', 'yes');
        }
      }

      const assignment = new TestAssignment();
      await assignment.execute({
        agentRuntime: { execute: async () => ({ output: {}, toolCalls: [] }) },
        workingMemory: {
          load: async () => new WorkingMemoryState(),
          save: async (agentId, userId, state) => { savedState = state; },
        },
        tools: [],
        systemPrompt: '',
        agentId: 'test',
        userId: 'user',
        context: {},
        logger: { info: () => {} },
      });

      assert.strictEqual(savedState.get('written_in_act'), 'yes');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/framework/Assignment.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/framework/Assignment.mjs

/**
 * Assignment - Base class for structured multi-step agent workflows.
 *
 * Template method pattern: gather → buildPrompt → reason → validate → act
 * Memory load/save is handled by the framework (this base class).
 * Subclasses implement the five phase methods.
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — Assignment section
 */
export class Assignment {
  static id;
  static description;
  static schedule; // cron expression, used by Scheduler

  /**
   * Execute the assignment lifecycle.
   * @param {Object} deps
   * @param {Object} deps.agentRuntime - IAgentRuntime implementation
   * @param {Object} deps.workingMemory - IWorkingMemory implementation
   * @param {Array} deps.tools - ITool[] available to the agent
   * @param {string} deps.systemPrompt - Agent system prompt
   * @param {string} deps.agentId - Agent identifier
   * @param {string} deps.userId - User identifier
   * @param {Object} deps.context - Execution context
   * @param {Object} deps.logger - Logger
   * @returns {Promise<any>} Validated output
   */
  async execute({ agentRuntime, workingMemory, tools, systemPrompt, agentId, userId, context, logger }) {
    // 1. Load memory
    const memory = await workingMemory.load(agentId, userId);
    memory.pruneExpired();

    // 2. Gather — programmatic data collection
    const gathered = await this.gather({ tools, userId, memory, logger });

    // 3. Build prompt — context engineering
    const prompt = this.buildPrompt(gathered, memory);

    // 4. Reason — LLM call
    const raw = await agentRuntime.execute({
      input: prompt,
      tools,
      systemPrompt,
      context: { userId, ...context },
    });

    // 5. Validate — schema + domain checks
    const validated = await this.validate(raw, gathered, logger);

    // 6. Act — write output, update memory
    await this.act(validated, { memory, userId, logger });

    // 7. Save memory
    await workingMemory.save(agentId, userId, memory);

    logger.info?.('assignment.complete', {
      agentId,
      assignmentId: this.constructor.id,
      userId,
    });

    return validated;
  }

  // --- Subclass contract ---
  async gather(deps) { throw new Error('Subclass must implement gather()'); }
  buildPrompt(gathered, memory) { throw new Error('Subclass must implement buildPrompt()'); }
  getOutputSchema() { throw new Error('Subclass must implement getOutputSchema()'); }
  async validate(raw, gathered, logger) { throw new Error('Subclass must implement validate()'); }
  async act(validated, deps) { throw new Error('Subclass must implement act()'); }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test backend/tests/unit/agents/framework/Assignment.test.mjs`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/Assignment.mjs backend/tests/unit/agents/framework/Assignment.test.mjs
git commit -m "feat(agents): add Assignment base class with lifecycle template method"
```

---

### Task 8: BaseAgent

**Files:**
- Create: `backend/src/3_applications/agents/framework/BaseAgent.mjs`
- Test: `backend/tests/unit/agents/framework/BaseAgent.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/framework/BaseAgent.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { BaseAgent } from '../../../../src/3_applications/agents/framework/BaseAgent.mjs';
import { ToolFactory } from '../../../../src/3_applications/agents/framework/ToolFactory.mjs';
import { createTool } from '../../../../src/3_applications/agents/ports/ITool.mjs';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('BaseAgent', () => {
  let mockRuntime;
  let mockWorkingMemory;
  let mockLogger;

  beforeEach(() => {
    mockRuntime = {
      execute: async ({ input, systemPrompt }) => ({
        output: `response to: ${input}`,
        toolCalls: [],
      }),
      executeInBackground: async () => ({ taskId: 'bg-1' }),
    };

    mockWorkingMemory = {
      load: async () => new WorkingMemoryState(),
      save: async () => {},
    };

    mockLogger = { info: () => {}, error: () => {}, warn: () => {} };
  });

  describe('constructor', () => {
    it('should throw if agentRuntime is not provided', () => {
      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'test'; }
        registerTools() {}
      }
      assert.throws(
        () => new TestAgent({ workingMemory: mockWorkingMemory, logger: mockLogger }),
        /agentRuntime is required/
      );
    });

    it('should throw if workingMemory is not provided', () => {
      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'test'; }
        registerTools() {}
      }
      assert.throws(
        () => new TestAgent({ agentRuntime: mockRuntime, logger: mockLogger }),
        /workingMemory is required/
      );
    });
  });

  describe('getTools', () => {
    it('should aggregate tools from multiple factories', () => {
      class FactoryA extends ToolFactory {
        static domain = 'a';
        createTools() {
          return [createTool({ name: 'tool_a', description: 'A', parameters: { type: 'object', properties: {} }, execute: async () => 'a' })];
        }
      }

      class FactoryB extends ToolFactory {
        static domain = 'b';
        createTools() {
          return [createTool({ name: 'tool_b', description: 'B', parameters: { type: 'object', properties: {} }, execute: async () => 'b' })];
        }
      }

      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'test'; }
        registerTools() {
          this.addToolFactory(new FactoryA({}));
          this.addToolFactory(new FactoryB({}));
        }
      }

      const agent = new TestAgent({ agentRuntime: mockRuntime, workingMemory: mockWorkingMemory, logger: mockLogger });
      const tools = agent.getTools();

      assert.strictEqual(tools.length, 2);
      assert.ok(tools.find(t => t.name === 'tool_a'));
      assert.ok(tools.find(t => t.name === 'tool_b'));
    });
  });

  describe('run (freeform)', () => {
    it('should call agentRuntime.execute with assembled prompt', async () => {
      let capturedOptions;

      const trackingRuntime = {
        ...mockRuntime,
        execute: async (options) => {
          capturedOptions = options;
          return { output: 'response', toolCalls: [] };
        },
      };

      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'You are a test agent.'; }
        registerTools() {}
      }

      const agent = new TestAgent({ agentRuntime: trackingRuntime, workingMemory: mockWorkingMemory, logger: mockLogger });
      await agent.run('hello', { userId: 'kevin' });

      assert.strictEqual(capturedOptions.input, 'hello');
      assert.ok(capturedOptions.systemPrompt.includes('You are a test agent.'));
    });

    it('should load and save memory when userId is provided', async () => {
      let loadCalled = false;
      let saveCalled = false;

      const trackingMemory = {
        load: async () => { loadCalled = true; return new WorkingMemoryState(); },
        save: async () => { saveCalled = true; },
      };

      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'test'; }
        registerTools() {}
      }

      const agent = new TestAgent({ agentRuntime: mockRuntime, workingMemory: trackingMemory, logger: mockLogger });
      await agent.run('hello', { userId: 'kevin' });

      assert.ok(loadCalled);
      assert.ok(saveCalled);
    });

    it('should skip memory when userId is not provided', async () => {
      let loadCalled = false;

      const trackingMemory = {
        load: async () => { loadCalled = true; return new WorkingMemoryState(); },
        save: async () => {},
      };

      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'test'; }
        registerTools() {}
      }

      const agent = new TestAgent({ agentRuntime: mockRuntime, workingMemory: trackingMemory, logger: mockLogger });
      await agent.run('hello');

      assert.strictEqual(loadCalled, false);
    });
  });

  describe('assignments', () => {
    it('should register and run an assignment', async () => {
      let assignmentExecuted = false;

      const mockAssignment = {
        id: 'test-assignment',
        constructor: { id: 'test-assignment' },
        execute: async (deps) => {
          assignmentExecuted = true;
          return { result: 'done' };
        },
      };

      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'test'; }
        registerTools() {}
      }

      const agent = new TestAgent({ agentRuntime: mockRuntime, workingMemory: mockWorkingMemory, logger: mockLogger });
      agent.registerAssignment(mockAssignment);

      const result = await agent.runAssignment('test-assignment', { userId: 'kevin' });
      assert.ok(assignmentExecuted);
      assert.deepStrictEqual(result, { result: 'done' });
    });

    it('should throw for unknown assignment', async () => {
      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'test'; }
        registerTools() {}
      }

      const agent = new TestAgent({ agentRuntime: mockRuntime, workingMemory: mockWorkingMemory, logger: mockLogger });

      await assert.rejects(
        () => agent.runAssignment('nonexistent', { userId: 'kevin' }),
        /Unknown assignment: nonexistent/
      );
    });

    it('should list registered assignments via getAssignments', () => {
      const mockAssignment = { id: 'a1', constructor: { id: 'a1' } };

      class TestAgent extends BaseAgent {
        static id = 'test';
        getSystemPrompt() { return 'test'; }
        registerTools() {}
      }

      const agent = new TestAgent({ agentRuntime: mockRuntime, workingMemory: mockWorkingMemory, logger: mockLogger });
      agent.registerAssignment(mockAssignment);

      const assignments = agent.getAssignments();
      assert.strictEqual(assignments.length, 1);
      assert.strictEqual(assignments[0].id, 'a1');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/framework/BaseAgent.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/framework/BaseAgent.mjs

/**
 * BaseAgent - Common agent lifecycle.
 *
 * Handles memory load/save, tool factory aggregation, and assignment dispatch.
 * Subclasses define behavior via getSystemPrompt(), registerTools(), and registerAssignments().
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — BaseAgent section
 */
export class BaseAgent {
  static id;
  static description;

  #agentRuntime;
  #workingMemory;
  #logger;
  #toolFactories = [];
  #assignments = new Map();

  constructor({ agentRuntime, workingMemory, logger = console, ...rest }) {
    if (!agentRuntime) throw new Error('agentRuntime is required');
    if (!workingMemory) throw new Error('workingMemory is required');

    this.#agentRuntime = agentRuntime;
    this.#workingMemory = workingMemory;
    this.#logger = logger;

    // Allow subclasses to store extra deps
    this.deps = rest;

    // Let subclass register tool factories
    this.registerTools();
  }

  // --- Subclass contract ---
  getSystemPrompt() { throw new Error('Subclass must implement getSystemPrompt()'); }
  registerTools() { /* optional — subclass calls addToolFactory() here */ }

  // --- Tool factories ---
  addToolFactory(factory) {
    this.#toolFactories.push(factory);
  }

  getTools() {
    return this.#toolFactories.flatMap(f => f.createTools());
  }

  // --- Freeform run (chat-style) ---
  async run(input, { userId, context = {} } = {}) {
    const memory = userId
      ? await this.#workingMemory.load(this.constructor.id, userId)
      : null;

    const result = await this.#agentRuntime.execute({
      agent: this,
      input,
      tools: this.getTools(),
      systemPrompt: this.#assemblePrompt(memory),
      context: { ...context, userId, memory },
    });

    if (memory) {
      await this.#workingMemory.save(this.constructor.id, userId, memory);
    }

    return result;
  }

  // --- Assignment run (structured workflow) ---
  async runAssignment(assignmentId, { userId, context = {} } = {}) {
    const assignment = this.#assignments.get(assignmentId);
    if (!assignment) throw new Error(`Unknown assignment: ${assignmentId}`);

    return assignment.execute({
      agentRuntime: this.#agentRuntime,
      workingMemory: this.#workingMemory,
      tools: this.getTools(),
      systemPrompt: this.getSystemPrompt(),
      agentId: this.constructor.id,
      userId,
      context,
      logger: this.#logger,
    });
  }

  registerAssignment(assignment) {
    this.#assignments.set(assignment.id, assignment);
  }

  getAssignments() {
    return [...this.#assignments.values()];
  }

  #assemblePrompt(memory) {
    const base = this.getSystemPrompt();
    if (!memory) return base;
    return `${base}\n\n## Working Memory\n${memory.serialize()}`;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test backend/tests/unit/agents/framework/BaseAgent.test.mjs`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/BaseAgent.mjs backend/tests/unit/agents/framework/BaseAgent.test.mjs
git commit -m "feat(agents): add BaseAgent with lifecycle, tools, memory, and assignments"
```

---

### Task 9: Extend AgentOrchestrator

**Files:**
- Modify: `backend/src/3_applications/agents/AgentOrchestrator.mjs`
- Modify: `backend/tests/unit/agents/AgentOrchestrator.test.mjs`

**Step 1: Write the failing tests (append to existing test file)**

Add these tests after the existing `describe('has', ...)` block:

```javascript
  describe('runAssignment', () => {
    it('should delegate to agent.runAssignment', async () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      let capturedArgs;

      class TestAgent {
        static id = 'test';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return 'test'; }
        async run() { return { output: '', toolCalls: [] }; }
        async runAssignment(assignmentId, opts) {
          capturedArgs = { assignmentId, opts };
          return { result: 'assignment done' };
        }
      }

      orchestrator.register(TestAgent, {});
      const result = await orchestrator.runAssignment('test', 'daily-dashboard', { userId: 'kevin' });

      assert.strictEqual(capturedArgs.assignmentId, 'daily-dashboard');
      assert.strictEqual(capturedArgs.opts.userId, 'kevin');
      assert.deepStrictEqual(result, { result: 'assignment done' });
    });

    it('should throw for unknown agent', async () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      await assert.rejects(
        () => orchestrator.runAssignment('nonexistent', 'task', {}),
        /not found/
      );
    });
  });

  describe('listInstances', () => {
    it('should return agent instances', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      class AgentA {
        static id = 'agent-a';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return ''; }
        async run() { return { output: '', toolCalls: [] }; }
      }

      orchestrator.register(AgentA, {});
      const instances = orchestrator.listInstances();

      assert.strictEqual(instances.length, 1);
      assert.strictEqual(instances[0].constructor.id, 'agent-a');
    });
  });
```

**Step 2: Run tests to verify the new tests fail**

Run: `node --test backend/tests/unit/agents/AgentOrchestrator.test.mjs`

Expected: New tests FAIL — `runAssignment` and `listInstances` are not functions

**Step 3: Add runAssignment and listInstances to AgentOrchestrator**

Add these two methods to the existing `AgentOrchestrator` class in `backend/src/3_applications/agents/AgentOrchestrator.mjs`:

```javascript
  /**
   * Run a specific assignment on a registered agent
   * @param {string} agentId - Agent identifier
   * @param {string} assignmentId - Assignment identifier
   * @param {Object} [options={}] - Options including userId, context, triggeredBy
   * @returns {Promise<any>} Assignment result
   */
  async runAssignment(agentId, assignmentId, options = {}) {
    const agent = this.#getAgent(agentId);

    this.#logger.info?.('orchestrator.runAssignment', { agentId, assignmentId });

    return agent.runAssignment(assignmentId, options);
  }

  /**
   * List agent instances (for scheduler registration)
   * @returns {Array<Object>} Agent instances
   */
  listInstances() {
    return Array.from(this.#agents.values());
  }
```

**Step 4: Run tests to verify all pass (including existing tests)**

Run: `node --test backend/tests/unit/agents/AgentOrchestrator.test.mjs`

Expected: All tests PASS (existing + new)

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/AgentOrchestrator.mjs backend/tests/unit/agents/AgentOrchestrator.test.mjs
git commit -m "feat(agents): add runAssignment and listInstances to AgentOrchestrator"
```

---

### Task 10: Scheduler

**Files:**
- Create: `backend/src/3_applications/agents/framework/Scheduler.mjs`
- Test: `backend/tests/unit/agents/framework/Scheduler.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/framework/Scheduler.test.mjs

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Scheduler } from '../../../../src/3_applications/agents/framework/Scheduler.mjs';

describe('Scheduler', () => {
  let scheduler;
  let mockLogger;

  beforeEach(() => {
    mockLogger = { info: () => {}, error: () => {}, warn: () => {} };
    scheduler = new Scheduler({ logger: mockLogger });
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('registerAgent', () => {
    it('should register cron jobs for assignments with schedules', () => {
      const mockAgent = {
        constructor: { id: 'test-agent' },
        getAssignments: () => [
          { constructor: { id: 'daily-task', schedule: '0 4 * * *' } },
        ],
      };

      const mockOrchestrator = {};
      scheduler.registerAgent(mockAgent, mockOrchestrator);

      const jobs = scheduler.list();
      assert.strictEqual(jobs.length, 1);
      assert.strictEqual(jobs[0], 'test-agent:daily-task');
    });

    it('should skip assignments without schedules', () => {
      const mockAgent = {
        constructor: { id: 'test-agent' },
        getAssignments: () => [
          { constructor: { id: 'no-schedule' } }, // no schedule property
        ],
      };

      scheduler.registerAgent(mockAgent, {});
      assert.strictEqual(scheduler.list().length, 0);
    });

    it('should skip invalid cron expressions', () => {
      let errorLogged = false;
      const errorLogger = { ...mockLogger, error: () => { errorLogged = true; } };
      const s = new Scheduler({ logger: errorLogger });

      const mockAgent = {
        constructor: { id: 'test-agent' },
        getAssignments: () => [
          { constructor: { id: 'bad-cron', schedule: 'not a cron' } },
        ],
      };

      s.registerAgent(mockAgent, {});
      assert.strictEqual(s.list().length, 0);
      assert.ok(errorLogged);
      s.stop();
    });

    it('should handle agents with no getAssignments method', () => {
      const mockAgent = { constructor: { id: 'legacy' } };
      assert.doesNotThrow(() => scheduler.registerAgent(mockAgent, {}));
      assert.strictEqual(scheduler.list().length, 0);
    });
  });

  describe('trigger', () => {
    it('should call orchestrator.runAssignment for manual trigger', async () => {
      let capturedArgs;
      const mockOrchestrator = {
        runAssignment: async (agentId, assignmentId, opts) => {
          capturedArgs = { agentId, assignmentId, opts };
          return { result: 'triggered' };
        },
      };

      const result = await scheduler.trigger('my-agent:my-task', mockOrchestrator);

      assert.strictEqual(capturedArgs.agentId, 'my-agent');
      assert.strictEqual(capturedArgs.assignmentId, 'my-task');
      assert.strictEqual(capturedArgs.opts.triggeredBy, 'manual');
    });
  });

  describe('stop', () => {
    it('should clear all registered jobs', () => {
      const mockAgent = {
        constructor: { id: 'test' },
        getAssignments: () => [
          { constructor: { id: 'job1', schedule: '0 * * * *' } },
        ],
      };

      scheduler.registerAgent(mockAgent, {});
      assert.strictEqual(scheduler.list().length, 1);

      scheduler.stop();
      assert.strictEqual(scheduler.list().length, 0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test backend/tests/unit/agents/framework/Scheduler.test.mjs`

Expected: FAIL — cannot find module

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/framework/Scheduler.mjs

import cron from 'node-cron';

/**
 * Scheduler - In-process cron that triggers agent assignments on configured schedules.
 *
 * The scheduler triggers assignments; multi-user fan-out is the assignment's responsibility.
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — Scheduler section
 */
export class Scheduler {
  #jobs = new Map();
  #logger;

  constructor({ logger = console }) {
    this.#logger = logger;
  }

  /**
   * Scan an agent's assignments and register cron jobs.
   * @param {Object} agent - Agent instance with getAssignments()
   * @param {Object} orchestrator - AgentOrchestrator instance
   */
  registerAgent(agent, orchestrator) {
    const assignments = agent.getAssignments?.() || [];

    for (const assignment of assignments) {
      if (!assignment.constructor.schedule) continue;

      const jobKey = `${agent.constructor.id}:${assignment.constructor.id}`;
      const cronExpr = assignment.constructor.schedule;

      if (!cron.validate(cronExpr)) {
        this.#logger.error?.('scheduler.invalid_cron', { jobKey, cronExpr });
        continue;
      }

      const job = cron.schedule(cronExpr, async () => {
        this.#logger.info?.('scheduler.trigger', { jobKey });
        try {
          await orchestrator.runAssignment(
            agent.constructor.id,
            assignment.constructor.id,
            { triggeredBy: 'scheduler' }
          );
        } catch (err) {
          this.#logger.error?.('scheduler.failed', { jobKey, error: err.message });
        }
      });

      this.#jobs.set(jobKey, job);
      this.#logger.info?.('scheduler.registered', { jobKey, cronExpr });
    }
  }

  /**
   * Manual trigger for testing and ad-hoc runs.
   * @param {string} jobKey - Format: "agentId:assignmentId"
   * @param {Object} orchestrator - AgentOrchestrator instance
   * @returns {Promise<any>} Assignment result
   */
  async trigger(jobKey, orchestrator) {
    const [agentId, assignmentId] = jobKey.split(':');
    return orchestrator.runAssignment(agentId, assignmentId, { triggeredBy: 'manual' });
  }

  /**
   * Stop all cron jobs.
   */
  stop() {
    for (const job of this.#jobs.values()) job.stop();
    this.#jobs.clear();
  }

  /**
   * List registered job keys.
   * @returns {string[]}
   */
  list() {
    return [...this.#jobs.keys()];
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test backend/tests/unit/agents/framework/Scheduler.test.mjs`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/framework/Scheduler.mjs backend/tests/unit/agents/framework/Scheduler.test.mjs
git commit -m "feat(agents): add Scheduler for cron-based assignment triggering"
```

---

### Task 11: Assignment API endpoints

**Files:**
- Modify: `backend/src/4_api/routers/agents.mjs`

**Step 1: Add assignment endpoints to the existing router**

Add these routes after the existing `run-background` route in `backend/src/4_api/routers/agents.mjs`. The `createAgentsRouter` function signature also needs to accept `scheduler`:

Update the function signature:
```javascript
export function createAgentsRouter(config) {
  const router = express.Router();
  const { agentOrchestrator, scheduler, logger = console } = config;
```

Then add before `return router;`:

```javascript
  /**
   * GET /api/agents/:agentId/assignments
   * List assignments for an agent
   */
  router.get('/:agentId/assignments', asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    if (!agentOrchestrator.has(agentId)) {
      return res.status(404).json({ error: `Agent '${agentId}' not found` });
    }

    const instances = agentOrchestrator.listInstances();
    const agent = instances.find(a => a.constructor.id === agentId);
    const assignments = (agent?.getAssignments?.() || []).map(a => ({
      id: a.constructor.id,
      description: a.constructor.description || '',
      schedule: a.constructor.schedule || null,
    }));

    res.json({ agentId, assignments });
  }));

  /**
   * POST /api/agents/:agentId/assignments/:assignmentId/run
   * Manually trigger an assignment
   * Body: { userId?: string, context?: object }
   */
  router.post('/:agentId/assignments/:assignmentId/run', asyncHandler(async (req, res) => {
    const { agentId, assignmentId } = req.params;
    const { userId, context = {} } = req.body;

    logger.info?.('agents.runAssignment.request', { agentId, assignmentId, userId });

    try {
      const result = await agentOrchestrator.runAssignment(agentId, assignmentId, {
        userId,
        context,
        triggeredBy: 'api',
      });

      res.json({ agentId, assignmentId, status: 'complete', result });
    } catch (error) {
      logger.error?.('agents.runAssignment.error', { agentId, assignmentId, error: error.message });

      if (error.message.includes('not found') || error.message.includes('Unknown assignment')) {
        return res.status(404).json({ error: error.message });
      }

      throw error;
    }
  }));
```

**Step 2: Run existing agent tests to verify nothing breaks**

Run: `node --test backend/tests/unit/agents/AgentOrchestrator.test.mjs`

Expected: All existing tests PASS

**Step 3: Commit**

```bash
git add backend/src/4_api/routers/agents.mjs
git commit -m "feat(agents): add assignment list and trigger API endpoints"
```

---

### Task 12: Framework barrel exports and index files

**Files:**
- Create: `backend/src/3_applications/agents/framework/index.mjs`
- Create: `backend/src/3_applications/agents/framework/ports/index.mjs`
- Modify: `backend/src/3_applications/agents/ports/index.mjs`
- Modify: `backend/src/3_applications/agents/index.mjs`
- Modify: `backend/src/1_adapters/agents/index.mjs`

**Step 1: Create framework barrel exports**

```javascript
// backend/src/3_applications/agents/framework/index.mjs

export { BaseAgent } from './BaseAgent.mjs';
export { ToolFactory } from './ToolFactory.mjs';
export { WorkingMemoryState } from './WorkingMemory.mjs';
export { Assignment } from './Assignment.mjs';
export { OutputValidator } from './OutputValidator.mjs';
export { Scheduler } from './Scheduler.mjs';
export * from './ports/index.mjs';
```

```javascript
// backend/src/3_applications/agents/framework/ports/index.mjs

export { IWorkingMemory, isWorkingMemoryStore } from './IWorkingMemory.mjs';
```

**Step 2: Update existing barrel exports**

Add to `backend/src/3_applications/agents/index.mjs`:
```javascript
// Framework
export * from './framework/index.mjs';
```

Add to `backend/src/1_adapters/agents/index.mjs`:
```javascript
export { YamlWorkingMemoryAdapter } from './YamlWorkingMemoryAdapter.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/agents/framework/index.mjs backend/src/3_applications/agents/framework/ports/index.mjs backend/src/3_applications/agents/index.mjs backend/src/1_adapters/agents/index.mjs backend/src/3_applications/agents/ports/index.mjs
git commit -m "chore(agents): add barrel exports for agent framework"
```

---

### Task 13: Run all framework tests together

**Step 1: Run all tests**

Run: `node --test backend/tests/unit/agents/AgentOrchestrator.test.mjs backend/tests/unit/agents/EchoAgent.test.mjs backend/tests/unit/agents/framework/WorkingMemoryState.test.mjs backend/tests/unit/agents/framework/YamlWorkingMemoryAdapter.test.mjs backend/tests/unit/agents/framework/ToolFactory.test.mjs backend/tests/unit/agents/framework/OutputValidator.test.mjs backend/tests/unit/agents/framework/Assignment.test.mjs backend/tests/unit/agents/framework/BaseAgent.test.mjs backend/tests/unit/agents/framework/Scheduler.test.mjs`

Expected: ALL tests PASS. If any fail, fix and re-run before proceeding.

**Step 2: Verify EchoAgent still works with the existing bootstrap**

The EchoAgent does not extend BaseAgent (it predates the framework). Verify it still registers and runs:

Run: `node --test backend/tests/unit/agents/EchoAgent.test.mjs`

Expected: All 10 existing EchoAgent tests PASS. EchoAgent is unchanged — it doesn't use the framework. Future agents extend BaseAgent; EchoAgent stays as-is unless explicitly migrated.

---

### Task 14: Update agents context doc

**Files:**
- Modify: `docs/ai-context/agents.md`

**Step 1: Add framework section to agents context doc**

Add after the existing "File Locations" section:

```markdown
### Framework (`3_applications/agents/framework/`)
- `BaseAgent.mjs` - Common lifecycle (memory, tools, assignments)
- `ToolFactory.mjs` - Grouped tool creation base class
- `WorkingMemory.mjs` - WorkingMemoryState with TTL-based expiry
- `Assignment.mjs` - Structured workflow template method
- `OutputValidator.mjs` - JSON Schema validation with LLM retry
- `Scheduler.mjs` - Cron-based assignment triggering
- `ports/IWorkingMemory.mjs` - Memory persistence port

### Adapter Layer (`1_adapters/agents/`)
- `MastraAdapter.mjs` - Mastra SDK implementation (existing)
- `YamlWorkingMemoryAdapter.mjs` - YAML file persistence for working memory
```

Update the API Endpoints table to include:

```markdown
| GET | `/agents/:agentId/assignments` | List agent assignments |
| POST | `/agents/:agentId/assignments/:assignmentId/run` | Manually trigger assignment |
```

Update "Creating a New Agent" section to reference BaseAgent:

```markdown
### 2. Define agent class (extending BaseAgent)

\`\`\`javascript
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { ToolFactory } from '../framework/ToolFactory.mjs';

class MyToolFactory extends ToolFactory {
  static domain = 'my-domain';
  createTools() { return [/* ITool[] */]; }
}

export class MyAgent extends BaseAgent {
  static id = 'my-agent';
  static description = 'Does something useful';

  getSystemPrompt() { return 'You are...'; }

  registerTools() {
    this.addToolFactory(new MyToolFactory(this.deps));
  }
}
\`\`\`
```

**Step 2: Commit**

```bash
git add docs/ai-context/agents.md
git commit -m "docs: update agents context with framework components"
```
