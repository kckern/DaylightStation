// tests/isolated/agents/AgentOrchestrator.userIdResolution.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { AgentOrchestrator } from '../../../backend/src/3_applications/agents/AgentOrchestrator.mjs';
import { BaseAgent } from '../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class FakeAgent extends BaseAgent {
  static id = 'fake';
  static description = 'fake agent';
  getSystemPrompt() { return 'SYS'; }
}

function makeOrch(defaultUserId = null) {
  const agentRuntime = { execute: vi.fn(async () => ({ output: 'ok', toolCalls: [] })) };
  const resolveDefaultUserId = defaultUserId
    ? vi.fn(() => defaultUserId)
    : vi.fn(() => null);
  const orch = new AgentOrchestrator({ agentRuntime, resolveDefaultUserId, createTurnId: () => 'test-turn' });
  orch.register(FakeAgent, {
    agentRuntime,
    workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
  });
  return { orch, agentRuntime };
}

describe('AgentOrchestrator userId resolution', () => {
  it('resolves userId="default" → getHeadOfHousehold()', async () => {
    const { orch, agentRuntime } = makeOrch('user_1');
    await orch.run('fake', 'hi', { userId: 'default' });
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    expect(call.context.userId).toBe('user_1');
  });

  it('resolves missing userId → getHeadOfHousehold()', async () => {
    const { orch, agentRuntime } = makeOrch('user_1');
    await orch.run('fake', 'hi', {}); // no userId
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    expect(call.context.userId).toBe('user_1');
  });

  it('passes through real userId untouched', async () => {
    const { orch, agentRuntime } = makeOrch('user_1');
    await orch.run('fake', 'hi', { userId: 'user_5' });
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    expect(call.context.userId).toBe('user_5');
  });

  it('falls through gracefully when configService missing', async () => {
    const { orch, agentRuntime } = makeOrch(null); // no configService
    await orch.run('fake', 'hi', { userId: 'default' });
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    // 'default' stays as-is when no configService — back-compat
    expect(call.context.userId).toBe('default');
  });

  it('falls through gracefully when getHeadOfHousehold returns null', async () => {
    const { orch, agentRuntime } = makeOrch(null);
    await orch.run('fake', 'hi', { userId: 'default' });
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    expect(call.context.userId).toBe('default');
  });

  it('logs the resolved userId in orchestrator.run', async () => {
    const logEvents = [];
    const agentRuntime = { execute: vi.fn(async () => ({ output: 'ok', toolCalls: [] })) };
    const orch = new AgentOrchestrator({
      agentRuntime,
      createTurnId: () => 'test-turn',
      resolveDefaultUserId: () => 'user_1',
      logger: { info: (event, data) => logEvents.push({ event, data }) },
    });
    orch.register(FakeAgent, {
      agentRuntime,
      workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
    });
    await orch.run('fake', 'hi', { userId: 'default' });
    const runEvent = logEvents.find(e => e.event === 'orchestrator.run');
    expect(runEvent).toBeDefined();
    expect(runEvent.data.userId).toBe('user_1');
  });
});
