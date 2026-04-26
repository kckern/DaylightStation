# Trigger Config Modality Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `data/household/config/nfc.yml` with a per-modality directory tree (`triggers/nfc/{locations,tags}.yml`, `triggers/state/locations.yml`) that supports universal tag identity, per-reader overrides on tags, and a forward-compatible resolver registry for future modalities (voice, barcode).

**Architecture:** Three DDD layers change together. **Layering matters** — the existing `2_domains/trigger/{TriggerConfig,TriggerIntent}.mjs` files are pre-existing layer violations (YAML parsing in domain) that this refactor fixes:
1. **Adapter (`1_adapters/trigger/`):** YAML knowledge lives here. `YamlTriggerConfigRepository` loads files via the injected `loadFile` helper and assembles the registry. `parsers/{nfcLocationsParser, nfcTagsParser, stateLocationsParser, buildTriggerRegistry}.mjs` are pure functions (no I/O) — independently testable.
2. **Domain (`2_domains/trigger/services/`):** Pure cross-entity resolution logic. `NfcResolver`, `StateResolver`, `ResolverRegistry` are stateless classes (PascalCase per `domain-layer-guidelines.md`). They receive already-parsed shapes, produce intents, know nothing about YAML or files.
3. **Application (`3_applications/trigger/`):** `TriggerDispatchService` and `actionHandlers` stay here. Only the dispatcher's body and imports change — its API and the HTTP/WS contracts are unchanged.

Migration is one-shot — no backward-compat shim. Only one location and two tags exist in prod, so the rewrite is a few lines of YAML.

**Tech Stack:** Node 20 ES modules (`.mjs`), vitest (domain + app tests under `tests/isolated/...`), `js-yaml` for YAML parsing (already in use via the existing `loadFile` helper), `node:fs` for directory walking, `#aliases` for imports (`#domains/...`, `#applications/...`).

**Spec source:** [`docs/superpowers/specs/2026-04-26-trigger-config-modality-architecture.md`](../specs/2026-04-26-trigger-config-modality-architecture.md). Read it before starting — this plan assumes the schema decisions in §"Schema" and the precedence chain in §"Precedence chain".

**Working directory note:** All paths in this plan are repo-relative from the worktree root. The repo is at `/opt/Code/DaylightStation` on `kckern-server` (this host); commands use that path. Adjust if running elsewhere.

---

## File Structure

**New files (created):**

| Path | Responsibility |
|---|---|
| `data/household/config/triggers/nfc/locations.yml` | NFC reader sources + defaults (target, action, shader). Per-physical-location. |
| `data/household/config/triggers/nfc/tags.yml` | Universal tag UID registry + per-location override blocks. |
| `data/household/config/triggers/state/locations.yml` | State-source locations + their state-value action maps. |
| `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs` | **Adapter — public entry.** Loads three YAML blobs via injected `loadFile`, calls `buildTriggerRegistry`, returns unified registry. Bootstrap calls this. |
| `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs` | **Adapter — pure orchestrator.** Combines parser outputs into `{ nfc: { locations, tags }, state: { locations } }`. No I/O. |
| `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs` | **Adapter — pure parser.** Validates and normalizes `nfc/locations.yml`. |
| `backend/src/1_adapters/trigger/parsers/nfcTagsParser.mjs` | **Adapter — pure parser.** Validates `nfc/tags.yml`. Implements the scalar-vs-object disambiguation rule. Cross-references reader IDs from locations parser. |
| `backend/src/1_adapters/trigger/parsers/stateLocationsParser.mjs` | **Adapter — pure parser.** Validates and normalizes `state/locations.yml`. |
| `backend/src/2_domains/trigger/services/NfcResolver.mjs` | **Domain service.** Stateless class with `static resolve(...)`. Universal tag lookup + per-reader override merging + shorthand expansion. |
| `backend/src/2_domains/trigger/services/StateResolver.mjs` | **Domain service.** `static resolve(...)` — location-scoped state-value lookup. |
| `backend/src/2_domains/trigger/services/ResolverRegistry.mjs` | **Domain service.** `static resolve({modality, ...})` — dispatches to per-modality resolver. Throws `UnknownModalityError`. |
| `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs` | Tests parser composition + cross-reference behavior. |
| `tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs` | Tests location schema, defaults inheritance, validation errors. |
| `tests/isolated/adapter/trigger/parsers/nfcTagsParser.test.mjs` | Tests universal tags, per-reader override blocks, scalar/object disambiguation, unknown-reader rejection. |
| `tests/isolated/adapter/trigger/parsers/stateLocationsParser.test.mjs` | Tests state schema. |
| `tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs` | Tests the I/O wrapper with an injected fake loadFile. |
| `tests/isolated/domain/trigger/services/NfcResolver.test.mjs` | Tests merge precedence (reader-default → tag-global → tag[reader]), shorthand expansion. |
| `tests/isolated/domain/trigger/services/StateResolver.test.mjs` | Tests state-value lookup. |
| `tests/isolated/domain/trigger/services/ResolverRegistry.test.mjs` | Tests modality dispatch + unknown-modality error. |
| `docs/reference/trigger/schema.md` | New — single-page schema reference (per-modality YAML, precedence chain, reserved keys, scalar-vs-object rule). |

**Modified files:**

| Path | What changes |
|---|---|
| `backend/src/2_domains/trigger/TriggerConfig.mjs` | Deleted. Re-exported as a thin shim that throws "moved to loadTriggerConfig" only if anything still imports it (nothing should after Task 14). Actually deleted in Task 14. |
| `backend/src/2_domains/trigger/TriggerIntent.mjs` | Old `resolveIntent` moves into `nfcResolver`. The `RESERVED_KEYS` constant moves alongside. File deleted in Task 14 if no other imports remain. |
| `backend/src/3_applications/trigger/TriggerDispatchService.mjs` | Reads the new unified registry shape. Delegates resolution to `resolverRegistry` instead of importing `resolveIntent` directly. Lookup paths change from `config[location].entries[modality][value]` to `config[modality]` + resolver-specific lookup. |
| `backend/src/0_system/bootstrap.mjs:1735-1741` | `parseTriggerConfig(loadFile('config/nfc'))` → `loadTriggerConfig({ rootPath, contentIdResolver })`. |
| `tests/isolated/domains/trigger/TriggerConfig.test.mjs` | Deleted (parser tests now live under `parsers/`). |
| `tests/isolated/domains/trigger/TriggerIntent.test.mjs` | Deleted or moved into resolver tests. |
| `tests/isolated/applications/trigger/TriggerDispatchService.test.mjs` | Update fixtures to the new registry shape. |
| `tests/isolated/applications/trigger/actionHandlers.test.mjs` | No change — `actionHandlers` consumes resolved intents, which keep the same `{ action, target, content, params, ... }` shape. |
| `docs/reference/trigger/events.md` | Replace YAML examples with new modality-rooted shape; update §"Files" section to reference new modules. |
| `docs/reference/trigger-endpoint.md` | Refresh embedded YAML examples; add note that locations are now per-modality. |

**Deleted files (during migration):**

| Path | Reason |
|---|---|
| `data/household/config/nfc.yml` | Replaced by `triggers/` tree. |
| `data/household/config/nfc.yml.bak-20260425-151147` | Stale backup. |
| `data/household/config/nfc.yml.bak-20260425-162314` | Stale backup. |
| `data/household/config/nfc (kckern-server's conflicted copy 2026-04-24).yml` | Conflicted copy from F7 audit finding. |

---

## Test commands cheat-sheet

- **Single isolated test file:** `npx vitest run tests/isolated/path/to/file.test.mjs`
- **All trigger isolated tests:** `npx vitest run tests/isolated/domains/trigger tests/isolated/applications/trigger`
- **Full isolated suite (smoke before commit):** `npx vitest run tests/isolated/ 2>&1 | tail -20`
- **Single test by name:** `npx vitest run -t 'parses universal tag with per-reader override'`
- **Backend boot smoke (no test runner — just verify the module loads):** `node -e "import('./backend/src/2_domains/trigger/loadTriggerConfig.mjs').then(m => console.log(Object.keys(m)))"`

---

## Pre-flight

### Task 0: Create worktree + capture baseline

**Files:** none (env setup)

- [ ] **Step 0.1: Create the worktree**

```bash
cd /opt/Code/DaylightStation
git worktree add ../DaylightStation-trigger-modality -b feat/trigger-modality-architecture main
cd ../DaylightStation-trigger-modality
```

Expected: new worktree path, branch `feat/trigger-modality-architecture` checked out from `main`.

- [ ] **Step 0.2: Capture baseline test result for the trigger suite**

```bash
npx vitest run tests/isolated/domains/trigger tests/isolated/applications/trigger 2>&1 | tail -10
```

Record the pass count. Expected today (2026-04-26 baseline): all green. Save the headline `Tests N passed` line — we'll re-check at the end (including the new `tests/isolated/adapter/trigger/` path created in later tasks) and any net delta is suspect.

- [ ] **Step 0.3: Confirm node_modules is reachable in the worktree**

```bash
ls node_modules/.bin/vitest >/dev/null && echo OK || echo "Symlink node_modules: ln -s ../DaylightStation/node_modules node_modules"
```

If missing, run the symlink command. (No-op if `npm install` already happened in this worktree.)

---

## Phase 1 — Data migration (new YAML files)

### Task 1: Create new trigger YAML files

**Files:**
- Create: `data/household/config/triggers/nfc/locations.yml`
- Create: `data/household/config/triggers/nfc/tags.yml`
- Create: `data/household/config/triggers/state/locations.yml`

These files are written into the **prod data volume** (the container mount). The `claude` user can't write directly — use `sudo docker exec daylight-station sh -c` heredocs.

- [ ] **Step 1.1: Confirm current `nfc.yml` content (sanity check before rewrite)**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/nfc.yml'
```

Expected:
```yaml
livingroom:
  target: livingroom-tv
  action: play-next
  tags:
    83_8e_68_06:
      plex: 620707
    8d_6d_2a_07:
      plex: 620707
  states:
    off:
      action: clear
```

If the content differs, STOP and reconcile with the user — the migration content below assumes this shape.

- [ ] **Step 1.2: Create the directory tree**

```bash
sudo docker exec daylight-station sh -c 'mkdir -p data/household/config/triggers/nfc data/household/config/triggers/state'
```

Verify:
```bash
sudo docker exec daylight-station sh -c 'ls -la data/household/config/triggers/'
```
Expected: two subdirs `nfc/` and `state/`.

- [ ] **Step 1.3: Write `triggers/nfc/locations.yml`**

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/triggers/nfc/locations.yml << 'EOF'
# NFC reader locations + per-reader defaults.
# Defaults inherit into every tag scanned at this reader unless the tag
# (or a per-reader block on the tag) overrides them.
livingroom:
  target: livingroom-tv
  action: play-next
EOF"
```

Verify: `sudo docker exec daylight-station sh -c 'cat data/household/config/triggers/nfc/locations.yml'`

- [ ] **Step 1.4: Write `triggers/nfc/tags.yml`**

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/triggers/nfc/tags.yml << 'EOF'
# Universal tag registry. UID -> content + optional overrides.
# Top-level scalar values are tag-global (apply at any reader).
# Top-level object values whose key matches a reader ID in nfc/locations.yml
# are per-reader override blocks (apply only when scanned at that reader).
83_8e_68_06:
  plex: 620707
8d_6d_2a_07:
  plex: 620707
EOF"
```

Verify: `sudo docker exec daylight-station sh -c 'cat data/household/config/triggers/nfc/tags.yml'`

- [ ] **Step 1.5: Write `triggers/state/locations.yml`**

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/triggers/state/locations.yml << 'EOF'
# State-source locations. Each location declares the target device that
# state-change actions should fire against, plus a states map keyed by
# the state value (e.g. 'off', 'on') -> action override block.
livingroom:
  target: livingroom-tv
  states:
    off:
      action: clear
EOF"
```

