import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ConciergePolicyEvaluator } from '../../../../../src/3_applications/concierge/services/ConciergePolicyEvaluator.mjs';

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

describe('ConciergePolicyEvaluator — defaults & basic shape', () => {
  it('default-open tool with no rules → allow', () => {
    const ev = new ConciergePolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const d = ev.evaluateToolCall(satellite(), 'remember_note', {}, tool({ name: 'remember_note' }), 'memory');
    assert.strictEqual(d.allow, true);
  });

  it('default-restricted tool with no allow rule → deny', () => {
    const ev = new ConciergePolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
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
    const ev = new ConciergePolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const sat = satellite({ scopes_allowed: ['memory:remember_note'] });
    const t = tool({ name: 'remember_note', defaultPolicy: 'restricted' });
    const d = ev.evaluateToolCall(sat, 'remember_note', {}, t, 'memory');
    assert.strictEqual(d.allow, true);
  });

  it('fallback scope used when getScopesFor returns []', () => {
    const ev = new ConciergePolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
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

describe('ConciergePolicyEvaluator — deny precedence', () => {
  function ev({ household = {} } = {}) {
    return new ConciergePolicyEvaluator({ householdPolicy: household, logger: silentLogger });
  }
  const restrictedReader = (getScopesFor) => tool({
    name: 'read_data_file',
    defaultPolicy: 'restricted',
    getScopesFor,
  });

  it('household deny short-circuits even when satellite allows it', () => {
    const e = ev({ household: { scopes_denied: ['data:finances:**'] } });
    const sat = satellite({ scopes_allowed: ['data:**'] });
    const t = restrictedReader(({ path }) => [`data:${path.replace(/\//g, ':')}`]);
    const d = e.evaluateToolCall(sat, 'read_data_file', { path: 'finances/budget.yml' }, t, 'helpdesk');
    assert.strictEqual(d.allow, false);
    assert.match(d.reason, /^household:/);
    assert.match(d.reason, /data:finances:\*\*/);
  });

  it('satellite deny short-circuits even when household allows it', () => {
    const e = ev({ household: { scopes_allowed: ['ha:**'] } });
    const sat = satellite({ scopes_denied: ['ha:scripts:office:**'] });
    const t = restrictedReader(({ name }) => [`ha:scripts:office:${name}`]);
    const d = e.evaluateToolCall(sat, 'ha_run_script', { name: 'chill_activate' }, t, 'home_automation');
    assert.strictEqual(d.allow, false);
    assert.match(d.reason, /^satellite:/);
  });

  it('multi-scope: any single denied scope causes deny', () => {
    const e = ev({ household: { scopes_denied: ['data:auth:*'] } });
    const sat = satellite({ scopes_allowed: ['data:**'] });
    const t = tool({
      name: 'multi',
      defaultPolicy: 'restricted',
      getScopesFor: () => ['data:fitness:strava.yml', 'data:auth:user.yml', 'data:weather:today.yml'],
    });
    const d = e.evaluateToolCall(sat, 'multi', {}, t, 'helpdesk');
    assert.strictEqual(d.allow, false);
    assert.match(d.reason, /data:auth/);
  });

  it('multi-scope: all covered → allow', () => {
    const e = ev();
    const sat = satellite({ scopes_allowed: ['data:fitness:**', 'data:weather:**'] });
    const t = tool({
      name: 'multi',
      defaultPolicy: 'restricted',
      getScopesFor: () => ['data:fitness:strava.yml', 'data:weather:today.yml'],
    });
    const d = e.evaluateToolCall(sat, 'multi', {}, t, 'helpdesk');
    assert.strictEqual(d.allow, true);
  });

  it('multi-scope: any uncovered scope on a restricted tool → deny', () => {
    const e = ev();
    const sat = satellite({ scopes_allowed: ['data:fitness:**'] });
    const t = tool({
      name: 'multi',
      defaultPolicy: 'restricted',
      getScopesFor: () => ['data:fitness:strava.yml', 'data:weather:today.yml'],
    });
    const d = e.evaluateToolCall(sat, 'multi', {}, t, 'helpdesk');
    assert.strictEqual(d.allow, false);
    assert.match(d.reason, /uncovered:data:weather/);
  });

  it('household allow can cover what satellite does not (allow-list union)', () => {
    const e = ev({ household: { scopes_allowed: ['memory:**'] } });
    const sat = satellite();   // no satellite-level allows
    const t = tool({ name: 'remember_note', defaultPolicy: 'restricted', getScopesFor: () => ['memory:write:notes'] });
    const d = e.evaluateToolCall(sat, 'remember_note', {}, t, 'memory');
    assert.strictEqual(d.allow, true);
  });
});

describe('ConciergePolicyEvaluator — fail-closed on tool bugs', () => {
  it('getScopesFor that throws → uses fallback scope, restricted tool denies', () => {
    const ev = new ConciergePolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const t = tool({
      name: 'broken',
      defaultPolicy: 'restricted',
      getScopesFor: () => { throw new Error('explode'); },
    });
    const d = ev.evaluateToolCall(satellite(), 'broken', {}, t, 'helpdesk');
    assert.strictEqual(d.allow, false);
    assert.match(d.reason, /uncovered:helpdesk:broken/);
  });

  it('getScopesFor that throws → fallback scope, open tool allows', () => {
    const ev = new ConciergePolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const t = tool({
      name: 'sloppy',
      defaultPolicy: 'open',
      getScopesFor: () => { throw new Error('explode'); },
    });
    const d = ev.evaluateToolCall(satellite(), 'sloppy', {}, t, 'memory');
    assert.strictEqual(d.allow, true);
  });

  it('getScopesFor returns non-array → fallback used', () => {
    const ev = new ConciergePolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const sat = satellite({ scopes_allowed: ['helpdesk:weird'] });
    const t = tool({ name: 'weird', defaultPolicy: 'restricted', getScopesFor: () => 'string-not-array' });
    const d = ev.evaluateToolCall(sat, 'weird', {}, t, 'helpdesk');
    assert.strictEqual(d.allow, true);   // fallback scope 'helpdesk:weird' matches
  });

  it('boot-time: malformed household glob throws at construction', () => {
    assert.throws(
      () => new ConciergePolicyEvaluator({
        householdPolicy: { scopes_denied: ['data:[bad]:*'] },
        logger: silentLogger,
      }),
      /invalid scope/i,
    );
  });
});
