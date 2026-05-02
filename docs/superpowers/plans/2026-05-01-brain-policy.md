# Brain Policy with Teeth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the no-op `PassThroughBrainPolicy` with a real `BrainPolicyEvaluator` that enforces per-satellite, per-tool, per-args governance via scope strings — fulfilling the gating mechanism the brain has been promising since v1.

**Architecture:** Tools self-declare `defaultPolicy` (`'open' | 'restricted'`) and `getScopesFor(args) → string[]`. Satellite YAML config declares glob lists of `scopes_allowed` / `scopes_denied`, with non-overridable household-level defaults. A `BrainPolicyEvaluator` service merges household + satellite rules, walks the tool's emitted scopes (deny-wins precedence), and returns `BrainDecision.allow()` or `BrainDecision.deny(reason)` per tool call. SkillRegistry already has the wrap-and-gate machinery — we just inject the new evaluator instead of the no-op. Per-decision audit lands in the existing `BrainTranscript`.

**Tech Stack:** Node.js (`.mjs`), `node:test` runner, YAML config via existing `ConfigService.reloadHouseholdAppConfig`, deployment via `sudo deploy-daylight` on `kckern-server`.

**Spec:** `/opt/Code/DaylightStation/docs/superpowers/specs/2026-05-01-brain-policy-design.md`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `backend/src/3_applications/brain/services/scopeMatcher.mjs` | **Create** | Pure glob-match helper (`*` single segment, `**` multi). One responsibility: scope-string matching. ~30 lines. |
| `backend/src/3_applications/brain/services/BrainPolicyEvaluator.mjs` | **Create** | Implements `IBrainPolicy.evaluateToolCall`. Takes household + satellite config, evaluates per-call scopes, returns `BrainDecision`. ~80 lines. |
| `backend/src/3_applications/brain/services/SkillRegistry.mjs` | **Modify** | Pass the registering skill's name into the policy evaluator; pass the tool object (so the evaluator can read `getScopesFor` / `defaultPolicy`); record `policyDecision` into the transcript. ~10 line change. |
| `backend/src/3_applications/brain/services/BrainTranscript.mjs` | **Modify** | `recordTool` accepts an optional `policyDecision` field. ~5 line change. |
| `backend/src/0_system/bootstrap.mjs` | **Modify** | In `createBrainServices`: validate `brain.yml.policy` + each satellite's `scopes_*` at boot, instantiate `BrainPolicyEvaluator`, inject into `BrainApplication` instead of `PassThroughBrainPolicy`. ~30 line change. |
| `backend/src/2_domains/brain/Satellite.mjs` | **Modify** | Add `scopes_allowed` and `scopes_denied` constructor fields (default `[]`). ~5 line change. |
| `backend/src/1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs` | **Modify** | Pass `scopes_allowed` / `scopes_denied` from YAML through to the `Satellite` constructor. ~3 line change. |
| `backend/tests/unit/applications/brain/services/scopeMatcher.test.mjs` | **Create** | Glob match edge cases. |
| `backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs` | **Create** | Decision matrix: defaults × allow/deny × household/satellite × multi-scope. |
| `backend/tests/unit/applications/brain/policy-integration.test.mjs` | **Create** | End-to-end through SkillRegistry: fake satellite, fake tools, assert decisions land in transcript. |
| `backend/tests/unit/domains/brain/Satellite.test.mjs` | **Modify** | Cover the two new constructor fields. |

---

## Phase 1 — Pure helpers (no integration)

### Task 1: scopeMatcher

**Files:**
- Create: `backend/src/3_applications/brain/services/scopeMatcher.mjs`
- Test: `backend/tests/unit/applications/brain/services/scopeMatcher.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/unit/applications/brain/services/scopeMatcher.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { matchesScope, validateGlob } from '../../../../../src/3_applications/brain/services/scopeMatcher.mjs';

describe('matchesScope', () => {
  it('exact match returns true', () => {
    assert.strictEqual(matchesScope('data:fitness:strava.yml', 'data:fitness:strava.yml'), true);
  });

  it('* matches a single segment only', () => {
    assert.strictEqual(matchesScope('data:fitness:strava.yml', 'data:fitness:*'), true);
    assert.strictEqual(matchesScope('data:fitness:cardio:peloton.yml', 'data:fitness:*'), false);
    assert.strictEqual(matchesScope('data:weather:today.yml', 'data:fitness:*'), false);
  });

  it('** matches one or more segments', () => {
    assert.strictEqual(matchesScope('data:fitness:strava.yml', 'data:fitness:**'), true);
    assert.strictEqual(matchesScope('data:fitness:cardio:peloton.yml', 'data:fitness:**'), true);
    assert.strictEqual(matchesScope('data:fitness', 'data:fitness:**'), false);
    assert.strictEqual(matchesScope('data:weather:today.yml', 'data:fitness:**'), false);
  });

  it('mixed wildcards combine', () => {
    assert.strictEqual(matchesScope('ha:office:lights:turn_on', 'ha:*:lights:**'), true);
    assert.strictEqual(matchesScope('ha:kitchen:lights:turn_on:bright', 'ha:*:lights:**'), true);
    assert.strictEqual(matchesScope('ha:office:scripts:vent', 'ha:*:lights:**'), false);
  });

  it('case-sensitive', () => {
    assert.strictEqual(matchesScope('data:Fitness:x', 'data:fitness:*'), false);
  });

  it('returns false for non-string inputs', () => {
    assert.strictEqual(matchesScope(null, 'data:*'), false);
    assert.strictEqual(matchesScope('data:x', null), false);
    assert.strictEqual(matchesScope(undefined, undefined), false);
  });

  it('empty scope and empty pattern', () => {
    assert.strictEqual(matchesScope('', ''), true);
    assert.strictEqual(matchesScope('', '*'), true);
    assert.strictEqual(matchesScope('a', ''), false);
  });
});

describe('validateGlob', () => {
  it('accepts simple patterns', () => {
    assert.doesNotThrow(() => validateGlob('data:fitness:*'));
    assert.doesNotThrow(() => validateGlob('data:fitness:**'));
    assert.doesNotThrow(() => validateGlob('memory:*'));
    assert.doesNotThrow(() => validateGlob('exact:scope'));
  });

  it('rejects regex/character-class artifacts', () => {
    assert.throws(() => validateGlob('data:[fitness]:*'), /invalid scope/i);
    assert.throws(() => validateGlob('data:fitness:?'), /invalid scope/i);
    assert.throws(() => validateGlob('data:fitness:.*'), /invalid scope/i);
  });

  it('rejects non-string', () => {
    assert.throws(() => validateGlob(null), /string/i);
    assert.throws(() => validateGlob(42), /string/i);
  });

  it('rejects empty string', () => {
    assert.throws(() => validateGlob(''), /empty/i);
  });
});
```

