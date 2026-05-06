# dscli Phase C — Write Commands + Policy Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the dscli write-side commands (`ha toggle`, `ha call-service`, `memory write`, `memory delete`, `finance refresh`, `system reload`) with explicit policy gating: a CLI satellite identity in `concierge.yml` and a mandatory `--allow-write` flag for any state-changing operation.

**Architecture:** A new "CLI satellite" identity is added to `data/household/config/concierge.yml`. Its `scopes_allowed` start as read-only-equivalent. Write commands at the dscli layer require the `--allow-write` flag — a deliberate friction surface that distinguishes "I meant to mutate state" from "I typo'd a read command into a write command". The dispatcher records every write invocation in a CLI-specific transcript log. Underlying service errors map to EXIT_FAIL with structured envelopes, same pattern as Phase B.

**Tech Stack:** Same as foundation. No new runtime deps.

**Spec:** [docs/superpowers/specs/2026-05-02-dscli-design.md](../specs/2026-05-02-dscli-design.md) — Phase C (line 392-399), Risk: CLI satellite identity in policy (lines 432-437), Open questions §3 (line 444).

**Prerequisites:** Phase A foundation merged. Phase B merged (some write commands rely on read commands like `ha resolve`).

---

## ⚠️ Decisions locked in by this plan

The spec left these open. This plan commits to specific choices. Implementers SHOULD follow them; deviations need user approval before implementation.

### Decision 1: CLI satellite identity is added to `concierge.yml`

A new `id: cli` satellite entry is added to `data/household/config/concierge.yml.satellites`. Initial `scopes_allowed` are **identical to the household scopes_denied minus the absolute denies** — i.e., the CLI starts with read access to everything *except* what's globally denied (auth, finances, secrets per the existing `scopes_denied` list). Write scopes are added per-action by this plan as each command lands.

| Command | Required scope grant added to satellites[id='cli'] |
|---|---|
| `ha toggle`, `ha call-service` | `ha:**` |
| `memory write`, `memory delete` | `memory:**` |
| `finance refresh` | (overridden — `data:finances:**` is in household scopes_denied; `finance refresh` requires bypassing this — see Decision 4) |
| `system reload` | `system:**` |

### Decision 2: `--allow-write` is mandatory for all write commands

Every write command checks `args.flags['allow-write'] === true` BEFORE calling the underlying service. Without it: exit 2 with `{error:'allow_write_required', command:'<cmd>'}` and a clear message explaining why.

This is deliberate friction. It means agents and humans must explicitly opt into mutation per command invocation. The flag is NOT inherited across multi-command pipelines; each write command needs its own.

### Decision 3: Write invocations are logged to a CLI transcript

Each successful write invocation appends a JSON line to `data/household/cli-transcripts/YYYY-MM-DD.ndjson` recording:
- ISO timestamp
- Command + action
- Args (with secrets redacted)
- Result envelope (success or error)
- Process info (pid, uid)

This mirrors the agent transcript pattern from concierge but lives in a CLI-specific location so it's searchable separately. If the path doesn't exist, the command attempts to create it; failure to log does NOT fail the command (logged to stderr as a warning instead).

### Decision 4: `finance refresh` is treated as bypassing `data:finances:**` denial

The household-wide `scopes_denied: [data:finances:**]` is intended for voice — "don't talk about money out loud". For dscli, finance reads are useful and finance writes (refresh) are explicitly opted into via `--allow-write`. The CLI dispatcher's scope check **trusts the per-satellite `scopes_allowed` granting `finance:write`** to override the household denial. If this isn't the desired security stance, **the user MUST flag this in execution** — either restrict `finance refresh` to manual data-volume access (not via dscli), or accept that `--allow-write` is sufficient gating.

### Decision 5: `system reload` requires the running backend

It's a POST to `/api/v1/system/reload` (verify endpoint exists during Task 8 — see Step 1 of that task). Mark `requiresBackend: true` for that action specifically. If the endpoint doesn't exist, **the implementer must either add it to the backend in a separate prerequisite commit OR scope `system reload` out of this plan**.

---

## Pattern overview

Every write command shares this structure:

```javascript
async function action<Name>(args, deps) {
  // 1. Validate required positional args → EXIT_USAGE on missing
  // 2. Check args.flags['allow-write'] → EXIT_USAGE with allow_write_required if missing
  // 3. Build factory → EXIT_CONFIG on throw
  // 4. Call underlying mutating method → EXIT_FAIL with <command>_error on throw
  // 5. Log to CLI transcript (best-effort)
  // 6. Emit JSON success envelope, EXIT_OK
}
```

