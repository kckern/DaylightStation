// backend/tests/unit/agents/EchoAgent.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EchoAgent } from '../../../src/3_applications/agents/echo/EchoAgent.mjs';
import { BaseAgent } from '../../../src/3_applications/agents/framework/BaseAgent.mjs';

describe('EchoAgent', () => {
  let mockAgentRuntime;
  let mockWorkingMemory;
  let mockLogger;

  beforeEach(() => {
    mockAgentRuntime = {
      execute: async ({ agent, input, tools, systemPrompt }) => {
        return { output: `Executed with: ${input}`, toolCalls: [] };
      },
      executeInBackground: async () => ({ taskId: 'bg-task' }),
    };

    mockWorkingMemory = {
      load: async () => null,
      save: async () => {},
    };

    mockLogger = {
      info: () => {},
      error: () => {},
    };
  });

  function makeAgent(overrides = {}) {
    return new EchoAgent({
      agentRuntime: mockAgentRuntime,
      workingMemory: mockWorkingMemory,
      logger: mockLogger,
      ...overrides,
    });
  }

  describe('inheritance', () => {
    it('extends BaseAgent', () => {
      assert.ok(Object.getPrototypeOf(EchoAgent.prototype) === BaseAgent.prototype);
    });
  });

  describe('static properties', () => {
    it('should have id "echo"', () => {
      assert.strictEqual(EchoAgent.id, 'echo');
    });

    it('should have a description', () => {
      assert.ok(EchoAgent.description);
      assert.ok(EchoAgent.description.length > 0);
    });
  });

  describe('constructor', () => {
    it('should throw if agentRuntime is not provided', () => {
      assert.throws(
        () => new EchoAgent({ workingMemory: mockWorkingMemory }),
        /agentRuntime is required/
      );
    });

    it('should throw if workingMemory is not provided', () => {
      assert.throws(
        () => new EchoAgent({ agentRuntime: mockAgentRuntime }),
        /workingMemory is required/
      );
    });

    it('should create with valid dependencies', () => {
      const agent = makeAgent();
      assert.ok(agent);
    });
  });

  describe('getTools', () => {
    it('should return an empty array (no tools registered)', () => {
      const agent = makeAgent();
      const tools = agent.getTools();
      assert.ok(Array.isArray(tools));
      assert.strictEqual(tools.length, 0);
    });
  });

  describe('getSystemPrompt', () => {
    it('should return a non-empty string', () => {
      const agent = makeAgent();
      const prompt = agent.getSystemPrompt();
      assert.strictEqual(typeof prompt, 'string');
      assert.ok(prompt.length > 0);
    });
  });

  describe('run', () => {
    it('returns echo output verbatim (no LLM call)', async () => {
      let executeCalled = false;
      const trackingRuntime = {
        ...mockAgentRuntime,
        execute: async () => { executeCalled = true; return { output: 'x', toolCalls: [] }; },
      };
      const agent = makeAgent({ agentRuntime: trackingRuntime });

      const result = await agent.run('hello world', { context: { userId: 'kc' } });

      assert.ok(!executeCalled, 'agentRuntime.execute must NOT be called');
      assert.ok(result.output.includes('hello world'));
    });

    it('returns expected output format', async () => {
      const agent = makeAgent();
      const result = await agent.run('test input', {});
      assert.strictEqual(typeof result.output, 'string');
      assert.ok(Array.isArray(result.toolCalls));
      assert.strictEqual(result.toolCalls.length, 0);
    });

    it('does not call workingMemory.load or save (diagnostic agent skips memory)', async () => {
      let loadCalled = false;
      let saveCalled = false;
      const trackingMemory = {
        load: async () => { loadCalled = true; return null; },
        save: async () => { saveCalled = true; },
      };
      const agent = makeAgent({ workingMemory: trackingMemory });

      await agent.run('hi', { context: { userId: 'kc' } });

      assert.ok(!loadCalled, 'workingMemory.load must NOT be called');
      assert.ok(!saveCalled, 'workingMemory.save must NOT be called');
    });
  });

  describe('runStream', () => {
    it('yields a text-delta chunk and a finish event without an LLM call', async () => {
      let streamCalled = false;
      const trackingRuntime = {
        ...mockAgentRuntime,
        streamExecute: async function* () { streamCalled = true; },
      };
      const agent = makeAgent({ agentRuntime: trackingRuntime });

      const chunks = [];
      for await (const chunk of agent.runStream('hello', {})) {
        chunks.push(chunk);
      }

      assert.ok(!streamCalled, 'agentRuntime.streamExecute must NOT be called');
      const delta = chunks.find(c => c.type === 'text-delta');
      const finish = chunks.find(c => c.type === 'finish');
      assert.ok(delta, 'must yield a text-delta chunk');
      assert.ok(finish, 'must yield a finish chunk');
      assert.ok(delta.text.includes('hello'));
    });
  });
});
