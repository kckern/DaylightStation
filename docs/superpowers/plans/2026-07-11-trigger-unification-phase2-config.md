# Trigger Unification — Plan 2 of 6: Config Restructure & State Split

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move trigger config to the ECA layout (`sources.yml` / `bindings/` / `responses.yml` / `endpoints.yml`) and split machine-written NFC discovery state out of `config/` into `history/`, via a one-time migration — while keeping NFC/state dispatch behavior unchanged.

**Architecture:** The on-disk config *format* changes; the in-memory registry *contract* does not. New parsers read the new files and `buildTriggerRegistry` assembles the **same** internal shape (`{ nfc:{locations,tags}, state:{locations}, responses, endpoints }`) the resolvers already consume. The `YamlTriggerConfigRepository` gains a second store: curated bindings stay in `config/triggers/bindings/nfc.yml`; observed discovery (first/last-seen, unnamed placeholders) moves to `config`-sibling `history/triggers/nfc.observed.yml` with a separate writer. A one-time migration script transforms the old files.

**Tech Stack:** Node ESM (`.mjs`), vitest, `js-yaml`, `#`-subpath imports. No new deps.

## Global Constraints

- **Internal registry contract is unchanged:** `{ nfc: { locations: { [loc]: { target, action, auth_token, notify_unknown, end, end_location, defaults } }, tags: { [uid]: { global, overrides } } }, state: { locations: { [loc]: { target, auth_token, states } } }, responses: { [name]: {...} }, endpoints: { [name]: {...} } }`. Resolvers/`TriggerDispatchService`/`mapIntentToResponse` must NOT need edits for this plan (except the repository injection + unknown-tag capture repoint in Task 5).
- **Config ↔ state split (spec/status):** hand-authored config lives under `config/triggers/`; machine-written discovery state lives under `history/triggers/`. No writer touches the other's file. This is the plan's headline correctness fix.
- **Big-bang, no dual-read:** the code reads ONLY the new paths. A one-time migration script transforms old→new. No back-compat shim.
- **New on-disk layout:**
  - `config/triggers/sources.yml` — map `sourceId → { modality, location?, ...modality-specific }`. `location` defaults to the map key.
  - `config/triggers/bindings/nfc.yml` — map `uid → { note?, ...curated fields..., [readerId]: {override} }` (NO `scanned_at`).
  - `config/triggers/responses.yml` — map `name → response spec` (may be empty this plan; consumed in Plans 3/5).
  - `config/triggers/endpoints.yml` — map `name → endpoint spec` (may be empty; consumed in Plan 5).
  - `history/triggers/nfc.observed.yml` — map `uid → { first_seen, last_seen, count }`.
- **Test runner:** vitest. `npx vitest run <path>`. Tests under `tests/isolated/{adapter,application}/trigger/…`.
- **Commit after every task.** Branch: `trigger-unification`. Base for Task 1 recorded by the controller.
- **Deploy ordering (Task 7):** run the migration to CREATE the new files FIRST (old code ignores them), THEN deploy the new code, THEN verify, THEN remove old files. Never deploy new code before the new files exist (boot would find no `sources.yml` → empty registry).

---

## File Structure

**Create:**
- `backend/src/1_adapters/trigger/parsers/sourcesParser.mjs` — parse `sources.yml` → `{ nfc:{locations}, state:{locations} }` slices.
- `backend/src/1_adapters/trigger/parsers/namedMapParser.mjs` — parse `responses.yml`/`endpoints.yml` (shallow name→object map with validation).
- `backend/src/1_adapters/persistence/yaml/YamlObservedStateStore.mjs` — read/write `history/triggers/nfc.observed.yml`.
- `scripts/migrate-trigger-config.mjs` — one-time transform old→new (pure transform fn + CLI wrapper).

**Modify:**
- `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs` — assemble from the new blobs; keep the internal shape; add `responses`/`endpoints`.
- `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs` — new PATHS; split writes (bindings vs observed); inject observed store.
- `backend/src/3_applications/trigger/TriggerDispatchService.mjs` — `#handleUnknownNfc` records observed state via the repo instead of writing a config placeholder (note-write path unchanged in spirit).
- `backend/src/5_composition/modules/triggerApi.mjs` — wire the observed store + new repo constructor.

**Tests (create):**
- `tests/isolated/adapter/trigger/parsers/sourcesParser.test.mjs`
- `tests/isolated/adapter/trigger/parsers/namedMapParser.test.mjs`
- `tests/isolated/adapter/persistence/YamlObservedStateStore.test.mjs`
- `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.v2.test.mjs`
- `tests/isolated/adapter/trigger/YamlTriggerConfigRepository.split.test.mjs`
- `tests/isolated/tooling/migrateTriggerConfig.test.mjs`

The existing `nfcLocationsParser`/`nfcTagsParser`/`stateLocationsParser` are RETAINED and REUSED internally by `sourcesParser` (nfc/state slices) and `buildTriggerRegistry` — do not rewrite their per-entry logic; wrap it.

---

## Task 1: `sourcesParser` — unified sources.yml → nfc/state slices

**Files:**
- Create: `backend/src/1_adapters/trigger/parsers/sourcesParser.mjs`
- Test: `tests/isolated/adapter/trigger/parsers/sourcesParser.test.mjs`

