// tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs
//
// Working memory is now owned by Mastra Memory, injected by the runtime —
// BaseAgent.buildPromptSections() no longer renders a "## Working Memory"
// section. These tests cover only the chat-path sections this layer owns:
// base prompt + Active User + attachments.
import { describe, it, expect } from 'vitest';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class FakeAgent extends BaseAgent {
  static id = 'fake';
  async getSystemPrompt() { return 'BASE'; }
}

describe('BaseAgent.buildPromptSections (default)', () => {
  function makeAgent() {
    return new FakeAgent({
      agentRuntime: { execute: async () => ({ output: 'ok' }) },
    });
  }

  it('returns base prompt when no context', async () => {
    const sections = await makeAgent().buildPromptSections({});
    expect(sections.filter(Boolean)).toEqual(['BASE']);
  });

  it('includes "## Active User" section when userId present', async () => {
    const sections = await makeAgent().buildPromptSections({ userId: 'user_1' });
    const userSection = sections.find(s => s?.includes('Active User'));
    expect(userSection).toMatch(/user_1/);
  });

  it('omits Active User section when userId absent', async () => {
    const sections = await makeAgent().buildPromptSections({});
    expect(sections.find(s => s?.includes('Active User'))).toBeUndefined();
  });

  it('does NOT render a "## Working Memory" section (owned by Mastra)', async () => {
    const sections = await makeAgent().buildPromptSections({ userId: 'user_1' });
    expect(sections.find(s => s?.includes('Working Memory'))).toBeUndefined();
  });
});

describe('BaseAgent.buildPromptSections (override)', () => {
  it('subclass can replace sections entirely', async () => {
    class CustomAgent extends BaseAgent {
      static id = 'custom';
      async getSystemPrompt() { return 'CUSTOM_BASE'; }
      async buildPromptSections() {
        return ['CUSTOM_BASE', null, '## Custom Section\nhello'];
      }
    }
    const agent = new CustomAgent({
      agentRuntime: { execute: async () => ({ output: 'ok' }) },
    });
    const sections = await agent.buildPromptSections({});
    expect(sections.filter(Boolean)).toEqual(['CUSTOM_BASE', '## Custom Section\nhello']);
  });
});

describe('BaseAgent.run uses buildPromptSections to assemble system prompt', () => {
  it('passes joined sections (filtered, joined by \\n\\n) to agentRuntime.execute', async () => {
    let captured;
    class CapturingAgent extends BaseAgent {
      static id = 'capturing';
      async getSystemPrompt() { return 'CAPTURING_BASE'; }
      async buildPromptSections() {
        return ['SECTION_1', null, 'SECTION_2'];
      }
    }
    const agent = new CapturingAgent({
      agentRuntime: { execute: async (args) => { captured = args; return { output: 'ok' }; } },
    });
    await agent.run('hi', { context: { userId: 'kc' } });
    expect(captured.systemPrompt).toBe('SECTION_1\n\nSECTION_2');
  });
});
