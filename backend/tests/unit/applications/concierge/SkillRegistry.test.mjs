import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SkillRegistry } from '../../../../src/3_applications/concierge/services/SkillRegistry.mjs';
import { Satellite } from '../../../../src/2_domains/concierge/Satellite.mjs';
import { PassThroughConciergePolicy } from '../../../../src/3_applications/concierge/services/PassThroughConciergePolicy.mjs';

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
  const policy = new PassThroughConciergePolicy();
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

describe('SkillRegistry — passes tool + skill name into policy', () => {
  it('forwards tool object and skill name to evaluateToolCall', async () => {
    const calls = [];
    const policy = {
      evaluateRequest: () => ({ allow: true }),
      evaluateToolCall: (sat, toolName, args, tool, skillName) => {
        calls.push({ toolName, args, hasTool: !!tool, defaultPolicy: tool?.defaultPolicy, skillName });
        return { allow: true };
      },
      shapeResponse: (_s, t) => t,
    };
    const r = new SkillRegistry({ logger: silentLogger });
    r.register(makeSkill('memory', [{
      name: 'remember_note',
      description: '', parameters: {},
      defaultPolicy: 'restricted',
      execute: async () => ({ ok: true }),
    }]));
    const sat = new Satellite({ id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'] });
    const tools = r.buildToolsFor(sat, policy);
    await tools[0].execute({ content: 'x' }, { satellite: sat });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].toolName, 'remember_note');
    assert.strictEqual(calls[0].hasTool, true);
    assert.strictEqual(calls[0].defaultPolicy, 'restricted');
    assert.strictEqual(calls[0].skillName, 'memory');
  });

  it('records policyDecision on the transcript when transcript is provided', async () => {
    const transcript = { recordTool: (e) => transcript.events.push(e), events: [] };
    const policy = {
      evaluateRequest: () => ({ allow: true }),
      evaluateToolCall: () => ({ allow: false, reason: 'household:data:auth:*' }),
      shapeResponse: (_s, t) => t,
    };
    const r = new SkillRegistry({ logger: silentLogger });
    r.register(makeSkill('helpdesk', [{
      name: 'read_data_file',
      description: '', parameters: {},
      execute: async () => ({ ok: true }),
    }]));
    const sat = new Satellite({ id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['helpdesk'] });
    const tools = r.buildToolsFor(sat, policy, transcript);
    await tools[0].execute({ path: 'auth/x' }, { satellite: sat });
    assert.strictEqual(transcript.events.length, 1);
    const entry = transcript.events[0];
    assert.strictEqual(entry.policyDecision.allowed, false);
    assert.strictEqual(entry.policyDecision.reason, 'household:data:auth:*');
  });
});
