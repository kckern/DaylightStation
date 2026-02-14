// backend/tests/unit/agents/AgentOrchestrator.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AgentOrchestrator } from '../../../src/3_applications/agents/AgentOrchestrator.mjs';

describe('AgentOrchestrator', () => {
  let mockAgentRuntime;
  let mockLogger;

  beforeEach(() => {
    mockAgentRuntime = {
      execute: async () => ({ output: 'test output', toolCalls: [] }),
      executeInBackground: async (opts, cb) => {
        setImmediate(() => cb({ output: 'background output', toolCalls: [] }));
        return { taskId: 'test-task-id' };
      },
    };

    mockLogger = {
      info: () => {},
      error: () => {},
    };
  });

  describe('constructor', () => {
    it('should throw if agentRuntime is not provided', () => {
      assert.throws(
        () => new AgentOrchestrator({}),
        /agentRuntime is required/
      );
    });

    it('should create with valid dependencies', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });
      assert.ok(orchestrator);
    });
  });

  describe('register', () => {
    it('should register an agent with static id', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      class TestAgent {
        static id = 'test-agent';
        static description = 'Test agent';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return 'test'; }
        async run() { return { output: 'test', toolCalls: [] }; }
      }

      orchestrator.register(TestAgent, {});
      assert.ok(orchestrator.has('test-agent'));
    });

    it('should throw if agent has no static id', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      class BadAgent {
        constructor() {}
      }

      assert.throws(
        () => orchestrator.register(BadAgent, {}),
        /Agent class must have static id property/
      );
    });
  });

  describe('list', () => {
    it('should return registered agents', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      class AgentA {
        static id = 'agent-a';
        static description = 'Agent A';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return 'a'; }
        async run() { return { output: '', toolCalls: [] }; }
      }

      class AgentB {
        static id = 'agent-b';
        static description = 'Agent B';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return 'b'; }
        async run() { return { output: '', toolCalls: [] }; }
      }

      orchestrator.register(AgentA, {});
      orchestrator.register(AgentB, {});

      const list = orchestrator.list();
      assert.strictEqual(list.length, 2);
      assert.ok(list.some(a => a.id === 'agent-a'));
      assert.ok(list.some(a => a.id === 'agent-b'));
    });
  });

  describe('run', () => {
    it('should throw for unknown agent', async () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      await assert.rejects(
        () => orchestrator.run('nonexistent', 'hello'),
        /Agent not found/
      );
    });

    it('should run registered agent', async () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      let runCalled = false;

      class TestAgent {
        static id = 'test';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return 'test'; }
        async run(input, options) {
          runCalled = true;
          return { output: `received: ${input}`, toolCalls: [] };
        }
      }

      orchestrator.register(TestAgent, {});
      const result = await orchestrator.run('test', 'hello world');

      assert.ok(runCalled);
      assert.strictEqual(result.output, 'received: hello world');
    });
  });

  describe('has', () => {
    it('should return false for unregistered agent', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      assert.strictEqual(orchestrator.has('nonexistent'), false);
    });

    it('should return true for registered agent', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      class TestAgent {
        static id = 'exists';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return ''; }
        async run() { return { output: '', toolCalls: [] }; }
      }

      orchestrator.register(TestAgent, {});
      assert.strictEqual(orchestrator.has('exists'), true);
    });
  });

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
});
