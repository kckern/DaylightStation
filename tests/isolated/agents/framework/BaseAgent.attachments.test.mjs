// tests/isolated/agents/framework/BaseAgent.attachments.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class FakeAgent extends BaseAgent {
  static id = 'fake';
  getSystemPrompt() { return 'BASE_SYSTEM_PROMPT'; }
}

const baseDeps = {
  agentRuntime: { execute: vi.fn(async () => ({ output: 'ok', toolCalls: [] })) },
  workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
};

describe('BaseAgent attachment preamble', () => {
  it('renders no preamble when context.attachments is absent', async () => {
    const agent = new FakeAgent(baseDeps);
    await agent.run('hi', { context: {} });
    const passed = baseDeps.agentRuntime.execute.mock.calls.at(-1)[0];
    expect(passed.systemPrompt).toBe('BASE_SYSTEM_PROMPT');
  });

  it('renders preamble when context.attachments has entries', async () => {
    const agent = new FakeAgent({ ...baseDeps,
      agentRuntime: { execute: vi.fn(async () => ({ output: 'ok', toolCalls: [] })) },
    });
    await agent.run('hi', { context: { attachments: [
      { type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' },
      { type: 'day', date: '2026-05-04', label: 'May 4, 2026' },
    ] } });
    const passed = agent.deps.agentRuntime?.execute?.mock?.calls?.at?.(-1)?.[0]
      ?? baseDeps.agentRuntime.execute.mock.calls.at(-1)[0];
    expect(passed.systemPrompt).toMatch(/BASE_SYSTEM_PROMPT/);
    expect(passed.systemPrompt).toMatch(/## User Mentions/);
    expect(passed.systemPrompt).toMatch(/last_30d/);
    expect(passed.systemPrompt).toMatch(/2026-05-04/);
  });

  it('subclass formatAttachments override is used when present', async () => {
    class CustomAgent extends BaseAgent {
      static id = 'custom';
      getSystemPrompt() { return 'CUSTOM'; }
      formatAttachments(attachments) {
        return `## Custom Block\n${attachments.length} item(s)`;
      }
    }
    const runtime = { execute: vi.fn(async () => ({ output: 'ok', toolCalls: [] })) };
    const agent = new CustomAgent({ ...baseDeps, agentRuntime: runtime });
    await agent.run('hi', { context: { attachments: [{ type: 'day', date: '2026-05-04', label: 'd' }] } });
    expect(runtime.execute.mock.calls.at(-1)[0].systemPrompt).toMatch(/## Custom Block\n1 item/);
  });
});