- [ ] **Step 2: Run the test — confirm FAIL**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/services/scopeMatcher.test.mjs
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement scopeMatcher.mjs**

```javascript
// backend/src/3_applications/brain/services/scopeMatcher.mjs

/**
 * Match a scope string against a glob pattern. The scope vocabulary uses
 * `:` as the segment separator; wildcards inside a segment are not supported.
 *
 *   *   matches exactly one segment
 *   **  matches one or more segments
 *
 * Examples:
 *   matchesScope('data:fitness:strava.yml', 'data:fitness:*') → true
 *   matchesScope('data:fitness:cardio:peloton.yml', 'data:fitness:*') → false
 *   matchesScope('data:fitness:cardio:peloton.yml', 'data:fitness:**') → true
 */
export function matchesScope(scope, pattern) {
  if (typeof scope !== 'string' || typeof pattern !== 'string') return false;
  if (scope === pattern) return true;
  const scopeSegs = scope === '' ? [] : scope.split(':');
  const patSegs = pattern === '' ? [] : pattern.split(':');
  return walk(scopeSegs, 0, patSegs, 0);
}

function walk(scopeSegs, si, patSegs, pi) {
  if (pi === patSegs.length) return si === scopeSegs.length;
  const pat = patSegs[pi];
  if (pat === '**') {
    // ** must consume at least one segment
    for (let consume = 1; si + consume <= scopeSegs.length; consume++) {
      if (walk(scopeSegs, si + consume, patSegs, pi + 1)) return true;
    }
    return false;
  }
  if (pat === '*') {
    if (si >= scopeSegs.length) return false;
    return walk(scopeSegs, si + 1, patSegs, pi + 1);
  }
  if (si >= scopeSegs.length) return false;
  if (scopeSegs[si] !== pat) return false;
  return walk(scopeSegs, si + 1, patSegs, pi + 1);
}

/**
 * Validate a glob pattern at boot time. Throws on anything we don't intend
 * to support — catches regex artifacts, character classes, etc. before they
 * silently never-match at runtime.
 */
export function validateGlob(pattern) {
  if (typeof pattern !== 'string') throw new Error('invalid scope: must be string');
  if (pattern.length === 0) throw new Error('invalid scope: empty pattern');
  // Allowed chars per segment: a-z A-Z 0-9 _ . - (segment separator is :)
  // Allowed wildcards: * and ** as full segment values
  const segs = pattern.split(':');
  for (const seg of segs) {
    if (seg === '*' || seg === '**') continue;
    if (!/^[A-Za-z0-9_.\-]+$/.test(seg)) {
      throw new Error(`invalid scope segment '${seg}' in pattern '${pattern}'`);
    }
  }
}

export default { matchesScope, validateGlob };
```

- [ ] **Step 4: Run the test — confirm PASS**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/services/scopeMatcher.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/brain/services/scopeMatcher.mjs \
        backend/tests/unit/applications/brain/services/scopeMatcher.test.mjs
git commit -m "feat(brain): scope glob matcher (* segment, ** multi-segment) + boot validator"
```

---

## Phase 2 — BrainPolicyEvaluator (the core)

### Task 2: BrainPolicyEvaluator — happy path & default-open behavior

**Files:**
- Create: `backend/src/3_applications/brain/services/BrainPolicyEvaluator.mjs`
- Test: `backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs`

- [ ] **Step 1: Write the failing test (basic shape + default-open)**

```javascript
// backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrainPolicyEvaluator } from '../../../../../src/3_applications/brain/services/BrainPolicyEvaluator.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function satellite({ scopes_allowed = [], scopes_denied = [] } = {}) {
  // Minimal satellite stand-in — Satellite class will get these fields in Task 7.
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
```

- [ ] **Step 2: Run the test — confirm FAIL**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs
```

Expected: FAIL — `BrainPolicyEvaluator` not found.

- [ ] **Step 3: Implement BrainPolicyEvaluator (minimum to make Task-2 tests pass)**

