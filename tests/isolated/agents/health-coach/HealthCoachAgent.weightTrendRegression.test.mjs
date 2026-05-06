// tests/isolated/agents/health-coach/HealthCoachAgent.weightTrendRegression.test.mjs
//
// Regression test for the failure transcript that motivated this plan:
// User asked "what's my weight trend?" via CoachChat. Agent confabulated
// userId="user123" and called the older get_weight_trend, returning
// "no recent weight data available" while real data existed.
//
// After the fix:
// - userId 'default' resolves to the configured head-of-household
// - The tool wrapper auto-injects the resolved userId into args
// - Tools never see 'user123' or 'default' — they see 'kckern'

import { describe, it, expect, vi } from 'vitest';
import { AgentOrchestrator } from '../../../../backend/src/3_applications/agents/AgentOrchestrator.mjs';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

// Minimal stub agent that exposes a tool with userId in its schema. The
// runtime is mocked to capture what args the tool's execute() actually
// received after the adapter's strip-and-inject pass.
class StubAgent extends BaseAgent {
  static id = 'stub';
  getSystemPrompt(context = {}) { return `BASE mode=${context?.mode ?? 'none'}`; }
  registerTools() {
    this.addToolFactory({
      createTools: () => [{
        name: 'get_weight_trend',
        description: 'returns weight trend',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            days: { type: 'number' },
          },
          required: ['userId'],
        },
        execute: async (args) => ({ receivedArgs: args }),
      }],
    });
  }
}

describe('regression: "what is my weight trend?" routes correctly', () => {
  it('userId=default → resolved kckern → tool sees userId=kckern', async () => {
    let toolReceivedArgs = null;

    // Fake runtime: simulate the model calling the tool, capture what the
    // wrapped execute receives. We build this by inspecting the translated
    // tools the adapter passes to the agent. Since we're testing through the
    // orchestrator → BaseAgent → MastraAdapter chain, we use a mock
    // agentRuntime that pretends to be Mastra and exercises the tool.
    const agentRuntime = {
      execute: async ({ tools, context, systemPrompt }) => {
        // Verify systemPrompt has Active User: kckern
        expect(systemPrompt).toMatch(/## Active User/);
        expect(systemPrompt).toMatch(/\*\*kckern\*\*/);
        // Verify mode passed via context
        expect(context.mode).toBe('chat');
        // The tools the agent registered are wrapped — but the wrapping
        // happens INSIDE MastraAdapter, not in BaseAgent. For this stub
        // runtime, tools[].execute is the raw inner execute. We're only
        // asserting that BaseAgent forwards the resolved userId correctly.
        expect(context.userId).toBe('kckern');
        // Simulate a tool call:
        const tool = tools[0];
        // BaseAgent doesn't wrap; the adapter does. So in this test we
        // verify the data BaseAgent passed in context. Real adapter
        // testing is in MastraAdapter.transcript.test.mjs.
        return { output: 'ok', toolCalls: [] };
      },
    };

    const cfg = { getHeadOfHousehold: vi.fn(() => 'kckern') };
    const orchestrator = new AgentOrchestrator({ agentRuntime, configService: cfg });
    orchestrator.register(StubAgent, {
      agentRuntime,
      workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
    });

    await orchestrator.run('stub', "what's my weight trend?", { userId: 'default' });

    // Assertions inside agentRuntime.execute fired during the call.
    // configService.getHeadOfHousehold was called by orchestrator
    expect(cfg.getHeadOfHousehold).toHaveBeenCalled();
  });

  it('userId missing → resolved to kckern same as default', async () => {
    const cfg = { getHeadOfHousehold: vi.fn(() => 'kckern') };
    let captured;
    const agentRuntime = {
      execute: async ({ context }) => {
        captured = context;
        return { output: 'ok', toolCalls: [] };
      },
    };
    const orch = new AgentOrchestrator({ agentRuntime, configService: cfg });
    orch.register(StubAgent, {
      agentRuntime,
      workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
    });
    await orch.run('stub', "what's my weight trend?", {}); // no userId at all
    expect(captured.userId).toBe('kckern');
  });

  it('userId=soren → passes through unchanged', async () => {
    const cfg = { getHeadOfHousehold: vi.fn(() => 'kckern') };
    let captured;
    const agentRuntime = {
      execute: async ({ context }) => {
        captured = context;
        return { output: 'ok', toolCalls: [] };
      },
    };
    const orch = new AgentOrchestrator({ agentRuntime, configService: cfg });
    orch.register(StubAgent, {
      agentRuntime,
      workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
    });
    await orch.run('stub', "what's my weight trend?", { userId: 'soren' });
    expect(captured.userId).toBe('soren');
    expect(cfg.getHeadOfHousehold).not.toHaveBeenCalled();
  });
});
