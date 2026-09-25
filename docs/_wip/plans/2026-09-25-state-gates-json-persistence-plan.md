# State Gates JSON Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store State Gates' durable state as JSON (schema v2) so a commit's
write costs single-digit milliseconds instead of 70–126 ms of YAML work on
the event loop.

**Architecture:** `YamlStateGatesStateEngine` keeps its in-memory copy and
its per-household serialised writes. Only the storage changes:

- `#write` stringifies the cached state to `current.json` through
  `writeFileAtomic`.
- `#read` prefers `current.json`, falls back once to the legacy v1
  `current.yml` (migration), and refuses to start when the legacy file is
  newer than the JSON file.
- A `toLegacyV1()` converter and a CLI make a deliberate rollback lossless.

**Tech Stack:** Node 22 ESM, vitest, FileIO (`backend/src/0_system/utils/FileIO.mjs`).

**Spec:** `docs/_wip/plans/2026-09-25-state-gates-json-persistence-design.md`
(read it first).

## Global Constraints

- New file: `data/household[-{hid}]/state-gates/current.json`, schema
  `daylight.state-gates-state/v2`, camelCase keys (the in-memory shape),
  compact `JSON.stringify`.
- Legacy file: `current.yml`, schema `daylight.state-gates-state/v1`,
  snake_case keys. The engine never modifies or deletes it.
- Precedence: JSON wins. A legacy file newer than the JSON file means refuse
  to start, with cause code `LEGACY_STATE_NEWER`.
- Every read failure throws `PersistenceError` `STATE_GATES_STATE_UNAVAILABLE`
  (503) with a cause. There is never a fallback from corrupt JSON to YAML.
- Unchanged:
  - one atomic write per commit;
  - the cache is dropped after a failed write;
  - retention (500 entries / 7 days);
  - replay, compaction and repository behaviour.
- Adapters must not import `node:fs` (the `adapters-no-direct-fs` audit).
  All IO goes through FileIO or injected functions.
- Keep the class name `YamlStateGatesStateEngine`.
- No wall-clock timing assertions in any gated test.

## Review Focus

1. **First boot after deploy on the real data:** `current.yml` only, with
   published and unpublished journal entries. After migration, pending
   delivery and `deliveryCheckpoint` must be exactly what they were.
   Pinned in Task 2 (migration + `markPublished` test).