**Context:** `sources.yml` is one map keyed by source id. Each entry has `modality` (`nfc`|`state`) and an optional `location` (defaults to the map key). Partition by modality, then delegate to the EXISTING per-entry parsers by reconstructing their expected raw shape keyed by `location`. NFC guard config `guards.authenticate.secret` maps to the internal `auth_token`; `guards.debounce.windowMs` is carried on the location as `debounce_ms` (consumed later; harmless now). Reuse `parseNfcLocations` and `parseStateLocations` — do not duplicate their validation.

**Interfaces:**
- Consumes: `parseNfcLocations` (`./nfcLocationsParser.mjs`), `parseStateLocations` (`./stateLocationsParser.mjs`).
- Produces: `parseSources(raw)` → `{ nfc: { locations }, state: { locations } }`. Throws `ValidationError` (code `INVALID_CONFIG_ROOT`) if root not an object; (code `INVALID_SOURCE`) if an entry isn't an object; (code `UNKNOWN_MODALITY`) if `modality` ∉ {nfc,state}.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/trigger/parsers/sourcesParser.test.mjs
import { describe, it, expect } from 'vitest';
import { parseSources } from '#adapters/trigger/parsers/sourcesParser.mjs';

describe('parseSources', () => {
  it('partitions nfc and state sources into internal slices', () => {
    const raw = {
      livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next', end: 'tv-off', end_location: 'living_room', notify_unknown: 'mobile_app_kc_phone' },
      'livingroom-state': { modality: 'state', location: 'livingroom', target: 'livingroom-tv', states: { off: { action: 'clear' } } },
    };
    const out = parseSources(raw);
    expect(out.nfc.locations.livingroom).toMatchObject({ target: 'livingroom-tv', action: 'play-next', end: 'tv-off', end_location: 'living_room', notify_unknown: 'mobile_app_kc_phone' });
    expect(out.state.locations.livingroom).toMatchObject({ target: 'livingroom-tv', states: { off: { action: 'clear' } } });
  });

  it('maps guards.authenticate.secret to auth_token and defaults location to the key', () => {
    const out = parseSources({ garage: { modality: 'nfc', target: 'garage-tv', guards: { authenticate: { secret: 'tok123' }, debounce: { windowMs: 5000 } } } });
    expect(out.nfc.locations.garage.auth_token).toBe('tok123');
    expect(out.nfc.locations.garage.debounce_ms).toBe(5000);
  });

  it('throws on non-object root, non-object entry, and unknown modality', () => {
    expect(() => parseSources('x')).toThrow();
    expect(() => parseSources({ a: 'x' })).toThrow();
    expect(() => parseSources({ a: { modality: 'voice', target: 't' } })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/sourcesParser.test.mjs`
Expected: FAIL — cannot resolve `#adapters/trigger/parsers/sourcesParser.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/trigger/parsers/sourcesParser.mjs
/**
 * Parser for triggers/sources.yml. One map keyed by source id; each entry
 * carries `modality` (nfc|state) and optional `location` (defaults to key).
 * Partitions by modality and delegates per-entry validation to the existing
 * nfc/state location parsers by reconstructing their raw keyed-by-location shape.
 *
 * Guard mapping: guards.authenticate.secret -> auth_token;
 * guards.debounce.windowMs -> debounce_ms (carried, consumed later).
 *
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 * @module adapters/trigger/parsers/sourcesParser
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';
import { parseNfcLocations } from './nfcLocationsParser.mjs';
import { parseStateLocations } from './stateLocationsParser.mjs';

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// Flatten a source entry into the shape the legacy per-entry parser expects
// (keyed by location, with auth_token/debounce_ms lifted out of guards).
function toLegacyEntry(entry) {
  const { modality, location, guards, ...rest } = entry;
  const legacy = { ...rest };
  const secret = guards?.authenticate?.secret ?? guards?.authenticate?.token;
  if (secret != null) legacy.auth_token = secret;
  const windowMs = guards?.debounce?.windowMs;
  if (windowMs != null) legacy.debounce_ms = windowMs;
  return legacy;
}

export function parseSources(raw) {
  if (!raw) return { nfc: { locations: {} }, state: { locations: {} } };
  if (!isPlainObject(raw)) {
    throw new ValidationError('sources.yml root must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }
  const nfcRaw = {};
  const stateRaw = {};
  for (const [sourceId, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      throw new ValidationError(`source "${sourceId}" must be an object`, { code: 'INVALID_SOURCE', field: sourceId });
    }
    const location = entry.location || sourceId;
    if (entry.modality === 'nfc') nfcRaw[location] = toLegacyEntry(entry);
    else if (entry.modality === 'state') stateRaw[location] = toLegacyEntry(entry);
    else throw new ValidationError(`source "${sourceId}" has unknown modality "${entry.modality}"`, { code: 'UNKNOWN_MODALITY', field: sourceId });
  }
  // parseNfcLocations strips unknown keys into `defaults`; debounce_ms lands there
  // harmlessly. Lift it back onto the location for later consumers.
  const nfcLocations = parseNfcLocations(nfcRaw);
  for (const loc of Object.keys(nfcLocations)) {
    if (nfcLocations[loc].defaults?.debounce_ms != null) {
      nfcLocations[loc].debounce_ms = nfcLocations[loc].defaults.debounce_ms;
      delete nfcLocations[loc].defaults.debounce_ms;
    }
  }
  return { nfc: { locations: nfcLocations }, state: { locations: parseStateLocations(stateRaw) } };
}

export default parseSources;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/sourcesParser.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/trigger/parsers/sourcesParser.mjs tests/isolated/adapter/trigger/parsers/sourcesParser.test.mjs
git commit -m "feat(trigger): add sourcesParser (unified sources.yml -> nfc/state slices)"
```

---

## Task 2: `namedMapParser` — responses.yml / endpoints.yml

**Files:**
- Create: `backend/src/1_adapters/trigger/parsers/namedMapParser.mjs`
- Test: `tests/isolated/adapter/trigger/parsers/namedMapParser.test.mjs`

**Context:** `responses.yml` and `endpoints.yml` are shallow `name → object` maps. This plan only needs a validated pass-through (empty map when the file is absent). Deep validation of response/endpoint specs happens in Plans 3/5 where they're consumed.

**Interfaces:**
- Produces: `parseNamedMap(raw, label)` → `{ [name]: object }`. Empty object when `raw` is falsy. Throws `ValidationError` (code `INVALID_CONFIG_ROOT`) if root not an object; (code `INVALID_NAMED_ENTRY`) if a value isn't an object.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/trigger/parsers/namedMapParser.test.mjs
import { describe, it, expect } from 'vitest';
import { parseNamedMap } from '#adapters/trigger/parsers/namedMapParser.mjs';

describe('parseNamedMap', () => {
  it('returns {} for falsy input', () => {
    expect(parseNamedMap(null, 'responses')).toEqual({});
    expect(parseNamedMap(undefined, 'endpoints')).toEqual({});
  });
  it('passes through a valid name->object map', () => {
    const raw = { 'play-bedtime-red': { kind: 'playback-hub', target: 'red' } };
    expect(parseNamedMap(raw, 'responses')).toEqual(raw);
  });
  it('throws on non-object root and non-object entries', () => {
    expect(() => parseNamedMap('x', 'responses')).toThrow();
    expect(() => parseNamedMap({ a: 'x' }, 'responses')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/namedMapParser.test.mjs`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/trigger/parsers/namedMapParser.mjs
/**
 * Parser for shallow name->object config maps (responses.yml, endpoints.yml).
 * Validated pass-through; deep spec validation happens where consumed.
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 * @module adapters/trigger/parsers/namedMapParser
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

export function parseNamedMap(raw, label = 'named map') {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError(`${label} root must be an object`, { code: 'INVALID_CONFIG_ROOT' });
  }
  const out = {};
  for (const [name, spec] of Object.entries(raw)) {
    if (!isPlainObject(spec)) {
      throw new ValidationError(`${label} entry "${name}" must be an object`, { code: 'INVALID_NAMED_ENTRY', field: name });
    }
    out[name] = spec;
  }
  return out;
}

export default parseNamedMap;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/namedMapParser.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/trigger/parsers/namedMapParser.mjs tests/isolated/adapter/trigger/parsers/namedMapParser.test.mjs
git commit -m "feat(trigger): add namedMapParser (responses/endpoints)"
```

---

## Task 3: `YamlObservedStateStore` — history/triggers/nfc.observed.yml

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlObservedStateStore.mjs`
- Test: `tests/isolated/adapter/persistence/YamlObservedStateStore.test.mjs`

**Context:** Machine-written discovery store, separate from config. Uses injected `loadFile`/`saveFile` (relative path helpers, same pattern as `YamlTriggerConfigRepository`). Records first/last-seen + count per uid. Path: `history/triggers/nfc.observed` (the loader appends `.yml`). Writes serialize through a promise-chain mutex.

**Interfaces:**
- Produces: `class YamlObservedStateStore` with:
  - `constructor({ loadFile, saveFile, path = 'history/triggers/nfc.observed' })`
  - `load()` → the in-memory map `{ [uid]: { first_seen, last_seen, count } }` (also cached internally)
  - `record(uid, timestampStr)` → `Promise<{ first_seen, last_seen, count }>` — upsert; sets first_seen on create, always updates last_seen + increments count.
  - `has(uid)` → boolean (from cache; call `load()` first).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/persistence/YamlObservedStateStore.test.mjs
import { describe, it, expect } from 'vitest';
import { YamlObservedStateStore } from '#adapters/persistence/yaml/YamlObservedStateStore.mjs';

function fakeIO(initial = {}) {
  const disk = { 'history/triggers/nfc.observed': initial };
  return {
    loadFile: (p) => disk[p],
    saveFile: (p, data) => { disk[p] = data; },
    _disk: disk,
  };
}

describe('YamlObservedStateStore', () => {
  it('records first_seen + last_seen + count on first sight', async () => {
    const io = fakeIO();
    const store = new YamlObservedStateStore(io);
    store.load();
    const r = await store.record('aa', '2026-07-11 10:00:00');
    expect(r).toEqual({ first_seen: '2026-07-11 10:00:00', last_seen: '2026-07-11 10:00:00', count: 1 });
    expect(io._disk['history/triggers/nfc.observed'].aa.count).toBe(1);
  });

  it('preserves first_seen and bumps last_seen + count on re-sight', async () => {
    const io = fakeIO({ aa: { first_seen: '2026-07-01 09:00:00', last_seen: '2026-07-01 09:00:00', count: 3 } });
    const store = new YamlObservedStateStore(io);
    store.load();
    const r = await store.record('aa', '2026-07-11 10:00:00');
    expect(r.first_seen).toBe('2026-07-01 09:00:00');
    expect(r.last_seen).toBe('2026-07-11 10:00:00');
    expect(r.count).toBe(4);
  });

  it('has() reflects the loaded cache', () => {
    const store = new YamlObservedStateStore(fakeIO({ bb: { first_seen: 'x', last_seen: 'x', count: 1 } }));
    store.load();
    expect(store.has('bb')).toBe(true);
    expect(store.has('zz')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/persistence/YamlObservedStateStore.test.mjs`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/persistence/yaml/YamlObservedStateStore.mjs
/**
 * Machine-written NFC discovery store: history/triggers/nfc.observed.yml.
 * Separate writer from the curated config bindings (spec/status split).
 * Layer: ADAPTER (1_adapters/persistence/yaml).
 * @module adapters/persistence/yaml/YamlObservedStateStore
 */
export class YamlObservedStateStore {
  #loadFile; #saveFile; #path; #cache = null; #writeChain = Promise.resolve();

  constructor({ loadFile, saveFile, path = 'history/triggers/nfc.observed' } = {}) {
    this.#loadFile = loadFile;
    this.#saveFile = saveFile;
    this.#path = path;
  }

  load() {
    const raw = this.#loadFile?.(this.#path);
    this.#cache = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    return this.#cache;
  }

  has(uid) {
    return !!(this.#cache && this.#cache[String(uid).toLowerCase()]);
  }

  record(uid, timestampStr) {
    return this.#enqueue(async () => {
      if (!this.#cache) this.load();
      const key = String(uid).toLowerCase();
      const existing = this.#cache[key];
      const entry = existing
        ? { first_seen: existing.first_seen, last_seen: timestampStr, count: (existing.count || 0) + 1 }
        : { first_seen: timestampStr, last_seen: timestampStr, count: 1 };
      this.#cache[key] = entry;
      await Promise.resolve(this.#saveFile?.(this.#path, this.#cache));
      return entry;
    });
  }

  #enqueue(task) {
    const next = this.#writeChain.then(task, task);
    this.#writeChain = next.then(() => undefined, () => undefined);
    return next;
  }
}

export default YamlObservedStateStore;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/persistence/YamlObservedStateStore.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlObservedStateStore.mjs tests/isolated/adapter/persistence/YamlObservedStateStore.test.mjs
git commit -m "feat(trigger): add YamlObservedStateStore (history/triggers/nfc.observed)"
```

---

## Task 4: `buildTriggerRegistry` v2 — assemble from new blobs

**Files:**
- Modify: `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs`
- Test: `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.v2.test.mjs` (create; the existing `buildTriggerRegistry.test.mjs` is updated in Step 3)

**Context:** Re-point `buildTriggerRegistry` at the new blobs: `{ sources, bindingsNfc, responses, endpoints }`. It calls `parseSources` for nfc/state locations, `parseNfcTags` for the bindings (reusing the existing tag parser — bindings/nfc.yml has the SAME flat per-uid shape as the old tags.yml, minus scanned_at), and `parseNamedMap` for responses/endpoints. Output adds `responses` and `endpoints` to the existing shape. The OLD `buildTriggerRegistry.test.mjs` (which passes `nfcLocations`/`nfcTags`/`stateLocations` blobs) must be updated to the new input shape.

**Interfaces:**
- Consumes: `parseSources` (Task 1), `parseNfcTags` (existing), `parseNamedMap` (Task 2).
- Produces: `buildTriggerRegistry({ sources, bindingsNfc, responses, endpoints })` → `{ nfc:{locations,tags}, state:{locations}, responses, endpoints }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.v2.test.mjs
import { describe, it, expect } from 'vitest';
import { buildTriggerRegistry } from '#adapters/trigger/parsers/buildTriggerRegistry.mjs';

describe('buildTriggerRegistry v2', () => {
  it('assembles nfc/state/tags/responses/endpoints from new blobs', () => {
    const reg = buildTriggerRegistry({
      sources: {
        livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next' },
        'lr-state': { modality: 'state', location: 'livingroom', target: 'livingroom-tv', states: { off: { action: 'clear' } } },
      },
      bindingsNfc: { '1a_95_71_06': { plex: 456598, action: 'queue', livingroom: { action: 'play' } } },
      responses: { 'r1': { kind: 'content' } },
      endpoints: { 'e1': { method: 'POST', url: 'http://x' } },
    });
    expect(reg.nfc.locations.livingroom.target).toBe('livingroom-tv');
    expect(reg.state.locations.livingroom.states.off).toEqual({ action: 'clear' });
    expect(reg.nfc.tags['1a_95_71_06'].global).toMatchObject({ plex: 456598, action: 'queue' });
    expect(reg.nfc.tags['1a_95_71_06'].overrides.livingroom).toEqual({ action: 'play' });
    expect(reg.responses.r1).toEqual({ kind: 'content' });
    expect(reg.endpoints.e1).toMatchObject({ method: 'POST' });
  });

  it('tolerates all blobs absent', () => {
    const reg = buildTriggerRegistry({});
    expect(reg).toEqual({ nfc: { locations: {}, tags: {} }, state: { locations: {} }, responses: {}, endpoints: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.v2.test.mjs`
Expected: FAIL — old signature ignores `sources`/`bindingsNfc`, so `reg.nfc.locations.livingroom` is undefined.

- [ ] **Step 3: Rewrite `buildTriggerRegistry.mjs` and update the old test**

Replace `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs`:

```javascript
/**
 * Trigger config assembler (v2 — ECA layout). Reads the new config blobs and
 * assembles the internal registry the resolvers consume. The internal shape is
 * unchanged from v1; only the input files changed.
 *
 * Input blobs: { sources, bindingsNfc, responses, endpoints } (raw YAML objects)
 * Output: { nfc:{locations,tags}, state:{locations}, responses, endpoints }
 *
 * Layer: ADAPTER (1_adapters/trigger). Pure (no FS).
 * @module adapters/trigger/parsers/buildTriggerRegistry
 */
import { parseSources } from './sourcesParser.mjs';
import { parseNfcTags } from './nfcTagsParser.mjs';
import { parseNamedMap } from './namedMapParser.mjs';

export function buildTriggerRegistry(blobs = {}) {
  const { nfc, state } = parseSources(blobs.sources);
  const knownNfcReaders = new Set(Object.keys(nfc.locations));
  const tags = parseNfcTags(blobs.bindingsNfc, knownNfcReaders);
  return {
    nfc: { locations: nfc.locations, tags },
    state: { locations: state.locations },
    responses: parseNamedMap(blobs.responses, 'responses'),
    endpoints: parseNamedMap(blobs.endpoints, 'endpoints'),
  };
}

export default buildTriggerRegistry;
```

Then update the OLD test `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs` to the new input shape. Open it, and for each call that passed `{ nfcLocations, nfcTags, stateLocations }`, convert to `{ sources, bindingsNfc }`: an `nfcLocations` entry `{ livingroom: { target, action, ... } }` becomes a `sources` entry `{ livingroom: { modality: 'nfc', target, action, ... } }`; a `stateLocations` entry `{ x: { target, states } }` becomes `{ x: { modality: 'state', target, states } }` (add a distinct key if it collides with an nfc location — use `<loc>-state` with `location: '<loc>'`); `nfcTags` becomes `bindingsNfc` unchanged. Keep every assertion; only the inputs change. If the file's assertions reference `reg.nfc`/`reg.state` they remain valid.

- [ ] **Step 4: Run both tests to verify they pass**

Run: `npx vitest run tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.v2.test.mjs tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.v2.test.mjs tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs
git commit -m "feat(trigger): buildTriggerRegistry v2 assembles from sources/bindings/responses/endpoints"
```

---

## Task 5: `YamlTriggerConfigRepository` split writes + service repoint

**Files:**
- Modify: `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs`
- Modify: `backend/src/3_applications/trigger/TriggerDispatchService.mjs`
- Test: `tests/isolated/adapter/trigger/YamlTriggerConfigRepository.split.test.mjs` (create)

**Context:** The repository stops writing observed state into the config file. New PATHS: `config/triggers/sources`, `config/triggers/bindings/nfc`, `config/triggers/responses`, `config/triggers/endpoints`. `loadRegistry` reads these into `buildTriggerRegistry`'s new blob shape. Writes split:
- `recordObserved(uid, scannedAt)` → delegates to the injected `YamlObservedStateStore.record` (history). NEW method, replaces `upsertNfcPlaceholder`.
- `setNfcNote(uid, note, scannedAt)` → writes the `note` into `bindings/nfc.yml` (curated) via `serializeNfcTags`; also calls `recordObserved` for the timestamp. (Note stays curated config; timestamp is observed state.)

`TriggerDispatchService.#handleUnknownNfc` currently calls `this.#tagWriter.upsertNfcPlaceholder`; change to `this.#tagWriter.recordObserved`. Its note-presence check reads `this.#config.nfc.tags[uid].global.note` — unchanged (note now lives in bindings, which populates `nfc.tags`). Everything else in the service is unchanged.

**Interfaces:**
- Repository produces: `constructor({ saveFile, observedStore })`; `loadRegistry({ loadFile })` reads new paths; `recordObserved(uid, scannedAt)` → `Promise<{created:boolean}>` (created = first sight); `setNfcNote(uid, note, scannedAtIfNew)` → `Promise<{created:boolean}>` (created = binding newly created).
- Service consumes: `tagWriter.recordObserved(uid, scannedAt)` in `#handleUnknownNfc`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/trigger/YamlTriggerConfigRepository.split.test.mjs
import { describe, it, expect } from 'vitest';
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';
import { YamlObservedStateStore } from '#adapters/persistence/yaml/YamlObservedStateStore.mjs';

function harness(files = {}) {
  const disk = {
    'config/triggers/sources': { livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next' } },
    'config/triggers/bindings/nfc': {},
    'config/triggers/responses': {},
    'config/triggers/endpoints': {},
    'history/triggers/nfc.observed': {},
    ...files,
  };
  const loadFile = (p) => disk[p];
  const saveFile = (p, d) => { disk[p] = d; };
  const observedStore = new YamlObservedStateStore({ loadFile, saveFile });
  observedStore.load();
  const repo = new YamlTriggerConfigRepository({ saveFile, observedStore });
  repo.loadRegistry({ loadFile });
  return { repo, disk };
}

describe('YamlTriggerConfigRepository split writes', () => {
  it('recordObserved writes to history, never to bindings', async () => {
    const { repo, disk } = harness();
    const r = await repo.recordObserved('aa', '2026-07-11 10:00:00');
    expect(r.created).toBe(true);
    expect(disk['history/triggers/nfc.observed'].aa.count).toBe(1);
    expect(disk['config/triggers/bindings/nfc'].aa).toBeUndefined();
  });

  it('setNfcNote writes note to bindings (config) and timestamp to history', async () => {
    const { repo, disk } = harness();
    const r = await repo.setNfcNote('bb', 'Pinocchio', '2026-07-11 10:00:00');
    expect(r.created).toBe(true);
    expect(disk['config/triggers/bindings/nfc'].bb.note).toBe('Pinocchio');
    expect(disk['config/triggers/bindings/nfc'].bb.scanned_at).toBeUndefined();
    expect(disk['history/triggers/nfc.observed'].bb.last_seen).toBe('2026-07-11 10:00:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/trigger/YamlTriggerConfigRepository.split.test.mjs`
Expected: FAIL — `recordObserved` is not a function / constructor doesn't accept `observedStore`.

- [ ] **Step 3: Modify the repository**

Edit `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs`:

Replace the `PATHS` constant:
```javascript
const PATHS = {
  sources: 'config/triggers/sources',
  bindingsNfc: 'config/triggers/bindings/nfc',
  responses: 'config/triggers/responses',
  endpoints: 'config/triggers/endpoints',
};
```

Change the constructor to accept `observedStore`:
```javascript
constructor({ saveFile, observedStore } = {}) {
  this.#saveFile = typeof saveFile === 'function' ? saveFile : null;
  this.#observedStore = observedStore || null;
}
```
(add `#observedStore` to the private field list.)

Change `loadRegistry` to read the new blobs:
```javascript
loadRegistry({ loadFile }) {
  const blobs = {
    sources: loadFile(PATHS.sources),
    bindingsNfc: loadFile(PATHS.bindingsNfc),
    responses: loadFile(PATHS.responses),
    endpoints: loadFile(PATHS.endpoints),
  };
  this.#registry = buildTriggerRegistry(blobs);
  return this.#registry;
}
```

Replace `upsertNfcPlaceholder` with `recordObserved` (delegates to the observed store — never touches config):
```javascript
/**
 * Record an observed NFC scan in the machine-written history store.
 * Never writes to config. @returns {Promise<{created:boolean}>}
 */
recordObserved(uid, scannedAt) {
  if (!this.#observedStore) return Promise.resolve({ created: false });
  const key = String(uid).toLowerCase();
  const firstSight = !this.#observedStore.has(key);
  return Promise.resolve(this.#observedStore.record(key, scannedAt)).then(() => ({ created: firstSight }));
}
```

Change `setNfcNote` to write the note into bindings (curated) and the timestamp into history:
```javascript
setNfcNote(uid, note, scannedAtIfNew) {
  return this.#enqueue(async () => {
    this.#assertReady();
    const tags = this.#registry.nfc.tags;
    const key = String(uid).toLowerCase();
    let created = false;
    if (!tags[key]) { tags[key] = { global: {}, overrides: {} }; created = true; }
    tags[key].global.note = note;
    await this.#flushBindings();
    if (this.#observedStore) await this.#observedStore.record(key, scannedAtIfNew);
    return { created };
  });
}
```

Rename `#flushTags` to `#flushBindings` writing to `PATHS.bindingsNfc`:
```javascript
#flushBindings() {
  const flat = serializeNfcTags(this.#registry.nfc.tags);
  return Promise.resolve(this.#saveFile(PATHS.bindingsNfc, flat));
}
```
Update `#assertReady` message text if it references tags. Keep the `#enqueue` mutex as-is.

- [ ] **Step 4: Repoint the service's unknown-tag capture**

Edit `backend/src/3_applications/trigger/TriggerDispatchService.mjs`, in `#handleUnknownNfc`, change the placeholder write:
```javascript
// old:
await this.#tagWriter.upsertNfcPlaceholder(uid, this.#formatScannedAt(this.#clock()));
this.#logger.debug?.('trigger.placeholder_created', { location, uid });
// new:
await this.#tagWriter.recordObserved(uid, this.#formatScannedAt(this.#clock()));
this.#logger.debug?.('trigger.observed_recorded', { location, uid });
```
(The surrounding try/catch and notify logic stay unchanged; the `entry`/`hasNote` check above it is unchanged.)

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/isolated/adapter/trigger/YamlTriggerConfigRepository.split.test.mjs tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs tests/isolated/application/trigger/`
Expected: PASS for the new split test + the application/trigger suite. NOTE: the OLD `YamlTriggerConfigRepository.test.mjs` exercises `upsertNfcPlaceholder`/old paths — update it: rename `upsertNfcPlaceholder` cases to `recordObserved` (assert history write, not config), point its fake IO at the new PATHS, and inject an `observedStore`. Keep the `setNfcNote` cases, updating their expected write target to `bindings/nfc` + history. Preserve the mutex/serialization test intent.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs backend/src/3_applications/trigger/TriggerDispatchService.mjs tests/isolated/adapter/trigger/YamlTriggerConfigRepository.split.test.mjs tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs
git commit -m "feat(trigger): split observed state to history; bindings stay curated"
```

---

## Task 6: Migration script (old config → new layout)

**Files:**
- Create: `scripts/migrate-trigger-config.mjs`
- Test: `tests/isolated/tooling/migrateTriggerConfig.test.mjs`

**Context:** A pure transform function `migrateTriggerConfig({ nfcLocations, nfcTags, stateLocations })` → `{ sources, bindingsNfc, observed, responses, endpoints }`, plus a thin CLI that reads the old files and writes the new ones via `js-yaml`. The transform:
- `sources`: each `nfcLocations[loc]` → `{ modality:'nfc', ...loc-fields }`; each `stateLocations[loc]` → keyed `<loc>-state` with `{ modality:'state', location: loc, ...fields }` (avoids nfc/state key collision).
- `bindingsNfc`: each `nfcTags[uid]` with `scanned_at` STRIPPED (all other fields, incl. `note` and per-reader override objects, retained).
- `observed`: each `nfcTags[uid]` that HAS `scanned_at` → `{ first_seen: scanned_at, last_seen: scanned_at, count: 1 }`.
- A tag with ONLY `scanned_at` (unnamed placeholder) → appears in `observed` only, NOT in `bindingsNfc` (empty curated entry is dropped).
- `responses`/`endpoints`: `{}`.

**Interfaces:**
- Produces: `migrateTriggerConfig(oldBlobs)` → `{ sources, bindingsNfc, observed, responses, endpoints }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/tooling/migrateTriggerConfig.test.mjs
import { describe, it, expect } from 'vitest';
import { migrateTriggerConfig } from '../../../scripts/migrate-trigger-config.mjs';

describe('migrateTriggerConfig', () => {
  const old = {
    nfcLocations: { livingroom: { target: 'livingroom-tv', action: 'play-next', notify_unknown: 'mobile_app_kc_phone' } },
    stateLocations: { livingroom: { target: 'livingroom-tv', states: { off: { action: 'clear' } } } },
    nfcTags: {
      '1a_95_71_06': { plex: 456598, action: 'queue' },                                  // curated, no timestamp
      '04_2f_71_72': { scanned_at: '2026-04-26 17:44:56', note: 'Pinocchio', plex: 620699 }, // curated + observed
      '04_87_33_00': { scanned_at: '2026-04-26 17:44:48' },                               // placeholder only
    },
  };

  it('builds sources with modality and de-collides state', () => {
    const { sources } = migrateTriggerConfig(old);
    expect(sources.livingroom).toMatchObject({ modality: 'nfc', target: 'livingroom-tv', action: 'play-next' });
    expect(sources['livingroom-state']).toMatchObject({ modality: 'state', location: 'livingroom', target: 'livingroom-tv' });
  });

  it('strips scanned_at from bindings and drops placeholder-only tags', () => {
    const { bindingsNfc } = migrateTriggerConfig(old);
    expect(bindingsNfc['1a_95_71_06']).toEqual({ plex: 456598, action: 'queue' });
    expect(bindingsNfc['04_2f_71_72']).toEqual({ note: 'Pinocchio', plex: 620699 });
    expect(bindingsNfc['04_87_33_00']).toBeUndefined();
  });

  it('moves scanned_at into observed as first/last-seen', () => {
    const { observed } = migrateTriggerConfig(old);
    expect(observed['04_2f_71_72']).toEqual({ first_seen: '2026-04-26 17:44:56', last_seen: '2026-04-26 17:44:56', count: 1 });
    expect(observed['04_87_33_00']).toEqual({ first_seen: '2026-04-26 17:44:48', last_seen: '2026-04-26 17:44:48', count: 1 });
    expect(observed['1a_95_71_06']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/tooling/migrateTriggerConfig.test.mjs`
Expected: FAIL — cannot resolve the script module.

- [ ] **Step 3: Write the migration script**

```javascript
// scripts/migrate-trigger-config.mjs
/**
 * One-time migration: old trigger config layout -> ECA layout with config/state split.
 *
 * Pure transform (migrateTriggerConfig) + a CLI that reads old files and writes new ones.
 * Old:  config/triggers/nfc/locations.yml, nfc/tags.yml, state/locations.yml
 * New:  config/triggers/sources.yml, bindings/nfc.yml, responses.yml, endpoints.yml
 *       history/triggers/nfc.observed.yml
 */
export function migrateTriggerConfig({ nfcLocations = {}, nfcTags = {}, stateLocations = {} } = {}) {
  const sources = {};
  for (const [loc, cfg] of Object.entries(nfcLocations)) {
    sources[loc] = { modality: 'nfc', ...cfg };
  }
  for (const [loc, cfg] of Object.entries(stateLocations)) {
    const key = sources[loc] ? `${loc}-state` : loc;
    sources[key] = { modality: 'state', location: loc, ...cfg };
  }

  const bindingsNfc = {};
  const observed = {};
  for (const [uid, entry] of Object.entries(nfcTags)) {
    const { scanned_at, ...curated } = entry || {};
    if (scanned_at) {
      observed[uid] = { first_seen: scanned_at, last_seen: scanned_at, count: 1 };
    }
    if (Object.keys(curated).length > 0) {
      bindingsNfc[uid] = curated;
    }
  }

  return { sources, bindingsNfc, observed, responses: {}, endpoints: {} };
}

export default migrateTriggerConfig;

// --- CLI (only runs when invoked directly) ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const [{ readFileSync, writeFileSync, mkdirSync, existsSync }, yaml, path] = await Promise.all([
    import('node:fs'), import('js-yaml').then((m) => m.default), import('node:path'),
  ]);
  const dataDir = process.argv[2];
  if (!dataDir) { console.error('usage: node scripts/migrate-trigger-config.mjs <dataDir>'); process.exit(1); }
  const rd = (p) => { const f = path.join(dataDir, p); return existsSync(f) ? yaml.load(readFileSync(f, 'utf8')) : undefined; };
  const wr = (p, obj) => {
    const f = path.join(dataDir, p);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, yaml.dump(obj, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');
    console.log('wrote', p, `(${Object.keys(obj).length} keys)`);
  };
  const out = migrateTriggerConfig({
    nfcLocations: rd('household/config/triggers/nfc/locations.yml'),
    nfcTags: rd('household/config/triggers/nfc/tags.yml'),
    stateLocations: rd('household/config/triggers/state/locations.yml'),
  });
  wr('household/config/triggers/sources.yml', out.sources);
  wr('household/config/triggers/bindings/nfc.yml', out.bindingsNfc);
  wr('household/config/triggers/responses.yml', out.responses);
  wr('household/config/triggers/endpoints.yml', out.endpoints);
  wr('household/history/triggers/nfc.observed.yml', out.observed);
  console.log('migration complete');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/tooling/migrateTriggerConfig.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-trigger-config.mjs tests/isolated/tooling/migrateTriggerConfig.test.mjs
git commit -m "feat(trigger): one-time config migration (old layout -> ECA + state split)"
```

---

## Task 7: Wire the new stores in bootstrap + regression sweep

**Files:**
- Modify: `backend/src/5_composition/modules/triggerApi.mjs`
- Test: run trigger suites + isolated sweep (no new file).

**Context:** `triggerApi.mjs` constructs `YamlTriggerConfigRepository` and calls `loadRegistry`. Update it to also construct a `YamlObservedStateStore` (with the same `loadFile`/`saveFile`), `load()` it, inject it into the repository, and pass the repository as `tagWriter` to `TriggerDispatchService` (already the case). Read the file first to match its current wiring.

- [ ] **Step 1: Read and update `triggerApi.mjs`**

Read `backend/src/5_composition/modules/triggerApi.mjs`. Where it does `new YamlTriggerConfigRepository({ saveFile })`, change to:
```javascript
import { YamlObservedStateStore } from '#adapters/persistence/yaml/YamlObservedStateStore.mjs';
// ...
const observedStore = new YamlObservedStateStore({ loadFile, saveFile });
observedStore.load();
const repository = new YamlTriggerConfigRepository({ saveFile, observedStore });
```
Keep the rest (`repository.loadRegistry({ loadFile })`, passing `repository` as `tagWriter`) unchanged.

- [ ] **Step 2: Run the trigger + adapter suites**

Run: `npx vitest run tests/isolated/domain/trigger tests/isolated/application/trigger tests/isolated/adapter/trigger tests/isolated/adapter/persistence tests/isolated/api/routers/trigger.test.mjs tests/isolated/api/routers/trigger.sideEffect.test.mjs tests/isolated/tooling/migrateTriggerConfig.test.mjs`
Expected: PASS (all).

- [ ] **Step 3: Confirm barcode suites still untouched**

Run: `npx vitest run tests/isolated/domain/barcode tests/isolated/assembly/barcode`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/5_composition/modules/triggerApi.mjs
git commit -m "feat(trigger): wire YamlObservedStateStore into trigger bootstrap"
```

- [ ] **Step 5: (Controller-run, live) Migrate the on-disk config, then note deploy ordering**

This step is executed by the controller against live data, NOT a subagent. The migration must run BEFORE the new code is deployed (so `sources.yml` exists when the new boot reads it). Sequence documented for the deploy phase:
```bash
# 1. Run the migration inside the container (writes new files alongside old)
sudo docker exec daylight-station node scripts/migrate-trigger-config.mjs data
# 2. Verify the new files exist and look right (sources.yml, bindings/nfc.yml, history/triggers/nfc.observed.yml)
# 3. Deploy the new image (reads new files)
# 4. After verification, remove the old files: config/triggers/nfc/, config/triggers/state/
```

---

## Self-Review

- **Spec coverage:** ECA layout (`sources`/`bindings`/`responses`/`endpoints`) — Tasks 1,2,4 ✓; config↔state split with separate writers — Tasks 3,5 ✓; migration — Task 6 ✓; internal-contract-unchanged (resolvers untouched) — enforced by buildTriggerRegistry v2 producing the same shape ✓; wiring — Task 7 ✓. Derived target registry is correctly DEFERRED to Plan 3 (only needed when self-describing barcode picks a kind from a target name).
- **Type consistency:** `buildTriggerRegistry({sources,bindingsNfc,responses,endpoints})` (Task 4) matches the repo's `loadRegistry` blobs (Task 5). `YamlObservedStateStore.{load,has,record}` (Task 3) matches repo `recordObserved` usage (Task 5) and bootstrap wiring (Task 7). `recordObserved` (Task 5) matches the service call site (Task 5 Step 4). `migrateTriggerConfig` output keys (Task 6) match the new PATHS (Task 5) and the CLI write targets.
- **Placeholder scan:** none — every code/test step carries complete code. The two existing-test updates (buildTriggerRegistry.test.mjs, YamlTriggerConfigRepository.test.mjs) give explicit transformation instructions rather than vague "update the test".