```javascript
// backend/src/3_applications/brain/services/BrainPolicyEvaluator.mjs

import { matchesScope, validateGlob } from './scopeMatcher.mjs';
import { BrainDecision } from '../../../2_domains/brain/BrainDecision.mjs';

/**
 * BrainPolicyEvaluator — implements IBrainPolicy.evaluateToolCall with real
 * teeth. Tools self-declare `defaultPolicy` (default 'open') and optionally
 * `getScopesFor(args) → string[]`. Satellite + household config declare
 * scope-glob allow/deny lists. Deny is non-overridable downward (household
 * deny wins over satellite allow).
 *
 * The other two IBrainPolicy methods (`evaluateRequest`, `shapeResponse`)
 * remain no-op — their implementations are deferred to a later policy phase.
 */
export class BrainPolicyEvaluator {
  #household;
  #logger;

  constructor({ householdPolicy = {}, logger = console } = {}) {
    this.#household = {
      scopes_allowed: householdPolicy.scopes_allowed ?? [],
      scopes_denied: householdPolicy.scopes_denied ?? [],
    };
    this.#logger = logger;
    // Boot-time validation. Throws on first malformed pattern.
    for (const p of this.#household.scopes_allowed) validateGlob(p);
    for (const p of this.#household.scopes_denied) validateGlob(p);
  }

  // No-op v1 — kept so PolicyEvaluator satisfies the full IBrainPolicy interface.
  evaluateRequest(_satellite, _request) { return BrainDecision.allow(); }
  shapeResponse(_satellite, draft) { return draft; }

  /**
   * @param {Object} satellite        - satellite descriptor with scopes_allowed/scopes_denied
   * @param {string} toolName
   * @param {Object} args             - args the LLM passed to the tool
   * @param {Object} tool             - the tool object (so we can read defaultPolicy + getScopesFor)
   * @param {string} skillName        - registering skill (used for fallback scope)
   * @returns {BrainDecision}
   */
  evaluateToolCall(satellite, toolName, args, tool, skillName) {
    const fallbackScope = `${skillName ?? 'unknown'}:${toolName}`;
    const scopes = this.#computeScopes(tool, args, fallbackScope);

    const satAllowed = satellite?.scopes_allowed ?? [];
    const satDenied = satellite?.scopes_denied ?? [];

    // Deny pass — household first, then satellite. Deny is absolute.
    for (const scope of scopes) {
      const hHit = this.#household.scopes_denied.find((p) => matchesScope(scope, p));
      if (hHit) return BrainDecision.deny(`household:${hHit}`);
      const sHit = satDenied.find((p) => matchesScope(scope, p));
      if (sHit) return BrainDecision.deny(`satellite:${sHit}`);
    }

    // Coverage pass — every scope must match at least one allow rule
    // (household OR satellite) to be covered. Default policy decides
    // the uncovered case.
    const allAllowed = scopes.every((scope) =>
      this.#household.scopes_allowed.some((p) => matchesScope(scope, p))
      || satAllowed.some((p) => matchesScope(scope, p)),
    );
    if (allAllowed) return BrainDecision.allow();

    const def = tool?.defaultPolicy ?? 'open';
    if (def === 'open') return BrainDecision.allow();
    // Find the first uncovered scope for a useful reason
    const uncovered = scopes.find((scope) =>
      !this.#household.scopes_allowed.some((p) => matchesScope(scope, p))
      && !satAllowed.some((p) => matchesScope(scope, p)),
    );
    return BrainDecision.deny(`uncovered:${uncovered}`);
  }

  #computeScopes(tool, args, fallbackScope) {
    if (typeof tool?.getScopesFor !== 'function') return [fallbackScope];
    let scopes;
    try {
      scopes = tool.getScopesFor(args);
    } catch (err) {
      this.#logger.warn?.('brain.policy.scopes_emit_failed', { tool: tool.name, error: err.message });
      // Fail-closed: treat as fallback scope (no special access). The deny
      // path may still hit, otherwise the default-policy decides.
      return [fallbackScope];
    }
    if (!Array.isArray(scopes) || scopes.length === 0) return [fallbackScope];
    return scopes.map((s) => String(s));
  }
}

export default BrainPolicyEvaluator;
```

- [ ] **Step 4: Run Task-2 tests — confirm PASS**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/brain/services/BrainPolicyEvaluator.mjs \
        backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs
