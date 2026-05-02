import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrainApplication } from '../../../../src/3_applications/brain/BrainApplication.mjs';
import { Satellite } from '../../../../src/2_domains/brain/Satellite.mjs';
import { MemorySkill } from '../../../../src/3_applications/brain/skills/MemorySkill.mjs';
import { PassThroughBrainPolicy } from '../../../../src/3_applications/brain/services/PassThroughBrainPolicy.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class InMemoryRegistry {
  constructor(satellite, token) { this.satellite = satellite; this.token = token; }
  async findByToken(t) { return t === this.token ? this.satellite : null; }
  async list() { return [this.satellite]; }
}

class InMemoryBrainMemory {
  constructor() { this.store = {}; }
  async get(k) { return this.store[k] ?? null; }
  async set(k, v) { this.store[k] = v; }
  async merge() {}
}

class FakeRuntime {
  async execute() { return { output: 'ok', toolCalls: [] }; }
  async *streamExecute() { yield { type: 'finish' }; }
}

describe('BrainApplication', () => {
  it('exposes runChat / streamChat (IChatCompletionRunner)', async () => {
    const sat = new Satellite({ id: 'a', mediaPlayerEntity: 'media_player.a', allowedSkills: ['memory'] });
    const memory = new InMemoryBrainMemory();
    const app = new BrainApplication({
      satelliteRegistry: new InMemoryRegistry(sat, 'tok'),
      memory,
      policy: new PassThroughBrainPolicy(),
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
    assert.throws(() => new BrainApplication({
      memory: {},
      policy: new PassThroughBrainPolicy(),
      agentRuntime: new FakeRuntime(),
      skills: [],
      logger: silentLogger,
    }), /satelliteRegistry required/);
  });
});