A helper module `cli/_writeAudit.mjs` centralizes the transcript-logging concern so each command is a one-liner: `await audit.log({ command, action, args, result })`.

---

## Task 1: CLI satellite identity + `--allow-write` flag plumbing

**Files:**
- Modify: `data/household/config/concierge.yml` — add `id: cli` satellite (NOTE: this lives inside the Docker volume; use the documented `sudo docker exec ... sh -c "cat >..."` pattern. Edit only via heredoc, NEVER `sed -i`.)
- Modify: `cli/dscli.mjs` — read `--allow-write` flag, add to deps bag
- Create: `cli/_writeAudit.mjs` — transcript logging helper
- Create: `tests/unit/cli/_writeAudit.test.mjs` — unit tests for the helper

The satellite identity addition is a configuration change; the dispatcher modification adds `allowWrite: boolean` to the deps bag; the audit helper is the shared logging facade.

- [ ] **Step 1: Add `id: cli` satellite to concierge.yml**

Read the current file:
```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/concierge.yml' > /tmp/concierge-current.yml
```

Append a new satellite block under `satellites:` (preserve the existing `dev` and `office` entries):

```yaml
  - id: cli
    media_player_entity: media_player.dummy_cli
    area: none
    allowed_skills: [memory, home_automation, media, finance, system]
    # CLI satellite identity. Read-only by default. Write commands require
    # the --allow-write flag at the dscli layer (defense-in-depth alongside
    # these scopes).
    scopes_allowed:
      - memory:**
      - media:**
      - ha:**
      - data:fitness:**
      - data:calendar:**
      - data:weather:**
      - data:household:**
      # Write scopes — each gated by --allow-write at the CLI:
      - ha:write:**
      - memory:write:**
      - finance:write:**
      - system:write:**
    token_ref: ENV:DAYLIGHT_BRAIN_TOKEN_CLI
```

Write back via heredoc:
```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/concierge.yml" < /tmp/concierge-modified.yml
```

Verify with `sudo docker exec daylight-station sh -c 'cat data/household/config/concierge.yml | grep -A 20 "id: cli"'`.

- [ ] **Step 2: Add `--allow-write` and `cliSatelliteId` to deps in `cli/dscli.mjs`**

In the deps construction block, add:

```javascript
  const allowWrite = parsed.flags['allow-write'] === true;
  const cliSatelliteId = process.env.DSCLI_SATELLITE_ID || 'cli';
```

Then in the deps bag itself:

```javascript
  const deps = {
    // ... existing keys
    allowWrite,
    cliSatelliteId,
    // ... factories
  };
```

- [ ] **Step 3: Write the audit helper test**

`tests/unit/cli/_writeAudit.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWriteAuditor } from '../../../cli/_writeAudit.mjs';

describe('createWriteAuditor', () => {
  let tmpRoot;
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dscli-audit-'));
  });
  afterEach(async () => { await fs.rm(tmpRoot, { recursive: true, force: true }); });

  it('appends a JSON line per call', async () => {
    const audit = createWriteAuditor({ baseDir: tmpRoot, dateFn: () => '2026-05-02' });
    await audit.log({ command: 'ha', action: 'toggle', args: { entity_id: 'light.x', state: 'on' }, result: { ok: true } });
    await audit.log({ command: 'memory', action: 'write', args: { key: 'notes' }, result: { ok: true } });

    const file = path.join(tmpRoot, '2026-05-02.ndjson');
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const e1 = JSON.parse(lines[0]);
    expect(e1.command).toBe('ha');
    expect(e1.action).toBe('toggle');
    expect(e1.args.entity_id).toBe('light.x');
    expect(e1.timestamp).toMatch(/^20\d\d-/);
  });

  it('redacts known sensitive arg keys', async () => {
    const audit = createWriteAuditor({ baseDir: tmpRoot, dateFn: () => '2026-05-02' });
    await audit.log({ command: 'system', action: 'reload', args: { token: 'secret-xyz', other: 'visible' }, result: { ok: true } });

    const file = path.join(tmpRoot, '2026-05-02.ndjson');
    const entry = JSON.parse((await fs.readFile(file, 'utf8')).trim());
    expect(entry.args.token).toBe('[redacted]');
    expect(entry.args.other).toBe('visible');
  });

  it('does not throw if directory creation fails (best-effort logging)', async () => {
    const badDir = '/proc/1/cannot-write-here';
    const audit = createWriteAuditor({ baseDir: badDir, dateFn: () => '2026-05-02' });
    // Should not throw
    await audit.log({ command: 'x', action: 'y', args: {}, result: {} });
  });
});
```

