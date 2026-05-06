// tests/isolated/agents/echo/EchoAgent.baseAgent.test.mjs

import { describe, it, expect } from 'vitest';
import { EchoAgent } from '../../../../backend/src/3_applications/agents/echo/EchoAgent.mjs';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

function makeAgent(overrides = {}) {
  return new EchoAgent({
    agentRuntime: { execute: async () => ({ output: 'ok', toolCalls: [] }) },
    workingMemory: { load: async () => null, save: async () => {} },
    ...overrides,
  });
}

describe('EchoAgent — extends BaseAgent', () => {
  it('is a subclass of BaseAgent', () => {
    expect(Object.getPrototypeOf(EchoAgent.prototype)).toBe(BaseAgent.prototype);
  });

  it('has static id "echo"', () => {
    expect(EchoAgent.id).toBe('echo');
  });

  it('has a non-empty description', () => {
    expect(typeof EchoAgent.description).toBe('string');
    expect(EchoAgent.description.length).toBeGreaterThan(0);
  });
});

describe('EchoAgent — constructor', () => {
  it('throws when agentRuntime is missing', () => {
    expect(() => new EchoAgent({ workingMemory: { load: async () => null, save: async () => {} } }))
      .toThrow(/agentRuntime is required/);
  });

  it('throws when workingMemory is missing', () => {
    expect(() => new EchoAgent({ agentRuntime: { execute: async () => ({}) } }))
      .toThrow(/workingMemory is required/);
  });

  it('constructs successfully with both required deps', () => {
    expect(() => makeAgent()).not.toThrow();
  });
});

describe('EchoAgent — run (no LLM round-trip)', () => {
  it('echoes its input in the output', async () => {
    const agent = makeAgent();
    const result = await agent.run('hello world', {});
    expect(result.output).toMatch(/hello world/);
  });

  it('returns empty toolCalls array', async () => {
    const agent = makeAgent();
    const result = await agent.run('hi', {});
    expect(result.toolCalls).toEqual([]);
  });

  it('does NOT call agentRuntime.execute', async () => {
    let called = false;
    const agent = makeAgent({
      agentRuntime: { execute: async () => { called = true; return { output: 'x', toolCalls: [] }; } },
    });
    await agent.run('test', {});
    expect(called).toBe(false);
  });

  it('does NOT call workingMemory.load or save (diagnostic — skips memory lifecycle)', async () => {
    let loaded = false;
    let saved = false;
    const agent = makeAgent({
      workingMemory: {
        load: async () => { loaded = true; return null; },
        save: async () => { saved = true; },
      },
    });
    await agent.run('test', { context: { userId: 'kc' } });
    expect(loaded).toBe(false);
    expect(saved).toBe(false);
  });
});

describe('EchoAgent — runStream (no LLM round-trip)', () => {
  it('yields text-delta and finish chunks without calling agentRuntime', async () => {
    let streamCalled = false;
    const agent = makeAgent({
      agentRuntime: {
        execute: async () => ({ output: 'ok', toolCalls: [] }),
        streamExecute: async function* () { streamCalled = true; },
      },
    });
    const chunks = [];
    for await (const chunk of agent.runStream('ping', {})) {
      chunks.push(chunk);
    }
    expect(streamCalled).toBe(false);
    const delta = chunks.find(c => c.type === 'text-delta');
    const finish = chunks.find(c => c.type === 'finish');
    expect(delta).toBeDefined();
    expect(finish).toBeDefined();
    expect(delta.text).toMatch(/ping/);
  });
});

describe('EchoAgent — getTools (no tools registered)', () => {
  it('returns an empty array', () => {
    const agent = makeAgent();
    expect(agent.getTools()).toEqual([]);
  });
});

describe('EchoAgent — getSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const agent = makeAgent();
    const prompt = agent.getSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe('EchoAgent — buildPromptSections (inherited from BaseAgent)', () => {
  it('includes the base system prompt section', async () => {
    const agent = makeAgent();
    const sections = await agent.buildPromptSections({}, null);
    const base = sections.find(s => s && s.length > 0);
    expect(base).toBeDefined();
  });

  it('includes Active User section when userId is in context', async () => {
    const agent = makeAgent();
    const sections = await agent.buildPromptSections({ userId: 'kckern' }, null);
    const userSection = sections.find(s => s?.includes('Active User'));
    expect(userSection).toMatch(/kckern/);
  });
});
