// tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs
import { describe, it, expect } from 'vitest';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';
import { WorkingMemoryState } from '../../../../backend/src/3_applications/agents/framework/WorkingMemory.mjs';

class FakeAgent extends BaseAgent {
  static id = 'fake';
  async getSystemPrompt() { return 'BASE'; }
}

describe('BaseAgent.buildPromptSections (default)', () => {
  function makeAgent() {
    return new FakeAgent({
      agentRuntime: { execute: async () => ({ output: 'ok' }) },
      workingMemory: { load: async () => null, save: async () => {} },
    });
  }

  it('returns base prompt when no context or memory', async () => {
    const sections = await makeAgent().buildPromptSections({}, null);
    expect(sections.filter(Boolean)).toEqual(['BASE']);
  });

  it('includes "## Active User" section when userId present', async () => {
    const sections = await makeAgent().buildPromptSections({ userId: 'kckern' }, null);
    const userSection = sections.find(s => s?.includes('Active User'));
    expect(userSection).toMatch(/kckern/);
  });

  it('includes "## Working Memory" section when memory present', async () => {
    const memory = new WorkingMemoryState();
    memory.set('note', 'remember this');
    const sections = await makeAgent().buildPromptSections({}, memory);
    const memSection = sections.find(s => s?.includes('Working Memory'));
    expect(memSection).toMatch(/remember this/);
  });

  it('omits Active User section when userId absent', async () => {
    const sections = await makeAgent().buildPromptSections({}, null);
    expect(sections.find(s => s?.includes('Active User'))).toBeUndefined();
  });

  it('omits Working Memory section when memory absent', async () => {
    const sections = await makeAgent().buildPromptSections({}, null);
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
      workingMemory: { load: async () => null, save: async () => {} },
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
      workingMemory: { load: async () => null, save: async () => {} },
    });
    await agent.run('hi', { context: { userId: 'kc' } });
    expect(captured.systemPrompt).toBe('SECTION_1\n\nSECTION_2');
  });
});
