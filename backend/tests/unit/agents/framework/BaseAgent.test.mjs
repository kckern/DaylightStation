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
