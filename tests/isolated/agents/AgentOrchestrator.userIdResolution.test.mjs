// tests/isolated/agents/AgentOrchestrator.userIdResolution.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { AgentOrchestrator } from '../../../backend/src/3_applications/agents/AgentOrchestrator.mjs';
import { BaseAgent } from '../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class FakeAgent extends BaseAgent {
  static id = 'fake';
  static description = 'fake agent';
  getSystemPrompt() { return 'SYS'; }
}

function makeOrch(configService = null) {
  const agentRuntime = { execute: vi.fn(async () => ({ output: 'ok', toolCalls: [] })) };
  const orch = new AgentOrchestrator({ agentRuntime, configService });
  orch.register(FakeAgent, {
    agentRuntime,
    workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
  });
  return { orch, agentRuntime };
}

describe('AgentOrchestrator userId resolution', () => {
  it('resolves userId="default" → getHeadOfHousehold()', async () => {
    const cfg = { getHeadOfHousehold: vi.fn(() => 'kckern') };
    const { orch, agentRuntime } = makeOrch(cfg);
    await orch.run('fake', 'hi', { userId: 'default' });
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    expect(call.context.userId).toBe('kckern');
  });

  it('resolves missing userId → getHeadOfHousehold()', async () => {
    const cfg = { getHeadOfHousehold: vi.fn(() => 'kckern') };
    const { orch, agentRuntime } = makeOrch(cfg);
    await orch.run('fake', 'hi', {}); // no userId
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    expect(call.context.userId).toBe('kckern');
  });

  it('passes through real userId untouched', async () => {
    const cfg = { getHeadOfHousehold: vi.fn(() => 'kckern') };
    const { orch, agentRuntime } = makeOrch(cfg);
    await orch.run('fake', 'hi', { userId: 'soren' });
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    expect(call.context.userId).toBe('soren');
    expect(cfg.getHeadOfHousehold).not.toHaveBeenCalled();
  });

  it('falls through gracefully when configService missing', async () => {
    const { orch, agentRuntime } = makeOrch(null); // no configService
    await orch.run('fake', 'hi', { userId: 'default' });
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    // 'default' stays as-is when no configService — back-compat
    expect(call.context.userId).toBe('default');
  });

  it('falls through gracefully when getHeadOfHousehold returns null', async () => {
    const cfg = { getHeadOfHousehold: vi.fn(() => null) };
    const { orch, agentRuntime } = makeOrch(cfg);
    await orch.run('fake', 'hi', { userId: 'default' });
    const call = agentRuntime.execute.mock.calls.at(-1)[0];
    expect(call.context.userId).toBe('default');
  });

  it('logs the resolved userId in orchestrator.run', async () => {
    const cfg = { getHeadOfHousehold: vi.fn(() => 'kckern') };
    const logEvents = [];
    const agentRuntime = { execute: vi.fn(async () => ({ output: 'ok', toolCalls: [] })) };
    const orch = new AgentOrchestrator({
      agentRuntime,
      configService: cfg,
      logger: { info: (event, data) => logEvents.push({ event, data }) },
    });
    orch.register(FakeAgent, {
      agentRuntime,
      workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
    });
    await orch.run('fake', 'hi', { userId: 'default' });
    const runEvent = logEvents.find(e => e.event === 'orchestrator.run');
    expect(runEvent).toBeDefined();
    expect(runEvent.data.userId).toBe('kckern');
  });
});
