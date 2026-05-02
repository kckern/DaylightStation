import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrainPolicyEvaluator } from '../../../../../src/3_applications/brain/services/BrainPolicyEvaluator.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function satellite({ scopes_allowed = [], scopes_denied = [] } = {}) {
  return { id: 'test-sat', scopes_allowed, scopes_denied, allowedSkills: [], canUseSkill: () => true };
}

function tool({ name = 'noop', defaultPolicy, getScopesFor } = {}) {
  const t = { name, description: '', parameters: {}, execute: async () => ({ ok: true }) };
  if (defaultPolicy !== undefined) t.defaultPolicy = defaultPolicy;
  if (getScopesFor !== undefined) t.getScopesFor = getScopesFor;
  return t;
}

describe('BrainPolicyEvaluator — defaults & basic shape', () => {
  it('default-open tool with no rules → allow', () => {
    const ev = new BrainPolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const d = ev.evaluateToolCall(satellite(), 'remember_note', {}, tool({ name: 'remember_note' }), 'memory');
    assert.strictEqual(d.allow, true);
  });

  it('default-restricted tool with no allow rule → deny', () => {
    const ev = new BrainPolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const t = tool({
      name: 'read_data_file',
      defaultPolicy: 'restricted',
      getScopesFor: ({ path }) => [`data:${path.replace(/\//g, ':')}`],
    });
    const d = ev.evaluateToolCall(satellite(), 'read_data_file', { path: 'finances/budget.yml' }, t, 'helpdesk');
    assert.strictEqual(d.allow, false);
    assert.match(d.reason, /uncovered/);
  });

  it('falls back to <skill>:<tool> scope when getScopesFor is missing', () => {
    const ev = new BrainPolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const sat = satellite({ scopes_allowed: ['memory:remember_note'] });
    const t = tool({ name: 'remember_note', defaultPolicy: 'restricted' });
    const d = ev.evaluateToolCall(sat, 'remember_note', {}, t, 'memory');
    assert.strictEqual(d.allow, true);
  });

  it('fallback scope used when getScopesFor returns []', () => {
    const ev = new BrainPolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const sat = satellite({ scopes_allowed: ['memory:remember_note'] });
    const t = tool({
      name: 'remember_note',
      defaultPolicy: 'restricted',
      getScopesFor: () => [],
    });
    const d = ev.evaluateToolCall(sat, 'remember_note', {}, t, 'memory');
    assert.strictEqual(d.allow, true);
  });
});
