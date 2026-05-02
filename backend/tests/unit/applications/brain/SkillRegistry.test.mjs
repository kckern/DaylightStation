import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SkillRegistry } from '../../../../src/3_applications/brain/services/SkillRegistry.mjs';
import { Satellite } from '../../../../src/2_domains/brain/Satellite.mjs';
import { PassThroughBrainPolicy } from '../../../../src/3_applications/brain/services/PassThroughBrainPolicy.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function makeSkill(name, tools) {
  return {
    name,
    getTools() { return tools; },
    getPromptFragment(_s) { return `(${name} prompt)`; },
    getConfig() { return {}; },
  };
}

describe('SkillRegistry', () => {
  const policy = new PassThroughBrainPolicy();
  const sat = new Satellite({
    id: 's',
    mediaPlayerEntity: 'media_player.x',
    allowedSkills: ['memory', 'media'],
  });

  it('only returns enabled skills', () => {
    const r = new SkillRegistry({ logger: silentLogger });
    r.register(makeSkill('memory', [{ name: 'note', description: '', parameters: {}, execute: async () => null }]));
    r.register(makeSkill('home_automation', [{ name: 'toggle', description: '', parameters: {}, execute: async () => null }]));
    r.register(makeSkill('media', [{ name: 'play', description: '', parameters: {}, execute: async () => null }]));
    const skills = r.getSkillsFor(sat);
    assert.deepStrictEqual(skills.map((s) => s.name).sort(), ['media', 'memory']);
  });

  it('builds tools wrapped with policy gate that denies', async () => {
    const r = new SkillRegistry({ logger: silentLogger });
    r.register(makeSkill('memory', [{
      name: 'note',
      description: '',
      parameters: {},
      execute: async () => ({ ok: true }),
    }]));
    const denying = {
      evaluateRequest: () => ({ allow: true }),
      evaluateToolCall: () => ({ allow: false, reason: 'no' }),
      shapeResponse: (_s, t) => t,
    };
    const tools = r.buildToolsFor(sat, denying);
    const result = await tools[0].execute({}, { satellite: sat });
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /policy_denied/);
  });

  it('wrapped tool surfaces caught error as ok:false reason:error', async () => {
    const r = new SkillRegistry({ logger: silentLogger });
    r.register(makeSkill('memory', [{
      name: 'broken',
      description: '',
      parameters: {},
      execute: async () => { throw new Error('boom'); },
    }]));
    const tools = r.buildToolsFor(sat, policy);
    const result = await tools[0].execute({}, {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'error');
    assert.match(result.error, /boom/);
  });

  it('concatenates prompt fragments with separators', () => {
    const r = new SkillRegistry({ logger: silentLogger });
    r.register(makeSkill('memory', []));
    r.register(makeSkill('media', []));
    const text = r.buildPromptFragmentsFor(sat);
    assert.match(text, /memory prompt/);
    assert.match(text, /media prompt/);
  });

  it('register throws on duplicate skill name', () => {
    const r = new SkillRegistry({ logger: silentLogger });
    r.register(makeSkill('memory', []));
    assert.throws(() => r.register(makeSkill('memory', [])), /already registered/);
  });
});