Verify: `sudo docker exec daylight-station sh -c 'cat data/household/config/triggers/state/locations.yml'`

- [ ] **Step 1.6: Do NOT delete `nfc.yml` yet**

The new files are now sitting alongside the old. Bootstrap still reads `nfc.yml` until Task 11. The old file is the safety net while the new code lands. Deletion happens in Task 13.

- [ ] **Step 1.7: Commit**

This task touches data on prod, not source. The data dir is already gitignored. Skip the git commit for this task — but do `cd` back to the worktree and confirm `git status` shows clean tree before proceeding.

```bash
cd /opt/Code/DaylightStation-trigger-modality
git status
```

Expected: `nothing to commit, working tree clean`.

---

## Phase 2 — Domain layer parsers

### Task 2: Implement `nfcLocationsParser` (TDD) — adapter layer

**Files:**
- Create: `tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs`
- Create: `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs`

**Layer note:** parsers know YAML structure → adapter layer (per `domain-layer-guidelines.md`).

- [ ] **Step 2.1: Write the failing test**

Create `tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseNfcLocations } from '#adapters/trigger/parsers/nfcLocationsParser.mjs';

describe('parseNfcLocations', () => {
  it('returns empty for null/undefined/empty input', () => {
    expect(parseNfcLocations(null)).toEqual({});
    expect(parseNfcLocations(undefined)).toEqual({});
    expect(parseNfcLocations({})).toEqual({});
  });

  it('parses a minimal location with target+action', () => {
    const result = parseNfcLocations({
      livingroom: { target: 'livingroom-tv', action: 'play-next' },
    });
    expect(result.livingroom).toEqual({
      target: 'livingroom-tv',
      action: 'play-next',
      auth_token: null,
      defaults: {},
    });
  });

  it('separates reserved fields (target/action/auth_token) from defaults', () => {
    const result = parseNfcLocations({
      bedroom: {
        target: 'bedroom-tv',
        action: 'play-next',
        auth_token: 'secret',
        shader: 'blackout',
        volume: 8,
      },
    });
    expect(result.bedroom.target).toBe('bedroom-tv');
    expect(result.bedroom.action).toBe('play-next');
    expect(result.bedroom.auth_token).toBe('secret');
    expect(result.bedroom.defaults).toEqual({ shader: 'blackout', volume: 8 });
  });

  it('throws when location is not an object', () => {
    expect(() => parseNfcLocations({ livingroom: 'oops' }))
      .toThrow(/location "livingroom".*object/i);
  });

  it('throws when location has no target', () => {
    expect(() => parseNfcLocations({ livingroom: { action: 'play' } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('throws when target is not a non-empty string', () => {
    expect(() => parseNfcLocations({ livingroom: { target: '' } }))
      .toThrow(/location "livingroom".*target/i);
    expect(() => parseNfcLocations({ livingroom: { target: 123 } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('defaults auth_token to null when omitted', () => {
    const result = parseNfcLocations({
      kitchen: { target: 'kitchen-display', action: 'open' },
    });
    expect(result.kitchen.auth_token).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run the test, expect FAIL**

```bash
npx vitest run tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs
```

Expected: FAIL with "Cannot find module '#adapters/trigger/parsers/nfcLocationsParser.mjs'".

- [ ] **Step 2.3: Implement the parser**

Create `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs`:

```javascript
/**
 * Parser for triggers/nfc/locations.yml. Each top-level key is an NFC reader
 * location ID. Reserved fields (target, action, auth_token) are extracted as
 * first-class config; all other top-level keys become the location's `defaults`
 * object, which inherits into every tag scanned at this reader.
 *
 * Layer: ADAPTER (1_adapters/trigger). Knows YAML key shape — that's storage-
 * format knowledge per domain-layer-guidelines.md.
 *
 * Output shape:
 *   { [locationId]: { target, action, auth_token, defaults: { ...rest } } }
 *
 * @module adapters/trigger/parsers/nfcLocationsParser
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const RESERVED = new Set(['target', 'action', 'auth_token']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseNfcLocations(raw) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('nfc/locations.yml root must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }

  const out = {};
  for (const [locationId, locConfig] of Object.entries(raw)) {
    if (!isPlainObject(locConfig)) {
      throw new ValidationError(`location "${locationId}" must be an object`, { code: 'INVALID_LOCATION', field: locationId });
    }
    if (typeof locConfig.target !== 'string' || locConfig.target.length === 0) {
      throw new ValidationError(`location "${locationId}" must declare a target device (non-empty string)`, { code: 'MISSING_TARGET', field: locationId });
    }

    const defaults = {};
    for (const [k, v] of Object.entries(locConfig)) {
      if (RESERVED.has(k)) continue;
      defaults[k] = v;
    }

    out[locationId] = {
      target: locConfig.target,
      action: locConfig.action,
      auth_token: locConfig.auth_token ?? null,
      defaults,
    };
  }

  return out;
}

export default parseNfcLocations;
```

- [ ] **Step 2.4: Run tests, expect PASS**

```bash
npx vitest run tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs
```

Expected: PASS (all 7 tests).

- [ ] **Step 2.5: Commit**

```bash
git add tests/isolated/adapter/trigger/parsers/nfcLocationsParser.test.mjs \
        backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs
git commit -m "feat(trigger): add nfcLocationsParser adapter for triggers/nfc/locations.yml"
```

---

### Task 3: Implement `nfcTagsParser` (TDD — universal tags + reader-override blocks) — adapter layer

**Files:**
- Create: `tests/isolated/adapter/trigger/parsers/nfcTagsParser.test.mjs`
- Create: `backend/src/1_adapters/trigger/parsers/nfcTagsParser.mjs`

- [ ] **Step 3.1: Write the failing test**

Create `tests/isolated/adapter/trigger/parsers/nfcTagsParser.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseNfcTags } from '#adapters/trigger/parsers/nfcTagsParser.mjs';

const KNOWN_READERS = new Set(['livingroom', 'bedroom', 'kitchen']);

describe('parseNfcTags', () => {
  it('returns empty for null/undefined/empty input', () => {
    expect(parseNfcTags(null, KNOWN_READERS)).toEqual({});
    expect(parseNfcTags(undefined, KNOWN_READERS)).toEqual({});
    expect(parseNfcTags({}, KNOWN_READERS)).toEqual({});
  });

  it('parses a minimal tag with content shorthand', () => {
    const result = parseNfcTags({
      '83_8e_68_06': { plex: 620707 },
    }, KNOWN_READERS);
    expect(result['83_8e_68_06']).toEqual({
      global: { plex: 620707 },
      overrides: {},
    });
  });

  it('lowercases the tag UID', () => {
    const result = parseNfcTags({
      '83_8E_68_06': { plex: 620707 },
    }, KNOWN_READERS);
    expect(result['83_8e_68_06']).toBeDefined();
    expect(result['83_8E_68_06']).toBeUndefined();
  });

  it('separates tag-global scalar fields from per-reader override blocks', () => {
    const result = parseNfcTags({
      'aa_bb_cc_dd': {
        plex: 100,
        shader: 'default',     // scalar -> tag-global
        volume: 10,            // scalar -> tag-global
        livingroom: {          // object + matches reader ID -> override block
          shader: 'blackout',
        },
        bedroom: {             // another override block
          shader: 'night',
          volume: 5,
        },
      },
    }, KNOWN_READERS);
    expect(result['aa_bb_cc_dd'].global).toEqual({ plex: 100, shader: 'default', volume: 10 });
    expect(result['aa_bb_cc_dd'].overrides).toEqual({
      livingroom: { shader: 'blackout' },
      bedroom: { shader: 'night', volume: 5 },
    });
  });

  it('throws when an object-valued key does not match a known reader', () => {
    expect(() => parseNfcTags({
      'aa_bb': {
        plex: 1,
        livingrm: { shader: 'blackout' },   // typo!
      },
    }, KNOWN_READERS))
      .toThrow(/tag "aa_bb".*reader-override.*"livingrm".*not registered/i);
  });

  it('accepts an object-valued field whose key matches a known reader (override block)', () => {
    expect(() => parseNfcTags({
      'aa_bb': {
        plex: 1,
        livingroom: { shader: 'blackout' },
      },
    }, KNOWN_READERS)).not.toThrow();
  });

  it('throws when tag entry is not an object', () => {
    expect(() => parseNfcTags({ 'aa_bb': 'oops' }, KNOWN_READERS))
      .toThrow(/tag "aa_bb".*object/i);
  });

  it('treats null override block as empty (graceful)', () => {
    const result = parseNfcTags({
      'aa_bb': {
        plex: 1,
        livingroom: null,
      },
    }, KNOWN_READERS);
    // null should be treated as a scalar tag-global field (degenerate but valid)
    expect(result['aa_bb'].global).toEqual({ plex: 1, livingroom: null });
    expect(result['aa_bb'].overrides).toEqual({});
  });

  it('ignores arrays as tag-global scalars (rejects as override blocks)', () => {
    // Arrays are not plain objects; they go into global like other scalars.
    const result = parseNfcTags({
      'aa_bb': {
        plex: 1,
        tags: ['x', 'y'],   // array -> goes into global
      },
    }, KNOWN_READERS);
    expect(result['aa_bb'].global).toEqual({ plex: 1, tags: ['x', 'y'] });
  });
});
```

- [ ] **Step 3.2: Run the test, expect FAIL**

```bash
npx vitest run tests/isolated/adapter/trigger/parsers/nfcTagsParser.test.mjs
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3.3: Implement the parser**

Create `backend/src/1_adapters/trigger/parsers/nfcTagsParser.mjs`:

```javascript
/**
 * Parser for triggers/nfc/tags.yml. Tags are universal — defined once and
 * recognized at any NFC reader. The disambiguation rule for a tag's top-level
 * keys: scalar values (or arrays) are tag-global fields; object values are
 * per-reader override blocks and the key MUST match a registered reader ID
 * (passed in as `knownReaders`). Unknown reader-id object keys throw —
 * this catches typos like `livingrm` instead of `livingroom`.
 *
 * Layer: ADAPTER (1_adapters/trigger).
 *
 * Output shape:
 *   {
 *     [tagUid]: {
 *       global: { ...tagGlobalFields },
 *       overrides: { [readerId]: { ...overrideFields } }
 *     }
 *   }
 *
 * @module adapters/trigger/parsers/nfcTagsParser
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseNfcTags(raw, knownReaders) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('nfc/tags.yml root must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }
  if (!(knownReaders instanceof Set)) {
    throw new ValidationError('parseNfcTags requires a Set of known reader IDs', { code: 'INVALID_KNOWN_READERS' });
  }

  const out = {};
  for (const [rawUid, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      throw new ValidationError(`tag "${rawUid}" must be an object`, { code: 'INVALID_TAG', field: rawUid });
    }
    const uid = rawUid.toLowerCase();
    const global = {};
    const overrides = {};
    for (const [k, v] of Object.entries(entry)) {
      if (isPlainObject(v)) {
        // Object value -> reader-override block. Key MUST be a registered reader.
        if (!knownReaders.has(k)) {
          throw new ValidationError(
            `tag "${rawUid}": reader-override block "${k}" is not a registered reader (known: ${[...knownReaders].join(', ') || 'none'})`,
            { code: 'UNKNOWN_READER_OVERRIDE', field: rawUid, override: k }
          );
        }
        overrides[k] = v;
      } else {
        // Scalar (or array, or null) -> tag-global field.
        global[k] = v;
      }
    }
    out[uid] = { global, overrides };
  }
  return out;
}

export default parseNfcTags;
```

- [ ] **Step 3.4: Run tests, expect PASS**

```bash
npx vitest run tests/isolated/adapter/trigger/parsers/nfcTagsParser.test.mjs
```

Expected: PASS (all 9 tests).

- [ ] **Step 3.5: Commit**

```bash
git add tests/isolated/adapter/trigger/parsers/nfcTagsParser.test.mjs \
        backend/src/1_adapters/trigger/parsers/nfcTagsParser.mjs
git commit -m "feat(trigger): add nfcTagsParser adapter with scalar/object disambiguation for reader overrides"
```

---

### Task 4: Implement `stateLocationsParser` (TDD) — adapter layer

**Files:**
- Create: `tests/isolated/adapter/trigger/parsers/stateLocationsParser.test.mjs`
- Create: `backend/src/1_adapters/trigger/parsers/stateLocationsParser.mjs`

- [ ] **Step 4.1: Write the failing test**

Create `tests/isolated/adapter/trigger/parsers/stateLocationsParser.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseStateLocations } from '#adapters/trigger/parsers/stateLocationsParser.mjs';

describe('parseStateLocations', () => {
  it('returns empty for null/undefined/empty input', () => {
    expect(parseStateLocations(null)).toEqual({});
    expect(parseStateLocations(undefined)).toEqual({});
    expect(parseStateLocations({})).toEqual({});
  });

  it('parses a location with state mappings', () => {
    const result = parseStateLocations({
      livingroom: {
        target: 'livingroom-tv',
        states: {
          off: { action: 'clear' },
          on: { action: 'play', queue: 'ambient' },
        },
      },
    });
    expect(result.livingroom).toEqual({
      target: 'livingroom-tv',
      auth_token: null,
      states: {
        off: { action: 'clear' },
        on: { action: 'play', queue: 'ambient' },
      },
    });
  });

  it('lowercases state values for lookup', () => {
    const result = parseStateLocations({
      livingroom: { target: 'tv', states: { OFF: { action: 'clear' } } },
    });
    expect(result.livingroom.states.off).toEqual({ action: 'clear' });
    expect(result.livingroom.states.OFF).toBeUndefined();
  });

  it('preserves auth_token when set', () => {
    const result = parseStateLocations({
      livingroom: { target: 'tv', auth_token: 'secret', states: {} },
    });
    expect(result.livingroom.auth_token).toBe('secret');
  });

  it('throws when location has no target', () => {
    expect(() => parseStateLocations({ livingroom: { states: {} } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('throws when states is not an object', () => {
    expect(() => parseStateLocations({
      livingroom: { target: 'tv', states: 'oops' },
    })).toThrow(/states.*object/i);
  });

  it('throws when a state entry is not an object', () => {
    expect(() => parseStateLocations({
      livingroom: { target: 'tv', states: { off: 'oops' } },
    })).toThrow(/state "off".*object/i);
  });

  it('treats missing states block as empty', () => {
    const result = parseStateLocations({
      kitchen: { target: 'kitchen-display' },
    });
    expect(result.kitchen.states).toEqual({});
  });
});
```

- [ ] **Step 4.2: Run the test, expect FAIL**

```bash
npx vitest run tests/isolated/adapter/trigger/parsers/stateLocationsParser.test.mjs
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 4.3: Implement the parser**

Create `backend/src/1_adapters/trigger/parsers/stateLocationsParser.mjs`:

```javascript
/**
 * Parser for triggers/state/locations.yml. State events are inherently
 * location-bound (entity_id is owned by a specific location), so the data
 * lives per-location with no separate registry. The `states` map is keyed by
 * the state value (lowercased) -> action override block.
 *
 * Layer: ADAPTER (1_adapters/trigger).
 *
 * Output shape:
 *   { [locationId]: { target, auth_token, states: { [stateValue]: <entry> } } }
 *
 * @module adapters/trigger/parsers/stateLocationsParser
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseStateLocations(raw) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('state/locations.yml root must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }

  const out = {};
  for (const [locationId, locConfig] of Object.entries(raw)) {
    if (!isPlainObject(locConfig)) {
      throw new ValidationError(`location "${locationId}" must be an object`, { code: 'INVALID_LOCATION', field: locationId });
    }
    if (typeof locConfig.target !== 'string' || locConfig.target.length === 0) {
      throw new ValidationError(`location "${locationId}" must declare a target device (non-empty string)`, { code: 'MISSING_TARGET', field: locationId });
    }

    const states = {};
    if (locConfig.states !== undefined) {
      if (!isPlainObject(locConfig.states)) {
        throw new ValidationError(`location "${locationId}" states must be an object`, { code: 'INVALID_STATES', field: locationId });
      }
      for (const [value, entry] of Object.entries(locConfig.states)) {
        if (!isPlainObject(entry)) {
          throw new ValidationError(`state "${value}" must be an object`, { code: 'INVALID_STATE_ENTRY', field: value });
        }
        states[value.toLowerCase()] = entry;
      }
    }

    out[locationId] = {
      target: locConfig.target,
      auth_token: locConfig.auth_token ?? null,
      states,
    };
  }

  return out;
}

export default parseStateLocations;
```

- [ ] **Step 4.4: Run tests, expect PASS**

```bash
npx vitest run tests/isolated/adapter/trigger/parsers/stateLocationsParser.test.mjs
```

Expected: PASS (all 8 tests).

- [ ] **Step 4.5: Commit**

```bash
git add tests/isolated/adapter/trigger/parsers/stateLocationsParser.test.mjs \
        backend/src/1_adapters/trigger/parsers/stateLocationsParser.mjs
git commit -m "feat(trigger): add stateLocationsParser adapter for triggers/state/locations.yml"
```

---

### Task 5: Implement `buildTriggerRegistry` assembler (TDD) — adapter layer

**Files:**
- Create: `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs`
- Create: `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs`

**Layer note:** still adapter — composes parser outputs into the unified shape, no I/O. Lives next to its parser dependencies. Task 5b wraps this in a Repository class with the I/O boundary.

- [ ] **Step 5.1: Write the failing test**

The orchestrator's job: take raw YAML blobs (already loaded from disk by the I/O wrapper) and produce a unified registry. Pure function (no FS) — passes blobs through.

Create `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildTriggerRegistry } from '#adapters/trigger/parsers/buildTriggerRegistry.mjs';

describe('buildTriggerRegistry', () => {
  it('returns empty registry when no blobs supplied', () => {
    const result = buildTriggerRegistry({});
    expect(result).toEqual({ nfc: { locations: {}, tags: {} }, state: { locations: {} } });
  });

  it('builds a complete registry from all three blobs', () => {
    const result = buildTriggerRegistry({
      nfcLocations: { livingroom: { target: 'livingroom-tv', action: 'play-next' } },
      nfcTags: { '83_8e_68_06': { plex: 620707 } },
      stateLocations: { livingroom: { target: 'livingroom-tv', states: { off: { action: 'clear' } } } },
    });
    expect(result.nfc.locations.livingroom.target).toBe('livingroom-tv');
    expect(result.nfc.tags['83_8e_68_06'].global).toEqual({ plex: 620707 });
    expect(result.state.locations.livingroom.states.off).toEqual({ action: 'clear' });
  });

  it('passes the set of NFC reader IDs to the tags parser', () => {
    // This test catches the cross-reference: tags need to know which keys are
    // valid reader IDs for the override-block disambiguation.
    expect(() => buildTriggerRegistry({
      nfcLocations: { livingroom: { target: 'tv' } },
      nfcTags: {
        'aa_bb': {
          plex: 1,
          livingrm: { shader: 'x' },  // typo
        },
      },
    })).toThrow(/livingrm.*not registered/i);
  });

  it('parses tags successfully when the override key matches a registered reader', () => {
    const result = buildTriggerRegistry({
      nfcLocations: { livingroom: { target: 'tv' } },
      nfcTags: {
        'aa_bb': {
          plex: 1,
          livingroom: { shader: 'blackout' },
        },
      },
    });
    expect(result.nfc.tags['aa_bb'].overrides.livingroom).toEqual({ shader: 'blackout' });
  });

  it('handles the case where nfcTags is non-empty but nfcLocations is empty (no readers)', () => {
    // Edge case: a tag exists but no readers are configured. Tag without
    // overrides is fine; tag with any object-valued field would throw.
    const result = buildTriggerRegistry({
      nfcTags: { 'aa_bb': { plex: 1 } },
    });
    expect(result.nfc.tags['aa_bb'].global).toEqual({ plex: 1 });
  });
});
```

- [ ] **Step 5.2: Run the test, expect FAIL**

```bash
npx vitest run tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 5.3: Implement the assembler**

Create `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs`:

```javascript
/**
 * Trigger config assembler. Combines per-modality parsers into a unified
 * in-memory registry consumed by TriggerDispatchService.
 *
 * Layer: ADAPTER (1_adapters/trigger). Pure function (no FS) — the I/O
 * boundary lives in YamlTriggerConfigRepository. This file is split out so
 * the assembly logic is independently testable without filesystem mocking.
 *
 * Output shape:
 *   {
 *     nfc:   { locations: { ... }, tags: { ... } },
 *     state: { locations: { ... } }
 *   }
 *
 * @module adapters/trigger/parsers/buildTriggerRegistry
 */

