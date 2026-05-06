// tests/isolated/agents/framework/BaseAgent.buildToolDecorators.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class TestAgent extends BaseAgent {
  static id = 'test-agent';
  static description = 'test';
  getSystemPrompt() { return 'test prompt'; }
  registerTools() {}
}

const sentinelDecorator = vi.fn((tool) => ({ ...tool, _sentinel: true }));

class PolicyTestAgent extends BaseAgent {
  static id = 'policy-agent';
  static description = 'has policy';
  getSystemPrompt() { return 'policy prompt'; }
  registerTools() {}

  buildToolDecorators() {
    return [sentinelDecorator];
  }
}

describe('BaseAgent.buildToolDecorators default', () => {
  it('returns an empty array by default', () => {
    const agent = new TestAgent({
      agentRuntime: { execute: async () => ({ output: 'ok' }) },
      workingMemory: { load: async () => null, save: async () => {} },
      logger: console,
    });
    expect(agent.buildToolDecorators()).toEqual([]);
  });
});

describe('BaseAgent.buildToolDecorators override', () => {
  it('subclass override is respected', () => {
    const agent = new PolicyTestAgent({
      agentRuntime: { execute: async () => ({ output: 'ok' }) },
      workingMemory: { load: async () => null, save: async () => {} },
      logger: console,
    });
    const decorators = agent.buildToolDecorators();
    expect(decorators).toHaveLength(1);
    expect(decorators[0]).toBe(sentinelDecorator);
  });
});
