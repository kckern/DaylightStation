// tests/isolated/agents/framework/assignment-identity.test.mjs
//
// Task 21: scheduled (assignment) runs must get the "## Active User" prompt
// section (previously bypassed buildPromptSections/#assemblePrompt), and
// Assignment.execute must not call the LLM runtime when buildPrompt()
// returns null (nothing actionable).
import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '#apps/agents/framework/BaseAgent.mjs';
import { Assignment } from '#apps/agents/framework/Assignment.mjs';

class NullAssignment extends Assignment {
  static id = 'null-check';
  async gather() { return { nothing_actionable: true }; }
  buildPrompt() { return null; }
  async validate(raw) { return raw; }
  async act() {}
}

class FakeAgent extends BaseAgent {
  static id = 'fake';
  async getSystemPrompt() { return 'BASE'; }
}

describe('assignment identity + empty-input guard', () => {
  it('does not call the runtime when buildPrompt returns null', async () => {
    const execute = vi.fn(async () => ({ output: 'x' }));
    const assignment = new NullAssignment();
    const save = vi.fn(async () => {});
    const result = await assignment.execute({
      agentRuntime: { execute }, workingMemory: { load: async () => ({ pruneExpired() {}, get() {} }), save },
      tools: [], systemPrompt: 'BASE', agentId: 'fake', userId: 'maya', context: {}, logger: { info() {} },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('runAssignment renders the Active User section into the scheduled prompt', async () => {
    let capturedPrompt = null;
    class CaptureAssignment extends Assignment {
      static id = 'cap';
      async gather() { return {}; }
      buildPrompt() { return 'DO SOMETHING'; }
      async validate(r) { return r; }
      async act() {}
    }
    const agent = new FakeAgent({
      agentRuntime: { execute: async ({ systemPrompt }) => { capturedPrompt = systemPrompt; return { output: 'ok' }; } },
      workingMemory: { load: async () => ({ pruneExpired() {}, get() {} }), save: async () => {} },
      logger: { info() {} },
    });
    agent.registerAssignment(new CaptureAssignment());
    await agent.runAssignment('cap', { userId: 'maya' });
    expect(capturedPrompt).toContain('Active User');
    expect(capturedPrompt).toContain('maya');
  });
});
