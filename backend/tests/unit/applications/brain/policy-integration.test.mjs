// backend/tests/unit/applications/brain/policy-integration.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SkillRegistry } from '../../../../src/3_applications/brain/services/SkillRegistry.mjs';
import { BrainPolicyEvaluator } from '../../../../src/3_applications/brain/services/BrainPolicyEvaluator.mjs';
import { Satellite } from '../../../../src/2_domains/brain/Satellite.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function fakeTranscript() {
  return { events: [], recordTool(e) { this.events.push(e); } };
}

function buildHelpdeskSkill() {
  return {
    name: 'helpdesk',
    getTools: () => [{
      name: 'read_data_file',
      description: 'Read a household data file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      defaultPolicy: 'restricted',
      getScopesFor: ({ path }) => {
        const segs = String(path).split('/').filter(Boolean);
        return [`data:${segs.join(':')}`];
      },
      execute: async ({ path }) => ({ ok: true, content: `contents of ${path}` }),
    }],
    getPromptFragment: () => '',
    getConfig: () => ({}),
  };
}

function buildMemorySkill() {
  return {
    name: 'memory',
    getTools: () => [{
      name: 'remember_note',
      description: 'Save a note',
      parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
      execute: async () => ({ ok: true }),
    }],
    getPromptFragment: () => '',
    getConfig: () => ({}),
  };
}

describe('Brain policy integration — SkillRegistry + BrainPolicyEvaluator', () => {
  const policy = new BrainPolicyEvaluator({
    householdPolicy: { scopes_denied: ['data:auth:*', 'data:finances:*'] },
    logger: silentLogger,
  });

  function buildSatellite({ scopes_allowed = [], scopes_denied = [] } = {}) {
    return new Satellite({
      id: 'office',
      mediaPlayerEntity: 'media_player.office',
      allowedSkills: ['helpdesk', 'memory'],
      scopes_allowed,
      scopes_denied,
    });
  }

  function buildRegistry() {
    const r = new SkillRegistry({ logger: silentLogger });
    r.register(buildHelpdeskSkill());
    r.register(buildMemorySkill());
    return r;
  }

  it('open tool with no scopes_allowed still runs (backward compat)', async () => {
    const sat = buildSatellite();
    const transcript = fakeTranscript();
    const tools = buildRegistry().buildToolsFor(sat, policy, transcript);
    const remember = tools.find(t => t.name === 'remember_note');
    const r = await remember.execute({ content: 'hi' }, { satellite: sat });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(transcript.events[0].policyDecision.allowed, true);
  });

  it('restricted tool with no satellite allow → policy_denied (uncovered)', async () => {
    const sat = buildSatellite();
    const transcript = fakeTranscript();
    const tools = buildRegistry().buildToolsFor(sat, policy, transcript);
    const reader = tools.find(t => t.name === 'read_data_file');
    const r = await reader.execute({ path: 'fitness/strava.yml' }, { satellite: sat });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /^policy_denied:uncovered/);
    assert.strictEqual(transcript.events[0].policyDecision.allowed, false);
  });

  it('restricted tool with matching satellite allow → executes', async () => {
    const sat = buildSatellite({ scopes_allowed: ['data:fitness:**'] });
    const transcript = fakeTranscript();
    const tools = buildRegistry().buildToolsFor(sat, policy, transcript);
    const reader = tools.find(t => t.name === 'read_data_file');
    const r = await reader.execute({ path: 'fitness/strava.yml' }, { satellite: sat });
    assert.strictEqual(r.ok, true);
    assert.match(r.content, /strava\.yml/);
    assert.strictEqual(transcript.events[0].policyDecision.allowed, true);
  });

  it('household deny beats satellite allow', async () => {
    const sat = buildSatellite({ scopes_allowed: ['data:**'] });   // satellite says yes to everything
    const transcript = fakeTranscript();
    const tools = buildRegistry().buildToolsFor(sat, policy, transcript);
    const reader = tools.find(t => t.name === 'read_data_file');
    const r = await reader.execute({ path: 'finances/budget.yml' }, { satellite: sat });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /^policy_denied:household:data:finances/);
    assert.strictEqual(transcript.events[0].policyDecision.allowed, false);
    assert.match(transcript.events[0].policyDecision.reason, /household:data:finances/);
  });

  it('multiple tool calls each get their own policy decision recorded', async () => {
    const sat = buildSatellite({ scopes_allowed: ['data:fitness:**', 'data:weather:**'] });
    const transcript = fakeTranscript();
    const tools = buildRegistry().buildToolsFor(sat, policy, transcript);
    const reader = tools.find(t => t.name === 'read_data_file');
    const remember = tools.find(t => t.name === 'remember_note');
    await reader.execute({ path: 'fitness/strava.yml' }, { satellite: sat });
    await reader.execute({ path: 'auth/secrets.yml' }, { satellite: sat });
    await remember.execute({ content: 'note' }, { satellite: sat });
    assert.strictEqual(transcript.events.length, 3);
    assert.strictEqual(transcript.events[0].policyDecision.allowed, true);
    assert.strictEqual(transcript.events[1].policyDecision.allowed, false);
    assert.match(transcript.events[1].policyDecision.reason, /household:data:auth/);
    assert.strictEqual(transcript.events[2].policyDecision.allowed, true);
  });
});
