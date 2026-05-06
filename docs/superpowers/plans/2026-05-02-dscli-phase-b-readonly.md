# dscli Phase B — Remaining Read-Only Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Round out Phase B of the dscli rollout with the remaining read-only commands across `ha`, `content`, and `finance` domains. All purely additive — no new infrastructure, no policy decisions, no design risk. Each command extends an existing command module with a new action and gets in-process tests.

**Architecture:** Each new action follows the **established foundation pattern** documented in `cli/README.md` and exemplified by `cli/commands/system.mjs` (`actionHealth` + `actionConfig`). Tasks add new `actionXxx` functions to the existing five command modules and append corresponding tests to the existing test files. No new bootstrap factories needed — all factories from Phase A cover the underlying services.

**Tech Stack:** Same as foundation (Node ESM, vitest, `#system/*` / `#adapters/*` / `#apps/*` aliases). Zero new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-05-02-dscli-design.md](../specs/2026-05-02-dscli-design.md) — Phase B subcommand catalog (lines 107-191).

**Foundation reference:** `docs/superpowers/plans/2026-05-02-dscli-foundation.md` is the source of the patterns. The merged foundation source is at `cli/` and `tests/unit/cli/`. Read those files before starting any task — they document the conventions every command in this plan must follow.

---

## Pattern checklist (apply to every command in this plan)

Every action you add follows this exact structure (see `cli/commands/system.mjs` for the canonical example):

1. Action function: `async function action<Name>(args, deps)` returns `{ exitCode }`. Two try/catch blocks: factory call → EXIT_CONFIG with `{error: 'config_error', message}`; service call → EXIT_FAIL with `{error: '<command>_error', message}`. (See `cli/commands/finance.mjs` `actionAccounts` for the exact pattern.)
2. Argument validation: missing required arg → write usage to stderr, return `{exitCode: EXIT_USAGE}`.
3. Output: `printJson(deps.stdout, value)` on success; `printError(deps.stderr, envelope)` on failure.
4. Register in the module's `ACTIONS` object: `<actionName>: action<Name>`.
5. Update the module's HELP string to document the action.
6. Update the module's `description` if the action set has grown.
7. Test: append a `describe('<action> action', ...)` block to the existing `tests/unit/cli/commands/<name>.test.mjs`. Use the existing `makeBuffers()` helper. Inject a fake for the relevant `getX` factory in deps.
8. Each command tests at minimum: happy path, missing-arg → EXIT_USAGE, factory throw → EXIT_CONFIG, service throw → EXIT_FAIL. Plus any per-action edge cases.

If the underlying service method does not exist on the adapter (rare), add it in a separate domain-layer commit before the CLI action — DO NOT inline-monkey-patch from the CLI.

---

## Task 1: `ha list-devices` — list HA entities, optional filters

**Files:**
- Modify: `cli/commands/ha.mjs` — add `actionListDevices`
- Modify: `tests/unit/cli/commands/ha.test.mjs` — append tests

The HA gateway already exposes `gateway.listAllStates()` (returns `DeviceState[]` for every entity). The action filters by domain and/or by area attribute (`attributes.area_id` or `attributes.area`).

- [ ] **Step 1: Append failing tests** to `tests/unit/cli/commands/ha.test.mjs` inside the existing `describe('cli/commands/ha', ...)` block:

