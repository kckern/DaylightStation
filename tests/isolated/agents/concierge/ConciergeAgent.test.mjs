import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConciergeAgent } from '../../../../backend/src/3_applications/agents/concierge/ConciergeAgent.mjs';
import { policyDecorator } from '../../../../backend/src/3_applications/agents/framework/decorators/PolicyDecorator.mjs';

function makeBundle(name, tools = []) {
  return { name, createTools: () => tools, getPromptFragment: () => `## ${name}`, getConfig: () => ({}) };
}

function makeSatellite(allowedSkills = ['memory']) {
  return {
    id: 'kitchen',
    area: 'kitchen',
    allowedSkills,
    canUseSkill: (name) => allowedSkills.includes(name),
    scopes_allowed: [],
    scopes_denied: [],
  };
}

function makeDeps(overrides = {}) {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    agentRuntime: { execute: async () => ({ output: 'ok' }), streamExecute: async function*() { yield { type: 'finish' }; } },
    workingMemory: { load: vi.fn(async () => ({ get: () => null, set: vi.fn(), serialize: () => '' })), save: vi.fn() },
    policy: { evaluateRequest: () => ({ allow: true }), evaluateToolCall: () => ({ allow: true }), shapeResponse: (_s, d) => d },
    toolBundles: [makeBundle('memory')],
    vocabulary: null,
    personality: null,
    ...overrides,
  };
}

describe('ConciergeAgent', () => {
  it('has static id = "concierge"', () => {
    expect(ConciergeAgent.id).toBe('concierge');
  });

  it('extends BaseAgent (inherits run method)', () => {
    const agent = new ConciergeAgent(makeDeps());
    expect(typeof agent.run).toBe('function');
  });

  it('buildToolDecorators includes policyDecorator', () => {
    const agent = new ConciergeAgent(makeDeps());
    const decorators = agent.buildToolDecorators();
    expect(decorators).toContain(policyDecorator);
  });

  describe('buildPromptSections', () => {
    it('returns an array with at least BASE_PROMPT, satellite, and memory sections', async () => {
      const agent = new ConciergeAgent(makeDeps());
      const satellite = makeSatellite();
      const memState = { get: () => null, set: vi.fn(), serialize: () => '' };
      const sections = await agent.buildPromptSections(
        { satellite, conversationId: null },
        memState
      );
      expect(Array.isArray(sections)).toBe(true);
      expect(sections.some(s => typeof s === 'string' && s.length > 10)).toBe(true);
    });

    it('returns null for personality section when personality is null', async () => {
      const agent = new ConciergeAgent(makeDeps({ personality: null }));
      const satellite = makeSatellite();
      const memState = { get: () => null, set: vi.fn() };
      const sections = await agent.buildPromptSections({ satellite }, memState);
      const hasPersonality = sections.some(s => s && s.toLowerCase().includes('personality'));
      expect(hasPersonality).toBe(false);
    });

    it('includes skill prompt fragments for allowed bundles', async () => {
      const bundle = makeBundle('memory');
      const agent = new ConciergeAgent(makeDeps({ toolBundles: [bundle] }));
      const satellite = makeSatellite(['memory']);
      const memState = { get: () => null, set: vi.fn() };
      const sections = await agent.buildPromptSections({ satellite }, memState);
      expect(sections.some(s => s && s.includes('## memory'))).toBe(true);
    });

    it('omits skill fragments for bundles not in satellite.allowedSkills', async () => {
      const bundle = makeBundle('media');
      const agent = new ConciergeAgent(makeDeps({ toolBundles: [bundle] }));
      const satellite = makeSatellite(['memory']);
      const memState = { get: () => null, set: vi.fn() };
      const sections = await agent.buildPromptSections({ satellite }, memState);
      expect(sections.some(s => s && s.includes('## media'))).toBe(false);
    });
  });
});