import { parseNfcLocations } from './nfcLocationsParser.mjs';
import { parseNfcTags } from './nfcTagsParser.mjs';
import { parseStateLocations } from './stateLocationsParser.mjs';

/**
 * @param {Object} blobs
 * @param {Object} [blobs.nfcLocations]   raw YAML object from triggers/nfc/locations.yml
 * @param {Object} [blobs.nfcTags]        raw YAML object from triggers/nfc/tags.yml
 * @param {Object} [blobs.stateLocations] raw YAML object from triggers/state/locations.yml
 * @returns {{ nfc: { locations, tags }, state: { locations } }}
 */
export function buildTriggerRegistry(blobs = {}) {
  const nfcLocations = parseNfcLocations(blobs.nfcLocations);
  const knownNfcReaders = new Set(Object.keys(nfcLocations));
  const nfcTags = parseNfcTags(blobs.nfcTags, knownNfcReaders);
  const stateLocations = parseStateLocations(blobs.stateLocations);

  return {
    nfc: { locations: nfcLocations, tags: nfcTags },
    state: { locations: stateLocations },
  };
}

export default buildTriggerRegistry;
```

- [ ] **Step 5.4: Run tests, expect PASS**

```bash
npx vitest run tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs
```

Expected: PASS (all 5 tests).

- [ ] **Step 5.5: Commit**

```bash
git add tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs \
        backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs
git commit -m "feat(trigger): add buildTriggerRegistry assembler combining per-modality parsers"
```

---

### Task 5b: Implement `YamlTriggerConfigRepository` (TDD) — adapter I/O wrapper

**Files:**
- Create: `tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs`
- Create: `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs`

This is the public adapter entry that bootstrap calls. It owns the I/O boundary (calling `loadFile` for each YAML path) and delegates assembly to `buildTriggerRegistry`.

- [ ] **Step 5b.1: Write the failing test**

Create `tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';

describe('YamlTriggerConfigRepository', () => {
  it('reads three YAML paths via injected loadFile and returns the registry', () => {
    const blobs = {
      'config/triggers/nfc/locations': { livingroom: { target: 'livingroom-tv', action: 'play-next' } },
      'config/triggers/nfc/tags': { '83_8e_68_06': { plex: 620707 } },
      'config/triggers/state/locations': { livingroom: { target: 'livingroom-tv', states: { off: { action: 'clear' } } } },
    };
    const loadFile = vi.fn((p) => blobs[p] ?? null);

    const repo = new YamlTriggerConfigRepository();
    const registry = repo.loadRegistry({ loadFile });

    expect(loadFile).toHaveBeenCalledWith('config/triggers/nfc/locations');
    expect(loadFile).toHaveBeenCalledWith('config/triggers/nfc/tags');
    expect(loadFile).toHaveBeenCalledWith('config/triggers/state/locations');
    expect(registry.nfc.locations.livingroom.target).toBe('livingroom-tv');
    expect(registry.nfc.tags['83_8e_68_06'].global).toEqual({ plex: 620707 });
    expect(registry.state.locations.livingroom.states.off).toEqual({ action: 'clear' });
  });

  it('returns an empty-shape registry when all files are missing', () => {
    const loadFile = () => null;
    const repo = new YamlTriggerConfigRepository();
    expect(repo.loadRegistry({ loadFile })).toEqual({
      nfc: { locations: {}, tags: {} },
      state: { locations: {} },
    });
  });

  it('throws ValidationError when a parser rejects the YAML (does not swallow)', () => {
    const loadFile = (p) => p === 'config/triggers/nfc/locations'
      ? { livingroom: 'oops' }   // invalid: location must be an object
      : null;
    const repo = new YamlTriggerConfigRepository();
    expect(() => repo.loadRegistry({ loadFile })).toThrow(/location "livingroom".*object/i);
  });
});
```

- [ ] **Step 5b.2: Run the test, expect FAIL**

```bash
npx vitest run tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 5b.3: Implement the repository**

