# Unknown NFC Tag Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an unregistered NFC tag is scanned, persist a placeholder in `tags.yml` and push an iOS Companion notification with an inline text-reply action; when the user submits a name, save it as the tag's `note:` field via a new PUT endpoint.

**Architecture:** Extend `TriggerDispatchService`'s "no intent" branch to handle NFC unknowns in-band: classify tag lifecycle from current YAML fields (no explicit `pending:` flag), write placeholder via a new `YamlTriggerConfigRepository` write method, call `haGateway.callService('notify', <svc>, { actions: [{ behavior: textInput, action: 'NFC_REPLY|<loc>|<uid>', ... }] })`. The user's reply round-trips through HA → `mobile_app_notification_action` event → existing rest_command shape → new `PUT /api/v1/trigger/<location>/<modality>/<value>/note` endpoint that writes the note via the same repository.

**Tech Stack:** Node.js ESM (`.mjs`), Express, vitest + supertest for tests, js-yaml for serialization, Home Assistant Companion app for the iOS-side notification UI.

**Spec:** [`docs/superpowers/specs/2026-04-26-unknown-nfc-capture-design.md`](../specs/2026-04-26-unknown-nfc-capture-design.md)

---

## File Structure

### Modify

| File | Change |
|---|---|
| `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs` | Add `notify_unknown` to RESERVED set; surface as top-level field |
| `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs` | Stateful: hold registry ref + saveFile + mutex; add `upsertNfcPlaceholder` + `setNfcNote` |
| `backend/src/3_applications/trigger/TriggerDispatchService.mjs` | Add `tagWriter` dep; extend `!intent` branch with `#handleUnknownNfc`; add `setNote` method; record debounce on unknown branch too |
| `backend/src/4_api/v1/routers/trigger.mjs` | Add `PUT /:location/:type/:value/note` route + JSON body parsing |
| `backend/src/0_system/bootstrap.mjs` | Inject `saveFile` into `createTriggerApiRouter`; pass repo to dispatcher as `tagWriter` |
| `docs/reference/trigger/schema.md` | Add lifecycle table + document `notify_unknown` / `scanned_at` / `note` fields |

### Create

| File | Purpose |
|---|---|
| `backend/src/1_adapters/trigger/parsers/nfcTagsSerializer.mjs` | Inverts `parseNfcTags`: `{ uid: { global, overrides } } → flat YAML shape` |

### Outside the JS repo (data volume + HA, on Docker host)

| File | Change |
|---|---|
| `data/household/config/triggers/nfc/locations.yml` (in container) | Set `notify_unknown: mobile_app_kc_phone` on `livingroom` |
| `_includes/rest_commands/nfc.yaml` (HA) | Add `nfc_set_note` command |
| `_includes/automations/nfc_unknown_tag_reply.yaml` (HA) | New automation: catch `mobile_app_notification_action` with `NFC_REPLY|*` and POST to backend |

---

## Conventions

