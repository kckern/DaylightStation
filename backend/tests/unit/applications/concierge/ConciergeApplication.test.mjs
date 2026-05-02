import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ConciergeApplication } from '../../../../src/3_applications/concierge/ConciergeApplication.mjs';
import { Satellite } from '../../../../src/2_domains/concierge/Satellite.mjs';
import { MemorySkill } from '../../../../src/3_applications/concierge/skills/MemorySkill.mjs';
import { PassThroughConciergePolicy } from '../../../../src/3_applications/concierge/services/PassThroughConciergePolicy.mjs';
import { AliasMap } from '../../../../src/2_domains/common/AliasMap.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class InMemoryRegistry {
  constructor(satellite, token) { this.satellite = satellite; this.token = token; }
  async findByToken(t) { return t === this.token ? this.satellite : null; }
  async list() { return [this.satellite]; }
}

class InMemoryConciergeMemory {
  constructor() { this.store = {}; }
  async get(k) { return this.store[k] ?? null; }
  async set(k, v) { this.store[k] = v; }
  async merge() {}
}

class FakeRuntime {
  async execute() { return { output: 'ok', toolCalls: [] }; }
  async *streamExecute() { yield { type: 'finish' }; }
}

describe('ConciergeApplication', () => {
  it('exposes runChat / streamChat (IChatCompletionRunner)', async () => {
    const sat = new Satellite({ id: 'a', mediaPlayerEntity: 'media_player.a', allowedSkills: ['memory'] });
    const memory = new InMemoryConciergeMemory();
    const app = new ConciergeApplication({
      satelliteRegistry: new InMemoryRegistry(sat, 'tok'),
      memory,
      policy: new PassThroughConciergePolicy(),
      agentRuntime: new FakeRuntime(),
      skills: [new MemorySkill({ memory, logger: silentLogger })],
      logger: silentLogger,
    });
    assert.strictEqual(typeof app.runChat, 'function');
    assert.strictEqual(typeof app.streamChat, 'function');
    const r = await app.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(r.content, 'ok');
  });

  it('throws if satelliteRegistry is missing', () => {
    assert.throws(() => new ConciergeApplication({
      memory: {},
      policy: new PassThroughConciergePolicy(),
      agentRuntime: new FakeRuntime(),
      skills: [],
      logger: silentLogger,
    }), /satelliteRegistry required/);
  });

  it('forwards personality to the agent so it appears in the system prompt', async () => {
    const sat = new Satellite({ id: 'c', mediaPlayerEntity: 'media_player.c', allowedSkills: ['memory'] });
    const memory = new InMemoryConciergeMemory();
    const capturedCalls = [];
    const capturingRuntime = {
      async execute(opts) { capturedCalls.push(opts); return { output: 'ok', toolCalls: [] }; },
      async *streamExecute() { yield { type: 'finish' }; },
    };
    const app = new ConciergeApplication({
      satelliteRegistry: new InMemoryRegistry(sat, 'tok'),
      memory,
      policy: new PassThroughConciergePolicy(),
      agentRuntime: capturingRuntime,
      skills: [new MemorySkill({ memory, logger: silentLogger })],
      personality: 'Talk like a pirate, arrr.',
      logger: silentLogger,
    });
    await app.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    assert.ok(capturedCalls.length > 0, 'runtime.execute should have been called');
    const { systemPrompt } = capturedCalls[0];
    assert.ok(systemPrompt.includes('## Personality'), 'personality header should be in prompt');
    assert.ok(systemPrompt.includes('Talk like a pirate, arrr.'), 'personality text should be in prompt');
  });

  it('forwards vocabulary to the agent so it appears in the system prompt', async () => {
    const sat = new Satellite({ id: 'b', mediaPlayerEntity: 'media_player.b', allowedSkills: ['memory'] });
    const memory = new InMemoryConciergeMemory();
    const capturedCalls = [];
    const capturingRuntime = {
      async execute(opts) { capturedCalls.push(opts); return { output: 'ok', toolCalls: [] }; },
      async *streamExecute() { yield { type: 'finish' }; },
    };
    const vocab = new AliasMap({ 'FHE': 'Family Home Evening (Mondays at 7pm)' });
    const app = new ConciergeApplication({
      satelliteRegistry: new InMemoryRegistry(sat, 'tok'),
      memory,
      policy: new PassThroughConciergePolicy(),
      agentRuntime: capturingRuntime,
      skills: [new MemorySkill({ memory, logger: silentLogger })],
      vocabulary: vocab,
      logger: silentLogger,
    });
    await app.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    assert.ok(capturedCalls.length > 0, 'runtime.execute should have been called');
    const { systemPrompt } = capturedCalls[0];
    assert.ok(systemPrompt.includes('## Household vocabulary'), 'vocabulary header should be in prompt');
    assert.ok(systemPrompt.includes('- FHE = Family Home Evening'), 'FHE entry should be in prompt');
  });
});