git commit -m "feat(brain): BrainPolicyEvaluator — defaults + uncovered/restricted gating"
```

---

### Task 3: BrainPolicyEvaluator — explicit deny precedence

**Files:**
- Modify: `backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs`

- [ ] **Step 1: Add the deny-precedence test suite**

Append to the test file:

```javascript
describe('BrainPolicyEvaluator — deny precedence', () => {
  function ev({ household = {} } = {}) {
    return new BrainPolicyEvaluator({ householdPolicy: household, logger: silentLogger });
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
```

- [ ] **Step 2: Run — all old + new tests should pass without changes to BrainPolicyEvaluator.mjs**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs
```

Expected: all pass. (Implementation in Task 2 already handled these cases.)

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs
git commit -m "test(brain): BrainPolicyEvaluator deny-precedence and multi-scope cases"
```

---

### Task 4: BrainPolicyEvaluator — fail-closed on tool bugs

**Files:**
- Modify: `backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs`

- [ ] **Step 1: Add the fail-closed test suite**

Append:

```javascript
describe('BrainPolicyEvaluator — fail-closed on tool bugs', () => {
  it('getScopesFor that throws → uses fallback scope, restricted tool denies', () => {
    const ev = new BrainPolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
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
    const ev = new BrainPolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const t = tool({
      name: 'sloppy',
      defaultPolicy: 'open',
      getScopesFor: () => { throw new Error('explode'); },
    });
    const d = ev.evaluateToolCall(satellite(), 'sloppy', {}, t, 'memory');
    assert.strictEqual(d.allow, true);
  });

  it('getScopesFor returns non-array → fallback used', () => {
    const ev = new BrainPolicyEvaluator({ householdPolicy: {}, logger: silentLogger });
    const sat = satellite({ scopes_allowed: ['helpdesk:weird'] });
    const t = tool({ name: 'weird', defaultPolicy: 'restricted', getScopesFor: () => 'string-not-array' });
    const d = ev.evaluateToolCall(sat, 'weird', {}, t, 'helpdesk');
    assert.strictEqual(d.allow, true);   // fallback scope 'helpdesk:weird' matches
  });

  it('boot-time: malformed household glob throws at construction', () => {
    assert.throws(
      () => new BrainPolicyEvaluator({
        householdPolicy: { scopes_denied: ['data:[bad]:*'] },
        logger: silentLogger,
      }),
      /invalid scope/i,
    );
  });
});
```

- [ ] **Step 2: Run — confirm tests pass without further code changes**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs
git commit -m "test(brain): BrainPolicyEvaluator fail-closed on tool bugs + boot-time validation"
```

---

## Phase 3 — Wire it into the pipeline

### Task 5: Satellite domain — accept scopes_allowed / scopes_denied

**Files:**
- Modify: `backend/src/2_domains/brain/Satellite.mjs`
- Modify: `backend/tests/unit/domains/brain/Satellite.test.mjs`

- [ ] **Step 1: Add failing tests for the new fields**

Read the current test file at `backend/tests/unit/domains/brain/Satellite.test.mjs`, then append:

```javascript
describe('Satellite — policy scope fields', () => {
  it('defaults scopes_allowed and scopes_denied to empty arrays', () => {
    const s = new Satellite({
      id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
    });
    assert.deepStrictEqual(s.scopes_allowed, []);
    assert.deepStrictEqual(s.scopes_denied, []);
  });

  it('accepts and freezes scopes_allowed and scopes_denied', () => {
    const s = new Satellite({
      id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
      scopes_allowed: ['memory:**', 'ha:office:**'],
      scopes_denied:  ['ha:scripts:dangerous:*'],
    });
    assert.deepStrictEqual(s.scopes_allowed, ['memory:**', 'ha:office:**']);
    assert.deepStrictEqual(s.scopes_denied, ['ha:scripts:dangerous:*']);
    assert.throws(() => s.scopes_allowed.push('x'));
    assert.throws(() => s.scopes_denied.push('x'));
  });

  it('rejects non-array scopes_allowed', () => {
    assert.throws(() =>
      new Satellite({
        id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
        scopes_allowed: 'memory:*',
      }),
      /scopes_allowed/,
    );
  });

  it('rejects non-array scopes_denied', () => {
    assert.throws(() =>
      new Satellite({
        id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
        scopes_denied: 42,
      }),
      /scopes_denied/,
    );
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/domains/brain/Satellite.test.mjs
```

Expected: 4 new tests fail.

- [ ] **Step 3: Modify `Satellite.mjs`**

Open `backend/src/2_domains/brain/Satellite.mjs`. Replace the constructor with:

```javascript
constructor({
  id,
  mediaPlayerEntity,
  area = null,
  allowedSkills = [],
  defaultVolume = null,
  defaultMediaClass = null,
  scopes_allowed = [],
  scopes_denied = [],
}) {
  if (!id || typeof id !== 'string') throw new Error('Satellite.id is required');
  if (!mediaPlayerEntity || typeof mediaPlayerEntity !== 'string') {
    throw new Error('Satellite.mediaPlayerEntity is required');
  }
  if (!Array.isArray(allowedSkills) || allowedSkills.length === 0) {
    throw new Error('Satellite.allowedSkills must be a non-empty list');
  }
  if (!Array.isArray(scopes_allowed)) throw new Error('Satellite.scopes_allowed must be an array');
  if (!Array.isArray(scopes_denied)) throw new Error('Satellite.scopes_denied must be an array');

  this.id = id;
  this.mediaPlayerEntity = mediaPlayerEntity;
  this.area = area;
  this.allowedSkills = Object.freeze([...allowedSkills]);
  this.defaultVolume = defaultVolume;
  this.defaultMediaClass = defaultMediaClass;
  this.scopes_allowed = Object.freeze([...scopes_allowed]);
  this.scopes_denied = Object.freeze([...scopes_denied]);
  Object.freeze(this);
}
```

- [ ] **Step 4: Run — confirm all Satellite tests pass**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/domains/brain/Satellite.test.mjs
```

Expected: all (5 existing + 4 new) pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/2_domains/brain/Satellite.mjs backend/tests/unit/domains/brain/Satellite.test.mjs
git commit -m "feat(brain): Satellite accepts scopes_allowed / scopes_denied (defaults [])"
```

---

### Task 6: YamlSatelliteRegistry — pass scope fields through

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs`
- Modify: `backend/tests/unit/adapters/persistence/YamlSatelliteRegistry.test.mjs`

- [ ] **Step 1: Add failing test**

Append to the registry test file:

```javascript
describe('YamlSatelliteRegistry — scope fields', () => {
  it('passes scopes_allowed and scopes_denied from YAML through to Satellite', async () => {
    const cfg = makeFakeConfigService(
      {
        satellites: [{
          id: 'office',
          media_player_entity: 'media_player.office',
          allowed_skills: ['memory'],
          scopes_allowed: ['memory:**', 'data:fitness:*'],
          scopes_denied: ['data:auth:*'],
          token_ref: 'ENV:T',
        }],
      },
      { T: 'tok' },
    );
    const registry = new YamlSatelliteRegistry({ configService: cfg, logger: console });
    await registry.load();
    const s = await registry.findByToken('tok');
    assert.deepStrictEqual([...s.scopes_allowed], ['memory:**', 'data:fitness:*']);
    assert.deepStrictEqual([...s.scopes_denied], ['data:auth:*']);
  });

  it('defaults scope fields to empty when YAML omits them', async () => {
    const cfg = makeFakeConfigService(
      {
        satellites: [{
          id: 'office', media_player_entity: 'media_player.office',
          allowed_skills: ['memory'], token_ref: 'ENV:T',
        }],
      },
      { T: 'tok' },
    );
    const registry = new YamlSatelliteRegistry({ configService: cfg, logger: console });
    await registry.load();
    const s = await registry.findByToken('tok');
    assert.strictEqual(s.scopes_allowed.length, 0);
    assert.strictEqual(s.scopes_denied.length, 0);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/adapters/persistence/YamlSatelliteRegistry.test.mjs
```

Expected: 2 new tests fail (Satellite has the fields but the registry doesn't pass them through).

- [ ] **Step 3: Modify YamlSatelliteRegistry.mjs**

Open `backend/src/1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs`. In the `load()` method, find the `new Satellite({...})` call and add the two new fields:

```javascript
const satellite = new Satellite({
  id: entry.id,
  mediaPlayerEntity: entry.media_player_entity,
  area: entry.area ?? null,
  allowedSkills: entry.allowed_skills ?? [],
  defaultVolume: entry.default_volume ?? null,
  defaultMediaClass: entry.default_media_class ?? null,
  scopes_allowed: entry.scopes_allowed ?? [],
  scopes_denied: entry.scopes_denied ?? [],
});
```

- [ ] **Step 4: Run — confirm all pass**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/adapters/persistence/YamlSatelliteRegistry.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs \
        backend/tests/unit/adapters/persistence/YamlSatelliteRegistry.test.mjs
git commit -m "feat(brain): YamlSatelliteRegistry threads scopes_allowed / scopes_denied"
```

---

### Task 7: BrainTranscript — record policyDecision per tool invocation

**Files:**
- Modify: `backend/src/3_applications/brain/services/BrainTranscript.mjs`
- Test: existing `backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs` covers nothing here — we'll add a focused integration test in Task 9.

- [ ] **Step 1: Modify `recordTool` to accept an optional policyDecision**

Open `backend/src/3_applications/brain/services/BrainTranscript.mjs`. Replace the `recordTool` method:

```javascript
recordTool({ name, args, result, ok, latencyMs, policyDecision = null }) {
  this.toolInvocations.push({
    name,
    args: safeClone(args),
    result: safeClone(result),
    ok: ok !== false,
    latencyMs: latencyMs ?? null,
    policyDecision: policyDecision ? safeClone(policyDecision) : null,
    ts: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: No existing tests reference policyDecision — confirm nothing broke**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/usecases/PlayMedia.test.mjs tests/unit/applications/brain/services/MediaJudge.test.mjs
```

Expected: all pass (PlayMedia tests don't touch transcript directly; this is an additive field).

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/brain/services/BrainTranscript.mjs
git commit -m "feat(brain): BrainTranscript captures optional policyDecision per tool call"
```

---

### Task 8: SkillRegistry — pass tool + skill name into evaluator; thread policyDecision into transcript

**Files:**
- Modify: `backend/src/3_applications/brain/services/SkillRegistry.mjs`
- Modify: `backend/tests/unit/applications/brain/SkillRegistry.test.mjs`

The current call is `policy.evaluateToolCall(satellite, tool.name, params)` — three args. The evaluator's new signature is `(satellite, toolName, args, tool, skillName)` — five. We need to thread two more values.

`PassThroughBrainPolicy` ignores extra args (it returns `BrainDecision.allow()` no matter what), so the extension is back-compat for existing tests using the old policy.

- [ ] **Step 1: Add failing test for the new wiring**

Read the existing `backend/tests/unit/applications/brain/SkillRegistry.test.mjs` to confirm it uses fakes that ignore extra args (they should — they all use `() => ({allow: true})` shape). If existing tests pass without modification, that's correct behavior. Then append:

```javascript
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
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/SkillRegistry.test.mjs
```

Expected: 2 new tests fail.

- [ ] **Step 3: Modify SkillRegistry.mjs `#wrap`**

Open `backend/src/3_applications/brain/services/SkillRegistry.mjs`. Replace the `#wrap` method:

```javascript
#wrap(tool, skill, satellite, policy, transcript) {
  const log = this.#logger;
  return {
    ...tool,
    execute: async (params, ctx) => {
      const decision = policy.evaluateToolCall(satellite, tool.name, params, tool, skill.name);
      if (!decision.allow) {
        log.warn?.('brain.tool.policy_denied', {
          satellite_id: satellite.id,
          tool: tool.name,
          reason: decision.reason,
        });
        const denied = { ok: false, reason: `policy_denied:${decision.reason ?? 'unspecified'}` };
        transcript?.recordTool({
          name: tool.name, args: params, result: denied, ok: false, latencyMs: 0,
          policyDecision: { allowed: false, reason: decision.reason ?? null },
        });
        return denied;
      }
      const start = Date.now();
      log.info?.('brain.tool.invoke', {
        satellite_id: satellite.id,
        tool: tool.name,
        args_shape: shapeOf(params),
      });
      try {
        const result = await tool.execute(params, { ...ctx, satellite, skill: skill.name });
        const latencyMs = Date.now() - start;
        log.info?.('brain.tool.complete', {
          satellite_id: satellite.id,
          tool: tool.name,
          ok: result?.ok !== false,
          latencyMs,
        });
        transcript?.recordTool({
          name: tool.name, args: params, result, ok: result?.ok !== false, latencyMs,
          policyDecision: { allowed: true },
        });
        return result;
      } catch (error) {
        const latencyMs = Date.now() - start;
        log.error?.('brain.tool.error', {
          satellite_id: satellite.id,
          tool: tool.name,
          error: error.message,
          latencyMs,
        });
        const errResult = { ok: false, reason: 'error', error: error.message };
        transcript?.recordTool({
          name: tool.name, args: params, result: errResult, ok: false, latencyMs,
          policyDecision: { allowed: true },
        });
        return errResult;
      }
    },
  };
}
```

- [ ] **Step 4: Run — confirm all SkillRegistry tests pass (existing 5 + 2 new)**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/SkillRegistry.test.mjs
```

Expected: 7/7 pass.

- [ ] **Step 5: Run brain test suite — confirm no other regressions**

```bash
cd /opt/Code/DaylightStation/backend && node --test \
  tests/unit/applications/brain/SkillRegistry.test.mjs \
  tests/unit/applications/brain/BrainAgent.test.mjs \
  tests/unit/applications/brain/BrainApplication.test.mjs \
  tests/unit/applications/brain/usecases/PlayMedia.test.mjs \
  tests/unit/applications/brain/PassThroughBrainPolicy.test.mjs \
  tests/unit/applications/brain/skills/MediaSkill.test.mjs \
  tests/unit/applications/brain/skills/MemorySkill.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/brain/services/SkillRegistry.mjs \
        backend/tests/unit/applications/brain/SkillRegistry.test.mjs
git commit -m "feat(brain): SkillRegistry passes tool + skill name to policy; records policyDecision in transcript"
```

---

## Phase 4 — Bootstrap wiring

### Task 9: Wire BrainPolicyEvaluator into createBrainServices

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Locate the existing PassThroughBrainPolicy injection**

Run:

```bash
grep -n "PassThroughBrainPolicy\|brainConfig\|policy: new" /opt/Code/DaylightStation/backend/src/0_system/bootstrap.mjs | head -10
```

You should see one import (around line 3191) and one instantiation in the `BrainApplication` constructor (around line 3300).

- [ ] **Step 2: Modify `createBrainServices` to construct the real evaluator**

Open `backend/src/0_system/bootstrap.mjs`. Find the line:

```javascript
const { PassThroughBrainPolicy } = await import('#applications/brain/services/PassThroughBrainPolicy.mjs');
```

Replace it with:

```javascript
const { PassThroughBrainPolicy } = await import('#applications/brain/services/PassThroughBrainPolicy.mjs');
const { BrainPolicyEvaluator } = await import('#applications/brain/services/BrainPolicyEvaluator.mjs');
```

Then find the line that reads brain config:

```javascript
const brainConfig = configService.reloadHouseholdAppConfig?.(null, 'brain') ?? {};
const mediaConfig = brainConfig?.media ?? {};
```

Add the policy section right below it:

```javascript
const householdPolicy = brainConfig?.policy ?? {};
let brainPolicy;
try {
  brainPolicy = new BrainPolicyEvaluator({
    householdPolicy,
    logger: logger.child({ component: 'policy' }),
  });
  logger.info?.('brain.policy.loaded', {
    household_allowed: householdPolicy.scopes_allowed?.length ?? 0,
    household_denied: householdPolicy.scopes_denied?.length ?? 0,
  });
} catch (err) {
  // Boot-time fail-loud: malformed glob in brain.yml.policy is a config bug.
  logger.error?.('brain.policy.invalid_config', { error: err.message });
  throw err;
}
```

Then find the `BrainApplication` constructor call (around line 3300):

```javascript
const brainApp = new BrainApplication({
  satelliteRegistry: brainSatelliteRegistry,
  memory: brainMemory,
  policy: new PassThroughBrainPolicy(),
  agentRuntime: brainAgentRuntime,
  skills: brainSkills,
  logger,
});
```

Replace `policy: new PassThroughBrainPolicy()` with `policy: brainPolicy`.

- [ ] **Step 3: Boot smoke — verify the change doesn't crash startup**

Stop any running dev backend, then:

```bash
cd /opt/Code/DaylightStation
DAYLIGHT_BRAIN_TOKEN_DEV=devtok node backend/index.js > /tmp/brain-policy-boot.log 2>&1 &
sleep 1
until grep -qE "(brain.mounted|brain.mount_failed|UNCAUGHT|SyntaxError)" /tmp/brain-policy-boot.log 2>/dev/null; do sleep 0.5; done
grep -E "brain\.policy|brain\.mounted|brain\.mount_failed" /tmp/brain-policy-boot.log
pkill -9 -f 'node backend/index.js' 2>/dev/null
```

Expected: see `brain.policy.loaded` followed by `brain.mounted`. If you see `brain.policy.invalid_config`, your `brain.yml` has a malformed glob — fix the YAML, not the code.

- [ ] **Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(brain): wire BrainPolicyEvaluator into createBrainServices (replaces no-op)"
```

---

## Phase 5 — End-to-end integration test

### Task 10: Policy integration test through SkillRegistry

**Files:**
- Create: `backend/tests/unit/applications/brain/policy-integration.test.mjs`

This exercises the full chain: BrainPolicyEvaluator → SkillRegistry wrap → (fake) tool → BrainTranscript record. No live system.

- [ ] **Step 1: Write the integration test**

```javascript
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
```

- [ ] **Step 2: Run — confirm PASS**

```bash
cd /opt/Code/DaylightStation/backend && node --test tests/unit/applications/brain/policy-integration.test.mjs
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/tests/unit/applications/brain/policy-integration.test.mjs
git commit -m "test(brain): policy integration through SkillRegistry — full chain"
```

---

## Phase 6 — Full sweep + boot smoke

### Task 11: Run the full brain test suite

- [ ] **Step 1: Run every brain-related test**

```bash
cd /opt/Code/DaylightStation/backend && node --test \
  tests/unit/applications/brain/services/scopeMatcher.test.mjs \
  tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs \
  tests/unit/applications/brain/services/MediaJudge.test.mjs \
  tests/unit/applications/brain/policy-integration.test.mjs \
  tests/unit/applications/brain/SkillRegistry.test.mjs \
  tests/unit/applications/brain/BrainAgent.test.mjs \
  tests/unit/applications/brain/BrainApplication.test.mjs \
  tests/unit/applications/brain/PassThroughBrainPolicy.test.mjs \
  tests/unit/applications/brain/usecases/PlayMedia.test.mjs \
  tests/unit/applications/brain/skills/MediaSkill.test.mjs \
  tests/unit/applications/brain/skills/MemorySkill.test.mjs \
  tests/unit/applications/brain/skills/HomeAutomationSkill.test.mjs \
  tests/unit/applications/brain/skills/CalendarReadSkill.test.mjs \
  tests/unit/applications/brain/skills/LifelogReadSkill.test.mjs \
  tests/unit/applications/brain/skills/FinanceReadSkill.test.mjs \
  tests/unit/applications/brain/skills/FitnessReadSkill.test.mjs \
  tests/unit/applications/brain/ports.test.mjs \
  tests/unit/domains/brain/Satellite.test.mjs \
  tests/unit/adapters/persistence/YamlSatelliteRegistry.test.mjs \
  tests/unit/adapters/persistence/YamlBrainMemoryAdapter.test.mjs \
  tests/unit/applications/content/ContentQueryService.test.mjs \
  tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs \
  tests/unit/api/routers/brain.test.mjs
```

Expected: all pass. Count should be roughly 100+ tests.

- [ ] **Step 2: If anything fails, stop and triage. Do NOT deploy with red tests.**

---

### Task 12: Boot smoke against dev backend

- [ ] **Step 1: Stop any running dev backend**

```bash
pkill -9 -f 'node backend/index.js' 2>&1
sleep 1
ss -tlnp 2>/dev/null | grep ':3113' || echo "free"
```

- [ ] **Step 2: Start dev backend with current brain.yml (no policy section yet — exercises the optional path)**

```bash
cd /opt/Code/DaylightStation
DAYLIGHT_BRAIN_TOKEN_DEV=devtok DAYLIGHT_BRAIN_TOKEN_OFFICE=officetok node backend/index.js > /tmp/brain-policy-smoke.log 2>&1 &
echo "PID $!"
until grep -qE "(brain.mounted|brain.mount_failed|UNCAUGHT)" /tmp/brain-policy-smoke.log 2>/dev/null; do sleep 0.5; done
grep -E "brain\.policy|brain\.mounted|brain\.satellite" /tmp/brain-policy-smoke.log | head -5
```

Expected:
- `brain.policy.loaded` (with household_allowed=0, household_denied=0)
- `brain.mounted` with all 3 skills
- No `brain.policy.invalid_config`

- [ ] **Step 3: Issue a tool call via the brain endpoint**

```bash
curl -sS http://localhost:3113/v1/chat/completions \
  -H 'Authorization: Bearer devtok' \
  -H 'Content-Type: application/json' \
  --max-time 30 \
  -d '{"model":"daylight-house","messages":[{"role":"user","content":"Remember that the test ran successfully"}]}' \
  | head -100
```

Expected: 200 with content acknowledging the note. The new evaluator allowed the call (memory tool defaults to `'open'` — no behavior change for existing tools).

- [ ] **Step 4: Verify the latest transcript records `policyDecision: { allowed: true }`**

```bash
LATEST=$(ls -t /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/brain/*/dev/*.json 2>/dev/null | head -1)
echo "transcript: $LATEST"
node -e "
const t = JSON.parse(require('fs').readFileSync('$LATEST', 'utf8'));
const tc = t.toolInvocations ?? [];
console.log('tool invocations:', tc.length);
for (const i of tc) console.log('  ', i.name, '→', JSON.stringify(i.policyDecision));
"
```

Expected: at least one tool invocation with `policyDecision: {"allowed":true}`. (If memory persistence still doesn't survive due to permissions on dev, the tool will be invoked even if save silently fails — the policy decision still records.)

- [ ] **Step 5: Stop the dev backend**

```bash
pkill -9 -f 'node backend/index.js' 2>&1
sleep 1
```

---

### Task 13: Push, build, deploy

- [ ] **Step 1: Push commits**

```bash
cd /opt/Code/DaylightStation
git push origin main 2>&1 | tail -3
```

Expected: clean push, no rejection.

- [ ] **Step 2: Build the Docker image**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  . > /tmp/brain-policy-build.log 2>&1
tail -5 /tmp/brain-policy-build.log
```

Expected: ends with `naming to docker.io/kckern/daylight-station:latest done`.

- [ ] **Step 3: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight 2>&1 | tail -5
```

Expected: `Container daylight-station started.` followed by status `Up`.

- [ ] **Step 4: Verify boot in production container**

```bash
until sudo docker logs daylight-station 2>&1 | grep -qE "(brain.mounted|brain.mount_failed)"; do sleep 1; done
sudo docker exec daylight-station cat /build.txt
sudo docker logs daylight-station 2>&1 | grep -E "brain\.policy|brain\.mounted" | head -5
```

Expected:
- `Build Time:` and `Commit:` matching what you just built
- `brain.policy.loaded`
- `brain.mounted`

- [ ] **Step 5: Smoke a real chat completion**

```bash
TOKEN=$(sudo docker exec daylight-station printenv DAYLIGHT_BRAIN_TOKEN_OFFICE)
curl -sS http://localhost:3111/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --max-time 30 \
  -d '{"model":"daylight-house","messages":[{"role":"user","content":"What time is it?"}]}' | head -50
```

Expected: 200 with a one-sentence reply. (The brain has no `get_time` tool yet, so it'll hand back a default — what we're verifying is that the endpoint is up and the policy gate didn't break anything.)

- [ ] **Step 6: Done. Report status.**

If everything passed, the new evaluator is live. Existing tools work unchanged. No satellite needed YAML edits. The household + per-satellite scope rules can now be added to `brain.yml` to gate future restricted tools.

---

## Self-review notes for the executing engineer

- **All tests use `node:test`** and run via `node --test <file>` (NOT `npx jest`). The codebase has both runners; brain tests are uniformly `node:test`.
- **Each task ends in a commit.** If a step fails, do not move past it. Triage, fix, then commit.
- **Existing tools are unaffected.** None of the 7 existing skills declare `defaultPolicy` — they all default to `'open'`. No satellite needs YAML edits. The new behavior only activates when a satellite declares `scopes_allowed`/`scopes_denied`, or when a new restricted-by-default tool is registered.
- **Don't add `defaultPolicy: 'restricted'` to existing tools as part of this plan.** That's a Phase 2 / per-skill decision. This plan only delivers the *mechanism*.
- **`brain.yml` policy section is optional.** Boot must succeed when it's missing or empty.
- **`PassThroughBrainPolicy.mjs` stays.** It's still imported by the test suite (`PassThroughBrainPolicy.test.mjs`) and remains the simplest no-op for tests that don't care about scopes.
- **Logging discipline.** Never log raw arg values at info level. Args summary in `brain.tool.invoke` already uses `shapeOf` (key→type). The new `brain.policy.*` events log scope strings and pattern names — fine, those are meta, not user content.

---

## Spec coverage check

| Spec section / requirement | Implemented in |
|---|---|
| Decisions Q1 (only evaluateToolCall gets teeth) | Task 2 (other two methods are no-op stubs) |
| Decisions Q2 (per-tool defaultPolicy declared by skill) | Task 2 (default-open and default-restricted both tested) |
| Decisions Q3 (scope-based, tools emit string[]) | Task 2 (`#computeScopes` + getScopesFor) |
| Decisions Q4 (deny → `{ok:false, reason:'policy_denied:...'}`) | Task 8 (SkillRegistry wrap formats this) |
| Decisions Q5 (household + per-satellite, deny non-overridable) | Task 3 (deny-precedence test); Task 9 (household read from brain.yml.policy) |
| Glob: `*` single, `**` multi | Task 1 (matchesScope) |
| Boot-time validation of malformed globs | Task 1 (validateGlob); Task 2 (BrainPolicyEvaluator validates at construction); Task 9 (boot fails loud on bad config) |
| Audit: per-decision record on transcript | Task 7 (BrainTranscript.recordTool accepts policyDecision); Task 8 (SkillRegistry passes it); Task 10 (integration assertions) |
| Tool author forgot getScopesFor → fallback `<skill>:<tool>` | Task 2 (`#computeScopes` falls back); Task 4 (test) |
| Tool author getScopesFor throws → fail-closed (use fallback) | Task 4 |
| Empty array returned → fallback | Task 2 |
| Satellite has no scopes → per-tool default rules | Task 5 (defaults `[]`); Task 2 (default-open path) |
| Household has no policy section → boots fine | Task 9 (`brainConfig?.policy ?? {}`); Task 12 (smoke without policy) |
| All 7 existing skills keep working | Task 8 step 5 (full brain suite); Task 12 step 3 (live curl) |
| Out of scope (evaluateRequest, shapeResponse, named profiles, etc.) | Not implemented; PassThroughBrainPolicy stays for those methods on the new evaluator |
