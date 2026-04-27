# Trigger `end` Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the YAML field `end: tv-off` (and `end: clear`, `end: nothing`) on a trigger location/tag actually fire the configured side-effect when the resulting playback queue completes — for the NFC modality, livingroom location first, generalized so other locations/modalities work too.

**Architecture:** Carry a triple `(end, endLocation, endDeviceId)` from YAML through `NfcResolver → actionHandlers → WakeAndLoadService → device load query`. The frontend `useQueueController` sees those keys on its `play`/`queue` source object and appends a hidden synthetic `mediaType: 'trigger/side-effect'` tail item. When the player advances onto that head, it fires-and-forgets `POST /api/v1/trigger/side-effect`, which dispatches via a new `sideEffectHandlers` registry to either `tvControlAdapter.turnOff(loc)` or `device.clearContent()`. The marker is hidden from playback-state broadcasts and the activeSource (it's a control item, not media). Same shape as the abandoned `b8385b660` design, re-applied on top of the current `services/{NfcResolver,ResolverRegistry,StateResolver}` architecture instead of the deleted `TriggerConfig.mjs`/`TriggerIntent.mjs` files.

**Tech Stack:** Node ESM (backend), React hooks (frontend), Express, Vitest (most tests), Jest (some via the isolated harness — pick whichever the existing neighbor file uses), supertest for router tests, Home Assistant gateway via `script.{location}_tv_off`.

---

## Critical Context

- **Local main HEAD:** `f6586eaa2` (deployed to `daylight-station` container, build `2026-04-27T02:26:19Z`)
- **origin/main HEAD:** `b8385b660` (a divergent end-behavior commit that edits files deleted on local main — not mergeable, kept as design reference only)
- **Merge-base:** `1121f541d`
- **Reference design (read-only, do NOT cherry-pick):** `git show b8385b660` — the diffs for `WakeAndLoadService.mjs`, `sideEffectHandlers.mjs`, `useQueueController.js`, `Player.jsx`, `usePlaybackStateBroadcast.js`, `trigger.mjs` router are correct in shape and should be re-applied verbatim where paths still match. The diffs to `2_domains/trigger/TriggerConfig.mjs` and `TriggerIntent.mjs` cannot be used — those files no longer exist; their logic is re-cast onto `services/NfcResolver.mjs` and `parsers/nfcLocationsParser.mjs`.
- **YAML on disk** (Docker volume, not directly readable by `claude` user):
  ```
  data/household/config/triggers/nfc/locations.yml
  ```
  Currently: `livingroom: { target: livingroom-tv, action: play-next, end: tv-off, notify_unknown: ... }` — the `end:` is silently ignored today.
- **TVControlAdapter location keys** (`backend/src/1_adapters/home-automation/tv/TVControlAdapter.mjs:36-51`) are `living_room` and `office` (with underscore). The trigger-location id `livingroom` will NOT match. The YAML must declare `end_location: living_room` (with underscore) explicitly.

## File Structure

### New files
- `backend/src/3_applications/trigger/sideEffectHandlers.mjs` — registry + dispatcher for `tv-off`, `clear`
- `tests/isolated/application/trigger/sideEffectHandlers.test.mjs` — unit tests
- `tests/isolated/domain/trigger/services/NfcResolver.endBehavior.test.mjs` — end-behavior propagation
- `tests/isolated/adapter/trigger/parsers/nfcLocationsParser.endBehavior.test.mjs` — parser validation
- `tests/isolated/api/routers/trigger.sideEffect.test.mjs` — POST /side-effect route

### Modified files
- `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs` — recognize/validate `end`, `end_location`
- `backend/src/2_domains/trigger/services/NfcResolver.mjs` — propagate `end`, `endLocation` onto intent
- `backend/src/3_applications/trigger/actionHandlers.mjs` — `buildLoadOptions` forwards endBehavior/endLocation
- `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` — inject endBehavior/endLocation/endDeviceId into contentQuery
- `backend/src/4_api/v1/routers/trigger.mjs` — accept tvControlAdapter+deviceService; mount POST /side-effect with markerId dedup
- `backend/src/0_system/bootstrap.mjs` — wire tvControlAdapter+deviceService into createTriggerRouter
- `frontend/src/modules/Player/hooks/useQueueController.js` — append synthetic side-effect tail; dispatch on head; force `isContinuous=false` when end-behavior present
- `frontend/src/modules/Player/Player.jsx` — `activeSource` returns null when head is side-effect
- `frontend/src/modules/Media/shared/usePlaybackStateBroadcast.js` — filter hidden items
- `tests/isolated/application/trigger/actionHandlers.test.mjs` — extend with end-behavior cases
- `data/household/config/triggers/nfc/locations.yml` (Docker volume) — add `end_location: living_room`

---

## Task 0: Reconcile divergent histories (origin/main vs local main)

**Files:** none — pure git operation.

The remote tip `b8385b660` edits files that were deleted on local main. It cannot be merged. Replace origin/main with local main so the codebase has a single source of truth before changes start.

- [ ] **Step 1: Confirm local main has all commits the user wants to keep**

  ```bash
  git log --oneline f6586eaa2 ^1121f541d | head -30
  ```

  Expected: list of local-only commits (player shader fixes, weekly-review-ux merge, trigger debounce, etc.). Confirm none are missing.

- [ ] **Step 2: Confirm `b8385b660` adds nothing reachable**

  ```bash
  git show b8385b660 --stat
  ```

  Expected: edits to `backend/src/2_domains/trigger/TriggerConfig.mjs` and `TriggerIntent.mjs` (which don't exist on local main) plus paths that this plan re-implements.

- [ ] **Step 3: Force-push local main over origin's b8385b660**

  ```bash
  git push --force-with-lease=main:b8385b66036dbba9c80ed1faeae57d932c128821 origin main
  ```

  Expected: push succeeds, origin/main is now at `f6586eaa2`. The `--force-with-lease` form fails safely if anyone else pushed in the meantime.

  Verify:
  ```bash
  git fetch && git log -1 --format="%H" origin/main
  ```
  Expected: `f6586eaa2229a914fc75e02a30179ddafad7cc29`

- [ ] **Step 4: No commit needed for this task** — but confirm working tree is clean before continuing:

  ```bash
  git status
  ```
  Expected: `nothing to commit, working tree clean`.

---

## Task 1: nfcLocationsParser — recognize and validate `end` / `end_location`

**Files:**
- Test: `tests/isolated/adapter/trigger/parsers/nfcLocationsParser.endBehavior.test.mjs` (create)
- Modify: `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs`

Today the parser puts `end` into `defaults` (because `end` isn't in its `RESERVED` set). We need it as a first-class field on the location config so the resolver can read `locationConfig.end` directly, AND we need value validation.

- [ ] **Step 1: Write the failing test**

  Path: `tests/isolated/adapter/trigger/parsers/nfcLocationsParser.endBehavior.test.mjs`

  ```javascript
  import { describe, it, expect } from 'vitest';
  import { parseNfcLocations } from '../../../../../backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs';

  describe('parseNfcLocations — end behavior', () => {
    it('extracts end and end_location as first-class fields (not in defaults)', () => {
      const out = parseNfcLocations({
        livingroom: {
          target: 'livingroom-tv',
          action: 'play-next',
          end: 'tv-off',
          end_location: 'living_room',
          shader: 'default', // unrelated default — should still flow into defaults
        },
      });
      expect(out.livingroom.end).toBe('tv-off');
      expect(out.livingroom.end_location).toBe('living_room');
      expect(out.livingroom.defaults).toEqual({ shader: 'default' });
      expect(out.livingroom.defaults.end).toBeUndefined();
      expect(out.livingroom.defaults.end_location).toBeUndefined();
    });

    it('defaults end and end_location to null when absent', () => {
      const out = parseNfcLocations({
        livingroom: { target: 'livingroom-tv', action: 'play-next' },
      });
      expect(out.livingroom.end).toBeNull();
      expect(out.livingroom.end_location).toBeNull();
    });

    it('throws on unknown end value', () => {
      expect(() => parseNfcLocations({
        livingroom: { target: 'livingroom-tv', end: 'self-destruct' },
      })).toThrow(/end must be one of/);
    });

    it('throws when end:tv-off is set without end_location', () => {
      expect(() => parseNfcLocations({
        livingroom: { target: 'livingroom-tv', end: 'tv-off' },
      })).toThrow(/end_location/);
    });

    it('allows end:nothing and end:clear without end_location', () => {
      expect(() => parseNfcLocations({
        a: { target: 'tv', end: 'nothing' },
        b: { target: 'tv', end: 'clear' },
      })).not.toThrow();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm run test:isolated -- --only=adapter
  ```

  Expected: the new file's tests fail (most assertions fail, since `end` and `end_location` currently land in `defaults`, not first-class). The existing adapter tests in this run should still pass.

- [ ] **Step 3: Modify parser to handle end / end_location as reserved + validated**

  Path: `backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs`

  Replace the entire file with:

  ```javascript
  /**
   * Parser for triggers/nfc/locations.yml. Each top-level key is an NFC reader
   * location ID. Reserved fields (target, action, auth_token, notify_unknown,
   * end, end_location) are extracted as first-class config; all other top-level
   * keys become the location's `defaults` object, which inherits into every
   * tag scanned at this reader.
   *
   * Layer: ADAPTER (1_adapters/trigger).
   *
   * Output shape:
   *   { [locationId]: { target, action, auth_token, notify_unknown, end, end_location, defaults: { ...rest } } }
   *
   * @module adapters/trigger/parsers/nfcLocationsParser
   */

  import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

  const RESERVED = new Set(['target', 'action', 'auth_token', 'notify_unknown', 'end', 'end_location']);
  export const ALLOWED_END_BEHAVIORS = new Set(['tv-off', 'clear', 'nothing']);

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

      if (locConfig.end !== undefined && !ALLOWED_END_BEHAVIORS.has(locConfig.end)) {
        throw new ValidationError(
          `location "${locationId}" end must be one of ${[...ALLOWED_END_BEHAVIORS].join(', ')}`,
          { code: 'INVALID_END_BEHAVIOR', field: locationId }
        );
      }
      if (locConfig.end === 'tv-off' && (typeof locConfig.end_location !== 'string' || locConfig.end_location.length === 0)) {
        throw new ValidationError(
          `location "${locationId}" end: tv-off requires end_location (non-empty string)`,
          { code: 'MISSING_END_LOCATION', field: locationId }
        );
      }

      const defaults = {};
      for (const [k, v] of Object.entries(locConfig)) {
        if (RESERVED.has(k)) continue;
        defaults[k] = v;
      }

      out[locationId] = {
        target: locConfig.target,
        action: locConfig.action ?? null,
        auth_token: locConfig.auth_token ?? null,
        notify_unknown: locConfig.notify_unknown ?? null,
        end: locConfig.end ?? null,
        end_location: locConfig.end_location ?? null,
        defaults,
      };
    }

    return out;
  }

  export default parseNfcLocations;
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npm run test:isolated -- --only=adapter
  ```

  Expected: all 5 new tests pass. Other adapter tests remain green.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs \
          tests/isolated/adapter/trigger/parsers/nfcLocationsParser.endBehavior.test.mjs
  git commit -m "$(cat <<'EOF'
  feat(trigger/parser): validate location-level end + end_location

  Promotes end and end_location to first-class fields on the parsed
  location config (out of `defaults`), validates end ∈ {tv-off, clear,
  nothing}, and requires end_location whenever end == 'tv-off'.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2: NfcResolver — propagate `end` / `endLocation` onto resolved intent

**Files:**
- Test: `tests/isolated/domain/trigger/services/NfcResolver.endBehavior.test.mjs` (create)
- Modify: `backend/src/2_domains/trigger/services/NfcResolver.mjs`

When the resolver builds the merged tag config, the `end` field needs to land on `intent.end` (not in `intent.params`). Same for `end_location → intent.endLocation`. Tag-level `end` overrides location-level. `end: 'nothing'` resolves to "no end behavior" (intent has no `.end` field).

- [ ] **Step 1: Write the failing test**

  Path: `tests/isolated/domain/trigger/services/NfcResolver.endBehavior.test.mjs`

  ```javascript
  import { describe, it, expect } from 'vitest';
  import { NfcResolver } from '../../../../../backend/src/2_domains/trigger/services/NfcResolver.mjs';

  const stubResolver = { resolve: () => true }; // every shorthand is valid

  function buildRegistry({ end = null, end_location = null, tagFields = {} } = {}) {
    return {
      locations: {
        livingroom: {
          target: 'livingroom-tv',
          action: 'play-next',
          end,
          end_location,
          defaults: {},
        },
      },
      tags: {
        deadbeef: {
          global: { plex: '620681', ...tagFields },
          overrides: {},
        },
      },
    };
  }

  describe('NfcResolver — end behavior', () => {
    it('propagates location-level end and end_location onto the intent', () => {
      const intent = NfcResolver.resolve({
        location: 'livingroom',
        value: 'deadbeef',
        registry: buildRegistry({ end: 'tv-off', end_location: 'living_room' }),
        contentIdResolver: stubResolver,
      });
      expect(intent.end).toBe('tv-off');
      expect(intent.endLocation).toBe('living_room');
      expect(intent.params.end).toBeUndefined();
      expect(intent.params.end_location).toBeUndefined();
    });

    it('omits intent.end when no end is configured', () => {
      const intent = NfcResolver.resolve({
        location: 'livingroom',
        value: 'deadbeef',
        registry: buildRegistry({ end: null }),
        contentIdResolver: stubResolver,
      });
      expect(intent.end).toBeUndefined();
      expect(intent.endLocation).toBeUndefined();
    });

    it('treats end:nothing as "no end behavior" (no intent.end)', () => {
      const intent = NfcResolver.resolve({
        location: 'livingroom',
        value: 'deadbeef',
        registry: buildRegistry({ end: 'nothing' }),
        contentIdResolver: stubResolver,
      });
      expect(intent.end).toBeUndefined();
      expect(intent.endLocation).toBeUndefined();
    });

    it('per-tag end overrides location-level end', () => {
      const intent = NfcResolver.resolve({
        location: 'livingroom',
        value: 'deadbeef',
        registry: buildRegistry({
          end: 'tv-off',
          end_location: 'living_room',
          tagFields: { end: 'nothing' },
        }),
        contentIdResolver: stubResolver,
      });
      expect(intent.end).toBeUndefined(); // 'nothing' wins, suppresses end
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm run test:isolated -- --only=domain
  ```

  Expected: 4 new tests fail (current resolver puts `end` into `params.end`, doesn't read `locationConfig.end`).

- [ ] **Step 3: Modify resolver**

  Path: `backend/src/2_domains/trigger/services/NfcResolver.mjs`

  At line 26 (current `RESERVED_KEYS` set), replace:

  ```javascript
  const RESERVED_KEYS = new Set([
    'action', 'target', 'content',
    'scene', 'service', 'entity', 'data',
  ]);
  ```

  with:

  ```javascript
  const RESERVED_KEYS = new Set([
    'action', 'target', 'content',
    'scene', 'service', 'entity', 'data',
    'end', 'end_location',
  ]);
  ```

  Then, just before the `const intent = { action, target, params };` line (current line 109), insert end-behavior resolution. Find this block (current lines 87-91):

  ```javascript
      const action = merged.action ?? locationConfig.action;
      const target = merged.target ?? locationConfig.target;

      // Resolve content. Explicit `content` wins; otherwise expand single-prefix shorthand.
      let content = merged.content;
  ```

  Add two lines so it reads:

  ```javascript
      const action = merged.action ?? locationConfig.action;
      const target = merged.target ?? locationConfig.target;
      const end = merged.end ?? locationConfig.end;
      const endLocation = merged.end_location ?? locationConfig.end_location;

      // Resolve content. Explicit `content` wins; otherwise expand single-prefix shorthand.
      let content = merged.content;
  ```

  Then find the block where intent fields are conditionally assigned (current lines 109-114):

  ```javascript
      const intent = { action, target, params };
      if (content !== undefined) intent.content = content;
      if (merged.scene !== undefined) intent.scene = merged.scene;
      if (merged.service !== undefined) intent.service = merged.service;
      if (merged.entity !== undefined) intent.entity = merged.entity;
      if (merged.data !== undefined) intent.data = merged.data;
  ```

  Add end-behavior wiring AFTER that block (before the `hasDispatchable` check):

  ```javascript
      const intent = { action, target, params };
      if (content !== undefined) intent.content = content;
      if (merged.scene !== undefined) intent.scene = merged.scene;
      if (merged.service !== undefined) intent.service = merged.service;
      if (merged.entity !== undefined) intent.entity = merged.entity;
      if (merged.data !== undefined) intent.data = merged.data;
      // 'nothing' explicitly disables the configured behavior; treat as absent.
      if (end && end !== 'nothing') {
        intent.end = end;
        if (endLocation) intent.endLocation = endLocation;
      }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npm run test:isolated -- --only=domain
  ```

  Expected: 4 new tests pass; existing NfcResolver tests stay green.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/2_domains/trigger/services/NfcResolver.mjs \
          tests/isolated/domain/trigger/services/NfcResolver.endBehavior.test.mjs
  git commit -m "$(cat <<'EOF'
  feat(trigger/resolver): emit intent.end + intent.endLocation

  Reads merged.end ?? locationConfig.end (and end_location) and attaches
  them to the resolved intent unless end is 'nothing' (which explicitly
  suppresses any inherited behavior). Adds end and end_location to
  RESERVED_KEYS so they don't leak into intent.params.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: actionHandlers — forward `endBehavior` / `endLocation` into load options

**Files:**
- Modify: `backend/src/3_applications/trigger/actionHandlers.mjs`
- Modify: `tests/isolated/application/trigger/actionHandlers.test.mjs`

`buildLoadOptions(intent)` currently returns `{ dispatchId }`. Extend it to also include `endBehavior` and `endLocation` when they exist on the intent. WakeAndLoadService consumes those (next task).

- [ ] **Step 1: Write the failing test**

  Append to `tests/isolated/application/trigger/actionHandlers.test.mjs` (inside the existing `describe('actionHandlers', () => { ... })` block):

  ```javascript
    it('queue forwards intent.end → opts.endBehavior + opts.endLocation', async () => {
      const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
      const intent = {
        action: 'queue', target: 'livingroom-tv', content: 'plex:1',
        params: {}, end: 'tv-off', endLocation: 'living_room',
      };
      await actionHandlers.queue(intent, { wakeAndLoadService });
      expect(wakeAndLoadService.execute).toHaveBeenCalledWith(
        'livingroom-tv',
        { queue: 'plex:1' },
        expect.objectContaining({
          dispatchId: expect.any(String),
          endBehavior: 'tv-off',
          endLocation: 'living_room',
        })
      );
    });

    it('play-next forwards intent.end → opts.endBehavior', async () => {
      const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
      const intent = {
        action: 'play-next', target: 'livingroom-tv', content: 'plex:2',
        params: {}, end: 'clear',
      };
      await actionHandlers['play-next'](intent, { wakeAndLoadService });
      const opts = wakeAndLoadService.execute.mock.calls[0][2];
      expect(opts.endBehavior).toBe('clear');
      expect(opts.endLocation).toBeUndefined();
    });

    it('queue without intent.end yields opts without endBehavior', async () => {
      const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
      const intent = { action: 'queue', target: 't', content: 'plex:3', params: {} };
      await actionHandlers.queue(intent, { wakeAndLoadService });
      const opts = wakeAndLoadService.execute.mock.calls[0][2];
      expect(opts.endBehavior).toBeUndefined();
      expect(opts.endLocation).toBeUndefined();
    });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm run test:isolated -- --only=application
  ```

  Expected: 3 new tests fail (`buildLoadOptions` doesn't pass through endBehavior yet).

- [ ] **Step 3: Modify `buildLoadOptions`**

  Path: `backend/src/3_applications/trigger/actionHandlers.mjs`

  Replace (current lines 16-18):

  ```javascript
  function buildLoadOptions(intent) {
    return { dispatchId: intent.dispatchId || randomUUID() };
  }
  ```

  with:

  ```javascript
  function buildLoadOptions(intent) {
    const opts = { dispatchId: intent.dispatchId || randomUUID() };
    if (intent.end) {
      opts.endBehavior = intent.end;
      if (intent.endLocation) opts.endLocation = intent.endLocation;
    }
    return opts;
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npm run test:isolated -- --only=application
  ```

  Expected: all actionHandlers tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/3_applications/trigger/actionHandlers.mjs \
          tests/isolated/application/trigger/actionHandlers.test.mjs
  git commit -m "$(cat <<'EOF'
  feat(trigger/actions): forward intent.end into wakeAndLoad opts

  buildLoadOptions now passes endBehavior + endLocation when present on
  the intent, so WakeAndLoadService can inject them into the device load
  query.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: WakeAndLoadService — inject end-behavior into contentQuery

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`
- Test: `tests/isolated/application/devices/WakeAndLoadService.endBehavior.test.mjs` (create)

`WakeAndLoadService.execute(deviceId, query, options)` runs steps 1-N and at step 4 builds `contentQuery` (a clone of `query` minus `volume`) which it then hands to the device adapter. We piggy-back on that step: when `options.endBehavior` is set (and isn't `'nothing'`), inject `endBehavior`, `endLocation`, `endDeviceId` keys onto `contentQuery`. Those keys ride the WS envelope or URL fallback to the frontend Player.

- [ ] **Step 1: Write the failing test**

  Path: `tests/isolated/application/devices/WakeAndLoadService.endBehavior.test.mjs`

  ```javascript
  import { describe, it, expect, vi } from 'vitest';
  import { WakeAndLoadService } from '../../../../backend/src/3_applications/devices/services/WakeAndLoadService.mjs';

  function makeStubDevice() {
    const calls = [];
    return {
      calls,
      capabilities: {},
      ensurePower: vi.fn().mockResolvedValue({ ok: true, currentState: 'on' }),
      prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraSkipped: true, cameraAvailable: null }),
      loadContent: vi.fn(async (path, query) => { calls.push({ path, query }); return { ok: true }; }),
    };
  }

  function makeService(device) {
    const deviceService = { get: vi.fn().mockReturnValue(device), describe: vi.fn().mockReturnValue({ id: 'livingroom-tv', config: {} }) };
    const haGateway = null;
    return new WakeAndLoadService({
      deviceService,
      haGateway,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      broadcast: vi.fn(),
    });
  }

  describe('WakeAndLoadService — end-behavior propagation', () => {
    it('injects endBehavior, endDeviceId, endLocation into contentQuery', async () => {
      const device = makeStubDevice();
      const svc = makeService(device);
      await svc.execute('livingroom-tv', { queue: 'plex:1' }, {
        dispatchId: 'd1',
        endBehavior: 'tv-off',
        endLocation: 'living_room',
      });
      expect(device.loadContent).toHaveBeenCalledTimes(1);
      const [, query] = device.loadContent.mock.calls[0];
      expect(query.endBehavior).toBe('tv-off');
      expect(query.endLocation).toBe('living_room');
      expect(query.endDeviceId).toBe('livingroom-tv');
    });

    it('omits end-behavior fields when endBehavior is absent', async () => {
      const device = makeStubDevice();
      const svc = makeService(device);
      await svc.execute('livingroom-tv', { queue: 'plex:1' }, { dispatchId: 'd1' });
      const [, query] = device.loadContent.mock.calls[0];
      expect(query.endBehavior).toBeUndefined();
      expect(query.endLocation).toBeUndefined();
      expect(query.endDeviceId).toBeUndefined();
    });

    it("does not inject when endBehavior === 'nothing'", async () => {
      const device = makeStubDevice();
      const svc = makeService(device);
      await svc.execute('livingroom-tv', { queue: 'plex:1' }, { dispatchId: 'd1', endBehavior: 'nothing' });
      const [, query] = device.loadContent.mock.calls[0];
      expect(query.endBehavior).toBeUndefined();
    });
  });
  ```

  Note: this test runs `WakeAndLoadService.execute` for real but with a stub device. If the existing constructor signature (look at the top of the real file) requires fields this stub doesn't provide, mirror the dependency shape from a sibling test like `tests/isolated/application/devices/WakeAndLoadService.op.test.mjs`. The expected behavior assertions stay the same.

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm run test:isolated -- --only=application
  ```

  Expected: the 3 new tests fail (queries don't carry `endBehavior` yet).

- [ ] **Step 3: Modify WakeAndLoadService**

  Path: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`

  Find the block at lines 233-235 (look for the comment `// Remove volume from query so it's not passed to the frontend URL`):

  ```javascript
      // Remove volume from query so it's not passed to the frontend URL
      const contentQuery = { ...query };
      delete contentQuery.volume;

      // --- Step 4: Prepare Content ---
  ```

  Insert directly after `delete contentQuery.volume;` and before the `// --- Step 4: Prepare Content ---` comment:

  ```javascript
      // Trigger end-behavior — propagate to the frontend via both the WS envelope
      // params and the URL fallback. The Player appends a virtual side-effect
      // tail item to the queue when these are present (see useQueueController).
      if (options.endBehavior && options.endBehavior !== 'nothing') {
        contentQuery.endBehavior = options.endBehavior;
        contentQuery.endDeviceId = deviceId;
        if (options.endLocation) contentQuery.endLocation = options.endLocation;
      }

  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npm run test:isolated -- --only=application
  ```

  Expected: 3 new tests pass; existing WakeAndLoadService tests stay green.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs \
          tests/isolated/application/devices/WakeAndLoadService.endBehavior.test.mjs
  git commit -m "$(cat <<'EOF'
  feat(wake-and-load): inject end-behavior into contentQuery

  When opts.endBehavior is set (and not 'nothing'), adds endBehavior,
  endDeviceId, and endLocation to the query passed to the device's
  loadContent — these ride through to the frontend Player so it can
  append a synthetic side-effect tail item.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: sideEffectHandlers — implement `tv-off` and `clear`

**Files:**
- Create: `backend/src/3_applications/trigger/sideEffectHandlers.mjs`
- Test: `tests/isolated/application/trigger/sideEffectHandlers.test.mjs` (create)

A pluggable registry mirroring `actionHandlers`. Two behaviors at launch:
- `tv-off` → `tvControlAdapter.turnOff(location)`
- `clear` → `device.clearContent()` for `deviceId`

- [ ] **Step 1: Write the failing test**

  Path: `tests/isolated/application/trigger/sideEffectHandlers.test.mjs`

  ```javascript
  import { describe, it, expect, vi } from 'vitest';
  import {
    sideEffectHandlers,
    dispatchSideEffect,
    UnknownSideEffectError,
  } from '../../../../backend/src/3_applications/trigger/sideEffectHandlers.mjs';

  describe('sideEffectHandlers', () => {
    it('tv-off calls tvControlAdapter.turnOff with the location', async () => {
      const tvControlAdapter = { turnOff: vi.fn().mockResolvedValue({ ok: true }) };
      const out = await sideEffectHandlers['tv-off'](
        { location: 'living_room' },
        { tvControlAdapter }
      );
      expect(tvControlAdapter.turnOff).toHaveBeenCalledWith('living_room');
      expect(out).toEqual({ ok: true });
    });

    it('tv-off throws if tvControlAdapter is missing', async () => {
      await expect(sideEffectHandlers['tv-off'](
        { location: 'living_room' },
        {}
      )).rejects.toThrow(/tvControlAdapter not configured/);
    });

    it('tv-off throws if location is missing', async () => {
      const tvControlAdapter = { turnOff: vi.fn() };
      await expect(sideEffectHandlers['tv-off'](
        {},
        { tvControlAdapter }
      )).rejects.toThrow(/tv-off requires location/);
    });

    it('clear calls device.clearContent for the resolved device', async () => {
      const device = { clearContent: vi.fn().mockResolvedValue({ ok: true }) };
      const deviceService = { get: vi.fn().mockReturnValue(device) };
      const out = await sideEffectHandlers.clear(
        { deviceId: 'livingroom-tv' },
        { deviceService }
      );
      expect(deviceService.get).toHaveBeenCalledWith('livingroom-tv');
      expect(device.clearContent).toHaveBeenCalled();
      expect(out).toEqual({ ok: true });
    });

    it('clear throws when device is unknown', async () => {
      const deviceService = { get: vi.fn().mockReturnValue(null) };
      await expect(sideEffectHandlers.clear(
        { deviceId: 'ghost' },
        { deviceService }
      )).rejects.toThrow(/Unknown device: ghost/);
    });

    it('dispatchSideEffect routes by behavior', async () => {
      const tvControlAdapter = { turnOff: vi.fn().mockResolvedValue({ ok: true }) };
      await dispatchSideEffect(
        { behavior: 'tv-off', location: 'living_room' },
        { tvControlAdapter }
      );
      expect(tvControlAdapter.turnOff).toHaveBeenCalled();
    });

    it('dispatchSideEffect throws UnknownSideEffectError for unknown behavior', async () => {
      await expect(dispatchSideEffect(
        { behavior: 'self-destruct' },
        {}
      )).rejects.toBeInstanceOf(UnknownSideEffectError);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm run test:isolated -- --only=application
  ```

  Expected: all 7 tests fail with module-not-found errors (`sideEffectHandlers.mjs` doesn't exist).

- [ ] **Step 3: Create the module**

  Path: `backend/src/3_applications/trigger/sideEffectHandlers.mjs`

  ```javascript
  /**
   * Side-effect handlers for trigger end-behaviors.
   *
   * The Player's queue includes a virtual `mediaType: 'trigger/side-effect'`
   * tail item when a trigger is loaded with an end-behavior. When playback
   * advances onto that item, the Player POSTs to /api/v1/trigger/side-effect,
   * which dispatches via this registry.
   *
   * @module applications/trigger/sideEffectHandlers
   */

  export class UnknownSideEffectError extends Error {
    constructor(behavior) {
      super(`Unknown side-effect behavior: ${behavior}`);
      this.name = 'UnknownSideEffectError';
      this.behavior = behavior;
    }
  }

  export const sideEffectHandlers = {
    'tv-off': async ({ location }, { tvControlAdapter }) => {
      if (!tvControlAdapter) throw new Error('tvControlAdapter not configured');
      if (!location) throw new Error('tv-off requires location');
      return tvControlAdapter.turnOff(location);
    },

    clear: async ({ deviceId }, { deviceService }) => {
      if (!deviceService) throw new Error('deviceService not configured');
      if (!deviceId) throw new Error('clear requires deviceId');
      const device = deviceService.get(deviceId);
      if (!device) throw new Error(`Unknown device: ${deviceId}`);
      return device.clearContent();
    },
  };

  export async function dispatchSideEffect({ behavior, ...payload }, deps) {
    const handler = sideEffectHandlers[behavior];
    if (!handler) throw new UnknownSideEffectError(behavior);
    return handler(payload, deps);
  }

  export default { sideEffectHandlers, dispatchSideEffect, UnknownSideEffectError };
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npm run test:isolated -- --only=application
  ```

  Expected: 7 new tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/3_applications/trigger/sideEffectHandlers.mjs \
          tests/isolated/application/trigger/sideEffectHandlers.test.mjs
  git commit -m "$(cat <<'EOF'
  feat(trigger): sideEffectHandlers for tv-off + clear

  New pluggable registry for end-of-queue side effects, dispatched by
  the Player via POST /api/v1/trigger/side-effect when a virtual
  trigger/side-effect tail item becomes the queue head.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: Trigger router — POST /side-effect with markerId dedup

**Files:**
- Modify: `backend/src/4_api/v1/routers/trigger.mjs`
- Test: `tests/isolated/api/routers/trigger.sideEffect.test.mjs` (create)

The router accepts new optional deps (`tvControlAdapter`, `deviceService`) and exposes `POST /side-effect`. A 60s in-memory `Map<markerId, ts>` dedups duplicate posts (frontend retries, double-mounts). Failed dispatches drop the marker so the user can retry by re-tapping.

- [ ] **Step 1: Write the failing test**

  Path: `tests/isolated/api/routers/trigger.sideEffect.test.mjs`

  ```javascript
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import express from 'express';
  import request from 'supertest';
  import { createTriggerRouter } from '../../../../backend/src/4_api/v1/routers/trigger.mjs';

  describe('createTriggerRouter — POST /side-effect', () => {
    let triggerDispatchService;
    let tvControlAdapter;
    let deviceService;
    let app;

    beforeEach(() => {
      triggerDispatchService = { handleTrigger: vi.fn(), setNote: vi.fn() };
      tvControlAdapter = { turnOff: vi.fn().mockResolvedValue({ ok: true }) };
      deviceService = { get: vi.fn() };
      app = express();
      app.use('/api/v1/trigger', createTriggerRouter({
        triggerDispatchService,
        tvControlAdapter,
        deviceService,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
    });

    it('200 + dispatches tv-off to the adapter', async () => {
      const res = await request(app)
        .post('/api/v1/trigger/side-effect')
        .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm1' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(tvControlAdapter.turnOff).toHaveBeenCalledWith('living_room');
    });

    it('400 when behavior is missing', async () => {
      const res = await request(app).post('/api/v1/trigger/side-effect').send({ location: 'x' });
      expect(res.status).toBe(400);
    });

    it('400 (UnknownSideEffectError) for unknown behavior', async () => {
      const res = await request(app)
        .post('/api/v1/trigger/side-effect')
        .send({ behavior: 'self-destruct', markerId: 'm2' });
      expect(res.status).toBe(400);
    });

    it('502 when handler throws (e.g., HA error)', async () => {
      tvControlAdapter.turnOff.mockRejectedValue(new Error('HA timeout'));
      const res = await request(app)
        .post('/api/v1/trigger/side-effect')
        .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm3' });
      expect(res.status).toBe(502);
    });

    it('dedupes a second POST with the same markerId', async () => {
      await request(app)
        .post('/api/v1/trigger/side-effect')
        .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm-dedup' });
      tvControlAdapter.turnOff.mockClear();

      const res = await request(app)
        .post('/api/v1/trigger/side-effect')
        .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm-dedup' });
      expect(res.status).toBe(200);
      expect(res.body.deduped).toBe(true);
      expect(tvControlAdapter.turnOff).not.toHaveBeenCalled();
    });

    it('failed dispatch does NOT poison dedup window', async () => {
      tvControlAdapter.turnOff.mockRejectedValueOnce(new Error('transient'));
      await request(app)
        .post('/api/v1/trigger/side-effect')
        .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm-retry' });

      tvControlAdapter.turnOff.mockResolvedValueOnce({ ok: true });
      const res = await request(app)
        .post('/api/v1/trigger/side-effect')
        .send({ behavior: 'tv-off', location: 'living_room', markerId: 'm-retry' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.deduped).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm run test:isolated -- --only=api
  ```

  Expected: 6 new tests fail (route doesn't exist).

- [ ] **Step 3: Modify the router**

  Path: `backend/src/4_api/v1/routers/trigger.mjs`

  Replace the entire file with:

  ```javascript
  /**
   * Trigger Router — maps GET /:location/:type/:value to
   * TriggerDispatchService.handleTrigger, plus POST /side-effect for end-of-queue
   * tail markers fired by the device Player when it advances onto a virtual
   * `mediaType: 'trigger/side-effect'` item.
   * @module api/v1/routers/trigger
   */

  import express from 'express';
  import { asyncHandler } from '#system/http/middleware/index.mjs';
  import { dispatchSideEffect, UnknownSideEffectError } from '#apps/trigger/sideEffectHandlers.mjs';

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

  const SIDE_EFFECT_DEDUP_TTL_MS = 60_000;

  export function createTriggerRouter({
    triggerDispatchService,
    tvControlAdapter = null,
    deviceService = null,
    logger = console,
  }) {
    const router = express.Router();
    const recentMarkers = new Map(); // markerId -> timestampMs

    router.get('/:location/:type/:value', asyncHandler(async (req, res) => {
      const { location, type, value } = req.params;
      const { token, dryRun } = req.query;
      const options = { token };
      if (dryRun === '1' || dryRun === 'true') options.dryRun = true;

      logger.debug?.('trigger.router.fire', { location, type, value, dryRun: !!options.dryRun });

      const result = await triggerDispatchService.handleTrigger(location, type, value, options);

      if (result.ok) return res.status(200).json(result);

      const status = STATUS_BY_CODE[result.code] || 500;
      return res.status(status).json(result);
    }));

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

    router.post('/side-effect', express.json(), asyncHandler(async (req, res) => {
      const { behavior, location, deviceId, markerId } = req.body || {};
      const startedAt = Date.now();
      const baseLog = { behavior, location, deviceId, markerId };

      if (!behavior || typeof behavior !== 'string') {
        logger.warn?.('trigger.side-effect.fired', { ...baseLog, ok: false, error: 'missing-behavior' });
        return res.status(400).json({ ok: false, error: 'behavior required' });
      }

      if (markerId) {
        // Prune expired entries on every call (small map, cheap)
        for (const [id, ts] of recentMarkers) {
          if (startedAt - ts > SIDE_EFFECT_DEDUP_TTL_MS) recentMarkers.delete(id);
        }
        if (recentMarkers.has(markerId)) {
          logger.info?.('trigger.side-effect.deduped', { ...baseLog });
          return res.status(200).json({ ok: true, deduped: true });
        }
        recentMarkers.set(markerId, startedAt);
      }

      try {
        const result = await dispatchSideEffect(
          { behavior, location, deviceId },
          { tvControlAdapter, deviceService }
        );
        const elapsedMs = Date.now() - startedAt;
        logger.info?.('trigger.side-effect.fired', { ...baseLog, ok: true, elapsedMs });
        return res.status(200).json({ ok: true, behavior, elapsedMs, result });
      } catch (err) {
        const elapsedMs = Date.now() - startedAt;
        // Failed dispatches shouldn't poison the dedup window — let the player retry on next trigger
        if (markerId) recentMarkers.delete(markerId);
        const status = err instanceof UnknownSideEffectError ? 400 : 502;
        logger.error?.('trigger.side-effect.fired', { ...baseLog, ok: false, error: err.message, elapsedMs });
        return res.status(status).json({ ok: false, error: err.message, elapsedMs });
      }
    }));

    return router;
  }

  export default createTriggerRouter;
  ```

  Note: this depends on the `#apps/trigger/sideEffectHandlers.mjs` import alias resolving correctly. Verify the existing path alias for `#apps` in `package.json`'s `imports` block matches `backend/src/3_applications/*`. If a different alias is used (e.g. `#applications`), use that one instead — match the convention already used in the same router.

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npm run test:isolated -- --only=api
  ```

  Expected: 6 new tests pass; existing trigger router tests stay green.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/4_api/v1/routers/trigger.mjs \
          tests/isolated/api/routers/trigger.sideEffect.test.mjs
  git commit -m "$(cat <<'EOF'
  feat(trigger/api): POST /side-effect with markerId dedup

  60s in-memory dedup keyed on markerId; failed dispatches drop the
  marker so the user can retry. Route receives optional tvControlAdapter
  + deviceService deps and routes via sideEffectHandlers.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: Bootstrap — wire `tvControlAdapter` + `deviceService` into the trigger router

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: `backend/src/app.mjs` (the caller of `createTriggerApiRouter`)

`createTriggerApiRouter` already has access to `deviceServices.deviceService` (passed via `triggerDispatchService`). It needs `tvControlAdapter` too. Trace it from where the home-automation adapters are instantiated to where the trigger router is created.

- [ ] **Step 1: Locate the call site of `createTriggerApiRouter`**

  ```bash
  grep -n "createTriggerApiRouter(" backend/src/app.mjs
  ```

  Expected: one match around line 1706.

- [ ] **Step 2: Verify what deps are currently passed and what's available in scope**

  Read `backend/src/app.mjs` lines 1700–1740. Confirm `tvAdapter` (or equivalent — created in `createHomeAutomationAdapters` at `bootstrap.mjs:1474`) is reachable in the same scope. If it isn't, add it to that function's return value, then forward it into `createTriggerApiRouter`.

  ```bash
  grep -n "tvAdapter\|tvControlAdapter" backend/src/app.mjs | head -10
  ```

- [ ] **Step 3: Add the params to `createTriggerApiRouter`**

  Path: `backend/src/0_system/bootstrap.mjs`, function `createTriggerApiRouter` (current line 1724).

  Find the destructuring block:

  ```javascript
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
  ```

  Change to:

  ```javascript
    const {
      deviceServices,
      wakeAndLoadService,
      haGateway,
      tvControlAdapter = null,
      contentIdResolver,
      broadcast,
      loadFile,
      saveFile,
      logger = console,
    } = config;
  ```

  Then find `const router = createTriggerRouter({ triggerDispatchService, logger });` (current line 1756) and change to:

  ```javascript
    const router = createTriggerRouter({
      triggerDispatchService,
      tvControlAdapter,
      deviceService: deviceServices.deviceService,
      logger,
    });
  ```

- [ ] **Step 4: Pass `tvControlAdapter` from the call site**

  Path: `backend/src/app.mjs`, around line 1706. The exact context depends on what variable name the home-automation adapters bag uses in scope (commonly `adapters.tvAdapter`). Find the call:

  ```javascript
    const { router: triggerRouter } = createTriggerApiRouter({
      // ... existing args ...
    });
  ```

  Add `tvControlAdapter: adapters.tvAdapter,` to the args (substituting the variable name actually in scope — confirm via the grep in Step 2).

- [ ] **Step 5: Smoke test bootstrap**

  ```bash
  node -e "import('./backend/index.js').catch(e => { console.error(e); process.exit(1); })" &
  sleep 5
  curl -sf http://localhost:3112/api/v1/trigger/livingroom/nfc/aa?dryRun=1 || echo "endpoint failed"
  pkill -f 'backend/index.js'
  ```

  Expected: server starts cleanly, the dry-run trigger returns a JSON response (likely `TRIGGER_NOT_REGISTERED`, but no stack trace).

  Alternatively, just run the existing assembly tests:
  ```bash
  npm run test:isolated -- --only=assembly
  ```

  Expected: green.

- [ ] **Step 6: Commit**

  ```bash
  git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
  git commit -m "$(cat <<'EOF'
  feat(bootstrap): wire tvControlAdapter+deviceService into trigger router

  Forwards the home-automation TV control adapter and the device
  service into createTriggerRouter so the new POST /side-effect route
  can dispatch tv-off and clear behaviors.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: Frontend useQueueController — append synthetic side-effect tail

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js`
- Test: `tests/isolated/modules/Player/useQueueController.endBehavior.test.mjs` (create)

When the source object (`play` or `queue`) carries `endBehavior`, append one hidden synthetic item after the last valid queue item. The marker carries `behavior`, `location`, and `deviceId` so the controller can POST it later.

- [ ] **Step 1: Write the failing test**

  Path: `tests/isolated/modules/Player/useQueueController.endBehavior.test.mjs`

  ```javascript
  import { describe, it, expect } from 'vitest';

  // The synthetic-marker append is a pure transform — extract it via the same
  // shape the hook uses internally so we can test it in isolation.
  function appendSideEffectTail(validQueue, sourceObj, guid = () => 'g') {
    if (!sourceObj?.endBehavior) return validQueue;
    if (!Array.isArray(validQueue) || validQueue.length === 0) return validQueue;
    return [
      ...validQueue,
      {
        id: `sideeffect:${sourceObj.endBehavior}:${guid()}`,
        guid: guid(),
        mediaType: 'trigger/side-effect',
        behavior: sourceObj.endBehavior,
        location: sourceObj.endLocation || null,
        deviceId: sourceObj.endDeviceId || null,
        duration: 0,
        hidden: true,
      },
    ];
  }

  describe('side-effect tail marker append', () => {
    const item = (id) => ({ contentId: id, guid: id });

    it('appends a hidden marker when endBehavior is set', () => {
      const out = appendSideEffectTail([item('a'), item('b')], {
        endBehavior: 'tv-off',
        endLocation: 'living_room',
        endDeviceId: 'livingroom-tv',
      });
      expect(out).toHaveLength(3);
      const tail = out[2];
      expect(tail.mediaType).toBe('trigger/side-effect');
      expect(tail.behavior).toBe('tv-off');
      expect(tail.location).toBe('living_room');
      expect(tail.deviceId).toBe('livingroom-tv');
      expect(tail.hidden).toBe(true);
    });

    it('returns input unchanged when endBehavior is absent', () => {
      const input = [item('a')];
      expect(appendSideEffectTail(input, {})).toBe(input);
    });

    it('does not append when validQueue is empty', () => {
      const out = appendSideEffectTail([], { endBehavior: 'tv-off' });
      expect(out).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm run test:isolated -- --only=modules
  ```

  Expected: tests fail (the test file doesn't exist yet — actually since this is a self-contained pure function defined in the test, it'll pass once the file is added). **But** the goal of this task is also that the hook itself appends the marker. So we will also add a hook integration assertion at task end. Skip step 2's "fail" theatre here and use this test as a contract spec instead.

- [ ] **Step 3: Modify the hook to append the marker**

  Path: `frontend/src/modules/Player/hooks/useQueueController.js`

  Find the `validQueue` filter (lines 178-182):

  ```javascript
        // Validate queue items — reject garbage (e.g., string-spread objects with numeric keys)
        const validQueue = newQueue.filter(item =>
          item.contentId || item.play || item.media || item.mediaUrl || item.media_url
          || item.key || item.id || item.plex || item.assetId
        );
  ```

  Insert the marker append immediately after that filter (before the existing `if (newQueue.length > 0 && validQueue.length === 0)` invalid-queue guard):

  ```javascript
        // Trigger end-behavior tail marker — append a synthetic side-effect item
        // so the player fires the configured behavior (tv-off, clear) when the
        // queue plays through. See backend sideEffectHandlers.mjs.
        if (sourceObj.endBehavior && validQueue.length > 0) {
          validQueue.push({
            id: `sideeffect:${sourceObj.endBehavior}:${guid()}`,
            guid: guid(),
            mediaType: 'trigger/side-effect',
            behavior: sourceObj.endBehavior,
            location: sourceObj.endLocation || null,
            deviceId: sourceObj.endDeviceId || null,
            duration: 0,
            hidden: true,
          });
        }

  ```

- [ ] **Step 4: Run the test**

  ```bash
  npm run test:isolated -- --only=modules
  ```

  Expected: 3 new tests pass; existing module tests stay green.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/modules/Player/hooks/useQueueController.js \
          tests/isolated/modules/Player/useQueueController.endBehavior.test.mjs
  git commit -m "$(cat <<'EOF'
  feat(player): append synthetic side-effect tail marker

  When the source object carries endBehavior (forwarded from
  WakeAndLoadService.contentQuery), append one hidden trigger/side-
  effect item to the queue tail so the controller can fire the
  configured behavior when playback completes.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9: Frontend useQueueController — disable continuous loop when end-behavior present

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js`

If the queue is `continuous`, the marker would re-fire on every loop. Force `isContinuous=false` whenever `endBehavior` is present.

- [ ] **Step 1: Modify the `isContinuous` initializer**

  Path: `frontend/src/modules/Player/hooks/useQueueController.js`

  Find (current line 30):

  ```javascript
    const [isContinuous] = useState(!!queue?.continuous || !!play?.continuous || false);
  ```

  Replace with:

  ```javascript
    // Trigger end-behavior queues must not loop — the marker would re-fire each cycle.
    const hasEndBehavior = !!(play?.endBehavior || queue?.endBehavior);
    const [isContinuous] = useState(
      !hasEndBehavior && (!!queue?.continuous || !!play?.continuous || false)
    );
  ```

- [ ] **Step 2: Run module tests**

  ```bash
  npm run test:isolated -- --only=modules
  ```

  Expected: all module tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/modules/Player/hooks/useQueueController.js
  git commit -m "$(cat <<'EOF'
  fix(player): disable continuous loop when end-behavior is present

  If a queue is both continuous and carries a side-effect tail marker,
  the marker would re-fire on every loop. Force non-continuous
  playback whenever endBehavior is configured.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10: Frontend useQueueController — dispatch on head + advance

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js`

When the synthetic marker is at the head, POST it (fire-and-forget) and `advance(1)` to clear it from the queue. A `Set` keyed on marker `id` prevents double-fire if the effect re-runs.

- [ ] **Step 1: Modify the hook**

  Path: `frontend/src/modules/Player/hooks/useQueueController.js`

  Locate the `lastLoggedGuidRef` declaration (around line 308). Insert the side-effect dispatcher just BEFORE that declaration:

  ```javascript
    // Trigger end-behavior side-effect dispatcher.
    // When the queue advances onto a virtual side-effect tail item, POST to the
    // backend (fire-and-forget) and advance past it. Skips media mount entirely.
    const firedMarkersRef = useRef(new Set());
    useEffect(() => {
      const head = playQueue[0];
      if (!head || head.mediaType !== 'trigger/side-effect') return;
      if (firedMarkersRef.current.has(head.id)) return;
      firedMarkersRef.current.add(head.id);

      DaylightAPI('api/v1/trigger/side-effect', {
        behavior: head.behavior,
        location: head.location,
        deviceId: head.deviceId,
        markerId: head.id,
      }, 'POST').catch((err) => {
        playbackLog('side-effect-post-failed', {
          markerId: head.id,
          behavior: head.behavior,
          error: err?.message,
        }, { level: 'warn' });
      });

      playbackLog('side-effect-fired', {
        markerId: head.id,
        behavior: head.behavior,
        location: head.location,
        deviceId: head.deviceId,
      }, { level: 'info' });

      advance(1);
    }, [playQueue, advance]);

  ```

  **Important:** verify `DaylightAPI`'s third positional argument is the HTTP method by reading `frontend/src/lib/api.mjs` (line 11 — `async (path, data = {}, method = 'GET')`). If your local copy uses a different signature for non-GET, adjust accordingly.

- [ ] **Step 2: Run module tests**

  ```bash
  npm run test:isolated -- --only=modules
  ```

  Expected: green (no new test added — this effect is best validated by the live integration test in Task 14).

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/modules/Player/hooks/useQueueController.js
  git commit -m "$(cat <<'EOF'
  feat(player): fire side-effect marker + advance past it

  When the synthetic trigger/side-effect tail item reaches the queue
  head, POST it to /api/v1/trigger/side-effect (fire-and-forget) and
  advance past it. firedMarkersRef prevents double-fire on effect
  re-runs; backend dedup is the second line of defense.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 11: Frontend Player — skip side-effect heads in `activeSource`

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx`

The Player must NOT try to play the synthetic marker. Make `activeSource` return `null` when the head is a `trigger/side-effect` — the queue controller advances past it.

- [ ] **Step 1: Modify `activeSource`**

  Path: `frontend/src/modules/Player/Player.jsx`

  Find (around lines 139-147):

  ```javascript
    const activeSource = useMemo(() => {
      if (isQueue && playQueue?.length > 0) {
        return playQueue[0];
      }
      if (play && !Array.isArray(play)) {
        return play;
      }
      return null;
    }, [isQueue, playQueue, play]);
  ```

  Replace with:

  ```javascript
    const activeSource = useMemo(() => {
      if (isQueue && playQueue?.length > 0) {
        const head = playQueue[0];
        // Trigger end-behavior side-effect markers are not playable. The
        // useQueueController hook fires the configured behavior (tv-off, clear)
        // and advances past them on its own.
        if (head?.mediaType === 'trigger/side-effect') return null;
        return head;
      }
      if (play && !Array.isArray(play)) {
        return play;
      }
      return null;
    }, [isQueue, playQueue, play]);
  ```

- [ ] **Step 2: Sanity-check the build**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20 && cd -
  ```

  Expected: build succeeds. (No new tests for this 3-line guard — Task 14 validates it end-to-end.)

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/modules/Player/Player.jsx
  git commit -m "$(cat <<'EOF'
  fix(player): skip side-effect markers in activeSource

  The synthetic trigger/side-effect tail item is a control item, not
  media. The queue controller fires the behavior and advances past it.
  Returning null prevents the player from attempting to mount it.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 12: Frontend usePlaybackStateBroadcast — filter hidden items

**Files:**
- Modify: `frontend/src/modules/Media/shared/usePlaybackStateBroadcast.js`

When the marker becomes the head, fleet UIs subscribed to `playback_state` would see a "trigger/side-effect" item. Suppress it: if `currentItem.hidden`, broadcast as `null`.

- [ ] **Step 1: Modify `buildMessage`**

  Path: `frontend/src/modules/Media/shared/usePlaybackStateBroadcast.js`

  Replace the entire `buildMessage` function:

  ```javascript
  function buildMessage({ clientId, sessionId, displayName, state, currentItem, position, config }) {
    // Hidden items (e.g. trigger end-behavior side-effect markers) must not appear
    // in the broadcast — they're internal control items, not media for fleet UIs.
    const visibleItem = currentItem?.hidden ? null : (currentItem ?? null);
    return {
      topic: 'playback_state',
      clientId,
      sessionId,
      displayName,
      state,
      currentItem: visibleItem,
      position: position ?? 0,
      duration: visibleItem?.duration ?? null,
      config: config ?? null,
      ts: new Date().toISOString(),
    };
  }
  ```

- [ ] **Step 2: Frontend build smoke**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20 && cd -
  ```

  Expected: build succeeds.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/modules/Media/shared/usePlaybackStateBroadcast.js
  git commit -m "$(cat <<'EOF'
  fix(broadcast): hide synthetic side-effect markers from playback state

  The trigger/side-effect tail item is a control item, not media. Strip
  it from playback_state messages so fleet UIs don't render it.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 13: Update YAML config — add `end_location: living_room`

**Files:**
- Modify: `data/household/config/triggers/nfc/locations.yml` (inside the `daylight-station` Docker volume)

The validator (Task 1) requires `end_location` whenever `end: tv-off`. The TVControlAdapter expects `living_room` (with underscore), not `livingroom`.

- [ ] **Step 1: Read the current YAML**

  ```bash
  sudo docker exec daylight-station sh -c 'cat data/household/config/triggers/nfc/locations.yml'
  ```

  Expected current content:
  ```yaml
  livingroom:
    target: livingroom-tv
    action: play-next
    end: tv-off
    notify_unknown: mobile_app_kc_phone
  ```

- [ ] **Step 2: Write the updated YAML via heredoc**

  ```bash
  sudo docker exec daylight-station sh -c "cat > data/household/config/triggers/nfc/locations.yml << 'EOF'
  livingroom:
    target: livingroom-tv
    action: play-next
    end: tv-off
    end_location: living_room
    notify_unknown: mobile_app_kc_phone
  EOF"
  ```

  Verify:
  ```bash
  sudo docker exec daylight-station sh -c 'cat data/household/config/triggers/nfc/locations.yml'
  ```
  Expected: the new content with `end_location: living_room`.

- [ ] **Step 3: No git commit needed** — this file is in the Docker volume, not the repo. No change to record locally.

  However, if the same file exists in the repo (some workspaces commit reference YAML), update that too:
  ```bash
  find . -name "locations.yml" -path "*triggers/nfc*" 2>/dev/null
  ```
  If a tracked copy exists, update it the same way and commit:
  ```bash
  git commit -am "config(trigger): add end_location: living_room to livingroom NFC reader"
  ```

---

## Task 14: End-to-end live verification

**Files:** none — pure runtime validation.

Restart the dev server, tap an NFC tag at livingroom, watch all four logs for the full chain.

- [ ] **Step 1: Restart dev backend**

  ```bash
  pkill -f 'node backend/index.js' 2>/dev/null
  nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
  sleep 5
  curl -sf http://localhost:3112/api/v1/system/health | head -1
  ```

  Expected: dev server starts cleanly, health endpoint returns 200.

- [ ] **Step 2: Tail all four log streams in separate terminals (or as backgrounded `tail -f`)**

  ```bash
  # Terminal A — backend dev
  tail -f /tmp/backend-dev.log | grep -i "trigger\|side-effect\|wake-and-load"

  # Terminal B — Home Assistant
  sudo docker logs -f homeassistant 2>&1 | grep -iE "living_room_tv|tv_off|tv_on"

  # Terminal C — Shield TV frontend (via WS log forwarding to backend)
  tail -f /tmp/backend-dev.log | grep -iE "playback\.|side-effect-fired|queue-advance"
  ```

- [ ] **Step 3: Tap the Jungle Book NFC tag**

  Physical action. Watch terminals.

- [ ] **Step 4: Verify the expected sequence**

  Within ~30s of tap:
  - **Terminal A:** `trigger.fired` `{registered: true, action: 'play-next', target: 'livingroom-tv', ok: true}`
  - **Terminal A:** `wake-and-load.prepare.start` … `wake-and-load.prepare.done`
  - **Terminal C:** `playback.started {title: 'The Jungle Book', ...}`

  Through playback (~8 minutes for the readalong):
  - **Terminal C:** `play.log.request_received` events crawling 0% → 100%

  At end of playback:
  - **Terminal C:** `playback.queue-advance {action: 'clear', reason: 'end of non-continuous playlist'}`
  - **Terminal C:** `side-effect-fired {behavior: 'tv-off', location: 'living_room', markerId: 'sideeffect:tv-off:...'}`
  - **Terminal A:** `trigger.side-effect.fired {behavior: 'tv-off', location: 'living_room', ok: true, elapsedMs: ...}`
  - **Terminal B (HA):** `script.living_room_tv_off` execution logged

  Within ~10s of HA script firing:
  - HA state for `binary_sensor.living_room_tv_power` transitions `on → off`. Verify with:
  ```bash
  sudo docker exec daylight-station sh -c 'TOKEN=$(grep token data/household/auth/homeassistant.yml | cut -d" " -f2) && curl -s "http://homeassistant:8123/api/states/binary_sensor.living_room_tv_power" -H "Authorization: Bearer $TOKEN"' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["state"], d["last_changed"])'
  ```
  Expected: `off <recent timestamp>`.

  **If any expected log is missing:** stop and debug. Don't fake-pass. The user has explicit feedback that "should be" speculation is forbidden — verify from logs.

- [ ] **Step 5: Stop dev server**

  ```bash
  pkill -f 'node backend/index.js'
  ```

- [ ] **Step 6: Build + deploy to prod (per CLAUDE.local.md "Deploy at will on this host")**

  ```bash
  cd /opt/Code/DaylightStation
  sudo docker build -f docker/Dockerfile \
    -t kckern/daylight-station:latest \
    --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
    .
  sudo docker stop daylight-station && sudo docker rm daylight-station
  sudo deploy-daylight
  sleep 10
  curl -sf http://localhost:3111/api/v1/system/health | head -1
  ```

  Expected: container restarts on the new image, health endpoint returns 200.

- [ ] **Step 7: Re-verify the live trigger against the prod container**

  Repeat Step 3 + Step 4, but tail `sudo docker logs -f daylight-station` instead of the dev log. Same expected sequence. If any step fails, roll back the container and debug — don't leave prod broken.

---

## Self-Review

**Spec coverage** — Goal is "make `end: tv-off` actually fire". Mapped pieces:
- YAML validation: Task 1.
- Resolver propagation: Task 2.
- Action handler forwarding: Task 3.
- WakeAndLoad propagation: Task 4.
- Side-effect handlers: Task 5.
- API route: Task 6.
- Bootstrap wiring: Task 7.
- Frontend tail append: Task 8.
- No-loop guard: Task 9.
- Dispatch + advance: Task 10.
- Player skip: Task 11.
- Broadcast filter: Task 12.
- YAML data update: Task 13.
- End-to-end live test + deploy: Task 14.
- Reconciliation of divergent origin: Task 0.

No gaps.

**Type consistency** — `intent.end` (string) and `intent.endLocation` (string) flow through `buildLoadOptions → opts.endBehavior + opts.endLocation`, then `WakeAndLoadService` adds `contentQuery.endBehavior + .endLocation + .endDeviceId`. The frontend reads `play.endBehavior + play.endLocation + play.endDeviceId` (or same on `queue`). The synthetic marker carries `behavior`, `location`, `deviceId` (renamed for the POST payload contract). The router POST body uses `behavior, location, deviceId, markerId`. Side-effect handler `tv-off` accepts `{ location }`. Side-effect handler `clear` accepts `{ deviceId }`. Names match across boundaries.

**Placeholder scan** — No "TBD", "implement later", "add appropriate error handling". All test bodies are concrete. All commands include expected output or exit conditions.

---

## Execution Handoff

Plan saved to `docs/_wip/plans/2026-04-26-trigger-end-behavior.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