```javascript
  describe('list-devices action', () => {
    function fakeGateway(states) {
      return { async listAllStates() { return states; } };
    }
    const sample = [
      { entityId: 'light.office_main', state: 'off', attributes: { friendly_name: 'Office Main', area_id: 'office' } },
      { entityId: 'light.kitchen_main', state: 'on', attributes: { friendly_name: 'Kitchen Main', area_id: 'kitchen' } },
      { entityId: 'switch.office_fan', state: 'off', attributes: { friendly_name: 'Office Fan', area_id: 'office' } },
    ];

    it('returns all devices when no filters', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['list-devices'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway(sample) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.devices).toHaveLength(3);
      expect(out.count).toBe(3);
    });

    it('filters by --domain', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['list-devices'], flags: { domain: 'light' }, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway(sample) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.devices).toHaveLength(2);
      expect(out.devices.every(d => d.entity_id.startsWith('light.'))).toBe(true);
    });

    it('filters by --area', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['list-devices'], flags: { area: 'office' }, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway(sample) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.devices).toHaveLength(2);
    });

    it('combines --domain and --area filters', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['list-devices'], flags: { domain: 'light', area: 'office' }, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway(sample) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.devices).toHaveLength(1);
      expect(out.devices[0].entity_id).toBe('light.office_main');
    });

    it('exits 3 when getHaGateway() throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['list-devices'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => { throw new Error('not configured'); } },
      );
      expect(r.exitCode).toBe(3);
    });

    it('exits 1 when listAllStates() throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['list-devices'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async listAllStates() { throw new Error('HA timeout'); } }) },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('ha_error');
    });
  });
```

- [ ] **Step 2: Run tests; confirm 6 new failures**

`cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/commands/ha.test.mjs`
Expected: 6 failures in `list-devices action`; existing 7 still pass.

- [ ] **Step 3: Add `actionListDevices` to `cli/commands/ha.mjs`**

Update the HELP string to include the new action under `Actions:`:

```
  list-devices [--domain X] [--area Y]
                       List entities, optionally filtered.
                       Returns: { devices, count }
```

Add the function before `const ACTIONS`:

```javascript
async function actionListDevices(args, deps) {
  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let states;
  try {
    states = await gateway.listAllStates();
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  const domainFilter = args.flags.domain;
  const areaFilter = args.flags.area;

  let filtered = states;
  if (domainFilter) {
    filtered = filtered.filter((s) => s.entityId.startsWith(domainFilter + '.'));
  }
  if (areaFilter) {
    filtered = filtered.filter((s) => s.attributes?.area_id === areaFilter || s.attributes?.area === areaFilter);
  }

  const devices = filtered.map((s) => ({
    entity_id: s.entityId,
    state: s.state,
    friendly_name: s.attributes?.friendly_name ?? null,
    area_id: s.attributes?.area_id ?? s.attributes?.area ?? null,
    domain: s.entityId.split('.')[0],
  }));

  printJson(deps.stdout, { devices, count: devices.length });
  return { exitCode: EXIT_OK };
}
```

Register in `ACTIONS`:

```javascript
const ACTIONS = {
  state: actionState,
  'list-devices': actionListDevices,
};
```

Update `description` to `'Home Assistant entity state and listing'`.

- [ ] **Step 4: Run tests; confirm all pass**

`npx vitest run tests/unit/cli/commands/ha.test.mjs`
Expected: 13 passing (7 original + 6 new).

- [ ] **Step 5: Commit**

```bash
git add cli/commands/ha.mjs tests/unit/cli/commands/ha.test.mjs
git commit -m "feat(dscli): ha list-devices action with --domain/--area filters"
```

---

## Task 2: `ha list-areas` — derived from devices

**Files:**
- Modify: `cli/commands/ha.mjs` — add `actionListAreas`
- Modify: `tests/unit/cli/commands/ha.test.mjs` — append tests

HA's REST API doesn't expose the area registry directly via the existing adapter. We derive areas from the `area_id` attributes of all entities. (If we later want a richer view with area display names, the gateway would need a new method — not in scope here.)

- [ ] **Step 1: Append failing tests**