Create `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs`:

```javascript
/**
 * YAML-backed trigger config repository. Public adapter entry — bootstrap
 * calls this. Owns the I/O boundary; delegates schema validation and
 * registry assembly to the parsers module.
 *
 * Layer: ADAPTER (1_adapters/trigger). The dependency-injected `loadFile`
 * helper handles YAML file resolution + parsing (already provided by app.mjs);
 * this class only knows the file-path layout.
 *
 * @module adapters/trigger/YamlTriggerConfigRepository
 */

import { buildTriggerRegistry } from './parsers/buildTriggerRegistry.mjs';

const PATHS = {
  nfcLocations: 'config/triggers/nfc/locations',
  nfcTags: 'config/triggers/nfc/tags',
  stateLocations: 'config/triggers/state/locations',
};

export class YamlTriggerConfigRepository {
  /**
   * Load all per-modality YAML blobs and assemble the unified trigger registry.
   *
   * @param {Object} args
   * @param {(relativePath: string) => Object|null} args.loadFile  — injected helper
   *   that loads a YAML file relative to the household dir, returning the parsed
   *   object or null if the file is missing.
   * @returns {Object} unified registry: { nfc: { locations, tags }, state: { locations } }
   * @throws {ValidationError} if any YAML is malformed.
   */
  loadRegistry({ loadFile }) {
    const blobs = {
      nfcLocations: loadFile(PATHS.nfcLocations),
      nfcTags: loadFile(PATHS.nfcTags),
      stateLocations: loadFile(PATHS.stateLocations),
    };
    return buildTriggerRegistry(blobs);
  }
}

export default YamlTriggerConfigRepository;
```

- [ ] **Step 5b.4: Run tests, expect PASS**

```bash
npx vitest run tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs
```

Expected: PASS (all 3 tests).

- [ ] **Step 5b.5: Commit**

```bash
git add tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs \
        backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs
git commit -m "feat(trigger): add YamlTriggerConfigRepository as adapter I/O entry"
```

---

## Phase 3 — Domain layer resolvers (services)

### Task 6: Implement `NfcResolver` (TDD) — domain service

**Files:**
- Create: `tests/isolated/domain/trigger/services/NfcResolver.test.mjs`
- Create: `backend/src/2_domains/trigger/services/NfcResolver.mjs`

**Layer note:** stateless cross-entity logic (combines reader-config + tag-config to produce an intent). No I/O, no YAML knowledge. Domain service per `domain-layer-guidelines.md`. Implemented as a class with a `static resolve(...)` method following the `ZoneService` example.

This is the most semantically important resolver. It does:
1. Universal tag lookup in `nfcRegistry.tags[uid]`.
2. Reader-defaults lookup in `nfcRegistry.locations[location].defaults`.
3. Merge: `{ ...readerDefaults, ...tagGlobal, ...tagOverridesForLocation }`.
4. Build the resolved entry shape (`action`, `target`, `content`, `params`) using shorthand expansion (logic moved from the deleted `TriggerIntent.mjs`).

- [ ] **Step 6.1: Write the failing test**

Create `tests/isolated/domain/trigger/services/NfcResolver.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { NfcResolver } from '#domains/trigger/services/NfcResolver.mjs';

const makeContentIdResolver = () => ({
  resolve: (compound) => compound.startsWith('plex:') ? compound : null,
});

const baseRegistry = {
  locations: {
    livingroom: {
      target: 'livingroom-tv',
      action: 'play-next',
      auth_token: null,
      defaults: { shader: 'default', volume: 15 },
    },
    bedroom: {
      target: 'bedroom-tv',
      action: 'play-next',
      auth_token: null,
      defaults: { shader: 'blackout', volume: 8 },
    },
  },
  tags: {
    '83_8e_68_06': { global: { plex: 620707 }, overrides: {} },
    'aa_bb': {
      global: { plex: 100, shader: 'focused' },
      overrides: {
        bedroom: { shader: 'night', volume: 5 },
      },
    },
  },
};

describe('NfcResolver', () => {
  const contentIdResolver = makeContentIdResolver();

  it('returns null when location is not registered', () => {
    const result = NfcResolver.resolve({
      location: 'unknown',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result).toBeNull();
  });

  it('returns null when tag UID is not registered', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'unknown_tag',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result).toBeNull();
  });

  it('produces an intent for a minimal tag using reader defaults', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '83_8e_68_06',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result).toEqual({
      action: 'play-next',
      target: 'livingroom-tv',
      content: 'plex:620707',
      params: { shader: 'default', volume: 15 },
    });
  });

  it('merges reader-defaults < tag-global, with tag-global winning on collision', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.shader).toBe('focused');
    expect(result.params.volume).toBe(15);
  });

  it('merges reader-defaults < tag-global < tag-override-for-location, with override winning', () => {
    const result = NfcResolver.resolve({
      location: 'bedroom',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.shader).toBe('night');
    expect(result.params.volume).toBe(5);
    expect(result.target).toBe('bedroom-tv');
  });

  it('does not apply overrides for other locations', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.shader).toBe('focused');
    expect(result.target).toBe('livingroom-tv');
  });

  it('allows tag-global to override action and target', () => {
    const registry = {
      locations: {
        livingroom: { target: 'livingroom-tv', action: 'play-next', defaults: {} },
      },
      tags: {
        'override_tag': {
          global: { plex: 100, action: 'queue', target: 'kitchen-display' },
          overrides: {},
        },
      },
    };
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'override_tag',
      registry,
      contentIdResolver,
    });
    expect(result.action).toBe('queue');
    expect(result.target).toBe('kitchen-display');
  });

  it('lowercases the input value before lookup', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '83_8E_68_06',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result?.content).toBe('plex:620707');
  });

  it('throws when shorthand expansion finds multiple resolvable content prefixes', () => {
    const registry = {
      locations: { livingroom: { target: 'tv', action: 'play', defaults: {} } },
      tags: {
        'ambiguous': { global: { plex: 1, files: 'x' }, overrides: {} },
      },
    };
    // Both `plex:` and `files:` resolve as content per the contentIdResolver.
    // (See implementation Step 6.3 — only resolvable candidates are flagged ambiguous.)
    const ambiguousResolver = { resolve: (c) => c.startsWith('plex:') || c.startsWith('files:') };
    expect(() => NfcResolver.resolve({
      location: 'livingroom',
      value: 'ambiguous',
      registry,
      contentIdResolver: ambiguousResolver,
    })).toThrow(/shorthand/i);
  });

  it('does not include consumed shorthand key in params', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '83_8e_68_06',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.plex).toBeUndefined();
  });
});
```

- [ ] **Step 6.2: Run the test, expect FAIL**

```bash
npx vitest run tests/isolated/domain/trigger/services/NfcResolver.test.mjs
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 6.3: Implement the resolver**

Create `backend/src/2_domains/trigger/services/NfcResolver.mjs`:

```javascript
/**
 * NFC resolver: turns a (location, tagUid) pair into a resolved trigger
 * intent. Universal tag lookup + reader-default merging + per-reader override
 * + content-shorthand expansion.
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Stateless cross-entity
 * logic per domain-layer-guidelines.md. No I/O, no YAML knowledge — receives
 * already-parsed shapes from the adapter.
 *
 * Precedence (later wins):
 *   reader.defaults  <  tag.global  <  tag.overrides[location]
 *
 * Reserved fields (action, target, content) follow the same chain. Other
 * fields (shader, volume, etc.) flow into intent.params.
 *
 * Returns null if the location or tag is not registered (caller treats
 * missing as TRIGGER_NOT_REGISTERED).
 *
 * Throws ValidationError for malformed entries (e.g., ambiguous shorthand).
 *
 * @module domains/trigger/services/NfcResolver
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const RESERVED_KEYS = new Set([
  'action', 'target', 'content',
  'scene', 'service', 'entity', 'data',
]);

function expandShorthand(merged, contentIdResolver) {
  const candidates = Object.entries(merged).filter(([k]) => !RESERVED_KEYS.has(k));
  // Heuristic: a "shorthand" is a single non-reserved key whose `prefix:value`
  // form is a valid content ID. Multiple non-reserved keys do NOT mean
  // shorthand — they're just regular params unless the user specifically
  // intended one as content. To keep parity with the previous expandShorthand
  // behavior, we still require exactly one candidate. Multiple candidates
  // throw to catch ambiguous configs.
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    // Find which (if any) resolve as content — but for safety we throw if more
    // than one resolves, mirroring the strict behavior of the old resolveIntent.
    const resolvable = candidates.filter(([k, v]) => contentIdResolver?.resolve(`${k}:${v}`));
    if (resolvable.length > 1) {
      throw new ValidationError(
        `ambiguous shorthand: multiple keys (${resolvable.map(([k]) => k).join(', ')}) resolve as content`,
        { code: 'AMBIGUOUS_SHORTHAND' }
      );
    }
    if (resolvable.length === 1) return { compound: `${resolvable[0][0]}:${resolvable[0][1]}`, key: resolvable[0][0] };
    return null;
  }
  const [[prefix, value]] = candidates;
  const compound = `${prefix}:${value}`;
  if (!contentIdResolver?.resolve(compound)) return null;
  return { compound, key: prefix };
}

/**
 * Stateless domain service. Use static method.
 *
 * @class NfcResolver
 * @stateless
 */
export class NfcResolver {
  /**
   * Resolve an (location, tagUid) pair against the NFC registry slice.
   *
   * @param {Object} args
   * @param {string} args.location  reader location ID (e.g. 'livingroom')
   * @param {string} args.value     raw tag UID (case-insensitive)
   * @param {Object} args.registry  the `nfc` slice of the trigger registry: { locations, tags }
   * @param {Object} args.contentIdResolver  has `.resolve(compound)` -> truthy if valid
   * @returns {Object|null} resolved intent { action, target, content, params, ... } or null if not registered
   * @throws {ValidationError} if shorthand expansion is ambiguous
   */
  static resolve({ location, value, registry, contentIdResolver }) {
    const locationConfig = registry?.locations?.[location];
    if (!locationConfig) return null;

    const uid = String(value || '').toLowerCase();
    const tag = registry?.tags?.[uid];
    if (!tag) return null;

    // Merge: readerDefaults < tagGlobal < tagOverridesForLocation
    const merged = {
      ...(locationConfig.defaults || {}),
      ...(tag.global || {}),
      ...(tag.overrides?.[location] || {}),
    };

    // Action and target follow the same chain. Reserved keys can appear in any
    // layer (reader-defaults can NOT today set action/target since those are
    // first-class on the location, but tag-global/tag-overrides can).
    const action = merged.action ?? locationConfig.action;
    const target = merged.target ?? locationConfig.target;

    // Resolve content. Explicit `content` wins; otherwise expand single-prefix shorthand.
    let content = merged.content;
    let consumedKey = null;
    if (!content) {
      const shorthand = expandShorthand(merged, contentIdResolver);
      if (shorthand) {
        content = shorthand.compound;
        consumedKey = shorthand.key;
      }
    }

    // Build params from leftover non-reserved keys.
    const params = {};
    for (const [k, v] of Object.entries(merged)) {
      if (RESERVED_KEYS.has(k)) continue;
      if (k === consumedKey) continue;
      params[k] = v;
    }

    const intent = { action, target, params };
    if (content !== undefined) intent.content = content;
    if (merged.scene !== undefined) intent.scene = merged.scene;
    if (merged.service !== undefined) intent.service = merged.service;
    if (merged.entity !== undefined) intent.entity = merged.entity;
    if (merged.data !== undefined) intent.data = merged.data;

    return intent;
  }
}

