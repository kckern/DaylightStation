import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ConciergeAgent } from '../../../../src/3_applications/concierge/ConciergeAgent.mjs';
import { Satellite } from '../../../../src/2_domains/concierge/Satellite.mjs';
import { PassThroughConciergePolicy } from '../../../../src/3_applications/concierge/services/PassThroughConciergePolicy.mjs';
import { SkillRegistry } from '../../../../src/3_applications/concierge/services/SkillRegistry.mjs';
import { MemorySkill } from '../../../../src/3_applications/concierge/skills/MemorySkill.mjs';
import { AliasMap } from '../../../../src/2_domains/common/AliasMap.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class InMemoryConciergeMemory {
  constructor() { this.store = {}; }
  async get(k) { return this.store[k] ?? null; }
  async set(k, v) { this.store[k] = v; }
  async merge() {}
}

class FakeRuntime {
  constructor({ outputs }) { this.outputs = outputs; this.calls = []; }
  async execute(opts) {
    this.calls.push(opts);
    return this.outputs.execute ?? { output: 'ok', toolCalls: [] };
  }
  async *streamExecute(opts) {
    this.calls.push(opts);
    for (const c of this.outputs.stream ?? [{ type: 'text-delta', text: 'ok' }, { type: 'finish' }]) {
      yield c;
    }
  }
}

describe('ConciergeAgent', () => {
  const sat = new Satellite({ id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'] });
  const policy = new PassThroughConciergePolicy();

  function build(runtimeOutputs = {}) {
    const memory = new InMemoryConciergeMemory();
    const registry = new SkillRegistry({ logger: silentLogger });
    registry.register(new MemorySkill({ memory, logger: silentLogger }));
    const runtime = new FakeRuntime({ outputs: runtimeOutputs });
    const agent = new ConciergeAgent({
      agentRuntime: runtime,
      memory,
      policy,
      skills: registry,
      logger: silentLogger,
    });
    return { agent, runtime, memory };
  }

  it('runChat returns the runtime output as content', async () => {
    const { agent } = build({ execute: { output: 'Hello there.', toolCalls: [] } });
    const result = await agent.runChat({
      satellite: sat,
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.strictEqual(result.content, 'Hello there.');
  });

  it('passes assembled prompt and tools to runtime.execute', async () => {
    const { agent, runtime } = build({ execute: { output: 'ok', toolCalls: [] } });
    await agent.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    const opts = runtime.calls[0];
    assert.match(opts.systemPrompt, /satellite/i);
    assert.ok(opts.tools.length > 0);
    const toolNames = opts.tools.map((t) => t.name);
    assert.ok(toolNames.includes('remember_note') || toolNames.includes('recall_note'));
  });

  it('streamChat yields text deltas', async () => {
    const { agent } = build({
      stream: [
        { type: 'text-delta', text: 'Hi' },
        { type: 'text-delta', text: ' there' },
        { type: 'finish' },
      ],
    });
    const chunks = [];
    for await (const c of agent.streamChat({
      satellite: sat,
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c);
    }
    const texts = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('');
    assert.strictEqual(texts, 'Hi there');
  });

  it('refuses pre-flight via policy', async () => {
    const memory = new InMemoryConciergeMemory();
    const registry = new SkillRegistry({ logger: silentLogger });
    registry.register(new MemorySkill({ memory, logger: silentLogger }));
    const runtime = new FakeRuntime({ outputs: {} });
    const denyAll = {
      evaluateRequest: () => ({ allow: false, reason: 'quiet_hours' }),
      evaluateToolCall: () => ({ allow: true }),
      shapeResponse: (_s, t) => t,
    };
    const agent = new ConciergeAgent({
      agentRuntime: runtime,
      memory,
      policy: denyAll,
      skills: registry,
      logger: silentLogger,
    });
    const result = await agent.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    assert.match(result.content, /can't/i);
    assert.strictEqual(runtime.calls.length, 0);
  });

  it('includes vocabulary section in systemPrompt when non-empty AliasMap is provided', async () => {
    const memory = new InMemoryConciergeMemory();
    const registry = new SkillRegistry({ logger: silentLogger });
    registry.register(new MemorySkill({ memory, logger: silentLogger }));
    const runtime = new FakeRuntime({ outputs: { execute: { output: 'ok', toolCalls: [] } } });
    const vocab = new AliasMap({ 'FHE': 'Family Home Evening', 'big room': 'living room' });
    const agent = new ConciergeAgent({
      agentRuntime: runtime,
      memory,
      policy,
      skills: registry,
      vocabulary: vocab,
      logger: silentLogger,
    });
    await agent.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    const { systemPrompt } = runtime.calls[0];
    assert.ok(systemPrompt.includes('## Household vocabulary'), 'should include vocabulary header');
    assert.ok(systemPrompt.includes('- FHE = Family Home Evening'), 'should include FHE entry');
    assert.ok(systemPrompt.includes('- big room = living room'), 'should include big room entry');
  });

  it('includes personality section in systemPrompt when personality string is provided', async () => {
    const memory = new InMemoryConciergeMemory();
    const registry = new SkillRegistry({ logger: silentLogger });
    registry.register(new MemorySkill({ memory, logger: silentLogger }));
    const runtime = new FakeRuntime({ outputs: { execute: { output: 'ok', toolCalls: [] } } });
    const agent = new ConciergeAgent({
      agentRuntime: runtime,
      memory,
      policy,
      skills: registry,
      personality: 'Speak like a refined English butler. Address the user as sir.',
      logger: silentLogger,
    });
    await agent.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    const { systemPrompt } = runtime.calls[0];
    assert.ok(systemPrompt.includes('## Personality'), 'should include personality header');
    assert.ok(systemPrompt.includes('Speak like a refined English butler'), 'should include personality text');
  });

  it('omits personality section when personality is null', async () => {
    const { agent, runtime } = build({ execute: { output: 'ok', toolCalls: [] } });
    await agent.runChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] });
    const { systemPrompt } = runtime.calls[0];
    assert.ok(!systemPrompt.includes('## Personality'), 'should not include personality header when null');
  });

  it('streamChat refusal yields a single text-delta + finish', async () => {
    const memory = new InMemoryConciergeMemory();
    const registry = new SkillRegistry({ logger: silentLogger });
    const denyAll = {
      evaluateRequest: () => ({ allow: false, reason: 'busy' }),
      evaluateToolCall: () => ({ allow: true }),
      shapeResponse: (_s, t) => t,
    };
    const runtime = new FakeRuntime({ outputs: {} });
    const agent = new ConciergeAgent({
      agentRuntime: runtime,
      memory,
      policy: denyAll,
      skills: registry,
      logger: silentLogger,
    });
    const chunks = [];
    for await (const c of agent.streamChat({ satellite: sat, messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(c);
    }
    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].type, 'text-delta');
    assert.match(chunks[0].text, /can't/i);
    assert.strictEqual(chunks[1].type, 'finish');
    assert.strictEqual(runtime.calls.length, 0);
  });
});