```javascript
  describe('list-areas action', () => {
    it('returns unique areas with device counts', async () => {
      const { stdout, stderr } = makeBuffers();
      const states = [
        { entityId: 'light.office_main', state: 'off', attributes: { area_id: 'office' } },
        { entityId: 'switch.office_fan', state: 'off', attributes: { area_id: 'office' } },
        { entityId: 'light.kitchen_main', state: 'on', attributes: { area_id: 'kitchen' } },
        { entityId: 'sensor.no_area', state: 'on', attributes: {} },
      ];
      const r = await ha.run(
        { subcommand: 'ha', positional: ['list-areas'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async listAllStates() { return states; } }) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.areas).toEqual(expect.arrayContaining([
        { area_id: 'office', device_count: 2 },
        { area_id: 'kitchen', device_count: 1 },
      ]));
      expect(out.count).toBe(2); // entities without area_id are excluded
    });

    it('returns empty list when no entities have areas', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['list-areas'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async listAllStates() { return []; } }) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.areas).toEqual([]);
      expect(out.count).toBe(0);
    });
  });
```

- [ ] **Step 2: Run tests; confirm 2 new failures**

- [ ] **Step 3: Add `actionListAreas` and register**

```javascript
async function actionListAreas(args, deps) {
  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let states;
  try {
    states = await gateway.listAllStates();
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  const counts = new Map();
  for (const s of states) {
    const areaId = s.attributes?.area_id ?? s.attributes?.area;
    if (!areaId) continue;
    counts.set(areaId, (counts.get(areaId) ?? 0) + 1);
  }
  const areas = Array.from(counts.entries())
    .map(([area_id, device_count]) => ({ area_id, device_count }))
    .sort((a, b) => a.area_id.localeCompare(b.area_id));

  printJson(deps.stdout, { areas, count: areas.length });
  return { exitCode: EXIT_OK };
}
```

Add `'list-areas': actionListAreas` to `ACTIONS` and document in HELP.

- [ ] **Step 4: Run tests, confirm 15 passing.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/ha.mjs tests/unit/cli/commands/ha.test.mjs
git commit -m "feat(dscli): ha list-areas derived from entity area_id attributes"
```

---

## Task 3: `ha resolve` — fuzzy-match a friendly name to entity_id

**Files:**
- Modify: `cli/commands/ha.mjs` — add `actionResolve`
- Modify: `tests/unit/cli/commands/ha.test.mjs` — append tests

Take a free-text query, return the best-matching entity_id by friendly_name. Uses simple substring + lowercase comparison; a fuzzy library is overkill for the foundation. If the household maintains a `friendly_name_aliases` map (per the spec), apply that first. For the foundation, only the friendly_name field is consulted.

- [ ] **Step 1: Append failing tests**

```javascript
  describe('resolve action', () => {
    const sample = [
      { entityId: 'light.office_main', state: 'off', attributes: { friendly_name: 'Office Main' } },
      { entityId: 'light.living_room_main', state: 'off', attributes: { friendly_name: 'Living Room Main' } },
      { entityId: 'switch.kitchen_fan', state: 'off', attributes: { friendly_name: 'Kitchen Fan' } },
    ];

    it('returns exact friendly_name match', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['resolve', 'Office Main'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async listAllStates() { return sample; } }) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.entity_id).toBe('light.office_main');
      expect(out.friendly_name).toBe('Office Main');
    });

    it('returns case-insensitive substring match', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['resolve', 'living', 'room'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async listAllStates() { return sample; } }) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.entity_id).toBe('light.living_room_main');
    });

    it('exits 1 not_found when no match', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['resolve', 'garage'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async listAllStates() { return sample; } }) },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.query).toBe('garage');
    });

    it('exits 2 when query missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await ha.run(
        { subcommand: 'ha', positional: ['resolve'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async listAllStates() { return []; } }) },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/query/i);
    });
  });