export default NfcResolver;
```

- [ ] **Step 6.4: Run tests, expect PASS**

```bash
npx vitest run tests/isolated/domain/trigger/services/NfcResolver.test.mjs
```

Expected: PASS (all 10 tests).

- [ ] **Step 6.5: Commit**

```bash
git add tests/isolated/domain/trigger/services/NfcResolver.test.mjs \
        backend/src/2_domains/trigger/services/NfcResolver.mjs
git commit -m "feat(trigger): add NfcResolver domain service with universal tag lookup + per-reader override merging"
```

---

### Task 7: Implement `StateResolver` (TDD) — domain service

**Files:**
- Create: `tests/isolated/domain/trigger/services/StateResolver.test.mjs`
- Create: `backend/src/2_domains/trigger/services/StateResolver.mjs`

- [ ] **Step 7.1: Write the failing test**

Create `tests/isolated/domain/trigger/services/StateResolver.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { StateResolver } from '#domains/trigger/services/StateResolver.mjs';

const baseRegistry = {
  locations: {
    livingroom: {
      target: 'livingroom-tv',
      auth_token: null,
      states: {
        off: { action: 'clear' },
        on: { action: 'play', queue: 'ambient' },
      },
    },
  },
};

describe('StateResolver', () => {
  it('returns null when location is not registered', () => {
    const result = StateResolver.resolve({ location: 'unknown', value: 'off', registry: baseRegistry });
    expect(result).toBeNull();
  });

  it('returns null when state value is not in the location map', () => {
    const result = StateResolver.resolve({ location: 'livingroom', value: 'glitch', registry: baseRegistry });
    expect(result).toBeNull();
  });

  it('produces an intent with the location target and the state-entry action', () => {
    const result = StateResolver.resolve({ location: 'livingroom', value: 'off', registry: baseRegistry });
    expect(result).toEqual({
      action: 'clear',
      target: 'livingroom-tv',
      params: {},
    });
  });

  it('flows non-reserved state-entry fields into params', () => {
    const result = StateResolver.resolve({ location: 'livingroom', value: 'on', registry: baseRegistry });
    expect(result.action).toBe('play');
    expect(result.target).toBe('livingroom-tv');
    expect(result.params).toEqual({ queue: 'ambient' });
  });

  it('lowercases the input value', () => {
    const result = StateResolver.resolve({ location: 'livingroom', value: 'OFF', registry: baseRegistry });
    expect(result?.action).toBe('clear');
  });

  it('throws when state entry has no action', () => {
    const registry = {
      locations: {
        livingroom: { target: 'tv', states: { off: {} } },
      },
    };
    expect(() => StateResolver.resolve({ location: 'livingroom', value: 'off', registry }))
      .toThrow(/state.*action/i);
  });
});
```

- [ ] **Step 7.2: Run the test, expect FAIL**

```bash
npx vitest run tests/isolated/domain/trigger/services/StateResolver.test.mjs
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 7.3: Implement the resolver**

Create `backend/src/2_domains/trigger/services/StateResolver.mjs`:

```javascript
/**
 * State resolver: looks up a (location, stateValue) pair in the per-location
 * states map and produces a trigger intent. Unlike NFC, there is no universal
 * registry — every state event is location-scoped (the entity_id that emitted
 * it belongs to a single location).
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Stateless cross-entity
 * logic. No I/O, no YAML knowledge.
 *
 * Returns null if the location or state value is not registered.
 *
 * Throws ValidationError if the state entry is malformed (e.g. missing action).
 *
 * @module domains/trigger/services/StateResolver
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const RESERVED_KEYS = new Set(['action', 'target', 'content', 'scene', 'service', 'entity', 'data']);

/**
 * Stateless domain service. Use static method.
 *
 * @class StateResolver
 * @stateless
 */
export class StateResolver {
  /**
   * @param {Object} args
   * @param {string} args.location  state-source location ID
   * @param {string} args.value     raw state value (case-insensitive, e.g. 'off')
   * @param {Object} args.registry  the `state` slice of the trigger registry: { locations }
   * @returns {Object|null} resolved intent or null if not registered
   * @throws {ValidationError} if the state entry has no action
   */
  static resolve({ location, value, registry }) {
    const locationConfig = registry?.locations?.[location];
    if (!locationConfig) return null;

    const stateValue = String(value || '').toLowerCase();
    const stateEntry = locationConfig.states?.[stateValue];
    if (!stateEntry) return null;

    if (!stateEntry.action) {
      throw new ValidationError(
        `state "${stateValue}" at location "${location}" has no action`,
        { code: 'STATE_MISSING_ACTION', field: stateValue }
      );
    }

    const params = {};
    for (const [k, v] of Object.entries(stateEntry)) {
      if (RESERVED_KEYS.has(k)) continue;
      params[k] = v;
    }

    const intent = {
      action: stateEntry.action,
      target: stateEntry.target ?? locationConfig.target,
      params,
    };
    if (stateEntry.content !== undefined) intent.content = stateEntry.content;
    if (stateEntry.scene !== undefined) intent.scene = stateEntry.scene;
    if (stateEntry.service !== undefined) intent.service = stateEntry.service;
    if (stateEntry.entity !== undefined) intent.entity = stateEntry.entity;
    if (stateEntry.data !== undefined) intent.data = stateEntry.data;

    return intent;
  }
}

export default StateResolver;
```

- [ ] **Step 7.4: Run tests, expect PASS**

```bash
npx vitest run tests/isolated/domain/trigger/services/StateResolver.test.mjs
```

Expected: PASS (all 6 tests).

- [ ] **Step 7.5: Commit**

```bash
git add tests/isolated/domain/trigger/services/StateResolver.test.mjs \
        backend/src/2_domains/trigger/services/StateResolver.mjs
git commit -m "feat(trigger): add StateResolver domain service for location-scoped state-value lookup"
```

---

### Task 8: Implement `ResolverRegistry` (TDD) — domain service

**Files:**
- Create: `tests/isolated/domain/trigger/services/ResolverRegistry.test.mjs`
- Create: `backend/src/2_domains/trigger/services/ResolverRegistry.mjs`

- [ ] **Step 8.1: Write the failing test**

Create `tests/isolated/domain/trigger/services/ResolverRegistry.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { ResolverRegistry, UnknownModalityError } from '#domains/trigger/services/ResolverRegistry.mjs';

const fakeContentIdResolver = { resolve: (c) => c.startsWith('plex:') };

const fakeRegistry = {
  nfc: {
    locations: {
      livingroom: { target: 'tv', action: 'play', defaults: {} },
    },
    tags: {
      'aa_bb': { global: { plex: 100 }, overrides: {} },
    },
  },
  state: {
    locations: {
      livingroom: { target: 'tv', states: { off: { action: 'clear' } } },
    },
  },
};

describe('ResolverRegistry.resolve', () => {
  it('dispatches nfc to NfcResolver', () => {
    const result = ResolverRegistry.resolve({
      modality: 'nfc',
      location: 'livingroom',
      value: 'aa_bb',
      registry: fakeRegistry,
      contentIdResolver: fakeContentIdResolver,
    });
    expect(result?.content).toBe('plex:100');
  });

  it('dispatches state to StateResolver', () => {
    const result = ResolverRegistry.resolve({
      modality: 'state',
      location: 'livingroom',
      value: 'off',
      registry: fakeRegistry,
      contentIdResolver: fakeContentIdResolver,
    });
    expect(result?.action).toBe('clear');
  });

  it('throws UnknownModalityError for an unknown modality', () => {
    expect(() => ResolverRegistry.resolve({
      modality: 'voice',
      location: 'livingroom',
      value: 'play_jazz',
      registry: fakeRegistry,
      contentIdResolver: fakeContentIdResolver,
    })).toThrow(UnknownModalityError);
  });

  it('returns null when the resolver returns null (e.g. unregistered)', () => {
    const result = ResolverRegistry.resolve({
      modality: 'nfc',
      location: 'unknown',
      value: 'aa_bb',
      registry: fakeRegistry,
      contentIdResolver: fakeContentIdResolver,
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 8.2: Run the test, expect FAIL**

```bash
npx vitest run tests/isolated/domain/trigger/services/ResolverRegistry.test.mjs
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 8.3: Implement the registry**

Create `backend/src/2_domains/trigger/services/ResolverRegistry.mjs`:

```javascript
/**
 * Resolver registry: modality string -> resolver class. Single entry point
 * for TriggerDispatchService to convert (modality, location, value) into an
 * intent object.
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Stateless dispatch.
 *
 * To add a new modality (voice, barcode, etc.):
 *   1. Add a parser under 1_adapters/trigger/parsers/ and wire it into
 *      buildTriggerRegistry.
 *   2. Add a resolver class under 2_domains/trigger/services/ that
 *      consumes the modality slice of the registry.
 *   3. Register the resolver class here in the `resolvers` map.
 *
 * Each resolver receives the modality slice of the registry (e.g.
 * `registry.nfc` for NfcResolver) — NOT the whole registry. This keeps
 * resolvers from peeking across modalities.
 *
 * @module domains/trigger/services/ResolverRegistry
 */

import { NfcResolver } from './NfcResolver.mjs';
import { StateResolver } from './StateResolver.mjs';

export class UnknownModalityError extends Error {
  constructor(modality) {
    super(`Unknown trigger modality: ${modality}`);
    this.name = 'UnknownModalityError';
    this.modality = modality;
  }
}

export const resolvers = {
  nfc: NfcResolver,
  state: StateResolver,
};

/**
 * Stateless dispatch facade.
 *
 * @class ResolverRegistry
 * @stateless
 */
export class ResolverRegistry {
  /**
   * @param {Object} args
   * @param {string} args.modality  e.g. 'nfc' or 'state'
   * @param {string} args.location
   * @param {string} args.value
   * @param {Object} args.registry  the unified registry from buildTriggerRegistry
   * @param {Object} [args.contentIdResolver]  required by some modalities (nfc)
   * @returns {Object|null} resolved intent or null if unregistered
   * @throws {UnknownModalityError} if no resolver is registered for the modality
   */
  static resolve({ modality, location, value, registry, contentIdResolver }) {
    const Resolver = resolvers[modality];
    if (!Resolver) throw new UnknownModalityError(modality);

    const modalityRegistry = registry?.[modality];
    return Resolver.resolve({ location, value, registry: modalityRegistry, contentIdResolver });
  }
}

export default ResolverRegistry;
```

- [ ] **Step 8.4: Run tests, expect PASS**

```bash
npx vitest run tests/isolated/domain/trigger/services/ResolverRegistry.test.mjs
```

Expected: PASS (all 4 tests).

- [ ] **Step 8.5: Commit**

```bash
git add tests/isolated/domain/trigger/services/ResolverRegistry.test.mjs \
        backend/src/2_domains/trigger/services/ResolverRegistry.mjs
git commit -m "feat(trigger): add ResolverRegistry domain service for modality dispatch"
```

---

## Phase 4 — Refactor TriggerDispatchService

### Task 9: Update `TriggerDispatchService` to consume the new registry shape

**Files:**
- Modify: `backend/src/3_applications/trigger/TriggerDispatchService.mjs`
- Modify: `tests/isolated/applications/trigger/TriggerDispatchService.test.mjs`

The dispatcher's API stays the same (`handleTrigger(location, modality, value, options)`). What changes:
- Config shape: was `{ [location]: { target, action, auth_token, entries: { [modality]: ... } } }`. Is now `{ nfc: { locations, tags }, state: { locations } }`.
- Lookup: was `config[location].entries[modality][value]`. Is now via `resolveTrigger(...)`.
- Auth check: was `config[location].auth_token`. Is now `config[modality].locations[location].auth_token`.

- [ ] **Step 9.1: Read the existing test file**

