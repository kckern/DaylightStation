// backend/tests/unit/agents/EchoAgent.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EchoAgent } from '../../../src/3_applications/agents/echo/EchoAgent.mjs';

describe('EchoAgent', () => {
  let mockAgentRuntime;
  let mockLogger;

  beforeEach(() => {
    mockAgentRuntime = {
      execute: async ({ agent, input, tools, systemPrompt }) => {
        return { output: `Executed with: ${input}`, toolCalls: [] };
      },
      executeInBackground: async () => ({ taskId: 'bg-task' }),
    };

    mockLogger = {
      info: () => {},
      error: () => {},
    };
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
        () => new EchoAgent({}),
        /agentRuntime is required/
      );
    });

    it('should create with valid dependencies', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });
      assert.ok(agent);
    });
  });

  describe('getTools', () => {
    it('should return array of tools', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      assert.ok(Array.isArray(tools));
      assert.ok(tools.length > 0);
    });

    it('should include echo_message tool', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      const echoTool = tools.find(t => t.name === 'echo_message');

      assert.ok(echoTool);
      assert.ok(echoTool.description);
      assert.strictEqual(typeof echoTool.execute, 'function');
    });

    it('should include get_current_time tool', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      const timeTool = tools.find(t => t.name === 'get_current_time');

      assert.ok(timeTool);
      assert.ok(timeTool.description);
      assert.strictEqual(typeof timeTool.execute, 'function');
    });
  });

  describe('tool execution', () => {
    it('echo_message should return timestamped message', async () => {
      const fixedTime = '2026-01-26T12:00:00.000Z';
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        timestampFn: () => fixedTime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      const echoTool = tools.find(t => t.name === 'echo_message');

      const result = await echoTool.execute({ message: 'Hello' }, {});

      assert.ok(result.echoed.includes(fixedTime));
      assert.ok(result.echoed.includes('Hello'));
    });

    it('get_current_time should return current time', async () => {
      const fixedTime = '2026-01-26T12:00:00.000Z';
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        timestampFn: () => fixedTime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      const timeTool = tools.find(t => t.name === 'get_current_time');

      const result = await timeTool.execute({}, {});

      assert.strictEqual(result.currentTime, fixedTime);
    });
  });

  describe('getSystemPrompt', () => {
    it('should return a non-empty string', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      const prompt = agent.getSystemPrompt();
      assert.strictEqual(typeof prompt, 'string');
      assert.ok(prompt.length > 0);
    });
  });

  describe('run', () => {
    it('should call agentRuntime.execute with correct params', async () => {
      let executeCalled = false;
      let capturedOptions = null;

      const trackingRuntime = {
        ...mockAgentRuntime,
        execute: async (options) => {
          executeCalled = true;
          capturedOptions = options;
          return { output: 'test', toolCalls: [] };
        },
      };

      const agent = new EchoAgent({
        agentRuntime: trackingRuntime,
        logger: mockLogger,
      });

      await agent.run('test input', { context: { userId: '123' } });

      assert.ok(executeCalled);
      assert.strictEqual(capturedOptions.input, 'test input');
      assert.strictEqual(capturedOptions.agent, agent);
      assert.ok(Array.isArray(capturedOptions.tools));
      assert.strictEqual(typeof capturedOptions.systemPrompt, 'string');
      assert.deepStrictEqual(capturedOptions.context, { userId: '123' });
    });
  });
});