- [ ] **Step 4: Implement `cli/_writeAudit.mjs`**

```javascript
/**
 * CLI write-audit log. Append-only NDJSON per UTC date.
 *
 * Each successful write command calls `audit.log({...})` after the underlying
 * service confirms success. Failures to write the audit log are themselves
 * logged to stderr but do NOT fail the command — the user's intent succeeded;
 * we just lost the trail.
 */

import fs from 'node:fs';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

const SENSITIVE_KEYS = new Set(['token', 'password', 'apiKey', 'api_key', 'secret', 'authorization']);

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : redact(v);
  }
  return out;
}

export function createWriteAuditor({ baseDir, dateFn = () => new Date().toISOString().slice(0, 10) } = {}) {
  return {
    async log({ command, action, args, result }) {
      const entry = {
        timestamp: new Date().toISOString(),
        command,
        action,
        args: redact(args),
        result: redact(result),
        pid: process.pid,
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
      };
      const file = path.join(baseDir, `${dateFn()}.ndjson`);
      try {
        await fsp.mkdir(baseDir, { recursive: true });
        await fsp.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
      } catch (err) {
        process.stderr.write(`dscli: audit log write failed: ${err.message}\n`);
      }
    },
  };
}
```

- [ ] **Step 5: Wire the auditor into `cli/_bootstrap.mjs`**

Add a `getWriteAuditor()` factory:

```javascript
import path from 'node:path';
import { createWriteAuditor } from './_writeAudit.mjs';

let _auditor = null;

export async function getWriteAuditor() {
  if (_auditor) return _auditor;
  const cfg = await getConfigService();
  const baseDir = path.join(cfg.getDataDir(), 'household', 'cli-transcripts');
  _auditor = createWriteAuditor({ baseDir });
  return _auditor;
}
```

Add to `_resetForTests()` and to `dscli.mjs` deps bag:

```javascript
    getWriteAuditor: bootstrap.getWriteAuditor,
```