2. **A household with neither file** (new household, multi-household boot)
   gets an empty state, and its first commit creates `current.json`.
   Pinned in Task 2 and Task 4 (the retry test's `utc` household).
3. **A write that fails midway leaves the old `current.json` intact**
   (atomic rename), and the next read comes from disk. Pinned in Task 1
   (the matrix interrupted-write case against the JSON store).
4. **A value JSON cannot represent** (`undefined`, `NaN`) sneaking into state
   must fail a test instead of silently changing on disk. Pinned in Task 1
   (the disk-equals-memory helper uses `toStrictEqual`).
5. **An older build ran after the switch** (Watchtower revert). Boot refuses
   with `LEGACY_STATE_NEWER` instead of silently discarding the older build's
   writes. Pinned in Task 2.

---

### Task 1: JSON write path and v2 read

**Files:**
- Modify: `backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs`
- Modify: `tests/isolated/adapter/state-gates/stateGatesPersistence.matrix.test.mjs`
- Modify: `tests/isolated/adapter/state-gates/stateGatesStateEngineCache.test.mjs`
- Modify: `tests/isolated/adapter/state-gates/stateGatesAdapters.test.mjs:127,214-216`

**Interfaces:**
- Produces:
  - constructor options `{ filePath?, resolveFilePath?, load?, save?, maxEntries?, maxAgeMs?, logger? }`,
    where `load(jsonPath) → object|null` returns a parsed v2 object and
    `save(jsonPath, content: string)`;
  - exported constants `STATE_SCHEMA_V1 = 'daylight.state-gates-state/v1'`
    and `STATE_SCHEMA_V2 = 'daylight.state-gates-state/v2'`;
  - log event `state-gates.state.written`
    `{ householdId, durationMs, bytes, journalEntries }` via
    `logger.sampled` (info, at most 4 per minute).

- [ ] **Step 1: Switch the test helpers to the string contract (failing first)**

In `stateGatesPersistence.matrix.test.mjs`, replace `memoryEngine` and add a
disk-equals-memory helper:

```js
function memoryEngine(options = {}) {
  const files = new Map();
  let failSave = false;
  const engine = new YamlStateGatesStateEngine({
    resolveFilePath: householdId => `/virtual/${householdId}/current.json`,
    load: filePath => files.has(filePath) ? JSON.parse(files.get(filePath)) : null,
    save: (filePath, content) => {
      if (failSave) throw new Error('simulated interrupted write');
      expect(typeof content).toBe('string');
      files.set(filePath, content);
    },
    ...options,
  });
  return { engine, files, failSave: value => { failSave = value; } };
}

// What reached disk must be exactly what the engine holds: JSON drops
// undefined keys and turns NaN into null, where YAML used to throw.
async function expectDiskMatchesMemory(engine, files, householdId = 'home') {
  const disk = JSON.parse(files.get(`/virtual/${householdId}/current.json`));
  expect(disk.schema).toBe('daylight.state-gates-state/v2');
  expect(disk.projection).toStrictEqual(await engine.loadProjection(householdId));
}
```

Add this test to the matrix `describe`:

```js
  it('writes compact v2 JSON that round-trips to exactly the in-memory state', async () => {
    const { engine, files } = memoryEngine();
    await engine.commit('home', 0, projection(1, { assertions: [{ id: 'a', observedAt: 1790371529737, value: { rings: 3 } }] }), [event(1)]);
    await engine.markPublished('home', [event(1).transitionId]);
    const content = files.get('/virtual/home/current.json');
    expect(content.startsWith('{')).toBe(true);
    expect(content).not.toContain('\n');
    expect(JSON.parse(content).deliveryCheckpoint).toBe(1);
    await expectDiskMatchesMemory(engine, files);
  });

  it('a value JSON cannot represent is caught by the disk check, not silently dropped', async () => {
    const { engine, files } = memoryEngine();
    await engine.commit('home', 0, projection(1, { assertions: [{ id: 'a', note: undefined }] }), []);
    await expect(expectDiskMatchesMemory(engine, files)).rejects.toThrow();
  });
```

Wherever a matrix test reads `files` expecting an object, change it to
`JSON.parse(files.get(...))`. Run the file to find them (Step 2).

In `stateGatesStateEngineCache.test.mjs:8-14`, change the paths to
`current.json`, the load to `files.has(p) ? JSON.parse(files.get(p)) : null`,
and the save to store the string: `files.set(p, v)`, keeping its `failSave`
guard.

In `stateGatesAdapters.test.mjs:127`:

```js
    const engine = new YamlStateGatesStateEngine({ resolveFilePath: householdId => `/virtual/${householdId}/current.json`, load: path => memory.has(path) ? JSON.parse(memory.get(path)) : null, save: (path, content) => memory.set(path, content) });
```

At `:214`, change `filePath: '/virtual/corrupt.yml'` to
`filePath: '/virtual/corrupt.json'` and the thrown message to
`'bad json'`. The expectation (503 `STATE_GATES_STATE_UNAVAILABLE`) is
unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/isolated/adapter/state-gates/`

Expected: FAIL. The engine still passes an object to `save`, so
`typeof content` is `'object'`, and `JSON.parse` of an object throws.

- [ ] **Step 3: Implement the JSON write and v2 read**

In `YamlStateGatesStateEngine.mjs`:

Replace the import line and `strictLoad` with:

```js
import { fileExists, readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

export const STATE_SCHEMA_V1 = 'daylight.state-gates-state/v1';
export const STATE_SCHEMA_V2 = 'daylight.state-gates-state/v2';

// Default JSON loader: null when the file is absent; a parse error throws
// and becomes STATE_GATES_STATE_UNAVAILABLE. It never falls back to YAML.
function loadJson(filePath) {
  if (!fileExists(filePath)) return null;
  return JSON.parse(readTextFromPath(filePath));
}

function unsupportedSchema() {
  return persistenceError('State Gates state could not be read',
    Object.assign(new Error('Unsupported State Gates state schema'), { code: 'UNSUPPORTED_STATE_SCHEMA' }));
}
```

Keep `plain`, `snake`, `camel`, `DYNAMIC_MAPS` and `mapKeys`: Task 2 and
Task 3 use them. In `emptyState()`, change `schema` to `STATE_SCHEMA_V2`.

In the class, change the constructor defaults to `load = loadJson,
save = writeFileAtomic`. Replace the class doc comment's first line with:

```js
// Storage is JSON (current.json, schema v2) since 2026-09-25; the class keeps
// its Yaml- name to avoid churning blame in a performance fix. See
// docs/_wip/plans/2026-09-25-state-gates-json-persistence-design.md.
```

Replace `#read`:

```js
  #read(householdId) {
    let stored;
    try { stored = this.#load(this.#resolveFilePath(householdId)); }
    catch (error) { throw persistenceError('State Gates state could not be read', error); }
    if (!stored) return emptyState();
    if (stored.schema !== STATE_SCHEMA_V2) throw unsupportedSchema();
    return stored;
  }
```

Replace `#write`:

```js
  #write(householdId, state) {
    const startedAt = performance.now();
    // State is plain by construction (commit() runs plain() on caller input
    // before it touches the cached copy), so no deep walk is needed here.
    const content = JSON.stringify({ ...state, schema: STATE_SCHEMA_V2 });
    try { this.#save(this.#resolveFilePath(householdId), content); }
    catch (error) {
      this.#cache.delete(householdId); // disk is truth again; re-parse on the next read
      this.#logger?.warn?.('state-gates.cache-dropped-after-failed-write', {
        householdId, error: error?.message ?? String(error),
      });
      throw persistenceError('State Gates state could not be saved', error);
    }
    this.#logger?.sampled?.('state-gates.state.written', {
      householdId,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      bytes: Buffer.byteLength(content),
      journalEntries: state.journal.length,
    }, { maxPerMinute: 4 });
  }
```

Keep the existing explanatory comments inside the catch block. They are
shortened above for readability.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/isolated/adapter/state-gates/`

Expected: PASS, all three files (38 existing tests plus the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs tests/isolated/adapter/state-gates/
git commit -m "perf(state-gates): persist state as compact JSON (schema v2)" -- backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs tests/isolated/adapter/state-gates/
```

---

### Task 2: Legacy migration and the newer-legacy guard

**Files:**
- Modify: `backend/src/0_system/utils/FileIO.mjs` (add `fileMtimeMs` after `fileSignature`)
- Modify: `backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs`
- Create: `tests/isolated/adapter/state-gates/stateGatesJsonMigration.test.mjs`

**Interfaces:**
- Consumes (from Task 1):
  - `STATE_SCHEMA_V1` and `STATE_SCHEMA_V2`;
  - `mapKeys(value, mapper)`, `camel` and `snake` (module-private);
  - `#read`.
- Produces:
  - constructor options `legacyFilePath?`, `resolveLegacyFilePath?`,
    `loadLegacy?(ymlPath) → object|null` and `mtime?(path) → number|null`;
  - `FileIO.fileMtimeMs(filePath) → number|null`;
  - log event `state-gates.state.migrated` `{ householdId, householdRevision }`
    (info).

- [ ] **Step 1: Write the failing tests**

Create `tests/isolated/adapter/state-gates/stateGatesJsonMigration.test.mjs`:

```js
import { describe, expect, it, vi } from 'vitest';
import { YamlStateGatesStateEngine } from '#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs';

const JSON_PATH = id => `/virtual/${id}/current.json`;
const YML_PATH = id => `/virtual/${id}/current.yml`;

// A v1 file exactly as the YAML engine stored it: snake_case outside the
// dynamic maps, one published and one unpublished revision batch.
function legacyV1() {
  return {
    schema: 'daylight.state-gates-state/v1',
    projection: {
      schema_version: 1, household_revision: 2, active_policy_candidate: {
        claim_types: { 'school.dailyDone': { schema_version: 1 } },
      },
      assertions: [{ id: 'a1', observed_at: 1790371529737 }], evaluations: [], decisions: [],
    },
    journal: [
      { transition_id: 't1', household_revision: 1, ordinal: 0, occurred_at: Date.now(), kind: 'StateObservation', payload: {}, published: true },
      { transition_id: 't2', household_revision: 2, ordinal: 0, occurred_at: Date.now(), kind: 'StateObservation', payload: {}, published: false },
    ],
    compacted_through: 0,
    delivery_checkpoint: 1,
  };
}

function engineWith({ json = null, yml = null, jsonAt = null, ymlAt = null } = {}) {
  const files = new Map();
  if (json !== null) files.set(JSON_PATH('home'), json);
  const legacy = new Map();
  if (yml !== null) legacy.set(YML_PATH('home'), yml);
  const times = new Map([[JSON_PATH('home'), jsonAt], [YML_PATH('home'), ymlAt]]);
  const logger = { info: vi.fn(), warn: vi.fn(), sampled: vi.fn() };
  const engine = new YamlStateGatesStateEngine({
    resolveFilePath: JSON_PATH,
    resolveLegacyFilePath: YML_PATH,
    load: p => files.has(p) ? JSON.parse(files.get(p)) : null,
    loadLegacy: p => legacy.has(p) ? structuredClone(legacy.get(p)) : null,
    save: (p, content) => { files.set(p, content); times.set(p, Date.now() + 1e6); },
    mtime: p => times.get(p) ?? null,
    logger,
  });
  return { engine, files, legacy, logger };
}

describe('State Gates JSON migration', () => {
  it('reads a v1 YAML file, and the first commit writes v2 JSON with the same content', async () => {
    const { engine, files, legacy, logger } = engineWith({ yml: legacyV1() });
    const before = await engine.loadProjection('home');
    expect(before.householdRevision).toBe(2);
    expect(before.activePolicyCandidate.claimTypes['school.dailyDone']).toEqual({ schemaVersion: 1 });
    expect(logger.info).toHaveBeenCalledWith('state-gates.state.migrated', { householdId: 'home', householdRevision: 2 });

    await engine.commit('home', 2, { ...before, householdRevision: 3 }, []);
    const disk = JSON.parse(files.get(JSON_PATH('home')));
    expect(disk.schema).toBe('daylight.state-gates-state/v2');
    expect(disk.projection.assertions).toEqual([{ id: 'a1', observedAt: 1790371529737 }]);
    expect(disk.journal.map(e => [e.transitionId, e.published])).toEqual([['t1', true], ['t2', false]]);
    expect(legacy.get(YML_PATH('home'))).toEqual(legacyV1()); // never touched
  });

  it('pending delivery and the delivery checkpoint survive the migration', async () => {
    const { engine, files } = engineWith({ yml: legacyV1() });
    expect((await engine.pending('home')).map(e => e.transitionId)).toEqual(['t2']);
    await engine.markPublished('home', ['t2']);
    const disk = JSON.parse(files.get(JSON_PATH('home')));
    expect(disk.deliveryCheckpoint).toBe(2);
    expect(await engine.pending('home')).toEqual([]);
  });

  it('when both files exist and the JSON file is newer, JSON wins', async () => {
    const json = JSON.stringify({ schema: 'daylight.state-gates-state/v2', projection: { householdRevision: 9 }, journal: [], compactedThrough: 0, deliveryCheckpoint: 0 });
    const { engine } = engineWith({ json, yml: legacyV1(), jsonAt: 2000, ymlAt: 1000 });
    expect((await engine.loadProjection('home')).householdRevision).toBe(9);
  });

  it('refuses to start when the legacy YAML is newer than the JSON (an older build ran)', async () => {
    const json = JSON.stringify({ schema: 'daylight.state-gates-state/v2', projection: { householdRevision: 9 }, journal: [], compactedThrough: 0, deliveryCheckpoint: 0 });
    const { engine } = engineWith({ json, yml: legacyV1(), jsonAt: 1000, ymlAt: 2000 });
    await expect(engine.loadProjection('home')).rejects.toMatchObject({
      code: 'STATE_GATES_STATE_UNAVAILABLE', status: 503, cause: { code: 'LEGACY_STATE_NEWER' },
    });
  });

  it('corrupt JSON is a read failure and never falls back to the YAML', async () => {
    const { engine } = engineWith({ json: '{"schema": "daylight.state-', yml: legacyV1(), jsonAt: 2000, ymlAt: 1000 });
    await expect(engine.loadProjection('home')).rejects.toMatchObject({ code: 'STATE_GATES_STATE_UNAVAILABLE' });
  });

  it('an unknown schema in either file is UNSUPPORTED_STATE_SCHEMA', async () => {
    const odd = engineWith({ yml: { ...legacyV1(), schema: 'daylight.state-gates-state/v0' } });
    await expect(odd.engine.loadProjection('home')).rejects.toMatchObject({ cause: { code: 'UNSUPPORTED_STATE_SCHEMA' } });
    const oddJson = engineWith({ json: JSON.stringify({ schema: 'something-else' }) });
    await expect(oddJson.engine.loadProjection('home')).rejects.toMatchObject({ cause: { code: 'UNSUPPORTED_STATE_SCHEMA' } });
  });

  it('a household with neither file starts empty, and its first commit creates the JSON', async () => {
    const { engine, files } = engineWith();
    expect(await engine.loadProjection('home')).toBeNull();
    await engine.commit('home', 0, { schemaVersion: 1, householdRevision: 1, assertions: [], evaluations: [], decisions: [] }, []);
    expect(JSON.parse(files.get(JSON_PATH('home'))).projection.householdRevision).toBe(1);
  });
});
```

Before relying on "starts empty", check what `loadProjection` returns for an
empty state: `emptyState().projection` is `null`, so `toBeNull()` holds.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/isolated/adapter/state-gates/stateGatesJsonMigration.test.mjs`

Expected: FAIL. `resolveLegacyFilePath` and `loadLegacy` are ignored, so the
migration tests see empty state, and the guard test resolves instead of
rejecting.

- [ ] **Step 3: Add `fileMtimeMs` to FileIO**

In `backend/src/0_system/utils/FileIO.mjs`, directly after `fileSignature`:

```js
/**
 * Modification time in ms, or null when the file cannot be stat'ed.
 * @param {string} filePath - File path
 * @returns {number|null}
 */
export function fileMtimeMs(filePath) {
  try { return fs.statSync(filePath).mtimeMs; }
  catch { return null; }
}
```

- [ ] **Step 4: Implement legacy read and the guard in the engine**

Imports become:

```js
import { fileExists, fileMtimeMs, readTextFromPath, readYamlFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';
```

Add back the legacy loader:

```js
// Legacy v1 YAML loader, for the one-time migration only.
function loadLegacyYaml(filePath) {
  try { return readYamlFromPath(filePath); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
```

Constructor: add `legacyFilePath`, `resolveLegacyFilePath`,
`loadLegacy = loadLegacyYaml` and `mtime = fileMtimeMs`. Store them as
`#resolveLegacyFilePath` (= `resolveLegacyFilePath ?? (legacyFilePath ? () => legacyFilePath : null)`),
`#loadLegacy` and `#mtime`. Declare the three private fields alongside the
others.

Replace `#read`:

```js
  #read(householdId) {
    const jsonPath = this.#resolveFilePath(householdId);
    const legacyPath = this.#resolveLegacyFilePath?.(householdId) ?? null;
    let stored;
    try { stored = this.#load(jsonPath); }
    catch (error) { throw persistenceError('State Gates state could not be read', error); }
    if (stored) {
      if (stored.schema !== STATE_SCHEMA_V2) throw unsupportedSchema();
      // An older (YAML) build wrote after the switch: preferring JSON would
      // silently discard that window. Refuse; the runbook says how to choose.
      if (legacyPath) {
        const legacyAt = this.#mtime(legacyPath);
        const jsonAt = this.#mtime(jsonPath);
        if (legacyAt !== null && jsonAt !== null && legacyAt > jsonAt) {
          throw persistenceError('State Gates state could not be read', Object.assign(
            new Error('Legacy YAML state is newer than the JSON state'), { code: 'LEGACY_STATE_NEWER' }));
        }
      }
      return stored;
    }
    if (!legacyPath) return emptyState();
    let legacy;
    try { legacy = this.#loadLegacy(legacyPath); }
    catch (error) { throw persistenceError('State Gates state could not be read', error); }
    if (!legacy) return emptyState();
    if (legacy.schema !== STATE_SCHEMA_V1) throw unsupportedSchema();
    const state = mapKeys(legacy, camel);
    this.#logger?.info?.('state-gates.state.migrated', {
      householdId, householdRevision: state.projection?.householdRevision ?? 0,
    });
    return state;
  }
```

- [ ] **Step 5: Run to verify it passes, together with Task 1's tests**

Run: `npx vitest run tests/isolated/adapter/state-gates/`

Expected: PASS, all four files.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(state-gates): migrate v1 YAML state to JSON; refuse a newer legacy file" -- backend/src/0_system/utils/FileIO.mjs backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs tests/isolated/adapter/state-gates/stateGatesJsonMigration.test.mjs
```

(Run `git add` on the new test file first.)

---

### Task 3: Lossless rollback converter

**Files:**
- Modify: `backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs` (export `toLegacyV1`)
- Create: `cli/state-gates-legacy-yaml.cli.mjs`
- Modify: `tests/isolated/adapter/state-gates/stateGatesJsonMigration.test.mjs` (add a test)

**Interfaces:**
- Consumes: `mapKeys`, `plain`, `snake`, `camel`, `STATE_SCHEMA_V1`.
- Produces: `export function toLegacyV1(state) → object` (v1-shaped, with
  snake_case keys outside the dynamic maps).

- [ ] **Step 1: Write the failing test** (append to the migration describe)

```js
  it('toLegacyV1 turns JSON state back into a v1 file the migration reads identically', async () => {
    const { toLegacyV1 } = await import('#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs');
    const first = engineWith({ yml: legacyV1() });
    const migrated = await first.engine.loadProjection('home');
    await first.engine.commit('home', 2, { ...migrated, householdRevision: 3 }, []);
    const jsonState = JSON.parse(first.files.get(JSON_PATH('home')));

    const back = toLegacyV1(jsonState);
    expect(back.schema).toBe('daylight.state-gates-state/v1');
    expect(back.projection.household_revision).toBe(3);
    expect(back.projection.active_policy_candidate.claim_types['school.dailyDone']).toEqual({ schema_version: 1 });

    const second = engineWith({ yml: back });
    const { schema, ...expected } = jsonState;
    expect(await second.engine.loadProjection('home')).toEqual(expected.projection);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/isolated/adapter/state-gates/stateGatesJsonMigration.test.mjs -t toLegacyV1`

Expected: FAIL (`toLegacyV1 is not a function`).

- [ ] **Step 3: Implement** (module level, after `mapKeys`)

```js
/**
 * JSON (v2) state → the v1 YAML object a pre-JSON build reads. For a
 * deliberate rollback: `node cli/state-gates-legacy-yaml.cli.mjs`.
 */
export function toLegacyV1(state) {
  const { schema: ignoredSchema, ...rest } = state;
  void ignoredSchema;
  const stored = mapKeys(plain(rest), snake);
  stored.schema = STATE_SCHEMA_V1;
  return stored;
}
```

Create `cli/state-gates-legacy-yaml.cli.mjs`:

```js
#!/usr/bin/env node
// Convert State Gates current.json (v2) back to the v1 current.yml a pre-JSON
// build reads, for a deliberate rollback. Run inside the container:
//   node cli/state-gates-legacy-yaml.cli.mjs data/household/state-gates/current.json data/household/state-gates/current.yml
// Then move current.json aside (never delete). See
// docs/reference/state-gates/integration-and-operations.md#rollback.
import { readTextFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { toLegacyV1 } from '#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  process.stderr.write('usage: state-gates-legacy-yaml.cli.mjs <current.json> <current.yml>\n');
  process.exit(2);
}
const state = JSON.parse(readTextFromPath(from));
saveYamlToPathAtomic(to, toLegacyV1(state), { noRefs: true, sortKeys: true });
process.stdout.write(`wrote ${to} (household revision ${state.projection?.householdRevision ?? 0})\n`);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/adapter/state-gates/`

Expected: PASS.

Smoke-test the CLI against a temporary file:

```bash
node -e "require('fs').writeFileSync('/tmp/sg-cli.json', JSON.stringify({schema:'daylight.state-gates-state/v2',projection:{householdRevision:1},journal:[],compactedThrough:0,deliveryCheckpoint:0}))"
node cli/state-gates-legacy-yaml.cli.mjs /tmp/sg-cli.json /tmp/sg-cli.yml && head -5 /tmp/sg-cli.yml
```

Expected: `wrote /tmp/sg-cli.yml (household revision 1)`, and the YAML
contains `household_revision: 1` and `schema: daylight.state-gates-state/v1`.

- [ ] **Step 5: Commit**

```bash
git add cli/state-gates-legacy-yaml.cli.mjs
git commit -m "feat(state-gates): toLegacyV1 converter + CLI for a lossless rollback" -- backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs cli/state-gates-legacy-yaml.cli.mjs tests/isolated/adapter/state-gates/stateGatesJsonMigration.test.mjs
```

---

### Task 4: Composition wiring, composition tests, tooling, bench

**Files:**
- Modify: `backend/src/5_composition/modules/stateGates.mjs:~52-70`
- Modify: `backend/src/5_composition/composition-contract-registry.test.mjs:94`
- Modify: `backend/src/5_composition/modules/stateGates.retry.test.mjs:205-206`
- Modify: `tests/preimplementation/application-modules/tooling/review-storage-consumers.mjs:219`
- Create: `scripts/bench/state-gates-write.mjs`

**Interfaces:**
- Consumes: the constructor options from Tasks 1–2.

- [ ] **Step 1: Update the composition test expectations (failing)**

`composition-contract-registry.test.mjs:94`:

```js
        expect(fs.existsSync(path.join(directory, 'state-gates/current.json'))).toBe(true);
```

`stateGates.retry.test.mjs:205-206`:

```js
      expect(fs.existsSync(path.join(directory, 'west/state-gates/current.json'))).toBe(true);
      expect(fs.existsSync(path.join(directory, 'utc/state-gates/current.json'))).toBe(true);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --pool=forks backend/src/5_composition/composition-contract-registry.test.mjs backend/src/5_composition/modules/stateGates.retry.test.mjs`

Expected: FAIL. Composition still resolves `current.yml`, so the engine
writes JSON content into a `.yml` path and no `.json` file exists.

- [ ] **Step 3: Wire the paths in composition**

In `createStateGatesModule`, replace the engine construction:

```js
  const statePath = id => configService.getHouseholdPath('state-gates/current', id);
  const engine = new YamlStateGatesStateEngine({
    resolveFilePath: id => `${statePath(id)}.json`,
    // Read once to migrate the pre-2026-09-25 YAML state; never written.
    resolveLegacyFilePath: id => `${statePath(id)}.yml`,
    ...journalRetention,
    logger: moduleLogger,
  });
```

Update the comment above `journalRetention` (`~:52-56`). Change its first
sentence to: "Journal + projection share current.json and every commit
rewrites the whole file, so journal size is the cost of every write (JSON
since 2026-09-25: about 5 ms for 500 entries)." Keep the rest.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --pool=forks backend/src/5_composition/composition-contract-registry.test.mjs backend/src/5_composition/modules/stateGates.retry.test.mjs && npx vitest run tests/isolated/adapter/state-gates/`

Expected: PASS.

- [ ] **Step 5: Adjudicate the new IO defaults in the storage-consumers tool**

In `review-storage-consumers.mjs:219`, change the policy's binding list from
`'saveYamlToPathAtomic'` to `'fileExists fileMtimeMs readTextFromPath readYamlFromPath writeFileAtomic'`.
Update its description to: "Destructured load/loadLegacy/save/mtime defaults
(loadJson, loadLegacyYaml, writeFileAtomic, fileMtimeMs); preserve
resolveFilePath/resolveLegacyFilePath timing."

Run: `node tests/preimplementation/application-modules/tooling/review-storage-consumers.mjs`

Expected: it reports no unadjudicated IO reference for
`YamlStateGatesStateEngine.mjs`. If it names a binding differently, match
its exact list. Don't touch any other policy.

- [ ] **Step 6: Add the bench script (outside the gate)**

Create `scripts/bench/state-gates-write.mjs`:

```js
#!/usr/bin/env node
// Production-sized State Gates write cost, YAML (old) vs JSON (new). Not a
// test: wall-clock numbers flake under gate load. Run by hand:
//   node scripts/bench/state-gates-write.mjs
import yaml from 'js-yaml';

const now = Date.now();
const state = {
  schema: 'daylight.state-gates-state/v2',
  projection: {
    schemaVersion: 1, householdRevision: 6174,
    assertions: Array.from({ length: 131 }, (_, i) => ({ id: `fitness:weekly-rings:user${i}`, observedAt: now, sourceRevision: now, value: { rings: i % 5, minutes: i * 3, detail: 'x'.repeat(300) } })),
    evaluations: Array.from({ length: 258 }, (_, i) => ({ gateId: `gate${i}`, state: 'satisfied', reasons: ['CLAIM_PRESENT'], validFrom: now, validUntil: null, detail: 'y'.repeat(250) })),
    decisions: Array.from({ length: 131 }, (_, i) => ({ entitlementId: `ent${i}`, allowed: true, reasons: [], detail: 'z'.repeat(250) })),
  },
  journal: Array.from({ length: 497 }, (_, i) => ({ transitionId: `t${i}`, householdRevision: 5700 + i, ordinal: 0, occurredAt: now, kind: 'StateObservation', payload: { observationKind: 'gate', detail: 'w'.repeat(600) }, published: true })),
  compactedThrough: 5699, deliveryCheckpoint: 6174,
};
const time = (label, fn, runs = 20) => {
  const samples = [];
  for (let i = 0; i < runs; i += 1) { const t = performance.now(); fn(); samples.push(performance.now() - t); }
  samples.sort((a, b) => a - b);
  console.log(label.padEnd(8), 'median', samples[runs >> 1].toFixed(1), 'ms  max', samples.at(-1).toFixed(1), 'ms');
};
const json = JSON.stringify(state);
console.log('state size', (Buffer.byteLength(json) / 1024).toFixed(0), 'KB');
time('yaml', () => yaml.dump(state, { noRefs: true, sortKeys: true }));
time('json', () => JSON.stringify(state));
```

Run: `node scripts/bench/state-gates-write.mjs`

Expected: a state of roughly 600–800 KB, with the `json` median several
times below the `yaml` median.

- [ ] **Step 7: Commit**

```bash
git add scripts/bench/state-gates-write.mjs
git commit -m "feat(state-gates): composition stores current.json, migrates current.yml" -- backend/src/5_composition/modules/stateGates.mjs backend/src/5_composition/composition-contract-registry.test.mjs backend/src/5_composition/modules/stateGates.retry.test.mjs tests/preimplementation/application-modules/tooling/review-storage-consumers.mjs scripts/bench/state-gates-write.mjs
```

---

### Task 5: Docs, deploy, verify

**Files:**
- Modify: `docs/reference/state-gates/integration-and-operations.md` (the "Persistence" and "Journal retention" sections, plus a new "Rollback" subsection)
- Modify: `docs/reference/state-gates/README.md` (~89, 108, 110: path and schema)
- Modify: `docs/reference/state-gates/architecture.md` (~991, 1003: path and schema)
- Modify: `docs/_wip/audits/2026-09-25-backend-event-loop-stalls.md`

- [ ] **Step 1: Update the operations doc**

In "Persistence":

- the path becomes `data/household[-{hid}]/state-gates/current.json`;
- the schema becomes `daylight.state-gates-state/v2`: compact JSON with
  camelCase keys, and the same contents list;
- add: "Before 2026-09-25 the state was YAML (`current.yml`, v1, snake_case).
  On first read, if `current.json` is absent, the engine reads
  `current.yml`, logs `state-gates.state.migrated`, and writes
  `current.json` on the next commit. It never modifies or deletes
  `current.yml`."

In "Journal retention", replace "The journal shares `current.yml`" with
"The journal shares `current.json`". Add: "each write is about 5 ms
(`state-gates.state.written`, sampled)".

Add a subsection:

```markdown
### Rollback

- A build older than 2026-09-25 reads the stale `current.yml`:
  - the household revision regresses;
  - changes since the switch are lost;
  - subscribers holding a newer replay cursor get `INVALID_REPLAY_CURSOR` (400)
    and resubscribe.
- To roll back without losing anything, first convert inside the container:
  `node cli/state-gates-legacy-yaml.cli.mjs data/household/state-gates/current.json data/household/state-gates/current.yml`
  Then move `current.json` into `data/_deleteme/`.
- Rolling forward again after an older build has written `current.yml`
  makes State Gates refuse to start (`STATE_GATES_STATE_UNAVAILABLE`, cause
  `LEGACY_STATE_NEWER`). Choose one:
  - keep the newer YAML: move `current.json` aside, and it re-migrates;
  - keep the JSON: move `current.yml` aside.
- A lost or damaged `current.json` is recovered from Dropbox version history
  on the data tree.
```

- [ ] **Step 2: Update the README and architecture path/schema mentions**

At the listed lines, change `current.yml` to `current.json` and `v1` to
`v2`, plus one clause: "(YAML v1 before 2026-09-25, migrated on first
read)". Run `grep -n "current.yml\|state-gates-state/v1" docs/reference/state-gates/*.md`:
the only hits left should be the migration and rollback text.

- [ ] **Step 3: Run the full relevant suites and gates**

Run:

```bash
npx vitest run tests/isolated/adapter/state-gates/ && npx vitest run --pool=forks backend/src/5_composition/composition-contract-registry.test.mjs backend/src/5_composition/modules/stateGates.retry.test.mjs && npm run -s audit:layers && npm run -s audit:fs
```

Expected: all pass, and the audits report `ok` at their baselines.

- [ ] **Step 4: Commit the docs, merge, deploy through the gate**

Commit the docs with a pathspec. Merge the branch to main, record it in
`docs/_archive/deleted-branches.md`, remove the worktree, push. Then follow
`CLAUDE.local.md`:

1. `./scripts/deploy-gate.sh`, which must exit 0;
2. `./scripts/build-daylight.sh`;
3. re-run the gate;
4. stop, remove and redeploy.

Don't run heavy tests while the container restarts.

- [ ] **Step 5: Verify on prod**

```bash
sudo docker exec daylight-station sh -c 'ls -la data/household/state-gates/'
curl -s http://localhost:9428/select/logsql/query -d 'query=("state-gates.state.migrated" OR "state-gates.state.written") AND _time:30m' -d 'limit=20'
```

Expected:

- `current.json` exists and is newer than `current.yml`;
- one `state-gates.state.migrated` event;
- `state-gates.state.written` events with single-digit to low-tens
  `durationMs`.

Then compare worst event-loop lag in minutes with a commit against minutes
without one:

```bash
curl -s http://localhost:9428/select/logsql/query -d 'query="state-gates.assertion.corrected" AND _time:2h' -d 'limit=500' | python3 -c "import sys,json; print(sorted({json.loads(l)['_time'][11:16] for l in sys.stdin}))"
curl -s http://localhost:9428/select/logsql/query -d 'query="system.event-loop.lag" AND _time:2h' -d 'limit=200' | python3 -c "import sys,json; [print(d['_time'][11:16], d.get('data.maxMs')) for d in sorted((json.loads(l) for l in sys.stdin), key=lambda d: d['_time'])]"
```

Expected: commit-minutes sit near the non-commit floor (~200–300 ms), not at
550–1175 ms.

- [ ] **Step 6: Close the audit item**

In `docs/_wip/audits/2026-09-25-backend-event-loop-stalls.md`, move item 1
to "Fixed" with the commit hash and the measured before/after. Commit and
push.