```

- [ ] **Step 2: Run; confirm 4 failures.**

- [ ] **Step 3: Add `actionResolve`**

```javascript
async function actionResolve(args, deps) {
  const query = args.positional.slice(1).join(' ').trim();
  if (!query) {
    deps.stderr.write('dscli ha resolve: missing required <query>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let states;
  try {
    states = await gateway.listAllStates();
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  const needle = query.toLowerCase();
  // Prefer exact (case-insensitive) friendly_name match, then substring
  let match = states.find((s) => s.attributes?.friendly_name?.toLowerCase() === needle);
  if (!match) {
    match = states.find((s) => s.attributes?.friendly_name?.toLowerCase().includes(needle));
  }

  if (!match) {
    printError(deps.stderr, { error: 'not_found', query });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, {
    entity_id: match.entityId,
    friendly_name: match.attributes?.friendly_name ?? null,
    state: match.state,
    area_id: match.attributes?.area_id ?? match.attributes?.area ?? null,
  });
  return { exitCode: EXIT_OK };
}
```

Register `resolve: actionResolve` in `ACTIONS`. Update HELP.

- [ ] **Step 4: Run tests; confirm 19 passing.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/ha.mjs tests/unit/cli/commands/ha.test.mjs
git commit -m "feat(dscli): ha resolve — friendly-name → entity_id matcher"
```

---

## Task 4: `content resolve <source>:<id>` — single-item lookup

**Files:**
- Modify: `cli/commands/content.mjs` — add `actionResolve`
- Modify: `tests/unit/cli/commands/content.test.mjs` — append tests

`ContentQueryService.resolve(source, localId, context, overrides)` already exists at `backend/src/3_applications/content/ContentQueryService.mjs:818`. The CLI parses `plex:642120` into `source='plex'` and `id='642120'`, calls resolve, and emits the result.

- [ ] **Step 1: Append failing tests**

```javascript
  describe('resolve action', () => {
    it('parses source:id and calls resolve()', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const fakeQuery = {
        async resolve(source, localId) {
          captured = { source, localId };
          return { source, localId, title: 'Workout Mix', type: 'playlist', metadata: { runtime: 1800 } };
        },
      };
      const r = await content.run(
        { subcommand: 'content', positional: ['resolve', 'plex:642120'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );
      expect(r.exitCode).toBe(0);
      expect(captured).toEqual({ source: 'plex', localId: '642120' });
      const out = JSON.parse(stdout.read().trim());
      expect(out.title).toBe('Workout Mix');
      expect(out.source).toBe('plex');
    });

    it('exits 2 when key is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['resolve'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => ({ async resolve() { return null; } }) },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/source:id/i);
    });

    it('exits 2 when key is malformed (no colon)', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['resolve', 'just-an-id'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => ({ async resolve() { return null; } }) },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/source:id/i);
    });

    it('exits 1 not_found when resolve returns null', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['resolve', 'plex:nope'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => ({ async resolve() { return null; } }) },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.source).toBe('plex');
      expect(err.localId).toBe('nope');
    });
  });
```

- [ ] **Step 2: Run; confirm 4 failures.**

- [ ] **Step 3: Add `actionResolve`** to `cli/commands/content.mjs`:

```javascript
async function actionResolve(args, deps) {
  const key = args.positional[1];
  if (!key || !key.includes(':')) {
    deps.stderr.write('dscli content resolve: missing or malformed <source:id> (e.g. plex:642120)\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  const colonIdx = key.indexOf(':');
  const source = key.slice(0, colonIdx);
  const localId = key.slice(colonIdx + 1);

  let queryService;
  try {
    queryService = await deps.getContentQuery();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let item;
  try {
    item = await queryService.resolve(source, localId);
  } catch (err) {
    printError(deps.stderr, { error: 'content_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  if (!item) {
    printError(deps.stderr, { error: 'not_found', source, localId });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, item);
  return { exitCode: EXIT_OK };
}
```

Register `resolve: actionResolve` in `ACTIONS`. Update HELP with `resolve <source>:<id>` line.

- [ ] **Step 4: Run; confirm 9 passing.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/content.mjs tests/unit/cli/commands/content.test.mjs
git commit -m "feat(dscli): content resolve <source>:<id> action"
```

---

## Task 5: `content list-libraries [--source X]` — list configured sources

**Files:**
- Modify: `cli/commands/content.mjs` — add `actionListLibraries`
- Modify: `tests/unit/cli/commands/content.test.mjs` — append tests

The `ContentQueryService` doesn't directly expose libraries; the registry does. The CLI command needs registry access, not just the query service.

**Decision:** rather than expose the registry through the bootstrap factory (a real refactor), we add a thin `listLibraries()` method to the bootstrap factory's return value. Modify `getContentQuery()` in `cli/_bootstrap.mjs` to also stash the registry: `queryService.__registry = registry`. The command reads `__registry.getCategories()` (an existing method on `ContentSourceRegistry`).

This mirrors the `__workingMemory` stash pattern in `getMemory()`.

- [ ] **Step 1: Modify `cli/_bootstrap.mjs`** to stash the registry:

In the `getContentQuery()` factory, after `_contentQuery = new ContentQueryService({ registry });` add:

```javascript
    _contentQuery.__registry = registry;
```

- [ ] **Step 2: Append failing tests** to `tests/unit/cli/commands/content.test.mjs`:

```javascript
  describe('list-libraries action', () => {
    it('returns categories with optional source filter', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeRegistry = {
        getCategories() { return ['media', 'gallery', 'audiobooks']; },
        resolveSource(name) {
          const map = {
            plex: [{ getProviderName: () => 'plex', getCategoryName: () => 'media' }],
            immich: [{ getProviderName: () => 'immich', getCategoryName: () => 'gallery' }],
          };
          return map[name] || [];
        },
      };
      const fakeQuery = { __registry: fakeRegistry };
      const r = await content.run(
        { subcommand: 'content', positional: ['list-libraries'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.categories).toEqual(['media', 'gallery', 'audiobooks']);
      expect(out.count).toBe(3);
    });

    it('exits 3 when factory throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['list-libraries'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => { throw new Error('plex auth missing'); } },
      );
      expect(r.exitCode).toBe(3);
    });
  });
```

- [ ] **Step 3: Run; confirm 2 failures.**

- [ ] **Step 4: Add `actionListLibraries`**:

```javascript
async function actionListLibraries(args, deps) {
  let queryService;
  try {
    queryService = await deps.getContentQuery();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const registry = queryService.__registry;
  if (!registry || typeof registry.getCategories !== 'function') {
    printError(deps.stderr, { error: 'content_error', message: 'registry not available' });
    return { exitCode: EXIT_FAIL };
  }

  const categories = registry.getCategories();
  printJson(deps.stdout, { categories, count: categories.length });
  return { exitCode: EXIT_OK };
}
```

Register `'list-libraries': actionListLibraries`. Update HELP.

- [ ] **Step 5: Run tests; confirm 11 passing.** Also re-run `tests/unit/cli/_bootstrap.test.mjs` to verify the `__registry` stash didn't regress anything (it shouldn't — bootstrap test doesn't exercise `getContentQuery()`).

- [ ] **Step 6: Commit**

```bash
git add cli/_bootstrap.mjs cli/commands/content.mjs tests/unit/cli/commands/content.test.mjs
git commit -m "feat(dscli): content list-libraries action + registry stash on query service"
```

---

## Task 6: `finance balance <name>` — single account by name

**Files:**
- Modify: `cli/commands/finance.mjs` — add `actionBalance`
- Modify: `tests/unit/cli/commands/finance.test.mjs` — append tests

Filter `getAccounts()` results by name. Case-insensitive exact-match first, then case-insensitive substring.

- [ ] **Step 1: Append failing tests**

```javascript
  describe('balance action', () => {
    const accounts = [
      { id: 732539, name: 'Fidelity', balance: 12345.67 },
      { id: 732537, name: 'Capital One', balance: -250.00 },
      { id: 1489884, name: 'Payroll', balance: 0 },
    ];

    it('returns exact-name match', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await finance.run(
        { subcommand: 'finance', positional: ['balance', 'Fidelity'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => ({ async getAccounts() { return accounts; } }) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.account.name).toBe('Fidelity');
      expect(out.account.balance).toBe(12345.67);
    });

    it('returns case-insensitive substring match', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await finance.run(
        { subcommand: 'finance', positional: ['balance', 'capital'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => ({ async getAccounts() { return accounts; } }) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.account.name).toBe('Capital One');
    });

    it('exits 1 not_found when no match', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await finance.run(
        { subcommand: 'finance', positional: ['balance', 'nonexistent'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => ({ async getAccounts() { return accounts; } }) },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.name).toBe('nonexistent');
    });

    it('exits 2 when name arg missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await finance.run(
        { subcommand: 'finance', positional: ['balance'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => ({ async getAccounts() { return []; } }) },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/name/i);
    });
  });
```

- [ ] **Step 2: Run; confirm 4 failures.**

- [ ] **Step 3: Add `actionBalance`**:

```javascript
async function actionBalance(args, deps) {
  const name = args.positional.slice(1).join(' ').trim();
  if (!name) {
    deps.stderr.write('dscli finance balance: missing required <name>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let buxfer;
  try {
    buxfer = await deps.getBuxfer();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let accounts;
  try {
    accounts = await buxfer.getAccounts();
  } catch (err) {
    printError(deps.stderr, { error: 'buxfer_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  const needle = name.toLowerCase();
  let match = accounts.find((a) => a.name?.toLowerCase() === needle);
  if (!match) {
    match = accounts.find((a) => a.name?.toLowerCase().includes(needle));
  }

  if (!match) {
    printError(deps.stderr, { error: 'not_found', name });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, { account: match });
  return { exitCode: EXIT_OK };
}
```

Register `balance: actionBalance`. Update HELP.

- [ ] **Step 4: Run tests; confirm 9 passing.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/finance.mjs tests/unit/cli/commands/finance.test.mjs
git commit -m "feat(dscli): finance balance <name> action"
```

---

## Task 7: `finance transactions` — query with date range / account / tag

**Files:**
- Modify: `cli/commands/finance.mjs` — add `actionTransactions`
- Modify: `tests/unit/cli/commands/finance.test.mjs` — append tests

`BuxferAdapter.getTransactions({ startDate, endDate, accounts, tagName })` already exists. Map CLI flags `--from`, `--to`, `--account`, `--tag` to those parameters.

- [ ] **Step 1: Append failing tests**

```javascript
  describe('transactions action', () => {
    const txns = [
      { id: 1, date: '2026-04-01', amount: -50, description: 'Safeway', tagNames: ['Groceries'] },
      { id: 2, date: '2026-04-15', amount: -200, description: 'Costco', tagNames: ['Groceries'] },
    ];

    it('passes date range and filters to adapter and returns array', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const fakeBuxfer = {
        async getTransactions(opts) {
          captured = opts;
          return txns;
        },
      };
      const r = await finance.run(
        {
          subcommand: 'finance',
          positional: ['transactions'],
          flags: { from: '2026-04-01', to: '2026-04-30', account: 'Fidelity', tag: 'Groceries' },
          help: false,
        },
        { stdout, stderr, getBuxfer: async () => fakeBuxfer },
      );
      expect(r.exitCode).toBe(0);
      expect(captured).toEqual({
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        accounts: 'Fidelity',
        tagName: 'Groceries',
      });
      const out = JSON.parse(stdout.read().trim());
      expect(out.transactions).toHaveLength(2);
      expect(out.count).toBe(2);
    });

    it('works without filters (all defaults to adapter)', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await finance.run(
        { subcommand: 'finance', positional: ['transactions'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => ({ async getTransactions() { return []; } }) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.transactions).toEqual([]);
    });

    it('exits 1 when adapter throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await finance.run(
        { subcommand: 'finance', positional: ['transactions'], flags: { from: '2026-04-01' }, help: false },
        { stdout, stderr, getBuxfer: async () => ({ async getTransactions() { throw new Error('rate-limited'); } }) },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('buxfer_error');
    });
  });
```

- [ ] **Step 2: Run; confirm 3 failures.**

- [ ] **Step 3: Add `actionTransactions`**:

```javascript
async function actionTransactions(args, deps) {
  let buxfer;
  try {
    buxfer = await deps.getBuxfer();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const opts = {};
  if (args.flags.from) opts.startDate = args.flags.from;
  if (args.flags.to) opts.endDate = args.flags.to;
  if (args.flags.account) opts.accounts = args.flags.account;
  if (args.flags.tag) opts.tagName = args.flags.tag;

  let transactions;
  try {
    transactions = await buxfer.getTransactions(opts);
  } catch (err) {
    printError(deps.stderr, { error: 'buxfer_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  transactions = Array.isArray(transactions) ? transactions : [];
  printJson(deps.stdout, { transactions, count: transactions.length });
  return { exitCode: EXIT_OK };
}
```

Register `transactions: actionTransactions`. Update HELP with the new action and document the four flags.

- [ ] **Step 4: Run tests; confirm 12 passing.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/finance.mjs tests/unit/cli/commands/finance.test.mjs
git commit -m "feat(dscli): finance transactions action with --from/--to/--account/--tag"
```

---

## Task 8: Aggregate test pass + smoke

**Files:** none (verification only)

- [ ] **Step 1: Full sweep**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/
```
Expected: 95+ tests passing (72 from foundation + ~25 new across the 7 tasks).

- [ ] **Step 2: Manual smoke**

```bash
node cli/dscli.mjs ha --help              # Should now list 4 actions: state, list-devices, list-areas, resolve
node cli/dscli.mjs content --help         # Should list 3 actions: search, resolve, list-libraries
node cli/dscli.mjs finance --help         # Should list 4 actions: accounts, balance, transactions
```
Expected: each prints updated help text including the new actions.

- [ ] **Step 3: README sync**

Open `cli/README.md`. Add the new commands to the Usage section in the same compact bullet style as the existing entries. Commit:

```bash
git add cli/README.md
git commit -m "docs(dscli): document Phase B read-only commands in README"
```

---

## Out of scope (deferred to Phase C/D/E)

- `memory delete` — moved to Phase C (it's a write operation; needs policy gating decisions)
- `ha toggle / call-service` — Phase C (write commands)
- `finance refresh` — Phase C (write/orchestration)
- `system reload` — Phase C (write/orchestration)
- `dscli concierge ask / transcript / replay / satellites` — Phase D
- `dscli content play` — Phase D (requires backend + HA gateway)
- `--format=text` formatters — Phase E
- Schema contract tests — Phase E

---

## Self-review notes

**Spec coverage check:**
- `ha state` (Foundation) ✓
- `ha list-areas` → Task 2
- `ha list-devices [--area] [--domain]` → Task 1
- `ha resolve "name"` → Task 3
- `content search` (Foundation) ✓
- `content resolve plex:642120` → Task 4
- `content list-libraries [--source plex]` → Task 5 (note: --source filter not yet implemented; the registry exposes all categories. A future enhancement could filter by capability, but `--source` semantics need design — deferred.)
- `finance balance <name>` → Task 6
- `finance balances` (Foundation `accounts` covers this) ✓
- `finance transactions --from --to --account --tag` → Task 7

**Type/name consistency:** All new commands return `{exitCode}`, follow the two-try-catch pattern (factory → EXIT_CONFIG, service → EXIT_FAIL with `<command>_error`), use `printJson`/`printError` from `_output.mjs`, and register actions via the `ACTIONS` map. Identical to foundation pattern.

**Placeholder scan:** No "TODO", "implement later", or "similar to Task N" without code. Each task is self-contained with full code.

**Known limitation:** `content list-libraries --source <name>` flag is documented in the spec but not implemented in Task 5 — only the unfiltered listing is shipped. The registry's `resolveSource(name)` exists; a follow-up can wire the flag once the desired output shape is decided.