```bash
cat tests/isolated/applications/trigger/TriggerDispatchService.test.mjs | head -100
```

Note the fixture shape used today. It uses the OLD config shape. We'll rewrite it.

- [ ] **Step 9.2: Update the test fixtures to use the new registry shape**

Open `tests/isolated/applications/trigger/TriggerDispatchService.test.mjs` and replace the existing `baseConfig` (or equivalent fixture) with the new shape:

```javascript
const newRegistry = {
  nfc: {
    locations: {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play-next',
        auth_token: null,
        defaults: {},
      },
    },
    tags: {
      '83_8e_68_06': { global: { plex: 620707 }, overrides: {} },
    },
  },
  state: {
    locations: {
      livingroom: {
        target: 'livingroom-tv',
        auth_token: null,
        states: {
          off: { action: 'clear' },
        },
      },
    },
  },
};
```

Then update each test to pass `config: newRegistry` to the `TriggerDispatchService` constructor. Update assertions accordingly:
- `LOCATION_NOT_FOUND` test: pick a location that's missing from BOTH `nfc.locations` AND `state.locations`.
- `AUTH_FAILED` test: set `newRegistry.nfc.locations.livingroom.auth_token = 'secret'` and assert the auth path fires for an NFC scan with the wrong token.
- `TRIGGER_NOT_REGISTERED` test: scan a UID not in `nfc.tags`.
- Successful dispatch: scan `83_8e_68_06`, expect `wakeAndLoadService.execute('livingroom-tv', { ..., op: 'play-next', 'play-next': 'plex:620707' }, { dispatchId: ... })`.
- State trigger: hit `(livingroom, state, off)`, expect `device.clearContent()` called.
- Debounce tests: structure unchanged, but the registry passed in is the new shape.

- [ ] **Step 9.3: Run the dispatcher tests, expect FAIL**

```bash
npx vitest run tests/isolated/applications/trigger/TriggerDispatchService.test.mjs
```

Expected: tests fail because the dispatcher still expects the old config shape.

- [ ] **Step 9.4: Refactor `TriggerDispatchService`**

Rewrite `backend/src/3_applications/trigger/TriggerDispatchService.mjs`. Key changes:
- Drop `import { resolveIntent } from '#domains/trigger/TriggerIntent.mjs'`.
- Add `import { ResolverRegistry, UnknownModalityError } from '#domains/trigger/services/ResolverRegistry.mjs'`.
- Update auth lookup to read `this.#config[modality]?.locations?.[location]?.auth_token`.
- Update existence check to consult the per-modality registry (the resolver returns null when not registered, so we can rely on it).
- Remove the `valueEntry` extraction step — the resolver does it.

Replace the entire file with:

```javascript
/**
 * TriggerDispatchService — orchestrates a single trigger event from API to
 * dispatched action. Modality-agnostic via ResolverRegistry (domain service).
 * Config shape:
 *   { [modality]: <modality-specific registry shape from buildTriggerRegistry> }
 *
 * Layer: APPLICATION (3_applications/trigger). Coordinates auth/debounce
 * (its own concerns) with the domain ResolverRegistry and the application
 * actionHandlers + WebSocket broadcast.
 *
 * @module applications/trigger/TriggerDispatchService
 */

import { randomUUID } from 'node:crypto';
import { ResolverRegistry, UnknownModalityError } from '#domains/trigger/services/ResolverRegistry.mjs';
import { dispatchAction, UnknownActionError } from './actionHandlers.mjs';

export class TriggerDispatchService {
  #config;
  #contentIdResolver;
  #deps;
  #broadcast;
  #logger;
  #recentDispatches;
  #debounceWindowMs;
  #clock;

  constructor({
    config,
    contentIdResolver,
    wakeAndLoadService,
    haGateway,
    deviceService,
    broadcast,
    logger = console,
    debounceWindowMs = 3000,
    clock = () => Date.now(),
  }) {
    this.#config = config || {};
    this.#contentIdResolver = contentIdResolver;
    this.#deps = { wakeAndLoadService, haGateway, deviceService };
    this.#broadcast = broadcast || (() => {});
    this.#logger = logger;
    this.#recentDispatches = new Map();
    this.#debounceWindowMs = debounceWindowMs;
    this.#clock = clock;
  }

  #pruneDispatches(now) {
    for (const [key, ts] of this.#recentDispatches) {
      if (now - ts > this.#debounceWindowMs) this.#recentDispatches.delete(key);
    }
  }

  #lookupAuthToken(modality, location) {
    return this.#config?.[modality]?.locations?.[location]?.auth_token ?? null;
  }

  async handleTrigger(location, modality, value, options = {}) {
    const startedAt = this.#clock();
    const dispatchId = randomUUID();
    const normalizedValue = String(value || '').toLowerCase();

    // The resolver tells us if the location/value is registered. But we still
    // need to do the auth check up-front (before resolution) to avoid leaking
    // signal about which tags exist. So we look up the location's auth_token
    // directly from the per-modality registry.
    const modalityConfig = this.#config?.[modality];
    if (!modalityConfig) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, registered: false, error: 'unknown-modality' });
      return { ok: false, code: 'UNKNOWN_MODALITY', error: `Unknown modality: ${modality}`, location, modality, value: normalizedValue, dispatchId };
    }
    const locationConfig = modalityConfig.locations?.[location];
    if (!locationConfig) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, registered: false, error: 'location-not-found' });
      return { ok: false, code: 'LOCATION_NOT_FOUND', error: `Unknown location: ${location}`, location, modality, value: normalizedValue, dispatchId };
    }

    const authToken = this.#lookupAuthToken(modality, location);
    if (authToken && authToken !== options.token) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, error: 'auth-failed' });
      return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', location, modality, value: normalizedValue, dispatchId };
    }

    const debounceKey = `${location}:${modality}:${normalizedValue}`;
    if (!options.dryRun) {
      this.#pruneDispatches(startedAt);
      const lastTs = this.#recentDispatches.get(debounceKey);
      if (lastTs != null && startedAt - lastTs < this.#debounceWindowMs) {
        const sinceMs = startedAt - lastTs;
        this.#logger.info?.('trigger.debounced', { location, modality, value: normalizedValue, sinceMs, windowMs: this.#debounceWindowMs, dispatchId });
        return { ok: true, debounced: true, location, modality, value: normalizedValue, dispatchId, sinceMs };
      }
    }

    let intent;
    try {
      intent = ResolverRegistry.resolve({
        modality,
        location,
        value: normalizedValue,
        registry: this.#config,
        contentIdResolver: this.#contentIdResolver,
      });
    } catch (err) {
      const code = err instanceof UnknownModalityError ? 'UNKNOWN_MODALITY' : 'INVALID_INTENT';
      this.#logger.error?.('trigger.fired', { location, modality, value: normalizedValue, error: err.message });
      this.#emit(location, modality, { location, modality, value: normalizedValue, dispatchId, ok: false, error: err.message });
      return { ok: false, code, error: err.message, location, modality, value: normalizedValue, dispatchId };
    }

    const baseLog = { location, modality, value: normalizedValue, registered: !!intent, dispatchId };

    if (!intent) {
      this.#logger.info?.('trigger.fired', { ...baseLog, error: 'trigger-not-registered' });
      this.#emit(location, modality, baseLog);
      return { ok: false, code: 'TRIGGER_NOT_REGISTERED', error: `Trigger not registered: ${normalizedValue}`, location, modality, value: normalizedValue, dispatchId };
    }

    intent.dispatchId = dispatchId;
    const summary = { location, modality, value: normalizedValue, action: intent.action, target: intent.target, dispatchId };

    if (options.dryRun) {
      this.#logger.info?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, dryRun: true });
      this.#emit(location, modality, { ...summary, dryRun: true });
      return { ok: true, dryRun: true, ...summary, intent };
    }

    try {
      const dispatchResult = await dispatchAction(intent, this.#deps);
      const elapsedMs = this.#clock() - startedAt;
      this.#recentDispatches.set(debounceKey, this.#clock());
      this.#logger.info?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, ok: true, elapsedMs });
      this.#emit(location, modality, { ...summary, ok: true });
      return { ok: true, ...summary, dispatch: dispatchResult, elapsedMs };
    } catch (err) {
      const elapsedMs = this.#clock() - startedAt;
      this.#recentDispatches.delete(debounceKey);
      const code = err instanceof UnknownActionError ? 'UNKNOWN_ACTION' : 'DISPATCH_FAILED';
      this.#logger.error?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, ok: false, error: err.message, code, elapsedMs });
      this.#emit(location, modality, { ...summary, ok: false, error: err.message });
      return { ok: false, code, error: err.message, ...summary, elapsedMs };
    }
  }

  #emit(location, modality, payload) {
    this.#broadcast({ topic: `trigger:${location}:${modality}`, ...payload, type: 'trigger.fired' });
  }
}

export default TriggerDispatchService;
```

- [ ] **Step 9.5: Run dispatcher tests, expect PASS**

```bash
npx vitest run tests/isolated/applications/trigger/TriggerDispatchService.test.mjs
```

Expected: PASS. If any test fails because it referenced the old `entries[modality][value]` shape, update the assertion to match the new resolver-returns-null pattern (the resolver returns null for both unknown locations AND unknown values within a known location; the dispatcher branches on which case it is via the location lookup that happens FIRST).

Also note the new `UNKNOWN_MODALITY` code — if a test passes a modality with no slice in `this.#config`, it now returns `{ code: 'UNKNOWN_MODALITY' }` rather than `LOCATION_NOT_FOUND`. Update test expectations accordingly if any test relied on the old behavior.

- [ ] **Step 9.6: Run the full trigger-related test set**

```bash
npx vitest run tests/isolated/domains/trigger tests/isolated/applications/trigger
```

Expected: all green.

- [ ] **Step 9.7: Commit**

```bash
git add backend/src/3_applications/trigger/TriggerDispatchService.mjs \
        tests/isolated/applications/trigger/TriggerDispatchService.test.mjs
git commit -m "refactor(trigger): TriggerDispatchService consumes per-modality registry via resolverRegistry"
```

---

## Phase 5 — Bootstrap integration

