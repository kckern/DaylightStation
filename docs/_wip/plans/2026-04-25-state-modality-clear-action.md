# State Modality + Clear Action Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new trigger modality (`state`) and a new action (`clear`) so HA can fire `GET /api/v1/trigger/livingroom/state/off` when the living-room TV turns off, causing the Shield's FKB instance to navigate back to its configured Start URL — preventing runaway playback when the TV next powers on.

**Architecture:** Extends the existing location-rooted trigger system. The parser becomes multi-modality (one parse pass produces all modalities' entries under each location). A new `clear` action handler bypasses `wakeAndLoadService` and calls a new `loadStartUrl()` method on the device's content control. The FKB adapter implements it as a single `cmd=loadStartURL` REST call to FKB.

**Tech Stack:** Node.js (ES modules, `#alias` import paths), vitest for unit tests, Express, YAML config, HA REST commands, Fully Kiosk Browser HTTP API.

---

## Context You Need

**Existing trigger system:**
- Config parser: `backend/src/2_domains/trigger/TriggerConfig.mjs` — currently single-modality (`parseTriggerConfig(raw, type)` returns `{ location: { target, action, auth_token, entries: {...} } }`).
- Dispatcher: `backend/src/3_applications/trigger/TriggerDispatchService.mjs` — `handleTrigger(location, modality, value, opts)`. Currently reads `locationConfig.entries[value]` ignoring modality.
- Action handlers: `backend/src/3_applications/trigger/actionHandlers.mjs` — `queue`, `play`, `open`, `scene`, `ha-service`. We're adding `clear`.
- Router: `backend/src/4_api/v1/routers/trigger.mjs` — `GET /:location/:type/:value`. **No change needed.**
- Bootstrap wiring: `backend/src/0_system/bootstrap.mjs` lines 1696–1716.

**Existing device/content stack:**
- IContentControl port: `backend/src/3_applications/devices/ports/IContentControl.mjs`. Currently requires `load` + `getStatus`. We're adding optional `loadStartUrl`.
- FKB adapter: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` — has private `#sendCommand(cmd, params)` that wraps FKB's HTTP API.
- Device facade: `backend/src/3_applications/devices/services/Device.mjs` — exposes `loadContent`, `prepareForContent`, `reboot`, etc., delegating to `#contentControl`. We're adding `clearContent()` as the public facade method.

**Existing prod config:**
- `data/household/config/nfc.yml` (prod path: `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/config/nfc.yml`) — currently has the `livingroom` location with `tags:` block.

**Test setup:**
- Unit tests: `backend/tests/unit/suite/...` mirroring `src/...` paths. Use vitest (`describe`, `it`, `expect`, `beforeEach`, `vi`).
- Run unit tests: `npm run test:unit`.
- Path aliases: `#domains/...`, `#apps/...`, `#system/...`, etc. (see `package.json` `imports`).
- Run a single test file: `npm run test:unit -- <substring-of-filename>` (the harness filters by filename).

**Prod ops:**
- DS prod restart: `ssh homeserver.local 'docker restart daylight-station'`. Config loaded at startup only — required after YAML changes.
- HA prod restart: `ssh homeserver.local 'docker restart homeassistant'`. Required after editing `_includes/rest_commands/*.yaml` or `_includes/automations/*.yaml`.
- Shield IP: `10.0.0.195` (Ethernet, post-2026-04-25).

---

## Pre-flight

Before starting:

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git status
git pull --rebase  # only if you're on main and remote ahead
```

If `git status` shows uncommitted changes, stop and confirm with the user before proceeding.

Recommended: run this work in a **worktree** for isolation:

```bash
git worktree add ../DaylightStation.state-trigger -b state-trigger main
cd ../DaylightStation.state-trigger
```

(See @superpowers:using-git-worktrees if unsure.) If skipping the worktree, just work on a feature branch off main.

---

### Task 1: Add `loadStartUrl` to FullyKioskContentAdapter (TDD)

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` (add new public method, ~5 lines)
- Modify: `backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs` (add new test case)

**Step 1: Read the existing test file to understand mocking conventions**

```bash
sed -n '1,80p' backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
```

Confirm: how `fetch` is mocked, how the adapter is instantiated. The `#sendCommand` private method calls `fetch(buildFullyKioskUrl(...))`. Existing tests likely mock `globalThis.fetch` or import a mocked module.

**Step 2: Write the failing test**

Add a new `describe` block in `FullyKioskContentAdapter.test.mjs`:

```javascript
describe('loadStartUrl', () => {
  it('sends cmd=loadStartURL to the FKB host', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'ok',
    });
    globalThis.fetch = fetchMock;

    const adapter = new FullyKioskContentAdapter({
      host: '10.0.0.195',
      port: 2323,
      password: 'secret',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await adapter.loadStartUrl();

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toMatch(/cmd=loadStartURL/);
    expect(url).toMatch(/^http:\/\/10\.0\.0\.195:2323\//);
  });

  it('returns ok:false when FKB returns non-2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Map(),
      text: async () => 'oops',
    });

    const adapter = new FullyKioskContentAdapter({
      host: '10.0.0.195', port: 2323, password: 'secret',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await adapter.loadStartUrl();
    expect(result.ok).toBe(false);
  });
});
```

(Adjust the constructor args to match existing tests' style — copy from how the file does it.)

**Step 3: Run the test, verify it fails**

```bash
npm run test:unit -- FullyKioskContentAdapter
```

Expected: failure with "loadStartUrl is not a function" or similar.

**Step 4: Implement loadStartUrl**

In `FullyKioskContentAdapter.mjs`, add after the `load(...)` method (around line ~280):

```javascript
/**
 * Navigate FKB to its configured Start URL. Used to "clear" the screen
 * back to the kiosk home state without waking the display.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async loadStartUrl() {
  const result = await this.#sendCommand('loadStartURL');
  return { ok: result.ok, ...(result.ok ? {} : { error: result.error || 'loadStartURL failed' }) };
}
```

**Step 5: Run the test, verify it passes**

```bash
npm run test:unit -- FullyKioskContentAdapter
```

Expected: PASS for both new cases. Existing tests still pass.

**Step 6: Commit**

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs \
        backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
git commit -m "feat(fkb-adapter): add loadStartUrl method"
```

---

### Task 2: Add `clearContent()` facade method to Device (TDD)

**Files:**
- Modify: `backend/src/3_applications/devices/services/Device.mjs` (add new method)
- Create or modify: `backend/tests/unit/suite/3_applications/devices/Device.test.mjs` (if it doesn't exist, create it; otherwise add to existing)

**Step 1: Check whether Device.test.mjs exists**

```bash
ls backend/tests/unit/suite/3_applications/devices/Device.test.mjs 2>/dev/null && echo "exists" || echo "missing"
```

**Step 2: Write the failing test**

If `Device.test.mjs` exists, add a new `describe('clearContent')` block. Otherwise create a minimal new file:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { Device } from '#apps/devices/services/Device.mjs';

describe('Device.clearContent', () => {
  it('delegates to contentControl.loadStartUrl', async () => {
    const loadStartUrl = vi.fn().mockResolvedValue({ ok: true });
    const device = new Device({
      id: 'livingroom-tv',
      type: 'shield-tv',
      capabilities: {
        contentControl: { load: vi.fn(), getStatus: vi.fn(), loadStartUrl },
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await device.clearContent();

    expect(loadStartUrl).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('returns ok:false when content control is missing', async () => {
    const device = new Device({
      id: 'minimal',
      type: 'unknown',
      capabilities: {},
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await device.clearContent();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no content control/i);
  });

  it('returns ok:false when content control lacks loadStartUrl', async () => {
    const device = new Device({
      id: 'old-adapter',
      type: 'unknown',
      capabilities: { contentControl: { load: vi.fn(), getStatus: vi.fn() } },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await device.clearContent();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not supported/i);
  });
});
```

(Verify the actual `Device` constructor shape by reading `Device.mjs:30-60`. Adjust the test to match.)

**Step 3: Run the test, verify it fails**

```bash
npm run test:unit -- Device.test
```

Expected: FAIL — `clearContent is not a function`.

**Step 4: Implement clearContent**

In `Device.mjs`, add a new method (mirror the structure of `loadContent` for log shape):

```javascript
/**
 * Clear the screen back to the kiosk home state.
 * No-op-safe when content control is missing or doesn't support it.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async clearContent() {
  this.#logger.info?.('device.clearContent.start', { id: this.#id, hasContentControl: !!this.#contentControl });
  if (!this.#contentControl) {
    return { ok: false, error: 'No content control configured' };
  }
  if (typeof this.#contentControl.loadStartUrl !== 'function') {
    return { ok: false, error: 'Content control does not support clear (loadStartUrl not implemented)' };
  }
  const result = await this.#contentControl.loadStartUrl();
  this.#logger.info?.('device.clearContent.done', { id: this.#id, ok: result.ok });
  return result;
}
```

**Step 5: Run the test, verify it passes**

```bash
npm run test:unit -- Device.test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add backend/src/3_applications/devices/services/Device.mjs \
        backend/tests/unit/suite/3_applications/devices/Device.test.mjs
git commit -m "feat(device): add clearContent facade for navigating to kiosk home"
```

---

### Task 3: Refactor TriggerConfig parser to multi-modality (TDD)

This is the riskiest task — the parser signature changes, and `TriggerDispatchService` will need a follow-up update (Task 4). The parser is small (~80 lines), so the refactor stays narrow.

**Files:**
- Modify: `backend/src/2_domains/trigger/TriggerConfig.mjs`
- Create: `backend/tests/unit/suite/2_domains/trigger/TriggerConfig.test.mjs` (no existing test)

**Step 1: Write the failing test**

Create `backend/tests/unit/suite/2_domains/trigger/TriggerConfig.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseTriggerConfig } from '#domains/trigger/TriggerConfig.mjs';
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

describe('parseTriggerConfig (multi-modality)', () => {
  it('returns empty registry for null/undefined input', () => {
    expect(parseTriggerConfig(null)).toEqual({});
    expect(parseTriggerConfig(undefined)).toEqual({});
  });

  it('parses an nfc-only location into entries.nfc', () => {
    const raw = {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play',
        tags: { '83_8e_68_06': { plex: 620707 } },
      },
    };
    const out = parseTriggerConfig(raw);
    expect(out.livingroom.target).toBe('livingroom-tv');
    expect(out.livingroom.action).toBe('play');
    expect(out.livingroom.entries.nfc['83_8e_68_06']).toEqual({ plex: 620707 });
    expect(out.livingroom.entries.state).toBeUndefined();
  });

  it('parses a location with both nfc and state modalities', () => {
    const raw = {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play',
        tags: { '83_8e_68_06': { plex: 620707 } },
        states: { off: { action: 'clear' } },
      },
    };
    const out = parseTriggerConfig(raw);
    expect(out.livingroom.entries.nfc['83_8e_68_06']).toEqual({ plex: 620707 });
    expect(out.livingroom.entries.state.off).toEqual({ action: 'clear' });
  });

  it('lowercases entry keys per modality', () => {
    const raw = {
      livingroom: {
        target: 't',
        tags: { 'AB_CD': {} },
        states: { OFF: { action: 'clear' } },
      },
    };
    const out = parseTriggerConfig(raw);
    expect(out.livingroom.entries.nfc.ab_cd).toBeDefined();
    expect(out.livingroom.entries.state.off).toBeDefined();
  });

  it('throws when a location is missing a target', () => {
    expect(() => parseTriggerConfig({ livingroom: { action: 'play' } }))
      .toThrow(ValidationError);
  });

  it('throws when a location is not an object', () => {
    expect(() => parseTriggerConfig({ livingroom: 'not an object' }))
      .toThrow(ValidationError);
  });

  it('throws when a modality block is not an object', () => {
    expect(() => parseTriggerConfig({
      livingroom: { target: 't', tags: 'broken' },
    })).toThrow(ValidationError);
  });

  it('throws when an entry value is not an object', () => {
    expect(() => parseTriggerConfig({
      livingroom: { target: 't', tags: { 'ab': 'broken' } },
    })).toThrow(ValidationError);
  });

  it('exposes auth_token at the location level', () => {
    const raw = {
      livingroom: { target: 't', auth_token: 'sekret', tags: {} },
    };
    expect(parseTriggerConfig(raw).livingroom.auth_token).toBe('sekret');
  });

  it('defaults auth_token to null when absent', () => {
    expect(parseTriggerConfig({ livingroom: { target: 't' } }).livingroom.auth_token).toBeNull();
  });
});
```

**Step 2: Run, verify failure**

```bash
npm run test:unit -- TriggerConfig
```

Expected: failures (the current parser has a different signature/shape).

**Step 3: Refactor `TriggerConfig.mjs`**

Replace the entire file body with:

```javascript
/**
 * Trigger config parser + validator.
 *
 * Parses a location-rooted YAML shape into a normalized registry consumed by
 * TriggerDispatchService. Each top-level key is a location (e.g. `livingroom`,
 * `office`); each location declares default `target` + `action`, an optional
 * `auth_token`, and modality-specific entry blocks.
 *
 * Modality → entries-block keys:
 *   nfc     → tags
 *   barcode → codes
 *   voice   → keywords
 *   state   → states
 *
 * Output shape:
 *   { [location]: { target, action, auth_token, entries: { [modality]: { [value]: <entry> } } } }
 *
 * @module domains/trigger/TriggerConfig
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

export const ENTRIES_KEY_BY_TYPE = {
  nfc: 'tags',
  barcode: 'codes',
  voice: 'keywords',
  state: 'states',
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Parse a location-rooted trigger config (all modalities).
 * @param {object|null|undefined} raw
 * @returns {object}
 */
export function parseTriggerConfig(raw) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('trigger config must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }

  const out = {};
  for (const [location, locConfig] of Object.entries(raw)) {
    if (!isPlainObject(locConfig)) {
      throw new ValidationError(`location "${location}" must be an object`, { code: 'INVALID_LOCATION', field: location });
    }
    if (typeof locConfig.target !== 'string' || locConfig.target.length === 0) {
      throw new ValidationError(`location "${location}" must declare a target device (string)`, { code: 'MISSING_TARGET', field: location });
    }

    const entries = {};
    for (const [modality, entriesKey] of Object.entries(ENTRIES_KEY_BY_TYPE)) {
      if (!(entriesKey in locConfig)) continue;
      const rawEntries = locConfig[entriesKey];
      if (!isPlainObject(rawEntries)) {
        throw new ValidationError(`location "${location}" ${entriesKey} must be an object`, { code: 'INVALID_ENTRIES', field: location });
      }
      const modalityEntries = {};
      for (const [value, entry] of Object.entries(rawEntries)) {
        if (!isPlainObject(entry)) {
          throw new ValidationError(`${entriesKey.slice(0, -1)} "${value}" must be an object`, { code: 'INVALID_ENTRY', field: value });
        }
        modalityEntries[value.toLowerCase()] = entry;
      }
      entries[modality] = modalityEntries;
    }

    out[location] = {
      target: locConfig.target,
      action: locConfig.action,
      auth_token: locConfig.auth_token ?? null,
      entries,
    };
  }

  return out;
}

export default parseTriggerConfig;
```

**Step 4: Run, verify pass**

```bash
npm run test:unit -- TriggerConfig
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/2_domains/trigger/TriggerConfig.mjs \
        backend/tests/unit/suite/2_domains/trigger/TriggerConfig.test.mjs
git commit -m "refactor(trigger): make parser multi-modality, add 'state'"
```

---

### Task 4: Update TriggerDispatchService to read entries by modality (TDD)

**Files:**
- Modify: `backend/src/3_applications/trigger/TriggerDispatchService.mjs:43`
- Create: `backend/tests/unit/suite/3_applications/trigger/TriggerDispatchService.test.mjs` (no existing test)

**Step 1: Write the failing test**

Create `backend/tests/unit/suite/3_applications/trigger/TriggerDispatchService.test.mjs`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriggerDispatchService } from '#apps/trigger/TriggerDispatchService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('TriggerDispatchService (modality-aware lookup)', () => {
  let logger, broadcast, deps, service;

  const config = {
    livingroom: {
      target: 'livingroom-tv',
      action: 'play',
      auth_token: null,
      entries: {
        nfc: { '83_8e_68_06': { plex: 620707 } },
        state: { off: { action: 'clear' } },
      },
    },
  };

  beforeEach(() => {
    logger = makeLogger();
    broadcast = vi.fn();
    deps = {
      wakeAndLoadService: { execute: vi.fn() },
      haGateway: { callService: vi.fn() },
      deviceService: { get: vi.fn() },
    };
    service = new TriggerDispatchService({
      config, contentIdResolver: null,
      ...deps, broadcast, logger,
    });
  });

  it('resolves an nfc trigger via entries.nfc', async () => {
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06', { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('play');
    expect(result.target).toBe('livingroom-tv');
  });

  it('resolves a state trigger via entries.state', async () => {
    const result = await service.handleTrigger('livingroom', 'state', 'off', { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('clear');
    expect(result.target).toBe('livingroom-tv');
  });

  it('returns TRIGGER_NOT_REGISTERED for unknown modality', async () => {
    const result = await service.handleTrigger('livingroom', 'voice', 'hello', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');
  });

  it('returns TRIGGER_NOT_REGISTERED for unknown value within a known modality', async () => {
    const result = await service.handleTrigger('livingroom', 'state', 'frozen', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');
  });

  it('returns LOCATION_NOT_FOUND for unknown location', async () => {
    const result = await service.handleTrigger('attic', 'nfc', 'whatever', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('LOCATION_NOT_FOUND');
  });
});
```

**Step 2: Run, verify failure**

```bash
npm run test:unit -- TriggerDispatchService
```

Expected: failures — the current dispatcher reads `locationConfig.entries[value]` (no modality), so the state lookup will collide-or-miss depending on entries shape.

**Step 3: Update the dispatcher**

In `TriggerDispatchService.mjs`, change the entry lookup at line ~43:

```diff
-    const valueEntry = locationConfig.entries?.[normalizedValue];
+    const valueEntry = locationConfig.entries?.[modality]?.[normalizedValue];
```

That's the only line. The rest of the dispatch flow stays identical.

**Step 4: Run, verify pass**

```bash
npm run test:unit -- TriggerDispatchService
```

Expected: PASS for all 5 cases.

**Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/TriggerDispatchService.mjs \
        backend/tests/unit/suite/3_applications/trigger/TriggerDispatchService.test.mjs
git commit -m "fix(trigger): look up entries by modality, not flat"
```

---

### Task 5: Add `clear` action handler (TDD)

**Files:**
- Modify: `backend/src/3_applications/trigger/actionHandlers.mjs`
- Create: `backend/tests/unit/suite/3_applications/trigger/actionHandlers.test.mjs` (no existing test)

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { actionHandlers, dispatchAction, UnknownActionError } from '#apps/trigger/actionHandlers.mjs';

describe('actionHandlers.clear', () => {
  it('calls deviceService.get(target).clearContent()', async () => {
    const clearContent = vi.fn().mockResolvedValue({ ok: true });
    const deviceService = { get: vi.fn().mockReturnValue({ clearContent }) };

    const result = await actionHandlers.clear(
      { action: 'clear', target: 'livingroom-tv' },
      { deviceService },
    );

    expect(deviceService.get).toHaveBeenCalledWith('livingroom-tv');
    expect(clearContent).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('throws when target device is missing', async () => {
    const deviceService = { get: vi.fn().mockReturnValue(null) };
    await expect(actionHandlers.clear({ action: 'clear', target: 'ghost' }, { deviceService }))
      .rejects.toThrow(/Unknown target device/);
  });
});

describe('dispatchAction', () => {
  it('throws UnknownActionError for an unregistered action', async () => {
    await expect(dispatchAction({ action: 'levitate' }, {})).rejects.toThrow(UnknownActionError);
  });
});
```

**Step 2: Run, verify failure**

```bash
npm run test:unit -- actionHandlers
```

Expected: FAIL — `actionHandlers.clear is not a function`.

**Step 3: Implement the handler**

In `backend/src/3_applications/trigger/actionHandlers.mjs`, add to the `actionHandlers` map (between `open` and `scene`):

```javascript
  clear: async (intent, { deviceService }) => {
    const device = deviceService.get(intent.target);
    if (!device) throw new Error(`Unknown target device: ${intent.target}`);
    return device.clearContent();
  },
```

**Step 4: Run, verify pass**

```bash
npm run test:unit -- actionHandlers
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/actionHandlers.mjs \
        backend/tests/unit/suite/3_applications/trigger/actionHandlers.test.mjs
git commit -m "feat(trigger): add 'clear' action handler"
```

---

### Task 6: Update bootstrap.mjs to use new parser signature

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:1696–1702`

**Step 1: Read the current wiring**

```bash
sed -n '1690,1716p' backend/src/0_system/bootstrap.mjs
```

**Step 2: Update the parser call**

Change the existing block (around lines 1696–1702):

```diff
   let triggerConfig;
   try {
-    triggerConfig = parseTriggerConfig(loadFile('config/nfc'), 'nfc');
+    triggerConfig = parseTriggerConfig(loadFile('config/nfc'));
   } catch (err) {
     logger.warn?.('trigger.config.parse.failed', { error: err.message });
     triggerConfig = {};
   }
```

(Single argument — no `'nfc'` second arg, since the parser is now multi-modality.)

**Step 3: Run all unit tests to confirm nothing else broke**

```bash
npm run test:unit
```

Expected: all green. If anything fails, it's likely an integration test that imported `parseTriggerConfig` with a second arg — fix it (drop the second arg).

**Step 4: Smoke-test locally with `node`**

```bash
node -e "
import('./backend/src/2_domains/trigger/TriggerConfig.mjs').then(m => {
  const out = m.parseTriggerConfig({
    livingroom: { target: 't', action: 'play', tags: { ab: { plex: 1 } }, states: { off: { action: 'clear' } } },
  });
  console.log(JSON.stringify(out, null, 2));
});
"
```

Expected output: `entries: { nfc: { ab: ... }, state: { off: ... } }`.

**Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "refactor(bootstrap): use multi-modality trigger parser"
```

---

### Task 7: Update prod `nfc.yml` with `states.off` block

**Files:**
- Modify on prod: `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/config/nfc.yml`

**Step 1: Back up current config and write new content**

```bash
ssh homeserver.local 'TS=$(date +%Y%m%d-%H%M%S); F=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/config/nfc.yml; cp "$F" "$F.bak-$TS"'
```

**Step 2: Write the updated YAML**

```bash
ssh homeserver.local 'cat > /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/config/nfc.yml' <<'EOF'
# NFC Tag → Action mapping + state-change triggers
# Source: tag_scanned and tv-state events from HA
# Format: location-rooted; entries grouped by modality block
#   - tags:   modality "nfc"   (NFC tag UIDs)
#   - states: modality "state" (TV/display state changes)

livingroom:
  target: livingroom-tv
  action: play              # default for tags
  tags:
    83_8e_68_06:
      plex: 620707
    8d_6d_2a_07:
      plex: 620707
  states:
    off:
      action: clear         # navigate FKB to Start URL when TV turns off
EOF
```

**Step 3: Verify the file**

```bash
ssh homeserver.local 'cat /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/config/nfc.yml'
```

**Step 4: Deploy code changes to prod and restart container**

This depends on your deploy workflow. The user runs `deploy.sh` manually — DO NOT run it automatically. Ask the user to deploy when ready, then:

```bash
ssh homeserver.local 'docker restart daylight-station'
```

After restart, verify clean parse:

```bash
ssh homeserver.local 'docker logs --since 1m daylight-station 2>&1 | grep -E "trigger\.config\.parse\.failed|api\.mounted"'
```

Expected: no `trigger.config.parse.failed` warning. The router list should still include `/trigger`.

**Step 5: Smoke test the new endpoint via curl (dry-run)**

```bash
curl -sS "https://daylightlocal.kckern.net/api/v1/trigger/livingroom/state/off?dryRun=1" | python3 -m json.tool
```

Expected JSON contains:
- `"ok": true`
- `"dryRun": true`
- `"action": "clear"`
- `"target": "livingroom-tv"`

Existing NFC trigger should still work — re-test:

```bash
curl -sS "https://daylightlocal.kckern.net/api/v1/trigger/livingroom/nfc/83_8e_68_06?dryRun=1" | python3 -m json.tool
```

Expected: `"ok": true, "action": "play", ...`.

**Step 6: Commit (no code changes — config-only — but record the intent)**

The YAML lives in Dropbox (production data dir), not the repo. No git commit needed. The repo changes were committed in Tasks 1–6.

---

### Task 8: Live-fire the clear action and confirm FKB navigates

**Step 1: Note FKB's current URL on the Shield**

```bash
ssh homeserver.local 'docker exec daylight-station sh -c "wget -qO- '\''http://10.0.0.195:2323/?cmd=getDeviceInfo&password=$(cat /usr/src/app/data/household/auth/fullykiosk.yml | sed -n s/^token:.//p | xargs)&type=json'\'' 2>/dev/null | python3 -c '\''import sys, json; d=json.load(sys.stdin); print(d.get(\"currentURL\", d.get(\"currentUrl\")))'\''"'
```

(Adjust if the auth YAML key is `password:` not `token:` — check `data/household/auth/fullykiosk.yml`.)

**Step 2: Fire a `play` trigger to put something on the screen**

```bash
curl -sS "https://daylightlocal.kckern.net/api/v1/trigger/livingroom/nfc/83_8e_68_06"
```

Wait for `dispatch.ok: true`. The Shield should now show Plex content.

**Step 3: Fire the `clear` trigger**

```bash
curl -sS -m 30 "https://daylightlocal.kckern.net/api/v1/trigger/livingroom/state/off" | python3 -m json.tool
```

Expected:
- HTTP 200
- `dispatch.ok: true`
- Total elapsed should be **< 2 seconds** (no wake/verify pipeline)
- The Shield should immediately stop playback and navigate to FKB's Start URL

**Step 4: Confirm via FKB**

Re-run the `getDeviceInfo` command from Step 1. The `currentURL` should now match FKB's configured Start URL (likely `https://daylightlocal.kckern.net/screen/living-room` with no query).

**Step 5: Verify DS logs**

```bash
ssh homeserver.local 'docker logs --since 1m daylight-station 2>&1 | grep -E "trigger\.fired|device\.clearContent|fullykiosk\.sendCommand.*loadStartURL"'
```

Expected lines:
- `trigger.fired ... action=clear ok=true elapsedMs=<small>`
- `device.clearContent.start id=livingroom-tv`
- `device.clearContent.done id=livingroom-tv ok=true`
- `fullykiosk.sendCommand.success cmd=loadStartURL`

If anything fails, **stop and debug** — do not move on to HA wiring until clear works via curl.

---

### Task 9: HA wiring — REST command + automation

**Files (on prod):**
- Create: `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/rest_commands/state_changed.yaml`
- Create: `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/automations/livingroom_tv_state.yaml`
- Modify (if needed): `/media/kckern/DockerDrive/Docker/Home/homeassistant/configuration.yaml` — verify both directories are included via `!include_dir_named` or similar (check existing `nfc.yaml` is loaded).

**Step 1: Verify how HA loads existing rest_commands and automations**

```bash
ssh homeserver.local 'grep -E "rest_command|automation" /media/kckern/DockerDrive/Docker/Home/homeassistant/configuration.yaml'
```

Confirm that the `_includes/rest_commands/` and `_includes/automations/` directories are merged in. If they aren't, add them.

**Step 2: Write the REST command**

```bash
ssh homeserver.local 'cat > /media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/rest_commands/state_changed.yaml' <<'EOF'
# =============================================================================
# State Change Forwarder
# =============================================================================
# Forwards an abstracted display/TV state change to DaylightStation, which
# resolves it to a configured action (e.g. "clear" → FKB loadStartURL) via
# nfc.yml's `states:` block per location.
# =============================================================================

state_changed:
  url: http://daylight-station:3111/api/v1/trigger/{{ location }}/state/{{ value }}
  method: GET
  timeout: 30
EOF
```

**Step 3: Write the automation**

The HA-side abstraction lives here — `binary_sensor.living_room_tv_state` is the template sensor that already mirrors `binary_sensor.living_room_tv_power`. The user can add CEC/other signals to it later without changing this automation.

```bash
ssh homeserver.local 'cat > /media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/automations/livingroom_tv_state.yaml' <<'EOF'
id: livingroom_tv_state_to_daylight
alias: "Living Room TV State → DaylightStation"
description: "When the abstracted Living Room TV state turns off, fire DS clear."
mode: single
trigger:
  - platform: state
    entity_id: binary_sensor.living_room_tv_state
    to: 'off'
    for: '00:00:30'   # debounce: ignore brief signal flickers
action:
  - service: rest_command.state_changed
    continue_on_error: true
    data:
      location: livingroom
      value: 'off'
  - service: logbook.log
    data:
      name: "TV State"
      message: "Living Room TV → off (after 30s debounce); fired DS clear"
      domain: rest_command
      entity_id: rest_command.state_changed
EOF
```

**Step 4: Verify automation YAML loads (HA config check)**

```bash
ssh homeserver.local 'docker exec homeassistant python3 -m homeassistant --script check_config -c /config 2>&1 | tail -30'
```

(If HA's `check_config` command differs, look it up. Should report 0 errors.)

**Step 5: Restart HA**

```bash
ssh homeserver.local 'docker restart homeassistant'
```

Wait ~20s for boot.

**Step 6: Verify the new automation loaded**

```bash
TOKEN='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...REDACTED...'  # from data/household/auth or known secret
ssh homeserver.local "docker exec daylight-station sh -c 'wget -qO- --header=\"Authorization: Bearer $TOKEN\" http://homeassistant:8123/api/states/automation.living_room_tv_state_to_daylight'" | python3 -m json.tool
```

Expected: state `on` (automation enabled), and a friendly_name match.

---

### Task 10: End-to-end live test

**Goal:** Toggle the TV off in real life (or simulate via `switch.living_room_tv_plug`) and confirm the chain runs through HA → DS → FKB.

**Step 1: Start with a "running playback" state**

```bash
curl -sS "https://daylightlocal.kckern.net/api/v1/trigger/livingroom/nfc/83_8e_68_06"
```

Wait for `dispatch.ok: true`. Visually confirm Plex is playing on the Shield.

**Step 2: Turn off the TV (real)**

Press the TV's power button, or simulate by toggling the smart plug:

```bash
TOKEN='...'
ssh homeserver.local "docker exec daylight-station sh -c 'wget -qO- --post-data=\"\" --header=\"Authorization: Bearer $TOKEN\" --header=\"Content-Type: application/json\" http://homeassistant:8123/api/services/switch/turn_off' --data='{\"entity_id\":\"switch.living_room_tv_plug\"}'"
```

(Easier: just press the physical power button.)

**Step 3: Wait the debounce (30s) + a couple seconds slack**

Set a timer for 35s. During this time, the threshold sensor should drop below 30W → `binary_sensor.living_room_tv_power` flips off → template sensor follows → automation fires after 30s.

**Step 4: Verify HA fired the REST call**

```bash
ssh homeserver.local 'docker logs --since 2m homeassistant 2>&1 | grep -iE "Living Room TV State|state_changed|livingroom/state"'
```

Expected: a logbook line "Living Room TV → off ... fired DS clear" or similar.

**Step 5: Verify DS dispatched**

```bash
ssh homeserver.local 'docker logs --since 2m daylight-station 2>&1 | grep -E "trigger\.fired.*state|device\.clearContent|loadStartURL"'
```

Expected: `trigger.fired modality=state value=off action=clear ok=true`, then `device.clearContent.done`, then FKB success.

**Step 6: Turn the TV back on and confirm no auto-resume**

Press the TV power button. Wait for the screen to come up.

Expected: the Shield is on FKB's Start URL (the bare `/screen/living-room`), NOT the Plex player. The `?play=plex:620707` URL is gone — proves the clear took effect.

**Step 7: Edge-case test — flicker doesn't fire clear**

Turn off the TV and turn it back on within ~10 seconds (faster than the 30s debounce). Verify no `trigger.fired modality=state value=off` appears in DS logs. The 30s `for:` clause prevents flicker-storm.

---

### Task 11: Update memory + docs

**Step 1: Save a memory about the new modality**

Create `/Users/kckern/.claude/projects/-Users-kckern-Documents-GitHub-DaylightStation/memory/reference_state_modality.md`:

```markdown
---
name: State modality + clear action
description: New trigger modality `state` and action `clear` — HA fires when display/TV goes off, DS sends FKB to Start URL
type: reference
---

URL: `GET /api/v1/trigger/<location>/state/<value>` (e.g., `/livingroom/state/off`).

YAML lives in `data/household/config/nfc.yml` under each location's `states:` block:

\`\`\`yaml
livingroom:
  target: livingroom-tv
  action: play   # default for nfc
  tags: { ... }
  states:
    off:
      action: clear
\`\`\`

The `clear` action is **lightweight** — bypasses `wakeAndLoadService` entirely. It only calls `device.clearContent()` → `contentControl.loadStartUrl()` → FKB `cmd=loadStartURL`. Total dispatch is sub-second.

HA-side: automation listens to `binary_sensor.living_room_tv_state` (template) flipping off, with a 30s `for:` debounce to ignore HDMI flickers.

Parser is multi-modality (`parseTriggerConfig(raw)` no longer takes a `type` arg). All known modalities (`nfc`, `barcode`, `voice`, `state`) get parsed in one pass; entries are namespaced by modality in the registry: `entries[modality][value]`.
```

Add to `MEMORY.md`:

```markdown
## State Modality + Clear Action
- [reference_state_modality.md](reference_state_modality.md) — `state` trigger modality and `clear` action; HA TV-off → FKB Start URL
```

**Step 2: Update the per-CLAUDE Shield docs if relevant**

Already up-to-date for the IP fix; no changes needed unless you want to document the new modality URL there too. Skip unless asked.

---

## Final Verification Checklist

- [ ] All unit tests pass: `npm run test:unit`
- [ ] No `trigger.config.parse.failed` warning at DS startup
- [ ] Curl dry-run `/api/v1/trigger/livingroom/state/off?dryRun=1` returns `ok:true action:clear`
- [ ] Real curl fires < 2s (no wake/verify timing)
- [ ] FKB navigates to Start URL (verified via `getDeviceInfo`)
- [ ] HA automation enabled and visible in `/api/states/automation.living_room_tv_state_to_daylight`
- [ ] Live test: turning off the TV → 30s later → FKB on Start URL
- [ ] Flicker test: brief on/off cycle does NOT fire clear
- [ ] Existing NFC trigger still works (regression check)

---

## What's NOT in this plan (YAGNI)

- **Renaming `nfc.yml` to `triggers.yml`.** The file now hosts more than NFC, but renaming is a separate refactor that touches `bootstrap.mjs`, the file itself on prod, and the Shield/HA `CLAUDE.md` references. Defer unless someone trips on the misnomer.
- **`loadStartUrl` for `WebSocketContentAdapter` (office-tv).** Office doesn't currently have a TV-off trigger. When it does, add it then.
- **A generic `daylight_trigger` HA REST command** that could replace both `nfc_tag_scanned` and `state_changed`. Cleaner but requires touching the working NFC automation. Defer until there's a third modality to wire.
- **Multi-display support per location.** The location-level trigger fires regardless of which physical display went off. If you ever have a location with multiple displays needing distinct triggers, design then.