- [ ] **Step 6: Run tests; confirm 3 audit tests pass + no regressions**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/
```

- [ ] **Step 7: Commit**

```bash
git add cli/_writeAudit.mjs cli/_bootstrap.mjs cli/dscli.mjs tests/unit/cli/_writeAudit.test.mjs
git commit -m "feat(dscli): write-audit log + --allow-write flag plumbing"
```

(Note: the concierge.yml change is in the data volume, not in git. Document it in your commit message: "Manual ops step: added id: cli satellite to data/household/config/concierge.yml — see plan Task 1 Step 1.")

---

## Task 2: `ha toggle <name|entity_id> <on|off>` — toggle a light/switch

**Files:**
- Modify: `cli/commands/ha.mjs` — add `actionToggle`
- Modify: `tests/unit/cli/commands/ha.test.mjs` — append tests

If the first arg looks like an entity_id (`<domain>.<id>`), use it directly. Otherwise, treat as a friendly-name query and resolve via `gateway.listAllStates()` (mirrors `actionResolve` from Phase B).

Underlying call: `gateway.callService('light' or 'switch', 'turn_on'/'turn_off', { entity_id })` based on entity domain.

- [ ] **Step 1: Append failing tests**

```javascript
  describe('toggle action', () => {
    function fakeGateway(states) {
      const calls = [];
      return {
        async listAllStates() { return states; },
        async callService(domain, service, data) {
          calls.push({ domain, service, data });
          return { ok: true };
        },
        _calls: calls,
      };
    }
    const sample = [
      { entityId: 'light.office_main', state: 'off', attributes: { friendly_name: 'Office Main' } },
    ];

    it('exits 2 when --allow-write is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['toggle', 'light.office_main', 'on'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway(sample), allowWrite: false },
      );
      expect(r.exitCode).toBe(2);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('allow_write_required');
    });

    it('toggles by entity_id when --allow-write is set', async () => {
      const { stdout, stderr } = makeBuffers();
      const gw = fakeGateway(sample);
      const r = await ha.run(
        { subcommand: 'ha', positional: ['toggle', 'light.office_main', 'on'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, getHaGateway: async () => gw, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(0);
      expect(gw._calls).toEqual([{ domain: 'light', service: 'turn_on', data: { entity_id: 'light.office_main' } }]);
    });

    it('toggles by friendly name (resolves via listAllStates)', async () => {
      const { stdout, stderr } = makeBuffers();
      const gw = fakeGateway(sample);
      const r = await ha.run(
        { subcommand: 'ha', positional: ['toggle', 'Office', 'Main', 'off'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, getHaGateway: async () => gw, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(0);
      expect(gw._calls[0]).toEqual({ domain: 'light', service: 'turn_off', data: { entity_id: 'light.office_main' } });
    });

    it('exits 1 not_found if friendly name doesn\'t resolve', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['toggle', 'garage', 'on'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway(sample), allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
    });

    it('exits 2 if state arg is not on/off', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['toggle', 'light.office_main', 'maybe'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway(sample), allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/on.*off/i);
    });

    it('calls audit.log on success', async () => {
      const { stdout, stderr } = makeBuffers();
      const logged = [];
      const r = await ha.run(
        { subcommand: 'ha', positional: ['toggle', 'light.office_main', 'on'], flags: { 'allow-write': true }, help: false },
        {
          stdout, stderr,
          getHaGateway: async () => fakeGateway(sample),
          allowWrite: true,
          getWriteAuditor: async () => ({ log: async (entry) => logged.push(entry) }),
        },
      );
      expect(r.exitCode).toBe(0);
      expect(logged).toHaveLength(1);
      expect(logged[0].command).toBe('ha');
      expect(logged[0].action).toBe('toggle');
    });
  });
```

- [ ] **Step 2: Run; confirm 6 failures.**

- [ ] **Step 3: Implement `actionToggle`** in `cli/commands/ha.mjs`. Add this function before `const ACTIONS`:

```javascript
async function actionToggle(args, deps) {
  // Last positional must be on|off; everything between [1] and [-1] is the name/entity_id
  const positional = args.positional.slice(1);
  if (positional.length < 2) {
    deps.stderr.write('dscli ha toggle: usage: dscli ha toggle <name|entity_id> <on|off> --allow-write\n');
    return { exitCode: EXIT_USAGE };
  }
  const desiredState = positional[positional.length - 1].toLowerCase();
  if (desiredState !== 'on' && desiredState !== 'off') {
    deps.stderr.write(`dscli ha toggle: state must be 'on' or 'off', got: ${desiredState}\n`);
    return { exitCode: EXIT_USAGE };
  }
  const target = positional.slice(0, -1).join(' ');

  if (!deps.allowWrite) {
    printError(deps.stderr, {
      error: 'allow_write_required',
      command: 'ha toggle',
      message: 'Write commands require the --allow-write flag.',
    });
    return { exitCode: EXIT_USAGE };
  }

  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  // Resolve entity_id: direct if it has a dot; otherwise fuzzy-resolve
  let entityId = target;
  if (!/^[a-z_]+\.[a-z0-9_]+$/i.test(target)) {
    let states;
    try {
      states = await gateway.listAllStates();
    } catch (err) {
      printError(deps.stderr, { error: 'ha_error', message: err.message });
      return { exitCode: EXIT_FAIL };
    }
    const needle = target.toLowerCase();
    const match = states.find((s) => s.attributes?.friendly_name?.toLowerCase() === needle)
                  || states.find((s) => s.attributes?.friendly_name?.toLowerCase().includes(needle));
    if (!match) {
      printError(deps.stderr, { error: 'not_found', query: target });
      return { exitCode: EXIT_FAIL };
    }
    entityId = match.entityId;
  }

  const domain = entityId.split('.')[0];
  const service = desiredState === 'on' ? 'turn_on' : 'turn_off';

  let result;
  try {
    result = await gateway.callService(domain, service, { entity_id: entityId });
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  // Best-effort audit log
  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({
      command: 'ha',
      action: 'toggle',
      args: { entity_id: entityId, state: desiredState },
      result,
    });
  } catch { /* logging failures don't fail the command */ }

  printJson(deps.stdout, { ok: result?.ok ?? true, entity_id: entityId, state: desiredState, result });
  return { exitCode: EXIT_OK };
}
```

Register `toggle: actionToggle` and update HELP.

- [ ] **Step 4: Run tests; confirm 25+ passing.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/ha.mjs tests/unit/cli/commands/ha.test.mjs
git commit -m "feat(dscli): ha toggle action with --allow-write gating + audit log"
```

---

## Task 3: `ha call-service <domain> <service> [entity_id] [--data JSON]`

**Files:**
- Modify: `cli/commands/ha.mjs` — add `actionCallService`
- Modify: `tests/unit/cli/commands/ha.test.mjs` — append tests

Direct passthrough to `gateway.callService(domain, service, data)`. Use this for non-toggle services (e.g. `light.turn_on` with brightness, `script.turn_on`, `media_player.play_media`).

- [ ] **Step 1: Append tests** asserting:
  - missing `--allow-write` → EXIT_USAGE with `allow_write_required`
  - missing domain or service → EXIT_USAGE
  - calls `gateway.callService(domain, service, parsedData)` with merged `entity_id` if provided
  - `--data '{"brightness":128}'` is parsed JSON
  - bad JSON in `--data` → EXIT_USAGE

(Use the same structure as `actionToggle` tests above; ~5 tests.)

- [ ] **Step 2: Implement `actionCallService`**:

```javascript
async function actionCallService(args, deps) {
  const domain = args.positional[1];
  const service = args.positional[2];
  const entityId = args.positional[3] || null;
  const dataJson = args.flags.data;

  if (!domain || !service) {
    deps.stderr.write('dscli ha call-service: usage: dscli ha call-service <domain> <service> [entity_id] [--data JSON] --allow-write\n');
    return { exitCode: EXIT_USAGE };
  }
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'ha call-service', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }

  let serviceData = {};
  if (dataJson) {
    try {
      serviceData = JSON.parse(dataJson);
    } catch (err) {
      deps.stderr.write(`dscli ha call-service: --data is not valid JSON: ${err.message}\n`);
      return { exitCode: EXIT_USAGE };
    }
  }
  if (entityId) serviceData.entity_id = entityId;

  let gateway;
  try { gateway = await deps.getHaGateway(); }
  catch (err) { printError(deps.stderr, { error: 'config_error', message: err.message }); return { exitCode: EXIT_CONFIG }; }

  let result;
  try { result = await gateway.callService(domain, service, serviceData); }
  catch (err) { printError(deps.stderr, { error: 'ha_error', message: err.message }); return { exitCode: EXIT_FAIL }; }

  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({ command: 'ha', action: 'call-service', args: { domain, service, data: serviceData }, result });
  } catch { /* */ }

  printJson(deps.stdout, { ok: result?.ok ?? true, domain, service, data: serviceData, result });
  return { exitCode: EXIT_OK };
}
```

Register `'call-service': actionCallService`. Update HELP.

- [ ] **Step 3: Run; commit.**

```bash
git add cli/commands/ha.mjs tests/unit/cli/commands/ha.test.mjs
git commit -m "feat(dscli): ha call-service action (--data JSON, --allow-write)"
```

---

## Task 4: `memory write <key> <value>` — set a memory key

**Files:**
- Modify: `cli/commands/memory.mjs` — add `actionWrite`
- Modify: `tests/unit/cli/commands/memory.test.mjs` — append tests

Treat the value as JSON if it parses; otherwise as a string. Supports complex objects via `dscli memory write notes '{"items":["a","b"]}' --allow-write`.

- [ ] **Step 1: Tests**:

```javascript
  describe('write action', () => {
    function fakeMemory() {
      const state = {};
      return {
        async get(key) { return state[key] ?? null; },
        async set(key, value) { state[key] = value; },
        _state: state,
      };
    }

    it('exits 2 without --allow-write', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await memory.run(
        { subcommand: 'memory', positional: ['write', 'notes', 'hello'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => fakeMemory(), allowWrite: false },
      );
      expect(r.exitCode).toBe(2);
    });

    it('writes a string value', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory();
      const r = await memory.run(
        { subcommand: 'memory', positional: ['write', 'notes', 'pick up groceries'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, getMemory: async () => mem, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(0);
      expect(mem._state.notes).toBe('pick up groceries');
    });

    it('writes a parsed JSON value', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory();
      const r = await memory.run(
        { subcommand: 'memory', positional: ['write', 'prefs', '{"diet":"low-carb"}'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, getMemory: async () => mem, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(0);
      expect(mem._state.prefs).toEqual({ diet: 'low-carb' });
    });

    it('exits 2 when key or value missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await memory.run(
        { subcommand: 'memory', positional: ['write', 'notes'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, getMemory: async () => fakeMemory(), allowWrite: true },
      );
      expect(r.exitCode).toBe(2);
    });
  });
```

- [ ] **Step 2: Implement `actionWrite`**:

```javascript
async function actionWrite(args, deps) {
  const key = args.positional[1];
  const rawValue = args.positional.slice(2).join(' ');
  if (!key || !rawValue) {
    deps.stderr.write('dscli memory write: usage: dscli memory write <key> <value> --allow-write\n');
    return { exitCode: EXIT_USAGE };
  }
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'memory write', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }

  // Try JSON-parse first; fall back to string
  let value;
  try { value = JSON.parse(rawValue); }
  catch { value = rawValue; }

  let memory;
  try { memory = await deps.getMemory(); }
  catch (err) { printError(deps.stderr, { error: 'config_error', message: err.message }); return { exitCode: EXIT_CONFIG }; }

  try { await memory.set(key, value); }
  catch (err) { printError(deps.stderr, { error: 'memory_error', message: err.message }); return { exitCode: EXIT_FAIL }; }

  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({ command: 'memory', action: 'write', args: { key, value }, result: { ok: true } });
  } catch {}

  printJson(deps.stdout, { ok: true, key, value });
  return { exitCode: EXIT_OK };
}
```

Register `write: actionWrite`. Update HELP.

- [ ] **Step 3: Commit**

```bash
git add cli/commands/memory.mjs tests/unit/cli/commands/memory.test.mjs
git commit -m "feat(dscli): memory write action with JSON-parse-or-string value handling"
```

---

## Task 5: `memory delete <key>` — remove a memory key

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs` — add `delete(key)` method
- Modify: `cli/commands/memory.mjs` — add `actionDelete`
- Modify: `tests/unit/cli/commands/memory.test.mjs` — append tests

The existing `YamlConciergeMemoryAdapter` has `get`, `set`, `merge` — no `delete`. We add a `delete(key)` that wraps the underlying `WorkingMemoryState` (load the state, remove the key from `state.data`, save).

- [ ] **Step 1: Add `delete()` to the adapter**

In `backend/src/1_adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs`, after `merge()`:

```javascript
  async delete(key) {
    const state = await this.#loadAll();
    if (state && state.data && typeof state.data === 'object') {
      if (Object.prototype.hasOwnProperty.call(state.data, key)) {
        delete state.data[key];
        await this.#save(state);
        return true;
      }
    }
    return false;
  }
```

- [ ] **Step 2: Add a test for the new adapter method**

Create `tests/isolated/adapter/yaml-concierge-memory-delete.test.mjs` (or extend an existing test if one exists) to assert `delete('foo')` removes the key and `delete('absent')` returns false.

- [ ] **Step 3: Add CLI tests for `actionDelete`**

```javascript
  describe('delete action', () => {
    function fakeMemory(initial = {}) {
      const state = { ...initial };
      return {
        async get(key) { return state[key] ?? null; },
        async delete(key) { if (key in state) { delete state[key]; return true; } return false; },
        _state: state,
      };
    }

    it('exits 2 without --allow-write', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await memory.run(
        { subcommand: 'memory', positional: ['delete', 'notes'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => fakeMemory({ notes: ['a'] }), allowWrite: false },
      );
      expect(r.exitCode).toBe(2);
    });

    it('removes the key', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory({ notes: ['a'] });
      const r = await memory.run(
        { subcommand: 'memory', positional: ['delete', 'notes'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, getMemory: async () => mem, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(0);
      expect(mem._state.notes).toBeUndefined();
    });

    it('exits 1 not_found when key absent', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await memory.run(
        { subcommand: 'memory', positional: ['delete', 'absent'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, getMemory: async () => fakeMemory({}), allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
    });
  });
```

- [ ] **Step 4: Implement `actionDelete`**:

```javascript
async function actionDelete(args, deps) {
  const key = args.positional[1];
  if (!key) {
    deps.stderr.write('dscli memory delete: usage: dscli memory delete <key> --allow-write\n');
    return { exitCode: EXIT_USAGE };
  }
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'memory delete', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }

  let memory;
  try { memory = await deps.getMemory(); }
  catch (err) { printError(deps.stderr, { error: 'config_error', message: err.message }); return { exitCode: EXIT_CONFIG }; }

  let removed;
  try { removed = await memory.delete(key); }
  catch (err) { printError(deps.stderr, { error: 'memory_error', message: err.message }); return { exitCode: EXIT_FAIL }; }

  if (!removed) {
    printError(deps.stderr, { error: 'not_found', key });
    return { exitCode: EXIT_FAIL };
  }

  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({ command: 'memory', action: 'delete', args: { key }, result: { ok: true } });
  } catch {}

  printJson(deps.stdout, { ok: true, key, deleted: true });
  return { exitCode: EXIT_OK };
}
```

Register `delete: actionDelete`. Update HELP.

- [ ] **Step 5: Run tests; confirm everything passes (existing memory tests + 3 new + 1 adapter test).**

- [ ] **Step 6: Commit (separate commits for adapter and CLI to keep history clean)**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs tests/isolated/adapter/yaml-concierge-memory-delete.test.mjs
git commit -m "feat(memory): YamlConciergeMemoryAdapter.delete(key) returns boolean"

git add cli/commands/memory.mjs tests/unit/cli/commands/memory.test.mjs
git commit -m "feat(dscli): memory delete action with --allow-write gating"
```

---

## Task 6: `finance refresh` — trigger full Buxfer refresh cycle

**Files:**
- Modify: `cli/commands/finance.mjs` — add `actionRefresh`
- Modify: `tests/unit/cli/commands/finance.test.mjs` — append tests

The backend has `FinanceHarvestService` (at `backend/src/3_applications/finance/FinanceHarvestService.mjs`) which orchestrates fetch + compile + categorize. The CLI wires through the existing HTTP endpoint `POST /api/v1/finance/refresh` (verified in CLAUDE.local.md) — this means `requiresBackend: true` for this action, similar to `system reload`.

The factory we use is `getHttpClient()` + the local backend URL (same pattern as `system health`).

- [ ] **Step 1: Tests**:

```javascript
  describe('refresh action', () => {
    it('exits 2 without --allow-write', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await finance.run(
        { subcommand: 'finance', positional: ['refresh'], flags: {}, help: false },
        { stdout, stderr, allowWrite: false },
      );
      expect(r.exitCode).toBe(2);
    });

    it('POSTs to /api/v1/finance/refresh and returns ok on 200', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const fakeFetch = async (url, opts) => {
        captured = { url, method: opts?.method };
        return { ok: true, status: 200, async json() { return { refreshed: true, accounts: 17 }; } };
      };
      const r = await finance.run(
        { subcommand: 'finance', positional: ['refresh'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, fetch: fakeFetch, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(0);
      expect(captured.url).toMatch(/\/api\/v1\/finance\/refresh$/);
      expect(captured.method).toBe('POST');
      const out = JSON.parse(stdout.read().trim());
      expect(out.ok).toBe(true);
    });

    it('exits 4 if backend unreachable', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
      const r = await finance.run(
        { subcommand: 'finance', positional: ['refresh'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, fetch: fakeFetch, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(4);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('backend_unreachable');
    });
  });
```

- [ ] **Step 2: Implement `actionRefresh`**:

```javascript
function backendUrl() {
  return process.env.DSCLI_BACKEND_URL || 'http://localhost:3111';
}

async function actionRefresh(args, deps) {
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'finance refresh', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }

  const url = backendUrl() + '/api/v1/finance/refresh';
  const fetchFn = deps.fetch || globalThis.fetch;

  let response;
  try {
    response = await fetchFn(url, { method: 'POST' });
  } catch (err) {
    printError(deps.stderr, { error: 'backend_unreachable', url, message: err.message });
    return { exitCode: EXIT_BACKEND };
  }

  if (!response.ok) {
    printError(deps.stderr, { error: 'backend_unhealthy', url, status: response.status });
    return { exitCode: EXIT_BACKEND };
  }

  let body = {};
  try { body = await response.json(); } catch {}

  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({ command: 'finance', action: 'refresh', args: {}, result: body });
  } catch {}

  printJson(deps.stdout, { ok: true, ...body });
  return { exitCode: EXIT_OK };
}
```

Add `EXIT_BACKEND` to the imports if not already present. Register `refresh: actionRefresh`. Update HELP.

- [ ] **Step 3: Commit**

```bash
git add cli/commands/finance.mjs tests/unit/cli/commands/finance.test.mjs
git commit -m "feat(dscli): finance refresh action (POST backend, --allow-write)"
```

---

## Task 7: `system reload` — POST /api/v1/system/reload (verify endpoint first)

**Files:**
- (Possibly) Create/modify backend route if endpoint doesn't exist — see Step 1
- Modify: `cli/commands/system.mjs` — add `actionReload`
- Modify: `tests/unit/cli/commands/system.test.mjs` — append tests

- [ ] **Step 1: Verify the endpoint exists**

```bash
grep -rn "router.post.*reload\|/system/reload" /opt/Code/DaylightStation/backend/src/4_api/v1/routers/ | head -5
```

If the endpoint EXISTS: proceed to Step 2.

If the endpoint DOES NOT EXIST: this plan does not cover adding the backend route. Either:
- (a) Add the route in a separate prerequisite commit before continuing this task. The route handler should call ConfigService.reloadHouseholdAppConfig() or whichever runtime-reload primitive exists. **Stop and confirm with the user before adding new backend routes.**
- (b) Scope `system reload` out of this plan and implement only the CLI side as a stub that always exits 4 with a clear message. Document the limitation.

The plan assumes (a) succeeds OR the implementer chooses (b). If (b), skip to Task 8.

- [ ] **Step 2: Append tests** (mirror Task 6's `actionRefresh` shape — `--allow-write` required, POST to `/api/v1/system/reload`, exit 4 on unreachable, exit 0 on success).

- [ ] **Step 3: Implement `actionReload`** in `cli/commands/system.mjs` (mirror Task 6's structure with the URL path changed).

- [ ] **Step 4: Commit**

```bash
git add cli/commands/system.mjs tests/unit/cli/commands/system.test.mjs
git commit -m "feat(dscli): system reload action (POST backend, --allow-write)"
```

---

## Task 8: README + transcript discovery

**Files:**
- Modify: `cli/README.md`
- Create: `cli/cli-transcripts/.gitkeep` (or similar) IF the path needs to exist outside the data volume — only create if user wants CLI invocations from outside the container also auditable

- [ ] **Step 1: README updates**

Add a new "Write commands" section to `cli/README.md`:

```markdown
## Write commands and policy

State-changing commands (`ha toggle`, `ha call-service`, `memory write`, `memory delete`, `finance refresh`, `system reload`) require the `--allow-write` flag on every invocation. Without it, the command exits 2 with `{error: 'allow_write_required'}`.

This is a deliberate friction surface. Each invocation is also audited to `data/household/cli-transcripts/YYYY-MM-DD.ndjson`.

Example:
```bash
# Read — works without --allow-write
dscli ha state light.office_main

# Write — needs --allow-write
dscli ha toggle light.office_main on --allow-write

# Audit log
ls data/household/cli-transcripts/
cat data/household/cli-transcripts/$(date -u +%Y-%m-%d).ndjson | jq .
```
```

- [ ] **Step 2: Aggregate test pass + smoke**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/
```

Smoke each new command's `--help`:
```bash
node cli/dscli.mjs ha --help        # should list toggle, call-service among actions
node cli/dscli.mjs memory --help    # should list write, delete
node cli/dscli.mjs finance --help   # should list refresh
node cli/dscli.mjs system --help    # should list reload
```

Smoke a write without --allow-write to confirm gating works:
```bash
node cli/dscli.mjs memory write x y; echo "exit: $?"
# Expected: {"error":"allow_write_required",...} on stderr, exit 2
```

- [ ] **Step 3: Commit**

```bash
git add cli/README.md
git commit -m "docs(dscli): document write commands, --allow-write, audit log"
```

---

## Out of scope (deferred to Phase D / future)

- Per-action scope checking (currently `--allow-write` is the only gate; we don't read `concierge.yml.satellites[id='cli'].scopes_allowed` programmatically). A future plan can add scope-level enforcement in the dispatcher.
- `dscli concierge ask` and friends — Phase D.
- Live HA toggle smoke test against the real device — manual verification only.
- Multi-step undo / redo — out of scope. Each write is idempotent at the underlying-service level.

---

## Self-review notes

**Spec coverage:**
- `ha toggle` → Task 2 ✓
- `ha call-service` → Task 3 ✓
- `memory write` → Task 4 ✓
- `memory delete` → Task 5 ✓ (also adds adapter `.delete()` method)
- `finance refresh` → Task 6 ✓
- `system reload` → Task 7 (with verification step for endpoint existence)
- CLI satellite identity → Task 1 ✓ (manual config edit + flag plumbing + audit helper)
- `--allow-write` flag → enforced in every write action ✓
- Audit log → Task 1 + every write command ✓

**Locked-in decisions** (from the top of this plan): documented at top with explicit "Decision N" headers. Implementer must STOP and consult the user if any of these decisions seems wrong on closer inspection of the codebase.

**Test counts:** Phase B ends at ~95 tests. This plan adds ~3 (audit helper) + ~6 (ha toggle) + ~5 (ha call-service) + ~4 (memory write) + ~3 (memory delete) + ~3 (finance refresh) + ~3 (system reload) = ~120 total after Phase C.

**Known risks:**
1. The concierge.yml edit is in the data volume, NOT git. If the volume is lost, the satellite config is lost. Acceptable for a household-scoped CLI; document the recovery procedure (re-add the snippet from this plan).
2. `finance refresh` and `system reload` rely on backend routes existing. Task 6 verifies finance is documented in CLAUDE.local.md. Task 7 explicitly verifies system/reload before assuming.
3. The audit log writes to a path under the data volume. On a multi-user host, `process.getuid()` distinguishes invocations but does not prevent another user from tailing/reading the log. Acceptable for a single-household single-user setup.