### Task 10: Wire `loadTriggerConfig` into `bootstrap.mjs`

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:1735-1741` (the `createTriggerApiRouter` function)

The bootstrap currently does:
```javascript
triggerConfig = parseTriggerConfig(loadFile('config/nfc'));
```

We need to load three new YAML blobs from the `triggers/` tree and pass them through `buildTriggerRegistry`. The `loadFile` helper accepts a path relative to the household dir.

- [ ] **Step 10.1: Inspect current bootstrap imports and the loadFile signature**

```bash
grep -n "parseTriggerConfig\|loadFile.*config" backend/src/0_system/bootstrap.mjs
grep -n "loadFile" backend/src/app.mjs | head -5
```

`loadFile` is defined in `backend/src/app.mjs:1606` as `(relativePath) => haLoadYaml(path.join(householdDir, relativePath))`. It returns the parsed YAML object (or null if the file is missing).

- [ ] **Step 10.2: Update the imports in `bootstrap.mjs`**

Find the existing import:
```javascript
import { parseTriggerConfig } from '#domains/trigger/TriggerConfig.mjs';
```

Replace with:
```javascript
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';
```

(Use the Edit tool to make the change. The exact location may have moved between commits — search for `parseTriggerConfig` to find it.)

- [ ] **Step 10.3: Update the body of `createTriggerApiRouter`**

In `backend/src/0_system/bootstrap.mjs:1735-1741`, replace:

```javascript
let triggerConfig;
try {
  triggerConfig = parseTriggerConfig(loadFile('config/nfc'));
} catch (err) {
  logger.warn?.('trigger.config.parse.failed', { error: err.message });
  triggerConfig = {};
}
```

With:

```javascript
let triggerConfig;
try {
  const triggerConfigRepository = new YamlTriggerConfigRepository();
  triggerConfig = triggerConfigRepository.loadRegistry({ loadFile });
} catch (err) {
  logger.warn?.('trigger.config.parse.failed', { error: err.message });
  triggerConfig = { nfc: { locations: {}, tags: {} }, state: { locations: {} } };
}
```

The repository encapsulates the file-path layout — `loadFile` doesn't need the `.yml` extension (the helper adds it).

- [ ] **Step 10.4: Boot the backend and confirm no parse errors**

This depends on the dev environment — running on `kckern-server` you'd typically deploy via Docker. For a fast smoke without deploying:

```bash
cd /opt/Code/DaylightStation-trigger-modality
node -e "
import('./backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs').then(m => {
  const fs = require('fs');
  const yaml = require('js-yaml');
  const base = '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/config/triggers';
  // Note: claude user can't read this path directly. If this fails with EACCES,
  // skip this step and rely on container boot in step 10.5.
  const load = (p) => { try { return yaml.load(fs.readFileSync(\`\${base}/\${p}\`, 'utf8')); } catch { return null; } };
  const reg = m.buildTriggerRegistry({
    nfcLocations: load('nfc/locations.yml'),
    nfcTags: load('nfc/tags.yml'),
    stateLocations: load('state/locations.yml'),
  });
  console.log(JSON.stringify(reg, null, 2));
}).catch(e => { console.error('FAIL', e.message); process.exit(1); });
"
```

If the read fails with EACCES, skip and rely on the container boot in 10.5.

- [ ] **Step 10.5: Container boot smoke test**

After committing the bootstrap change in step 10.6, the in-container build will pick this up. For a fast pre-deploy check (without rebuilding the container), restart the existing daylight-station container — it bind-mounts the source from the worktree's repo, so:

NOTE: the container actually serves from a baked image, not from the worktree. So this step is best done after the implementation is fully committed and merged. For now, assume bootstrap is correct based on the unit-tested loader; defer integration check to Phase 8.

- [ ] **Step 10.6: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(bootstrap): use buildTriggerRegistry to load triggers/ tree"
```

---

## Phase 6 — Cleanup

### Task 11: Delete obsolete domain modules and tests

**Files:**
- Delete: `backend/src/2_domains/trigger/TriggerConfig.mjs`
- Delete: `backend/src/2_domains/trigger/TriggerIntent.mjs`
- Delete: `tests/isolated/domains/trigger/TriggerConfig.test.mjs`
- Delete: `tests/isolated/domains/trigger/TriggerIntent.test.mjs`

- [ ] **Step 11.1: Confirm nothing imports the old modules**

```bash
grep -rn "TriggerConfig\|TriggerIntent\|parseTriggerConfig\|resolveIntent" backend/ tests/ cli/ 2>/dev/null | grep -v node_modules | grep -v "TriggerConfig.mjs:" | grep -v "TriggerIntent.mjs:" | grep -v "TriggerConfig.test.mjs:" | grep -v "TriggerIntent.test.mjs:"
```

Expected: no hits OUTSIDE the files being deleted. If you see imports from other files, STOP and update them first (they should already be updated by Tasks 9 and 10 — but double-check).

- [ ] **Step 11.2: Delete the files**

```bash
rm backend/src/2_domains/trigger/TriggerConfig.mjs
rm backend/src/2_domains/trigger/TriggerIntent.mjs
rm tests/isolated/domains/trigger/TriggerConfig.test.mjs
rm tests/isolated/domains/trigger/TriggerIntent.test.mjs
```

- [ ] **Step 11.3: Run full trigger test set**

```bash
npx vitest run tests/isolated/domains/trigger tests/isolated/applications/trigger tests/isolated/adapter/trigger
```

Expected: all green (the new parsers, repository, resolvers, and registry cover the deleted-test surface).

- [ ] **Step 11.4: Run isolated suite smoke**

```bash
npx vitest run tests/isolated/ 2>&1 | tail -5
```

Expected: same pass count as the baseline captured in Step 0.2 (we removed 2 test files but their behavior is preserved by the new files; net should be ≥ baseline).

- [ ] **Step 11.5: Commit**

```bash
git add -A backend/src/2_domains/trigger/ tests/isolated/domains/trigger/
git commit -m "chore(trigger): remove obsolete TriggerConfig/TriggerIntent modules and tests"
```

---

### Task 12: Delete obsolete prod data files

**Files (on prod data volume, via docker exec):**
- Delete: `data/household/config/nfc.yml`
- Delete: `data/household/config/nfc.yml.bak-20260425-151147`
- Delete: `data/household/config/nfc.yml.bak-20260425-162314`
- Delete: `data/household/config/nfc (kckern-server's conflicted copy 2026-04-24).yml`

- [ ] **Step 12.1: Verify the new files are in place (sanity)**

```bash
sudo docker exec daylight-station sh -c 'ls -la data/household/config/triggers/nfc/ data/household/config/triggers/state/'
```

Expected: `locations.yml` + `tags.yml` under `nfc/`, `locations.yml` under `state/`.

- [ ] **Step 12.2: Delete the obsolete files**

The conflicted-copy filename contains an apostrophe, which is awkward to escape across the docker→bash→sh quoting layers. Use `find -delete` to sidestep the quoting problem:

```bash
sudo docker exec daylight-station sh -c 'find data/household/config -maxdepth 1 -name "nfc*" -print -delete'
```

The `-print` flag lists each file as it deletes — confirm you see the expected four entries:
- `data/household/config/nfc.yml`
- `data/household/config/nfc.yml.bak-20260425-151147`
- `data/household/config/nfc.yml.bak-20260425-162314`
- `data/household/config/nfc (kckern-server's conflicted copy 2026-04-24).yml`

If `find` reports unexpected files, STOP and reconcile — don't proceed until the list matches.

Verify:
```bash
sudo docker exec daylight-station sh -c 'ls data/household/config/ | grep -i nfc'
```

Expected: empty output (no files matching `nfc*` at the root level — they all live under `triggers/nfc/` now).

- [ ] **Step 12.3: No git commit for this task**

The data files are gitignored — the deletes are prod-side operations. Confirm:

```bash
cd /opt/Code/DaylightStation-trigger-modality
git status
```

Expected: `nothing to commit, working tree clean`.

---

## Phase 7 — Documentation

### Task 13: Create `docs/reference/trigger/schema.md` (canonical schema reference)

**Files:**
- Create: `docs/reference/trigger/schema.md`

- [ ] **Step 13.1: Write the schema reference**

Create `docs/reference/trigger/schema.md`:

````markdown
# Trigger Config Schema

How the per-modality YAML files under `data/household/config/triggers/` are structured, parsed, and merged at resolution time. This is the canonical reference — if `events.md` and this disagree, this wins.

For the runtime contract (HTTP endpoint, status codes, broadcast shape), see [`events.md`](./events.md) and [`../trigger-endpoint.md`](../trigger-endpoint.md).

---

## Directory layout

```
data/household/config/triggers/
  nfc/
    locations.yml      # NFC reader sources + per-reader defaults
    tags.yml           # universal tag UID registry
  state/
    locations.yml      # state-source locations + state-value action maps
  # (future modalities live as siblings: voice/, barcode/, etc.)
```

Each modality is self-contained. A modality may have:
- A `locations.yml` (always — defines the trigger sources of that modality and their defaults)
- One or more registry/resolver-data files (`tags.yml`, `intents.yml`, etc.)
- A code-only resolver (some modalities, like voice, may need no static data file)

---

## `triggers/nfc/locations.yml`

Each top-level key is an NFC reader location ID. The key matches the URL `/api/v1/trigger/<location>/nfc/<value>`.

```yaml
livingroom:
  target: livingroom-tv     # device that receives the resolved load command
  action: play-next         # default action for tags scanned at this reader
  shader: default           # default shader (flows into load query)
  volume: 15                # default volume
  auth_token: null          # optional auth (omit or null = no auth)
```

**Reserved fields** (consumed as first-class config):
- `target` (REQUIRED, non-empty string) — the device ID this reader controls
- `action` (optional) — the default action for tags here; overridable per tag
- `auth_token` (optional, string or null) — required auth token; null = no auth

**Defaults** (everything else, e.g. `shader`, `volume`, `shuffle`, `continuous`) — flow into the load query as the lowest-precedence layer for any tag scanned at this reader.

---

## `triggers/nfc/tags.yml`

Universal tag registry. Each top-level key is a tag UID (case-insensitive — the parser lowercases). Tags are recognized at any reader in `nfc/locations.yml`.

```yaml
8d_6d_2a_07:
  plex: 620707              # tag-global content (shorthand: plex:620707)
  shader: default           # tag-global override
  livingroom:               # ← key matches a reader ID → per-reader override block
    shader: blackout        #   (only applies when scanned at livingroom)
  bedroom:                  # ← another override block
    shader: night
    volume: 5
```

### Disambiguation rule (scalar vs object)

A tag's top-level keys are classified by the *value's type*:

| Value type | Treated as | Constraint |
|---|---|---|
| Scalar (string, number, bool, null) | tag-global field | none |
| Array | tag-global field | none |
| Object (plain) | per-reader override block | key MUST match a registered reader ID in `nfc/locations.yml` |

If a tag has an object-valued key whose name does NOT match a registered reader, the parser throws `ValidationError(code: 'UNKNOWN_READER_OVERRIDE')`. This catches typos like `livingrm: { shader: blackout }`.

### Reserved tag fields

Inside the tag body (and inside any per-reader override block), these keys are consumed as first-class intent fields rather than passing through as load-query params: `action`, `target`, `content`, `scene`, `service`, `entity`, `data`. (Same `RESERVED_KEYS` set used by the previous `TriggerIntent.resolveIntent`.)

---

## `triggers/state/locations.yml`

```yaml
livingroom:
  target: livingroom-tv
  states:
    off:
      action: clear
    on:
      action: play
      queue: ambient-loop
```

State events are inherently location-bound (every entity_id belongs to one location), so there's no universal state registry — the action map is per-location.

**Schema:**
- `target` (REQUIRED) — same as NFC.
- `auth_token` (optional) — same as NFC.
- `states` (optional, object) — keyed by the state value (lowercased on parse). Each entry MUST have an `action`. Other fields flow into params; `target` can be overridden per-state if needed.

---

## Precedence chain

For an NFC scan at reader `R` of tag `T`, the final load query is built by spread-merging in this order (later wins):

```
final = {}
      ← reader[R].defaults              (from nfc/locations.yml — shader, volume, etc.)
      ← tag[T].global                   (from nfc/tags.yml — top-level scalar/array values)
      ← tag[T].overrides[R]             (from nfc/tags.yml — reader-id-keyed object value)
```

`action` and `target` follow the same chain — reserved keys can be overridden too. Useful for an "audio-only" tag that forces a different target even from a video-capable reader.

`content` is resolved from the tag-global / override layers only. Reader defaults don't supply content (a reader is a binding policy, not content).

---

## Adding a new modality

To add `voice`, `barcode`, etc.:

1. Create the data dir + files: `data/household/config/triggers/<modality>/locations.yml` (+ any registry files like `intents.yml`).
2. Add a parser at `backend/src/1_adapters/trigger/parsers/<modality>LocationsParser.mjs` (and any registry parsers).
3. Wire the parser into `buildTriggerRegistry` in `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs`.
4. Add a resolver class at `backend/src/2_domains/trigger/services/<Modality>Resolver.mjs` (PascalCase, with `static resolve(...)`).
5. Register the resolver class in `backend/src/2_domains/trigger/services/ResolverRegistry.mjs` (`resolvers` map).
6. Update `YamlTriggerConfigRepository` to load the new YAML blobs.

No changes needed to `TriggerDispatchService`, `actionHandlers`, the WebSocket broadcast, or the screen-framework subscription handler. The screen subscription topic (`trigger:<location>:<modality>`) generalizes for free.

---

## Files

- **Adapter (parsers + I/O):** `backend/src/1_adapters/trigger/{YamlTriggerConfigRepository,parsers/{buildTriggerRegistry,nfcLocationsParser,nfcTagsParser,stateLocationsParser}}.mjs`
- **Domain (resolvers):** `backend/src/2_domains/trigger/services/{NfcResolver,StateResolver,ResolverRegistry}.mjs`
- **Application (dispatcher + actions):** `backend/src/3_applications/trigger/{TriggerDispatchService,actionHandlers}.mjs`
- **API router:** `backend/src/4_api/v1/routers/trigger.mjs`
- **Bootstrap wiring:** `createTriggerApiRouter` in `backend/src/0_system/bootstrap.mjs`
- **Tests:** `tests/isolated/{adapters,domains,applications}/trigger/`

## See also

- [`events.md`](./events.md) — runtime event lifecycle and screen integration recipes
- [`../trigger-endpoint.md`](../trigger-endpoint.md) — HTTP contract and ESP32 firmware contract
````

- [ ] **Step 13.2: Commit**

```bash
git add docs/reference/trigger/schema.md
git commit -m "docs(trigger): add schema.md as canonical schema reference"
```

---

### Task 14: Update `docs/reference/trigger/events.md`

**Files:**
- Modify: `docs/reference/trigger/events.md`

The `events.md` file's runtime-contract sections (event lifecycle, broadcast payload, screen integration recipes) are unchanged. Only the YAML examples and the §"Files" footer need refreshing.

- [ ] **Step 14.1: Read the current events.md**

```bash
wc -l docs/reference/trigger/events.md
```

The file is ~252 lines. Two specific sections need editing:

1. **Example 1 — "NFC tag plays a Plex movie on the TV (canonical)"** at around line 117. The `data/household/config/nfc.yml` example block.
2. **§"Files"** at around line 238. The list of source files.

There may be a few inline references to `nfc.yml` in the prose to also catch.

- [ ] **Step 14.2: Update Example 1 to use the new schema**

Find the section starting with `### 1. NFC tag plays a Plex movie on the TV (canonical)` and replace the YAML example block. The old block is:

```yaml
livingroom:
  target: livingroom-tv
  action: play
  tags:
    "04a1b2c3d4":
      plex: 642120          # shorthand → content: "plex:642120"
```

Replace with two YAML blocks under the existing prose:

````markdown
**`data/household/config/triggers/nfc/locations.yml`:**

```yaml
livingroom:
  target: livingroom-tv
  action: play
```

**`data/household/config/triggers/nfc/tags.yml`:**

```yaml
"04a1b2c3d4":
  plex: 642120          # shorthand → content: "plex:642120"
```
````

Update the "Tap the tag →" sentence below if it references the old file path (it likely says "GET /api/v1/trigger/livingroom/nfc/04a1b2c3d4 → dispatch path runs..." — the URL is unchanged, just the config layout differs, so the sentence may not need any text edit).

- [ ] **Step 14.3: Update Example 3 (front-door NFC + PIP camera) similarly**

The prose `**\`nfc.yml\`:**` callout near line 152 — change to:

````markdown
**`data/household/config/triggers/nfc/locations.yml`** (add):

```yaml
frontdoor:
  target: kitchen-display
  action: scene
  auth_token: door-secret
```

**`data/household/config/triggers/nfc/tags.yml`** (add):

```yaml
"04doorkey1":
  scene: scene.welcome_home
```
````

- [ ] **Step 14.4: Update §"Reloading the Registry"**

Around line 227, the doc references `nfc.yml`. Update:

> If the YAML fails to parse, the endpoint returns 400 with the error and **leaves the existing in-memory registry intact** — a bad edit cannot blank out a working registry.

That stays. But the sentence above it about "trigger config is parsed once at boot" should reference the new directory:

> The trigger config is parsed once at boot from `data/household/config/triggers/`. To pick up edits without restarting the container:

(Change just the location reference; keep the rest.)

- [ ] **Step 14.5: Update §"Files"**

The current list (around line 240) reads:

```
- **Domain:** `backend/src/2_domains/trigger/{TriggerConfig,TriggerIntent}.mjs`
- **Application:** `backend/src/3_applications/trigger/{TriggerDispatchService,actionHandlers}.mjs`
- **API:** `backend/src/4_api/v1/routers/trigger.mjs`
- **Bootstrap:** `createTriggerApiRouter` in `backend/src/0_system/bootstrap.mjs`
- **Screen consumer:** `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`
- **Tests:** `tests/isolated/{domains,applications,api/routers}/trigger*`
```

Replace with:

```
- **Adapter (parsers + I/O):** `backend/src/1_adapters/trigger/{YamlTriggerConfigRepository,parsers/*}.mjs`
- **Domain (resolvers):** `backend/src/2_domains/trigger/services/{NfcResolver,StateResolver,ResolverRegistry}.mjs`
- **Application (dispatcher + actions):** `backend/src/3_applications/trigger/{TriggerDispatchService,actionHandlers}.mjs`
- **API:** `backend/src/4_api/v1/routers/trigger.mjs`
- **Bootstrap:** `createTriggerApiRouter` in `backend/src/0_system/bootstrap.mjs`
- **Screen consumer:** `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`
- **Tests:** `tests/isolated/{adapters,domains,applications}/trigger/`
- **Schema reference:** [`schema.md`](./schema.md)
```

- [ ] **Step 14.6: Update §"See also"**

Add a line linking to schema.md:

```
- [`schema.md`](./schema.md) — canonical YAML schema, precedence chain, and adding-a-new-modality guide
```

- [ ] **Step 14.7: Commit**

```bash
git add docs/reference/trigger/events.md
git commit -m "docs(trigger): update events.md YAML examples + Files section for new schema"
```

---

### Task 15: Update `docs/reference/trigger-endpoint.md`

**Files:**
- Modify: `docs/reference/trigger-endpoint.md`

- [ ] **Step 15.1: Read the file**

```bash
wc -l docs/reference/trigger-endpoint.md
cat docs/reference/trigger-endpoint.md | head -50
```

Identify any embedded YAML examples and any references to `nfc.yml`.

- [ ] **Step 15.2: Refresh YAML examples**

For any embedded YAML config example showing the old `livingroom: tags: ...` shape, replace with the two-file `nfc/locations.yml` + `nfc/tags.yml` shape (similar pattern as Task 14, Steps 14.2 and 14.3).

If the doc shows curl examples of the URL contract (`GET /api/v1/trigger/<location>/<modality>/<value>`), those are unchanged — only the underlying config layout changed.

- [ ] **Step 15.3: Add a brief note**

Near the top, add (or update an existing config-pointer note):

> **Config layout:** Trigger configs live under `data/household/config/triggers/<modality>/`. See [`trigger/schema.md`](./trigger/schema.md) for the schema reference.

- [ ] **Step 15.4: Commit**

```bash
git add docs/reference/trigger-endpoint.md
git commit -m "docs(trigger-endpoint): refresh YAML examples + add schema-doc pointer"
```

---

## Phase 8 — End-to-end verification

### Task 16: Build & deploy

**Files:** none (deploy)

Per `CLAUDE.local.md`: on `kckern-server` Claude may build + deploy without asking after a commit lands.

- [ ] **Step 16.1: Build the Docker image**

```bash
cd /opt/Code/DaylightStation-trigger-modality
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```

Expected: build succeeds.

- [ ] **Step 16.2: Stop & redeploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

Expected: container starts and listens on `:3111`.

- [ ] **Step 16.3: Confirm boot logs are clean**

```bash
sleep 10
sudo docker logs daylight-station --since 1m 2>&1 | grep -iE "trigger\.|error|warn" | head -30
```

Expected: no `trigger.config.parse.failed` warnings. May see some unrelated warnings — those are fine.

- [ ] **Step 16.4: Verify the trigger registry by dry-running an existing tag**

```bash
curl -s "http://localhost:3111/api/v1/trigger/livingroom/nfc/8d_6d_2a_07?dryRun=1" | jq .
```

Expected JSON includes:
- `ok: true`
- `dryRun: true`
- `action: "play-next"`
- `target: "livingroom-tv"`
- `intent.content: "plex:620707"`

- [ ] **Step 16.5: Verify state trigger dry-run**

```bash
curl -s "http://localhost:3111/api/v1/trigger/livingroom/state/off?dryRun=1" | jq .
```

Expected JSON includes:
- `ok: true`
- `dryRun: true`
- `action: "clear"`
- `target: "livingroom-tv"`

- [ ] **Step 16.6: Verify unregistered tag returns 404**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3111/api/v1/trigger/livingroom/nfc/deadbeef?dryRun=1"
```

Expected: `404`.

- [ ] **Step 16.7: Verify unknown modality returns 400 (or appropriate code)**

```bash
curl -s "http://localhost:3111/api/v1/trigger/livingroom/voice/play_jazz" | jq .
```

Expected: `ok: false`, `code: "UNKNOWN_MODALITY"` (or similar — the new dispatcher reports this case explicitly).

- [ ] **Step 16.8: Tail logs while you physically tap an NFC tag**

In one shell:
```bash
sudo docker logs -f daylight-station 2>&1 | grep -E "trigger\.|wake-and-load\.|fullykiosk\."
```

In another, physically tap tag `8d_6d_2a_07` on the living-room reader. Watch the logs:
- Expected: `trigger.fired` with `ok: true`, `target: livingroom-tv`, `action: play-next`
- Expected: `wake-and-load.power.start` → `wake-and-load.complete`
- Expected: `trigger.debounced` for any rapid duplicate fires (HA emits 2-3 per tap)

If the player ends up in the cover-art view playing audio, success.

- [ ] **Step 16.9: Negative-path smoke test — add a tag with a per-reader override and tap it**

This validates the new override semantic end-to-end. Pick an unused test UID (or use one of your existing tags temporarily). Add to `tags.yml`:

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/triggers/nfc/tags.yml << 'EOF'
83_8e_68_06:
  plex: 620707
8d_6d_2a_07:
  plex: 620707
  livingroom:
    shader: blackout
EOF"
```

Reload via curl (no API exists yet for reload — restart the container):

```bash
sudo docker restart daylight-station
sleep 10
```

Then tap `8d_6d_2a_07`. Watch the screen — the player should mount with `shader=blackout` (cover image but with a darker shader treatment than `default`).

After verifying, remove the override (revert `tags.yml` to the unmodified version) and restart again, OR keep it if the user wants `8d_6d_2a_07` permanently dimmed at livingroom.

- [ ] **Step 16.10: No git changes — record verification result in commit description (optional)**

If the user wants a written verification artifact, append the test commands + observed outputs to a section at the bottom of the spec file. Otherwise, just confirm verbally.

---

## Self-review checklist (run before declaring done)

- [ ] All 17 tasks committed individually (Task 0–16, plus Task 5b)
- [ ] `npx vitest run tests/isolated/` headline matches or exceeds the baseline pass count from Step 0.2
- [ ] No leftover imports of `parseTriggerConfig`, `resolveIntent`, `TriggerConfig.mjs`, or `TriggerIntent.mjs` anywhere in the repo (`grep -rn`)
- [ ] `backend/src/2_domains/trigger/` contains ONLY the `services/` subdirectory (no top-level `*.mjs` files — old TriggerConfig.mjs and TriggerIntent.mjs are deleted)
- [ ] `backend/src/1_adapters/trigger/` contains the new repository + parsers
- [ ] `data/household/config/` no longer contains any `nfc*.yml` files at the root level
- [ ] `data/household/config/triggers/{nfc/locations.yml, nfc/tags.yml, state/locations.yml}` all exist and parse
- [ ] Live NFC tap fires `trigger.fired ok:true` end-to-end on prod
- [ ] Live state trigger (`/trigger/livingroom/state/off`) calls `device.clearContent()` (verifiable via FKB load logs)
- [ ] `docs/reference/trigger/{events,schema}.md` and `docs/reference/trigger-endpoint.md` reflect the new schema
- [ ] No new `console.warn('trigger.config.parse.failed')` in boot logs

If everything checks, the worktree is ready to merge to `main`. Per `CLAUDE.md`: deploy at will from `kckern-server` (already done in Phase 8) — the merge to main can wait for user review of the actual diff.