- **Tests use vitest** (matches existing `tests/isolated/**/*.test.mjs`). Imports: `import { describe, it, expect, vi, beforeEach } from 'vitest';`
- **Run isolated tests:** `npm run test:isolated -- --reporter=verbose <path/to/test.mjs>` (the harness forwards args to vitest). For a single test file during TDD: `npx vitest run tests/isolated/path/to/test.mjs`.
- **Commits**: one focused commit per task, conventional style. Skip the Co-Authored-By trailer for these (matches repo convention — recent trigger commits don't use it).
- **Timestamps**: `new Date(ms).toLocaleString('sv-SE', { hour12: false })` produces `"YYYY-MM-DD HH:MM:SS"` in container local TZ. Wrap in a private helper for testability.

---

## Task 1: Add `notify_unknown` to `nfcLocationsParser`

**Files:**
- Modify: `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs`
- Test: `tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs`

- [ ] **Step 1: Add the failing test**

Append to `tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs` (inside the existing `describe('parseNfcLocations', ...)` block):

```javascript
it('extracts notify_unknown as a top-level field, not a default', () => {
  const result = parseNfcLocations({
    livingroom: {
      target: 'livingroom-tv',
      action: 'play-next',
      notify_unknown: 'mobile_app_kc_phone',
      shader: 'default',
    },
  });
  expect(result.livingroom.notify_unknown).toBe('mobile_app_kc_phone');
  expect(result.livingroom.defaults).toEqual({ shader: 'default' });
});

it('defaults notify_unknown to null when omitted', () => {
  const result = parseNfcLocations({
    livingroom: { target: 'livingroom-tv' },
  });
  expect(result.livingroom.notify_unknown).toBeNull();
});
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs`

Expected: 2 new tests fail — `notify_unknown` is `undefined` (current code lumps it into `defaults`).

- [ ] **Step 3: Implement `notify_unknown` extraction**

Edit `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs`:

Change the `RESERVED` set (line ~18):

```javascript
const RESERVED = new Set(['target', 'action', 'auth_token', 'notify_unknown']);
```

Change the output construction (lines ~45-50):

```javascript
out[locationId] = {
  target: locConfig.target,
  action: locConfig.action ?? null,
  auth_token: locConfig.auth_token ?? null,
  notify_unknown: locConfig.notify_unknown ?? null,
  defaults,
};
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs`

Expected: All tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs \
        tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs
git commit -m "feat(trigger): add notify_unknown reserved field to nfc locations parser"
```

---

## Task 2: Add `nfcTagsSerializer` (inverse of `parseNfcTags`)

The repository write methods need to round-trip the parsed `{ uid: { global, overrides } }` shape back into the flat YAML shape that `tags.yml` uses on disk. This serializer is its own concern.

**Files:**
- Create: `backend/src/1_adapters/trigger/parsers/nfcTagsSerializer.mjs`
- Test: `tests/isolated/adapter/trigger/parsers/nfcTagsSerializer.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/adapter/trigger/parsers/nfcTagsSerializer.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { serializeNfcTags } from '#adapters/trigger/parsers/nfcTagsSerializer.mjs';
import { parseNfcTags } from '#adapters/trigger/parsers/nfcTagsParser.mjs';

describe('serializeNfcTags', () => {
  it('returns an empty object for an empty input', () => {
    expect(serializeNfcTags({})).toEqual({});
  });

  it('flattens a tag with only global fields', () => {
    const parsed = {
      '83_8e_68_06': { global: { plex: 620707 }, overrides: {} },
    };
    expect(serializeNfcTags(parsed)).toEqual({
      '83_8e_68_06': { plex: 620707 },
    });
  });

  it('flattens a tag with global + per-reader overrides', () => {
    const parsed = {
      '83_8e_68_06': {
        global: { plex: 620707, shader: 'default' },
        overrides: {
          livingroom: { shader: 'blackout' },
          bedroom: { shader: 'night', volume: 5 },
        },
      },
    };
    expect(serializeNfcTags(parsed)).toEqual({
      '83_8e_68_06': {
        plex: 620707,
        shader: 'default',
        livingroom: { shader: 'blackout' },
        bedroom: { shader: 'night', volume: 5 },
      },
    });
  });

  it('round-trips through parseNfcTags', () => {
    const original = {
      '83_8e_68_06': {
        plex: 620707,
        shader: 'default',
        livingroom: { shader: 'blackout' },
      },
      '04_a1_b2_c3': {
        scanned_at: '2026-04-26 14:32:18',
        note: 'kids favorite',
      },
    };
    const parsed = parseNfcTags(original, new Set(['livingroom']));
    const reserialized = serializeNfcTags(parsed);
    expect(reserialized).toEqual(original);
  });

  it('preserves placeholder entries (only scanned_at)', () => {
    const parsed = {
      '04_a1_b2_c3': {
        global: { scanned_at: '2026-04-26 14:32:18' },
        overrides: {},
      },
    };
    expect(serializeNfcTags(parsed)).toEqual({
      '04_a1_b2_c3': { scanned_at: '2026-04-26 14:32:18' },
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/nfcTagsSerializer.test.mjs`

Expected: All tests fail with `Cannot find module '#adapters/trigger/parsers/nfcTagsSerializer.mjs'`.

- [ ] **Step 3: Create the serializer**

Create `backend/src/1_adapters/trigger/parsers/nfcTagsSerializer.mjs`:

```javascript
/**
 * Inverse of parseNfcTags: turns the parsed { [uid]: { global, overrides } }
 * shape back into the flat on-disk YAML shape so the repository can write
 * mutations to disk.
 *
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 *
 * Input shape (from parseNfcTags):
 *   { [uid]: { global: {...scalar/array fields...}, overrides: { [readerId]: {...} } } }
 *
 * Output shape (matches tags.yml):
 *   { [uid]: { ...globalFields, [readerId]: { ...overrideFields }, ... } }
 *
 * @module adapters/trigger/parsers/nfcTagsSerializer
 */

export function serializeNfcTags(parsedTags) {
  const out = {};
  for (const [uid, entry] of Object.entries(parsedTags || {})) {
    const flat = { ...(entry.global || {}) };
    for (const [readerId, overrideBlock] of Object.entries(entry.overrides || {})) {
      flat[readerId] = overrideBlock;
    }
    out[uid] = flat;
  }
  return out;
}

export default serializeNfcTags;
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/nfcTagsSerializer.test.mjs`

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/trigger/parsers/nfcTagsSerializer.mjs \
        tests/isolated/adapter/trigger/parsers/nfcTagsSerializer.test.mjs
git commit -m "feat(trigger): add nfcTagsSerializer (inverse of parseNfcTags)"
```

---

## Task 3: Add write methods to `YamlTriggerConfigRepository`

The repository becomes stateful: it holds the registry it produced and the `saveFile` injection, so write methods can mutate the in-memory tags map AND persist to disk in lockstep, serialized through a Promise-chain mutex.

**Files:**
- Modify: `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs`
- Test: `tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs`:

```javascript
describe('YamlTriggerConfigRepository write methods', () => {
  function makeRepo({ initialTags = {}, locations = { livingroom: { target: 'livingroom-tv' } } } = {}) {
    const blobs = {
      'config/triggers/nfc/locations': locations,
      'config/triggers/nfc/tags': initialTags,
      'config/triggers/state/locations': null,
    };
    const loadFile = vi.fn((p) => blobs[p] ?? null);
    const saveFile = vi.fn();
    const repo = new YamlTriggerConfigRepository({ saveFile });
    const registry = repo.loadRegistry({ loadFile });
    return { repo, registry, saveFile };
  }

  it('upsertNfcPlaceholder creates a new entry with scanned_at', async () => {
    const { repo, registry, saveFile } = makeRepo();
    const result = await repo.upsertNfcPlaceholder('04_a1_b2_c3', '2026-04-26 14:32:18');
    expect(result.created).toBe(true);
    expect(registry.nfc.tags['04_a1_b2_c3']).toEqual({
      global: { scanned_at: '2026-04-26 14:32:18' },
      overrides: {},
    });
    expect(saveFile).toHaveBeenCalledWith(
      'config/triggers/nfc/tags',
      { '04_a1_b2_c3': { scanned_at: '2026-04-26 14:32:18' } }
    );
  });

  it('upsertNfcPlaceholder is a no-op when entry already exists', async () => {
    const { repo, registry, saveFile } = makeRepo({
      initialTags: { '04_a1_b2_c3': { scanned_at: '2026-04-26 10:00:00' } },
    });
    const result = await repo.upsertNfcPlaceholder('04_a1_b2_c3', '2026-04-26 14:32:18');
    expect(result.created).toBe(false);
    // Original timestamp preserved (init time, never updated):
    expect(registry.nfc.tags['04_a1_b2_c3'].global.scanned_at).toBe('2026-04-26 10:00:00');
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('setNfcNote upserts: creates entry with scanned_at + note when missing', async () => {
    const { repo, registry, saveFile } = makeRepo();
    const result = await repo.setNfcNote('04_a1_b2_c3', 'kids favorite', '2026-04-26 14:32:18');
    expect(result.created).toBe(true);
    expect(registry.nfc.tags['04_a1_b2_c3'].global).toEqual({
      scanned_at: '2026-04-26 14:32:18',
      note: 'kids favorite',
    });
    expect(saveFile).toHaveBeenCalledWith(
      'config/triggers/nfc/tags',
      { '04_a1_b2_c3': { scanned_at: '2026-04-26 14:32:18', note: 'kids favorite' } }
    );
  });

  it('setNfcNote overwrites existing note, preserves scanned_at', async () => {
    const { repo, registry, saveFile } = makeRepo({
      initialTags: { '04_a1_b2_c3': { scanned_at: '2026-04-26 10:00:00', note: 'old' } },
    });
    const result = await repo.setNfcNote('04_a1_b2_c3', 'new', '2026-04-26 99:99:99');
    expect(result.created).toBe(false);
    expect(registry.nfc.tags['04_a1_b2_c3'].global).toEqual({
      scanned_at: '2026-04-26 10:00:00',
      note: 'new',
    });
    expect(saveFile).toHaveBeenLastCalledWith(
      'config/triggers/nfc/tags',
      { '04_a1_b2_c3': { scanned_at: '2026-04-26 10:00:00', note: 'new' } }
    );
  });

  it('setNfcNote on a promoted tag preserves intent fields and overrides', async () => {
    const { repo, registry, saveFile } = makeRepo({
      initialTags: {
        '83_8e_68_06': {
          plex: 620707,
          livingroom: { shader: 'blackout' },
        },
      },
    });
    await repo.setNfcNote('83_8e_68_06', 'star wars', '2026-04-26 14:32:18');
    expect(registry.nfc.tags['83_8e_68_06']).toEqual({
      global: { plex: 620707, note: 'star wars', scanned_at: '2026-04-26 14:32:18' },
      overrides: { livingroom: { shader: 'blackout' } },
    });
    expect(saveFile).toHaveBeenCalledWith(
      'config/triggers/nfc/tags',
      {
        '83_8e_68_06': {
          plex: 620707,
          note: 'star wars',
          scanned_at: '2026-04-26 14:32:18',
          livingroom: { shader: 'blackout' },
        },
      }
    );
  });

  it('serializes concurrent writes through a mutex (no lost writes)', async () => {
    const { repo, registry, saveFile } = makeRepo();
    // Make saveFile slow to expose race conditions
    let resolveOrder = [];
    saveFile.mockImplementation((path, data) => {
      resolveOrder.push(Object.keys(data));
      return new Promise((r) => setImmediate(r));
    });

    await Promise.all([
      repo.upsertNfcPlaceholder('aa', '2026-04-26 14:00:00'),
      repo.upsertNfcPlaceholder('bb', '2026-04-26 14:00:01'),
      repo.upsertNfcPlaceholder('cc', '2026-04-26 14:00:02'),
    ]);
    expect(Object.keys(registry.nfc.tags)).toEqual(['aa', 'bb', 'cc']);
    // Each write saw the cumulative state of prior writes:
    expect(resolveOrder[0]).toEqual(['aa']);
    expect(resolveOrder[1]).toEqual(['aa', 'bb']);
    expect(resolveOrder[2]).toEqual(['aa', 'bb', 'cc']);
  });

  it('throws if write methods called before loadRegistry', async () => {
    const repo = new YamlTriggerConfigRepository({ saveFile: vi.fn() });
    await expect(repo.upsertNfcPlaceholder('aa', '2026-04-26 14:00:00'))
      .rejects.toThrow(/registry not loaded/i);
  });

  it('throws if constructed without saveFile and a write is attempted', async () => {
    const repo = new YamlTriggerConfigRepository();
    repo.loadRegistry({ loadFile: () => null });
    await expect(repo.upsertNfcPlaceholder('aa', '2026-04-26 14:00:00'))
      .rejects.toThrow(/saveFile not configured/i);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx vitest run tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs`

Expected: 8 new tests fail; the 3 existing tests still pass (and should continue to pass after refactor).

- [ ] **Step 3: Refactor + extend the repository**

Replace the contents of `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs`:

```javascript
/**
 * YAML-backed trigger config repository. Public adapter entry — bootstrap
 * calls this. Owns the I/O boundary for both reads (boot-time config load)
 * and writes (placeholder + note mutations to nfc/tags.yml).
 *
 * Layer: ADAPTER (1_adapters/trigger). The dependency-injected `loadFile`
 * and `saveFile` helpers handle YAML I/O (provided by app.mjs); this class
 * only knows the file-path layout and serialization concerns.
 *
 * Writes are serialized through a Promise-chain mutex so two concurrent
 * scans of different unknown tags can't lose writes to each other.
 *
 * @module adapters/trigger/YamlTriggerConfigRepository
 */

import { buildTriggerRegistry } from './parsers/buildTriggerRegistry.mjs';
import { serializeNfcTags } from './parsers/nfcTagsSerializer.mjs';

const PATHS = {
  nfcLocations: 'config/triggers/nfc/locations',
  nfcTags: 'config/triggers/nfc/tags',
  stateLocations: 'config/triggers/state/locations',
};

export class YamlTriggerConfigRepository {
  #saveFile;
  #registry = null;
  #writeChain = Promise.resolve();

  constructor({ saveFile } = {}) {
    this.#saveFile = saveFile || null;
  }

  /**
   * Load all per-modality YAML blobs and assemble the unified trigger registry.
   * Stores the registry internally so write methods can mutate it.
   *
   * @returns {Object} unified registry: { nfc: { locations, tags }, state: { locations } }
   * @throws {ValidationError} if any YAML is malformed.
   */
  loadRegistry({ loadFile }) {
    const blobs = {
      nfcLocations: loadFile(PATHS.nfcLocations),
      nfcTags: loadFile(PATHS.nfcTags),
      stateLocations: loadFile(PATHS.stateLocations),
    };
    this.#registry = buildTriggerRegistry(blobs);
    return this.#registry;
  }

  /**
   * Create a placeholder entry for an unknown NFC tag UID. No-op if entry
   * already exists (init scan time is never updated).
   *
   * @param {string} uid lowercased tag UID
   * @param {string} scannedAt formatted timestamp string
   * @returns {Promise<{created: boolean}>}
   */
  upsertNfcPlaceholder(uid, scannedAt) {
    return this.#enqueue(async () => {
      this.#assertReady();
      const tags = this.#registry.nfc.tags;
      if (tags[uid]) return { created: false };
      tags[uid] = { global: { scanned_at: scannedAt }, overrides: {} };
      await this.#flushTags();
      return { created: true };
    });
  }

  /**
   * Set/overwrite the note on a tag. Idempotent upsert — creates the entry
   * with scanned_at + note if missing.
   *
   * @param {string} uid lowercased tag UID
   * @param {string} note the user-supplied freeform name
   * @param {string} scannedAtIfNew timestamp to use only when creating a new entry
   * @returns {Promise<{created: boolean}>}
   */
  setNfcNote(uid, note, scannedAtIfNew) {
    return this.#enqueue(async () => {
      this.#assertReady();
      const tags = this.#registry.nfc.tags;
      let created = false;
      if (!tags[uid]) {
        tags[uid] = { global: { scanned_at: scannedAtIfNew }, overrides: {} };
        created = true;
      }
      tags[uid].global.note = note;
      await this.#flushTags();
      return { created };
    });
  }

  // Serialize all writes through a single Promise chain. Each call awaits the
  // prior chain head before doing its own work. Errors don't poison the chain.
  #enqueue(task) {
    const next = this.#writeChain.then(task, task);
    // Detach from the chain so a rejection in this task doesn't propagate
    // forward (still surfaces to the caller via the returned promise).
    this.#writeChain = next.then(() => undefined, () => undefined);
    return next;
  }

  #assertReady() {
    if (!this.#registry) {
      throw new Error('YamlTriggerConfigRepository: registry not loaded — call loadRegistry first');
    }
    if (!this.#saveFile) {
      throw new Error('YamlTriggerConfigRepository: saveFile not configured — write methods unavailable');
    }
  }

  #flushTags() {
    const flat = serializeNfcTags(this.#registry.nfc.tags);
    return Promise.resolve(this.#saveFile(PATHS.nfcTags, flat));
  }
}

export default YamlTriggerConfigRepository;
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs`

Expected: All tests pass (3 existing + 8 new = 11).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs \
        tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs
git commit -m "feat(trigger): add upsertNfcPlaceholder + setNfcNote write methods"
```

---

## Task 4: Wire `saveFile` through bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:1724-1757` (`createTriggerApiRouter`)

- [ ] **Step 1: Read the surrounding context**

Open `backend/src/0_system/bootstrap.mjs:1700-1760`. Confirm the function `createTriggerApiRouter(config)` destructures `loadFile` from `config` and constructs `new YamlTriggerConfigRepository()`.

- [ ] **Step 2: Update `createTriggerApiRouter` to inject saveFile + repo**

Replace the body of `createTriggerApiRouter` (the function starting around line 1724):

```javascript
export function createTriggerApiRouter(config) {
  const {
    deviceServices,
    wakeAndLoadService,
    haGateway,
    contentIdResolver,
    broadcast,
    loadFile,
    saveFile,
    logger = console,
  } = config;

  const triggerConfigRepository = new YamlTriggerConfigRepository({ saveFile });
  let triggerConfig;
  try {
    triggerConfig = triggerConfigRepository.loadRegistry({ loadFile });
  } catch (err) {
    logger.warn?.('trigger.config.parse.failed', { error: err.message });
    triggerConfig = { nfc: { locations: {}, tags: {} }, state: { locations: {} } };
  }

  const triggerDispatchService = new TriggerDispatchService({
    config: triggerConfig,
    contentIdResolver,
    wakeAndLoadService,
    haGateway,
    deviceService: deviceServices.deviceService,
    tagWriter: triggerConfigRepository,
    broadcast,
    logger,
  });

  const router = createTriggerRouter({ triggerDispatchService, logger });

  return { triggerDispatchService, router };
}
```

The two changes vs. the existing function:
1. Destructure `saveFile` from `config`.
2. Pass `{ saveFile }` to the repo constructor and pass the repo as `tagWriter` to the dispatcher.

- [ ] **Step 3: Find where `createTriggerApiRouter` is invoked and pass saveFile**

Grep for the call site:

```bash
grep -n "createTriggerApiRouter" backend/src/0_system/bootstrap.mjs
```

You'll find a call somewhere later in `bootstrap.mjs` that passes `loadFile` but not `saveFile`. Add `saveFile` to that call. The same `saveFile` closure is already passed to `createContentApiRouter` and other routers — pull it from the same scope.

If the call looks like:
```javascript
const triggerStuff = createTriggerApiRouter({ deviceServices, wakeAndLoadService, haGateway, contentIdResolver, broadcast, loadFile, logger });
```

Change it to add `saveFile`:
```javascript
const triggerStuff = createTriggerApiRouter({ deviceServices, wakeAndLoadService, haGateway, contentIdResolver, broadcast, loadFile, saveFile, logger });
```

- [ ] **Step 4: Smoke test by running existing tests**

The existing TriggerDispatchService tests don't pass `tagWriter`; the constructor needs to accept `undefined` gracefully (will be tested in Task 5). For now just confirm bootstrap doesn't error syntactically:

```bash
node --check backend/src/0_system/bootstrap.mjs
```

Expected: no output (no syntax error).

Run all isolated trigger tests:

```bash
npx vitest run tests/isolated/adapter/trigger tests/isolated/application/trigger tests/isolated/api/routers/trigger.test.mjs
```

Expected: existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(trigger): inject saveFile into TriggerConfigRepository + pass repo as tagWriter"
```

---

## Task 5: Add `#handleUnknownNfc` branch + extend debounce in `TriggerDispatchService`

**Files:**
- Modify: `backend/src/3_applications/trigger/TriggerDispatchService.mjs`
- Test: `tests/isolated/application/trigger/TriggerDispatchService.test.mjs`

- [ ] **Step 1: Write failing tests for the unknown-NFC branch**

Append to `tests/isolated/application/trigger/TriggerDispatchService.test.mjs`:

```javascript
describe('TriggerDispatchService.handleTrigger — unknown NFC branch', () => {
  let wakeAndLoadService;
  let haGateway;
  let deviceService;
  let broadcast;
  let logger;
  let tagWriter;
  let now;

  beforeEach(() => {
    wakeAndLoadService = { execute: vi.fn() };
    haGateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
    deviceService = { get: vi.fn() };
    broadcast = vi.fn();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    tagWriter = {
      upsertNfcPlaceholder: vi.fn().mockResolvedValue({ created: true }),
      setNfcNote: vi.fn(),
    };
    now = 1714137138000; // arbitrary fixed ms
  });

  function makeRegistry({ tags = {}, notify_unknown = 'mobile_app_kc_phone' } = {}) {
    return {
      nfc: {
        locations: {
          livingroom: {
            target: 'livingroom-tv',
            action: 'play-next',
            auth_token: null,
            notify_unknown,
            defaults: {},
          },
        },
        tags,  // already in parsed { global, overrides } shape
      },
      state: { locations: {} },
    };
  }

  function makeService(config) {
    return new TriggerDispatchService({
      config,
      contentIdResolver: { resolve: () => null },
      wakeAndLoadService,
      haGateway,
      deviceService,
      tagWriter,
      broadcast,
      logger,
      clock: () => now,
    });
  }

  it('state 0 — first scan: writes placeholder, notifies, returns 404', async () => {
    const service = makeService(makeRegistry());
    const result = await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');

    expect(tagWriter.upsertNfcPlaceholder).toHaveBeenCalledWith(
      '04_a1_b2_c3',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    );

    expect(haGateway.callService).toHaveBeenCalledWith(
      'notify',
      'mobile_app_kc_phone',
      expect.objectContaining({
        title: expect.stringMatching(/livingroom/i),
        message: expect.stringContaining('04_a1_b2_c3'),
        data: expect.objectContaining({
          actions: [expect.objectContaining({
            action: 'NFC_REPLY|livingroom|04_a1_b2_c3',
            behavior: 'textInput',
          })],
        }),
      }),
    );

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'trigger:livingroom:nfc',
      type: 'trigger.fired',
      registered: false,
    }));
  });

  it('state 0 — no notify call when notify_unknown is unset', async () => {
    const service = makeService(makeRegistry({ notify_unknown: null }));
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    expect(tagWriter.upsertNfcPlaceholder).toHaveBeenCalled();
    expect(haGateway.callService).not.toHaveBeenCalled();
  });

  it('state 1 — re-scan with placeholder but no note: notifies, no new write', async () => {
    tagWriter.upsertNfcPlaceholder.mockResolvedValue({ created: false });
    const registry = makeRegistry({
      tags: { '04_a1_b2_c3': { global: { scanned_at: '2026-04-26 10:00:00' }, overrides: {} } },
    });
    const service = makeService(registry);
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');

    // upsert is called but no-ops (returns { created: false })
    expect(tagWriter.upsertNfcPlaceholder).toHaveBeenCalled();
    expect(haGateway.callService).toHaveBeenCalledTimes(1);
  });

  it('state 2 — has note already: silent (no notify, no write)', async () => {
    const registry = makeRegistry({
      tags: { '04_a1_b2_c3': {
        global: { scanned_at: '2026-04-26 10:00:00', note: 'kids movie' },
        overrides: {},
      } },
    });
    const service = makeService(registry);
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');

    expect(tagWriter.upsertNfcPlaceholder).not.toHaveBeenCalled();
    expect(haGateway.callService).not.toHaveBeenCalled();
    // Broadcast still fires for observer dashboards:
    expect(broadcast).toHaveBeenCalled();
  });

  it('debounce extends to unknown branch: second scan within 3s does not re-notify', async () => {
    const service = makeService(makeRegistry());
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    now += 1500; // 1.5 s later
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    expect(haGateway.callService).toHaveBeenCalledTimes(1);
    expect(tagWriter.upsertNfcPlaceholder).toHaveBeenCalledTimes(1);
  });

  it('debounce window expiry allows a second notify', async () => {
    tagWriter.upsertNfcPlaceholder
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });
    const service = makeService(makeRegistry());
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    now += 5000; // 5 s later, past window
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    expect(haGateway.callService).toHaveBeenCalledTimes(2);
  });

  it('notify failure does not change the GET response or skip broadcast', async () => {
    haGateway.callService.mockRejectedValue(new Error('HA down'));
    const service = makeService(makeRegistry());
    const result = await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');
    expect(broadcast).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('trigger.notify.failed', expect.any(Object));
  });

  it('non-NFC modality unknown branch does not call tagWriter', async () => {
    const config = {
      nfc: { locations: {}, tags: {} },
      state: {
        locations: {
          livingroom: {
            target: 'livingroom-tv',
            auth_token: null,
            states: {},  // empty: any state value will be unregistered
          },
        },
      },
    };
    const service = makeService(config);
    await service.handleTrigger('livingroom', 'state', 'on');
    expect(tagWriter.upsertNfcPlaceholder).not.toHaveBeenCalled();
    expect(haGateway.callService).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx vitest run tests/isolated/application/trigger/TriggerDispatchService.test.mjs`

Expected: 8 new tests fail (the dispatcher doesn't accept `tagWriter` and doesn't have unknown-tag handling). Existing tests still pass.

- [ ] **Step 3: Extend `TriggerDispatchService`**

Edit `backend/src/3_applications/trigger/TriggerDispatchService.mjs`:

Add to the constructor's destructure (around line 37) and store as a private field:

```javascript
  #tagWriter;
  // ... (existing fields)

  constructor({
    config,
    contentIdResolver,
    wakeAndLoadService,
    haGateway,
    deviceService,
    tagWriter = null,           // NEW
    broadcast,
    logger = console,
    debounceWindowMs = 3000,
    clock = () => Date.now(),
  }) {
    // ... existing assignments ...
    this.#tagWriter = tagWriter;
  }
```

Replace the unknown-tag branch (currently lines 131-135) with the new logic:

```javascript
    if (!intent) {
      if (modality === 'nfc') {
        await this.#handleUnknownNfc(location, normalizedValue, locationConfig);
      }
      this.#logger.info?.('trigger.fired', { ...baseLog, error: 'trigger-not-registered' });
      this.#emit(location, modality, baseLog);
      // Extend debounce to the unknown branch so HA's 2-3 duplicate fires
      // per physical tap collapse to a single placeholder write + notify.
      this.#recentDispatches.set(debounceKey, this.#clock());
      return { ok: false, code: 'TRIGGER_NOT_REGISTERED', error: `Trigger not registered: ${normalizedValue}`, location, modality, value: normalizedValue, dispatchId };
    }
```

Add a new private method on the class (place it after `#emit`):

```javascript
  /**
   * Handle a scan of an NFC tag that didn't resolve. Lifecycle is derived
   * from the current YAML entry (no explicit pending flag). Notification
   * failures are logged but never fail the GET response.
   *
   * - state 0 (no entry):           write placeholder + notify (if configured)
   * - state 1 (placeholder, no note): notify (if configured), no write
   * - state 2 (has note, no intent): silent (caller already broadcasts)
   *
   * State 3 is unreachable here — the resolver would have produced an intent.
   */
  async #handleUnknownNfc(location, uid, locationConfig) {
    const entry = this.#config?.nfc?.tags?.[uid];
    const hasNote = typeof entry?.global?.note === 'string' && entry.global.note.length > 0;
    if (entry && hasNote) return; // state 2 — silent

    if (!entry && this.#tagWriter) {
      try {
        await this.#tagWriter.upsertNfcPlaceholder(uid, this.#formatScannedAt(this.#clock()));
        this.#logger.debug?.('trigger.placeholder_created', { location, uid });
      } catch (err) {
        this.#logger.error?.('trigger.placeholder.failed', { location, uid, error: err.message });
        // Continue — still attempt to notify so the user knows the tag was seen.
      }
    }

    const notifyService = locationConfig.notify_unknown;
    if (!notifyService) return;

    const payload = {
      title: `Unknown NFC tag at ${location}`,
      message: `Tap to name tag ${uid}`,
      data: {
        actions: [{
          action: `NFC_REPLY|${location}|${uid}`,
          title: 'Submit',
          behavior: 'textInput',
          textInputButtonTitle: 'Save',
          textInputPlaceholder: 'Tag name',
        }],
      },
    };
    try {
      await this.#deps?.haGateway?.callService?.('notify', notifyService, payload)
        ?? await this.#haGatewayCall(notifyService, payload);
    } catch (err) {
      this.#logger.error?.('trigger.notify.failed', { location, uid, service: notifyService, error: err.message });
    }
  }

  #haGatewayCall(notifyService, payload) {
    // Existing dispatcher already has haGateway via #deps.haGateway from the
    // dispatchAction helper. Use it directly.
    return this.#deps.haGateway.callService('notify', notifyService, payload);
  }

  #formatScannedAt(ms) {
    // sv-SE locale produces ISO-like "YYYY-MM-DD HH:MM:SS" in container TZ.
    return new Date(ms).toLocaleString('sv-SE', { hour12: false });
  }
```

**Note**: The dispatcher already stores `this.#deps = { wakeAndLoadService, haGateway, deviceService }` in the constructor. So `this.#deps.haGateway.callService(...)` is the right call — simplify the method to:

```javascript
  async #handleUnknownNfc(location, uid, locationConfig) {
    const entry = this.#config?.nfc?.tags?.[uid];
    const hasNote = typeof entry?.global?.note === 'string' && entry.global.note.length > 0;
    if (entry && hasNote) return;

    if (!entry && this.#tagWriter) {
      try {
        await this.#tagWriter.upsertNfcPlaceholder(uid, this.#formatScannedAt(this.#clock()));
        this.#logger.debug?.('trigger.placeholder_created', { location, uid });
      } catch (err) {
        this.#logger.error?.('trigger.placeholder.failed', { location, uid, error: err.message });
      }
    }

    const notifyService = locationConfig.notify_unknown;
    if (!notifyService) return;

    const payload = {
      title: `Unknown NFC tag at ${location}`,
      message: `Tap to name tag ${uid}`,
      data: {
        actions: [{
          action: `NFC_REPLY|${location}|${uid}`,
          title: 'Submit',
          behavior: 'textInput',
          textInputButtonTitle: 'Save',
          textInputPlaceholder: 'Tag name',
        }],
      },
    };
    try {
      await this.#deps.haGateway.callService('notify', notifyService, payload);
    } catch (err) {
      this.#logger.error?.('trigger.notify.failed', { location, uid, service: notifyService, error: err.message });
    }
  }

  #formatScannedAt(ms) {
    return new Date(ms).toLocaleString('sv-SE', { hour12: false });
  }
```

(Drop the `#haGatewayCall` helper from the previous block — it's redundant.)

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run tests/isolated/application/trigger/TriggerDispatchService.test.mjs`

Expected: All tests pass. The 7 existing tests continue to pass; the 8 new tests now pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/TriggerDispatchService.mjs \
        tests/isolated/application/trigger/TriggerDispatchService.test.mjs
git commit -m "feat(trigger): handle unknown NFC scans — placeholder + iOS notify"
```

---

## Task 6: Add `setNote` method to `TriggerDispatchService`

**Files:**
- Modify: `backend/src/3_applications/trigger/TriggerDispatchService.mjs`
- Test: `tests/isolated/application/trigger/TriggerDispatchService.test.mjs`

- [ ] **Step 1: Write failing tests**

Append another `describe` block to `tests/isolated/application/trigger/TriggerDispatchService.test.mjs`:

```javascript
describe('TriggerDispatchService.setNote', () => {
  let tagWriter;
  let broadcast;
  let logger;

  beforeEach(() => {
    tagWriter = { setNfcNote: vi.fn().mockResolvedValue({ created: false }) };
    broadcast = vi.fn();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  });

  function makeService({ auth_token = null } = {}) {
    return new TriggerDispatchService({
      config: {
        nfc: {
          locations: {
            livingroom: { target: 'livingroom-tv', action: 'play-next', auth_token, notify_unknown: null, defaults: {} },
          },
          tags: {},
        },
        state: { locations: {} },
      },
      contentIdResolver: { resolve: () => null },
      wakeAndLoadService: { execute: vi.fn() },
      haGateway: { callService: vi.fn() },
      deviceService: { get: vi.fn() },
      tagWriter,
      broadcast,
      logger,
      clock: () => 1714137138000,
    });
  }

  it('writes the note via tagWriter and returns ok', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04_a1_b2_c3', 'kids favorite');
    expect(result.ok).toBe(true);
    expect(tagWriter.setNfcNote).toHaveBeenCalledWith(
      '04_a1_b2_c3',
      'kids favorite',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    );
  });

  it('lowercases the value before writing', async () => {
    const service = makeService();
    await service.setNote('livingroom', 'nfc', 'AA_BB_CC', 'x');
    expect(tagWriter.setNfcNote).toHaveBeenCalledWith('aa_bb_cc', 'x', expect.any(String));
  });

  it('broadcasts trigger.note_set on the location/modality topic', async () => {
    const service = makeService();
    await service.setNote('livingroom', 'nfc', '04_a1_b2_c3', 'kids favorite');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'trigger:livingroom:nfc',
      type: 'trigger.note_set',
      location: 'livingroom',
      modality: 'nfc',
      value: '04_a1_b2_c3',
      note: 'kids favorite',
    }));
  });

  it('returns 400 INVALID_NOTE when note is empty', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', '');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_NOTE');
    expect(tagWriter.setNfcNote).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_NOTE when note exceeds 200 chars', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', 'x'.repeat(201));
    expect(result.code).toBe('INVALID_NOTE');
  });

  it('returns 400 INVALID_NOTE when note is not a string', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', 42);
    expect(result.code).toBe('INVALID_NOTE');
  });

  it('returns 400 UNSUPPORTED_MODALITY for non-nfc modalities', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'state', 'on', 'x');
    expect(result.code).toBe('UNSUPPORTED_MODALITY');
  });

  it('returns 404 LOCATION_NOT_FOUND for an unknown location', async () => {
    const service = makeService();
    const result = await service.setNote('attic', 'nfc', '04', 'x');
    expect(result.code).toBe('LOCATION_NOT_FOUND');
  });

  it('returns 401 AUTH_FAILED when token does not match location auth_token', async () => {
    const service = makeService({ auth_token: 'secret' });
    const result = await service.setNote('livingroom', 'nfc', '04', 'x', { token: 'wrong' });
    expect(result.code).toBe('AUTH_FAILED');
  });

  it('returns 200 when token matches', async () => {
    const service = makeService({ auth_token: 'secret' });
    const result = await service.setNote('livingroom', 'nfc', '04', 'x', { token: 'secret' });
    expect(result.ok).toBe(true);
  });

  it('returns 200 when location has no auth_token regardless of provided token', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', 'x', { token: 'anything' });
    expect(result.ok).toBe(true);
  });

  it('returns 500 NOTE_WRITE_FAILED if tagWriter throws', async () => {
    tagWriter.setNfcNote.mockRejectedValue(new Error('disk full'));
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', 'x');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOTE_WRITE_FAILED');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/isolated/application/trigger/TriggerDispatchService.test.mjs`

Expected: 12 new tests fail with `service.setNote is not a function` (or similar).

- [ ] **Step 3: Implement `setNote`**

In `backend/src/3_applications/trigger/TriggerDispatchService.mjs`, add a new public method on the class (place it after `handleTrigger`):

```javascript
  /**
   * Set the freeform `note:` field on a tag entry. Idempotent upsert via
   * the injected tagWriter. Used by the iOS Companion REPLY action that
   * routes through HA → PUT /api/v1/trigger/<loc>/<modality>/<value>/note.
   *
   * @param {string} location
   * @param {string} modality   only 'nfc' supported today
   * @param {string} value      tag UID (will be lowercased)
   * @param {string} note       freeform user-supplied name (1..200 chars)
   * @param {Object} [options]
   * @param {string} [options.token] auth token for the location, if configured
   */
  async setNote(location, modality, value, note, options = {}) {
    if (modality !== 'nfc') {
      return { ok: false, code: 'UNSUPPORTED_MODALITY', error: `setNote only supports nfc modality (got "${modality}")` };
    }

    const locationConfig = this.#config?.nfc?.locations?.[location];
    if (!locationConfig) {
      return { ok: false, code: 'LOCATION_NOT_FOUND', error: `Unknown location: ${location}` };
    }

    const authToken = locationConfig.auth_token ?? null;
    if (authToken && authToken !== options.token) {
      return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed' };
    }

    if (typeof note !== 'string' || note.length === 0 || note.length > 200) {
      return { ok: false, code: 'INVALID_NOTE', error: 'note must be a non-empty string of at most 200 characters' };
    }

    if (!this.#tagWriter) {
      return { ok: false, code: 'NOTE_WRITE_FAILED', error: 'tagWriter not configured' };
    }

    const normalizedValue = String(value).toLowerCase();
    const scannedAtIfNew = this.#formatScannedAt(this.#clock());

    try {
      const result = await this.#tagWriter.setNfcNote(normalizedValue, note, scannedAtIfNew);
      this.#emit(location, modality, {
        location, modality, value: normalizedValue, note,
      }, 'trigger.note_set');
      this.#logger.info?.('trigger.note_set', { location, modality, value: normalizedValue, created: result.created });
      return { ok: true, location, modality, value: normalizedValue, note, created: result.created };
    } catch (err) {
      this.#logger.error?.('trigger.note_set.failed', { location, modality, value: normalizedValue, error: err.message });
      return { ok: false, code: 'NOTE_WRITE_FAILED', error: err.message };
    }
  }
```

The above uses `this.#emit(...)` with an extra argument for the event type. Update `#emit` to accept it (default to `'trigger.fired'`):

```javascript
  #emit(location, modality, payload, type = 'trigger.fired') {
    this.#broadcast({ topic: `trigger:${location}:${modality}`, ...payload, type });
  }
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run tests/isolated/application/trigger/TriggerDispatchService.test.mjs`

Expected: All tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/TriggerDispatchService.mjs \
        tests/isolated/application/trigger/TriggerDispatchService.test.mjs
git commit -m "feat(trigger): add setNote method for unknown-NFC reply persistence"
```

---

## Task 7: Add PUT route to the trigger router

**Files:**
- Modify: `backend/src/4_api/v1/routers/trigger.mjs`
- Test: `tests/isolated/api/routers/trigger.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `tests/isolated/api/routers/trigger.test.mjs` (inside the existing `describe('createTriggerRouter', ...)` block — you'll need to make sure the body parser is also installed in the test setup, see Step 3):

```javascript
describe('PUT /:location/:type/:value/note', () => {
  it('returns 200 on successful note set', async () => {
    triggerDispatchService.setNote = vi.fn().mockResolvedValue({
      ok: true, location: 'livingroom', modality: 'nfc', value: '04_a1_b2_c3', note: 'kids favorite',
    });
    const res = await request(app)
      .put('/api/v1/trigger/livingroom/nfc/04_a1_b2_c3/note')
      .send({ note: 'kids favorite' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(triggerDispatchService.setNote).toHaveBeenCalledWith(
      'livingroom', 'nfc', '04_a1_b2_c3', 'kids favorite', expect.any(Object),
    );
  });

  it('passes token from query string to setNote', async () => {
    triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: true });
    await request(app)
      .put('/api/v1/trigger/livingroom/nfc/04/note?token=secret')
      .send({ note: 'x' });
    expect(triggerDispatchService.setNote).toHaveBeenCalledWith(
      'livingroom', 'nfc', '04', 'x', expect.objectContaining({ token: 'secret' }),
    );
  });

  it('returns 400 for INVALID_NOTE', async () => {
    triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'INVALID_NOTE', error: 'too long' });
    const res = await request(app)
      .put('/api/v1/trigger/livingroom/nfc/04/note')
      .send({ note: '' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for AUTH_FAILED', async () => {
    triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'AUTH_FAILED', error: 'auth' });
    const res = await request(app)
      .put('/api/v1/trigger/livingroom/nfc/04/note')
      .send({ note: 'x' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for LOCATION_NOT_FOUND', async () => {
    triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'LOCATION_NOT_FOUND', error: 'no loc' });
    const res = await request(app)
      .put('/api/v1/trigger/attic/nfc/04/note')
      .send({ note: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for UNSUPPORTED_MODALITY', async () => {
    triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'UNSUPPORTED_MODALITY', error: 'no' });
    const res = await request(app)
      .put('/api/v1/trigger/livingroom/state/on/note')
      .send({ note: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 500 for NOTE_WRITE_FAILED', async () => {
    triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'NOTE_WRITE_FAILED', error: 'disk' });
    const res = await request(app)
      .put('/api/v1/trigger/livingroom/nfc/04/note')
      .send({ note: 'x' });
    expect(res.status).toBe(500);
  });

  it('returns 400 when body has no note field at all', async () => {
    triggerDispatchService.setNote = vi.fn().mockResolvedValue({ ok: false, code: 'INVALID_NOTE', error: 'missing' });
    const res = await request(app)
      .put('/api/v1/trigger/livingroom/nfc/04/note')
      .send({});
    expect(res.status).toBe(400);
    expect(triggerDispatchService.setNote).toHaveBeenCalledWith(
      'livingroom', 'nfc', '04', undefined, expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Update the test setup to install JSON body parser**

The existing test's `beforeEach` (around line 10) only does `app = express(); app.use('/api/v1/trigger', createTriggerRouter(...))`. The PUT route needs JSON body parsing. Modify the existing setup:

```javascript
  beforeEach(() => {
    triggerDispatchService = { handleTrigger: vi.fn(), setNote: vi.fn() };
    app = express();
    app.use(express.json());                    // ← NEW: enable JSON body parsing
    app.use('/api/v1/trigger', createTriggerRouter({
      triggerDispatchService,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
  });
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `npx vitest run tests/isolated/api/routers/trigger.test.mjs`

Expected: 8 new tests fail (404 from express because no PUT route is defined).

- [ ] **Step 4: Add the PUT route + status code mappings**

Edit `backend/src/4_api/v1/routers/trigger.mjs`:

Update the status-code map (around line 10) to include the new codes:

```javascript
const STATUS_BY_CODE = {
  LOCATION_NOT_FOUND: 404,
  TRIGGER_NOT_REGISTERED: 404,
  AUTH_FAILED: 401,
  UNKNOWN_MODALITY: 400,
  UNKNOWN_ACTION: 400,
  INVALID_INTENT: 400,
  DISPATCH_FAILED: 502,
  INVALID_NOTE: 400,
  UNSUPPORTED_MODALITY: 400,
  NOTE_WRITE_FAILED: 500,
};
```

Add the route inside `createTriggerRouter` after the existing GET route:

```javascript
  router.put('/:location/:type/:value/note', asyncHandler(async (req, res) => {
    const { location, type, value } = req.params;
    const { token } = req.query;
    const note = req.body?.note;

    logger.debug?.('trigger.router.set_note', { location, type, value, hasNote: typeof note === 'string' });

    const result = await triggerDispatchService.setNote(location, type, value, note, { token });

    if (result.ok) return res.status(200).json(result);
    const status = STATUS_BY_CODE[result.code] || 500;
    return res.status(status).json(result);
  }));
```

The `req.body?.note` works because `app.use(express.json())` is installed at the app level (already done in `app.mjs`/`bootstrap.mjs` for the running app — and now also in the test setup).

- [ ] **Step 5: Run tests to confirm pass**

Run: `npx vitest run tests/isolated/api/routers/trigger.test.mjs`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/trigger.mjs tests/isolated/api/routers/trigger.test.mjs
git commit -m "feat(trigger): add PUT /:location/:type/:value/note route"
```

---

## Task 8: Sanity-check the dev server boots

Before touching production data and HA, verify the JS changes don't break boot.

- [ ] **Step 1: Check for an already-running backend on this host**

```bash
ss -tlnp | grep 3113 || echo "no backend on 3113"
```

If something's listening, leave it. If not, start a one-off backend:

```bash
DAYLIGHT_ENV=dev nohup node backend/index.js > /tmp/backend-dev-unknown-nfc.log 2>&1 &
```

- [ ] **Step 2: Hit the trigger endpoint with an unknown UID (no notify configured yet, so just placeholder write)**

```bash
sleep 3
curl -sS http://localhost:3113/api/v1/trigger/livingroom/nfc/test_unknown_$(date +%s) | jq
```

Expected: `{"ok": false, "code": "TRIGGER_NOT_REGISTERED", ...}`. No 500.

- [ ] **Step 3: Verify the placeholder was written to dev's tags.yml**

The dev server reads/writes from the same data path the container does (per CLAUDE.md). Check the file:

```bash
sudo docker exec daylight-station sh -c 'grep -A1 test_unknown_ data/household/config/triggers/nfc/tags.yml | tail -5'
```

Expected: lines like `test_unknown_<ts>:` followed by `  scanned_at: "..."`.

If it's there, **clean up** before continuing — these are throwaway test entries:

```bash
# Manually remove the test_unknown_* entries from tags.yml via docker exec heredoc, or
# leave them for now and clean in Task 11.
```

- [ ] **Step 4: Hit the PUT endpoint to set a note on a test entry**

```bash
TS=$(date +%s)
curl -sS http://localhost:3113/api/v1/trigger/livingroom/nfc/test_unknown_${TS} | jq  # creates placeholder
curl -sS -X PUT -H 'Content-Type: application/json' \
  -d '{"note":"test note from sanity check"}' \
  http://localhost:3113/api/v1/trigger/livingroom/nfc/test_unknown_${TS}/note | jq
```

Expected: `{"ok": true, "note": "test note from sanity check", ...}`.

Verify in the YAML:

```bash
sudo docker exec daylight-station sh -c "grep -A2 test_unknown_${TS} data/household/config/triggers/nfc/tags.yml"
```

Expected: entry shows `scanned_at:` AND `note: "test note from sanity check"`.

- [ ] **Step 5: Stop the dev server (if you started it)**

```bash
pkill -f 'node backend/index.js' || true
```

- [ ] **Step 6: No commit (this is sanity validation only). If anything failed, stop and investigate.**

---

## Task 9: HA-side — add `nfc_set_note` rest_command + reply automation

These files live on the Docker host outside the JS repo. They are not committed to the DaylightStation repo. Edit them directly.

**Files (on Docker host):**
- Modify: `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/rest_commands/nfc.yaml`
- Create: `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/automations/nfc_unknown_tag_reply.yaml`

- [ ] **Step 1: Read the current rest_commands/nfc.yaml**

```bash
cat /media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/rest_commands/nfc.yaml
```

- [ ] **Step 2: Append the `nfc_set_note` command**

Use the Edit tool to add the new command after the existing `nfc_tag_scanned:` definition. The full file should end up looking like:

```yaml
# =============================================================================
# NFC Tag Scan Forwarder
# =============================================================================
# Forwards a tag_scanned event from any ESPHome PN532 reader to DaylightStation.
# DaylightStation looks up the reader_id + tag_uid in nfc.yml and runs the
# matching action (plex playback, etc).
# =============================================================================

nfc_tag_scanned:
  url: http://daylight-station:3111/api/v1/trigger/{{ reader_id }}/nfc/{{ tag_uid }}
  method: GET
  timeout: 30

# =============================================================================
# NFC Tag Note Setter
# =============================================================================
# Round-trip for the iOS Companion REPLY action on the "unknown tag" push:
# user types a name; the mobile_app_notification_action automation parses
# location+uid out of the action ID and calls this command.
# =============================================================================

nfc_set_note:
  url: http://daylight-station:3111/api/v1/trigger/{{ location }}/nfc/{{ uid }}/note
  method: PUT
  payload: '{"note": {{ note | to_json }}}'
  content_type: 'application/json'
  timeout: 10
```

- [ ] **Step 3: Create the reply automation**

Create `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/automations/nfc_unknown_tag_reply.yaml`:

```yaml
id: nfc_unknown_tag_reply
alias: NFC Unknown Tag — Submit Reply
description: >-
  When the user submits a name via the iOS Companion REPLY action on an
  Unknown NFC notification, POST it back to DaylightStation as the tag's
  note field.
mode: parallel
trigger:
  - platform: event
    event_type: mobile_app_notification_action
condition:
  - "{{ trigger.event.data.action.startswith('NFC_REPLY|') }}"
action:
  - variables:
      parts: "{{ trigger.event.data.action.split('|') }}"
      location: "{{ parts[1] }}"
      uid: "{{ parts[2] }}"
      reply: "{{ trigger.event.data.reply_text | default('', true) | trim }}"
  - condition: "{{ reply | length > 0 }}"
  - service: rest_command.nfc_set_note
    data:
      location: "{{ location }}"
      uid: "{{ uid }}"
      note: "{{ reply }}"
  - service: logbook.log
    data:
      name: "NFC"
      message: "Unknown tag {{ uid }} at {{ location }} named: {{ reply }}"
      domain: rest_command
      entity_id: rest_command.nfc_set_note
```

- [ ] **Step 4: Reload HA configuration**

The repo has a reload script at `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/reload_config.sh`. Run it:

```bash
/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/reload_config.sh
```

Or call HA's reload services directly via REST. Check HA logs after reload to confirm no YAML errors:

```bash
sudo docker logs --tail 50 homeassistant 2>&1 | grep -iE 'error|nfc_unknown|nfc_set_note' | tail -20
```

Expected: no error lines mentioning the new files.

- [ ] **Step 5: No commit (these files live outside the JS repo, in `/media/kckern/DockerDrive/Docker/Home/homeassistant/`).**

---

## Task 10: Wire `notify_unknown` on `livingroom` in production data

**File (in container):**
- Modify: `data/household/config/triggers/nfc/locations.yml`

- [ ] **Step 1: Read the current file**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/triggers/nfc/locations.yml'
```

- [ ] **Step 2: Write the updated file**

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/triggers/nfc/locations.yml << 'EOF'
# NFC reader locations + per-reader defaults.
# Defaults inherit into every tag scanned at this reader unless the tag
# (or a per-reader block on the tag) overrides them.
livingroom:
  target: livingroom-tv
  action: play-next
  notify_unknown: mobile_app_kc_phone
EOF"
```

Confirm by reading back:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/triggers/nfc/locations.yml'
```

- [ ] **Step 3: Restart the container to pick up the new locations.yml**

There is no in-process reload endpoint. The trigger registry is loaded once at boot:

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

If you get connection refused (container not running this on host), this step is a no-op — the next container restart picks it up.

Expected (when container is running): `{"ok": true, "locations": ["livingroom"], "tagCount": <n>}`.

- [ ] **Step 4: No commit (data files live in the data volume, not the JS repo).**

---

## Task 11: Update `docs/reference/trigger/schema.md`

**Files:**
- Modify: `docs/reference/trigger/schema.md`

- [ ] **Step 1: Add a new section after `## triggers/nfc/tags.yml`**

Insert this new section (before the existing `## triggers/state/locations.yml` section, around line 84):

```markdown
---

## Unknown tag capture (lifecycle)

A tag's lifecycle is **derived from its YAML fields**, not stored as a flag:

| State | YAML shape | Behavior on scan |
|---|---|---|
| 0 — never seen | (no entry) | Backend creates placeholder with `scanned_at: "..."`, sends iOS notify (if `notify_unknown:` set on the location), broadcasts `registered: false` |
| 1 — placeholder, no reply yet | `{ scanned_at: "..." }` | Backend re-sends iOS notify (if configured); no YAML write. Subject to the 3 s debounce window. |
| 2 — reply received, awaiting promotion | `{ scanned_at: "...", note: "..." }` | Silent — broadcast still fires for observer dashboards but no notify, no write |
| 3 — promoted to a real tag | `{ plex: 12345, ... }` | Normal dispatch via `NfcResolver.resolve` — never enters this flow |

**Fields:**

- `scanned_at` (string, quoted) — set by the backend on the **first** scan that creates the entry, in container-local format `"YYYY-MM-DD HH:MM:SS"` (sv-SE locale). **Never updated** after creation.
- `note` (string) — set by `PUT /api/v1/trigger/<location>/nfc/<uid>/note` when the user submits an iOS Companion REPLY. Overwrites on each PUT (last reply wins). Ignored by `NfcResolver.resolve`.

**Promotion** is "add an intent field" (`plex`, `scene`, `service`, etc.) by editing the YAML directly. The leftover `scanned_at:` and `note:` are harmless and may be hand-cleaned at the user's discretion.

**`notify_unknown` field on `nfc/locations.yml`:**

```yaml
livingroom:
  target: livingroom-tv
  action: play-next
  notify_unknown: mobile_app_kc_phone   # optional — HA notify service name
```

When set, the backend calls `haGateway.callService('notify', <value>, { title, message, data: { actions: [{ action: "NFC_REPLY|<location>|<uid>", behavior: "textInput", ... }] } })` on every state-0 or state-1 scan. The action ID encodes location + UID so the HA reply automation is stateless.

When omitted/null: the placeholder is still written and the broadcast still fires; only the push notification is skipped.
```

- [ ] **Step 2: Add the PUT endpoint to the "Files" section at the bottom**

Find the existing **Files** section (around line 138) and update the API router line:

```markdown
- **API router:** `backend/src/4_api/v1/routers/trigger.mjs` (GET trigger, PUT note)
```

- [ ] **Step 3: Commit**

```bash
git add docs/reference/trigger/schema.md
git commit -m "docs(trigger): document unknown-tag lifecycle + notify_unknown field"
```

---

## Task 12: End-to-end manual verification

After all of the above, walk through the user's actual workflow once.

- [ ] **Step 1: Confirm dev/prod server is up and serving the latest code**

If you've been running on dev: confirm the dev server is on 3113 and serving the rebuilt code.

If you want to test against prod, first deploy:

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  /opt/Code/DaylightStation
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
sleep 8
curl -sS http://localhost:3111/api/v1/trigger/livingroom/nfc/__boot_check__ | jq   # confirm boot OK (404 expected)
```

- [ ] **Step 2: Trigger an unknown tag scan**

The cleanest way is to physically tap a brand-new NFC tag at the living room reader. If you don't have one handy, simulate the HTTP call:

```bash
TEST_UID="04_e2e_test_$(date +%s)"
curl -sS http://localhost:3111/api/v1/trigger/livingroom/nfc/${TEST_UID} | jq
```

Expected response: `{"ok": false, "code": "TRIGGER_NOT_REGISTERED", ...}`.

- [ ] **Step 3: Verify the iOS push arrived**

Within ~5 seconds, your iPhone should receive a push notification titled "Unknown NFC tag at livingroom". If it doesn't:

- Check HA logs: `sudo docker logs --tail 100 homeassistant 2>&1 | grep -i notify | tail -20`
- Check backend logs: `sudo docker logs --tail 100 daylight-station 2>&1 | grep trigger.notify`
- Check the notify service exists: in HA UI → Developer Tools → Services → search for `notify.mobile_app_kc_phone`

- [ ] **Step 4: Submit a reply via the notification**

Long-press (or expand) the notification, type a name (e.g., "e2e test"), tap Save.

Within ~5 seconds:

```bash
sudo docker exec daylight-station sh -c "grep -A2 ${TEST_UID} data/household/config/triggers/nfc/tags.yml"
```

Expected: the entry now has both `scanned_at:` and `note: "e2e test"`.

- [ ] **Step 5: Verify state-2 silence on re-scan**

```bash
curl -sS http://localhost:3111/api/v1/trigger/livingroom/nfc/${TEST_UID} | jq
```

Expected response: still 404. Your phone should NOT receive a new notification (state 2 is silent).

- [ ] **Step 6: Clean up the test entry**

Read the current `tags.yml`, remove the `${TEST_UID}` block, and write it back via docker exec heredoc.

- [ ] **Step 7: Update memory with anything surprising you learned**

Per `CLAUDE.md` memory conventions, save any non-obvious quirks discovered (e.g., "iOS Companion's `behavior: textInput` requires app version ≥ X"). Skip this if nothing surprising came up.

---

## Self-Review Checklist

Run through these before declaring done:

- [ ] All `npx vitest run tests/isolated/{adapter,application,api}/.../trigger*` files pass cleanly.
- [ ] `npm run test:isolated` passes (all isolated tests, not just trigger).
- [ ] Dev server boots without throwing.
- [ ] An unknown-tag GET returns 404 + creates a placeholder + (if notify_unknown set) sends the push.
- [ ] A second unknown-tag GET within 3s does NOT re-send the push (debounce works).
- [ ] PUT to `…/note` writes the note and the file round-trips through `parseNfcTags` cleanly on next reload.
- [ ] The HA reply automation parses the action string and reaches the backend.
- [ ] A state-2 tag (has `note:`) is silent on re-scan.
- [ ] Spec was followed; no surprise behavior changes (e.g., `scanned_at` is NEVER updated after creation).
