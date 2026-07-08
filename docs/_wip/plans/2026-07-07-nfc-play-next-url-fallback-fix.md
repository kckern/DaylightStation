# NFC play-next URL Fallback Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the FKB-URL fallback delivery path for NFC `play-next` triggers actually play the tagged content, instead of mis-resolving a metadata query param and hanging on "Loading…" forever.

**Architecture:** Three-layer fix. (1) Frontend: teach `parseAutoplayParams` the `play-next`/`play-now` queue-op form and pass end-behavior params through, then emit `media:queue-op` (which `ScreenActionHandler` already handles correctly); harden the alias fallback so bookkeeping params can never be mistaken for content. (2) Backend domain: stop `NfcResolver` leaking tag metadata (`scanned_at`, `note`) into the device URL. (3) Backend application: arm the wake-and-load playback watchdog for `play-next` queries so this failure class alarms (`wake-and-load.playback.timeout`) instead of failing silently.

**Tech Stack:** Vanilla JS (frontend `.js`, backend `.mjs`), React (one small component edit), vitest (isolated tests via root `vitest.config.mjs`, run with `frontend/node_modules/.bin/vitest`).

**Background:** Read `docs/_wip/bugs/2026-07-07-nfc-play-next-url-fallback-misparse-nothing-plays.md` first — it has the full incident trace, root-cause analysis (RC1/RC2/G1), and file:line evidence.

**Key facts for someone with zero context:**

- An NFC tag scan → backend `TriggerDispatchService` → `actionHandlers['play-next']` → `WakeAndLoadService.execute(target, { ...params, 'play-next': 'plex:621568', op: 'play-next' })`.
- WakeAndLoad delivers content two ways: WS-first (a `CommandEnvelope{command:'queue', params:{op, contentId}}` — works) and, when WS acks time out, an **FKB URL fallback** that loads `/screen/living-room?<query>` on the kiosk.
- On the frontend, `ScreenAutoplay` (in `ScreenRenderer.jsx`) parses that query with `parseAutoplayParams`. That parser has no idea what `play-next` is, and its "alias fallback" turns the *first unknown param* into a play action — in the incident that was `scanned_at=2026-05-10 11:51:19`, producing content id `scanned_at:2026-05-10 11:51:19` → backend 404 `queue.source.unknown` → Player stuck on Loading.
- The metadata params (`scanned_at`, `note`) are in the URL at all because `NfcResolver` copies every non-reserved tag YAML key into `intent.params`.
- Run a single isolated test file: `frontend/node_modules/.bin/vitest run <file> --config vitest.config.mjs` (from repo root).

---

### Task 0: Worktree setup

Per `CLAUDE.local.md`, sync with the deployed source FIRST — local git is frequently behind the homeserver deploy tree.

**Step 1: Sync check**

```bash
git fetch origin
git log --oneline origin/main..main | head
ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline origin/main..HEAD | head'
```

Expected: no unpushed commits on the homeserver tree touching `parseAutoplayParams.js`, `ScreenRenderer.jsx`, `NfcResolver.mjs`, or `WakeAndLoadService.mjs`. If there ARE unpushed commits there, STOP and integrate them first (fetch the homeserver branch, rebase this work on it).

**Step 2: Create worktree branched from origin/main**

```bash
git worktree add .claude/worktrees/nfc-play-next-fix -b fix/nfc-play-next-url-fallback origin/main
cd .claude/worktrees/nfc-play-next-fix
```

**Step 3: Link node_modules (vitest needs them; don't reinstall)**

```bash
ln -s "$(git rev-parse --path-format=absolute --git-common-dir)/.." node_modules 2>/dev/null || true
# If the above symlink trick confuses you, just do it explicitly:
ln -sfn /Users/kckern/Documents/GitHub/DaylightStation/node_modules node_modules
ln -sfn /Users/kckern/Documents/GitHub/DaylightStation/frontend/node_modules frontend/node_modules
```

**Step 4: Sanity — existing tests pass before we touch anything**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/assembly/player/parseAutoplayParams.test.mjs tests/isolated/domain/trigger/services/NfcResolver.test.mjs tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs --config vitest.config.mjs
```

Expected: all PASS. If not, stop and report — the baseline is broken.

Commit policy note: per-task commits on this isolated feature branch are authorized (`feedback_commit_policy_feature_branches`). Do NOT push or merge to main without the user.

---

### Task 1: `parseAutoplayParams` learns `play-next` / `play-now` (queue-op form) + end-behavior passthrough

**Files:**
- Modify: `frontend/src/lib/parseAutoplayParams.js` (AUTOPLAY_ACTIONS line ~17, CONFIG_KEYS line ~23, ACTION_MAPPINGS line ~45)
- Test: `tests/isolated/assembly/player/parseAutoplayParams.test.mjs` (append new describe blocks)

**Step 1: Write the failing tests**

Append to `tests/isolated/assembly/player/parseAutoplayParams.test.mjs` (inside the top-level `describe('parseAutoplayParams', ...)`, matching the file's existing style — it defines `ALL_ACTIONS` locally; import the canonical list instead for the new block):

```js
// at top of file, extend the existing import:
import { parseAutoplayParams, AUTOPLAY_ACTIONS } from '#frontend/lib/parseAutoplayParams.js';
```

```js
  describe('queue-op actions (play-next / play-now)', () => {
    test('parses the exact prod NFC wake-and-load URL into a play-next queueOp', () => {
      // Verbatim query from the 2026-07-07 incident (fullykiosk.load.builtUrl)
      const search = '?scanned_at=2026-05-10+11%3A51%3A19&note=Eyes+shuts&play-next=plex%3A621568&op=play-next&endBehavior=tv-off&endDeviceId=livingroom-tv&endLocation=living_room';
      const result = parseAutoplayParams(search, AUTOPLAY_ACTIONS);
      expect(result).not.toBeNull();
      expect(result.queueOp).toBeDefined();
      expect(result.queueOp.op).toBe('play-next');
      expect(result.queueOp.contentId).toBe('plex:621568');
      // end-behavior params must survive into the payload (Player's side-effect tail)
      expect(result.queueOp.endBehavior).toBe('tv-off');
      expect(result.queueOp.endDeviceId).toBe('livingroom-tv');
      expect(result.queueOp.endLocation).toBe('living_room');
      // and must NOT be misparsed as play
      expect(result.play).toBeUndefined();
    });

    test('?play-next=621568 normalizes bare digits to plex:', () => {
      const result = parseAutoplayParams('?play-next=621568', AUTOPLAY_ACTIONS);
      expect(result.queueOp.op).toBe('play-next');
      expect(result.queueOp.contentId).toBe('plex:621568');
    });

    test('?play-now=hymn:198 maps to a play-now queueOp', () => {
      const result = parseAutoplayParams('?play-now=hymn:198', AUTOPLAY_ACTIONS);
      expect(result.queueOp.op).toBe('play-now');
      expect(result.queueOp.contentId).toBe('hymn:198');
    });
  });
```

**Step 2: Run tests to verify they fail**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/assembly/player/parseAutoplayParams.test.mjs --config vitest.config.mjs
```

Expected: the 3 new tests FAIL. The prod-URL test fails with `result.queueOp` undefined — and note WHAT it currently returns: `result.play.contentId === 'scanned_at:2026-05-10 11:51:19'` (the bug, live). Pre-existing tests still pass.

**Step 3: Implement**

In `frontend/src/lib/parseAutoplayParams.js`:

Replace the `AUTOPLAY_ACTIONS` array (keep the existing doc comment):

```js
export const AUTOPLAY_ACTIONS = Object.freeze([
  'play', 'queue', 'playlist', 'random',
  'display', 'read', 'open',
  'app', 'launch', 'list',
  'play-next', 'play-now',
]);
```

Replace `CONFIG_KEYS` (adds the three end-behavior passthrough keys):

```js
const CONFIG_KEYS = [
  'volume', 'shader', 'playbackRate', 'shuffle', 'continuous',
  'repeat', 'loop', 'overlay', 'advance', 'interval', 'mode', 'frame',
  'prewarmToken', 'prewarmContentId',
  'endBehavior', 'endDeviceId', 'endLocation',
];
```

Add two entries to `ACTION_MAPPINGS` (after the `random` entry):

```js
  // Queue-op form used by WakeAndLoadService's FKB-URL fallback for NFC
  // triggers (?play-next=plex:123&op=play-next). Emitted as media:queue-op —
  // ScreenActionHandler routes it to the active Player or mounts a fresh one.
  'play-next': (value, config) => ({ queueOp: { op: 'play-next', contentId: toContentId(value), ...config } }),
  'play-now': (value, config) => ({ queueOp: { op: 'play-now', contentId: toContentId(value), ...config } }),
```

**Step 4: Run tests to verify they pass**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/assembly/player/parseAutoplayParams.test.mjs --config vitest.config.mjs
```

Expected: ALL pass (new + pre-existing). If a pre-existing test fails, you broke config-key handling — re-check Step 3, don't "fix" the old test.

**Step 5: Commit**

```bash
git add frontend/src/lib/parseAutoplayParams.js tests/isolated/assembly/player/parseAutoplayParams.test.mjs
git commit -m "fix(screen-framework): parseAutoplayParams understands play-next/play-now queue-ops (NFC URL fallback bug)"
```

---

### Task 2: Harden the alias fallback — bookkeeping params can never become content

**Files:**
- Modify: `frontend/src/lib/parseAutoplayParams.js` (alias fallback loop, line ~123)
- Test: `tests/isolated/assembly/player/parseAutoplayParams.test.mjs`

**Step 1: Write the failing tests**

Append:

```js
  describe('alias fallback hardening', () => {
    test('metadata/envelope params alone produce no action (not a bogus play)', () => {
      // Without an action key, the old fallback turned scanned_at into
      // play contentId 'scanned_at:...' → queue.source.unknown 404.
      const result = parseAutoplayParams('?scanned_at=2026-05-10+11%3A51%3A19&note=Eyes+shuts&op=play-next', AUTOPLAY_ACTIONS);
      expect(result).toBeNull();
    });

    test('genuine alias shorthand still works alongside passthrough params', () => {
      const result = parseAutoplayParams('?scanned_at=2026-05-10&hymn=198', AUTOPLAY_ACTIONS);
      expect(result.play.contentId).toBe('hymn:198');
    });
  });
```

**Step 2: Run tests to verify they fail**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/assembly/player/parseAutoplayParams.test.mjs --config vitest.config.mjs
```

Expected: first new test FAILS (`result` is a play action for `scanned_at:...`). Second may also fail (fallback picks `scanned_at` before `hymn` — order-dependent).

**Step 3: Implement**

In `parseAutoplayParams.js`, add next to `CONFIG_KEYS`:

```js
// Params that ride along in wake-and-load / trigger URLs but are NEVER
// content: envelope routing keys and NFC tag bookkeeping. The alias
// fallback must not turn these into a play action (2026-07-07 bug:
// ?scanned_at=... became contentId 'scanned_at:...' → 404 → stuck Loading).
const PASSTHROUGH_KEYS = new Set([
  'op', 'endBehavior', 'endDeviceId', 'endLocation',
  'scanned_at', 'note', 'dispatchId', 'token',
]);
```

Change the alias fallback loop to skip them:

```js
  // Alias fallback: unknown key -> play key:value
  for (const [key, value] of Object.entries(queryEntries)) {
    if (CONFIG_KEYS.includes(key) || PASSTHROUGH_KEYS.has(key) || key.includes('.')) continue;
    return { play: { contentId: `${key}:${value}`, ...config } };
  }
```

(Note: this replaces the old `if (!CONFIG_KEYS.includes(key) && !key.includes('.'))` body-wrapping form with an equivalent continue-style guard — same behavior for old inputs, plus the new skip.)

**Step 4: Run tests to verify they pass**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/assembly/player/parseAutoplayParams.test.mjs --config vitest.config.mjs
```

Expected: ALL pass.

**Step 5: Commit**

```bash
git add frontend/src/lib/parseAutoplayParams.js tests/isolated/assembly/player/parseAutoplayParams.test.mjs
git commit -m "fix(screen-framework): alias fallback ignores envelope/metadata params (scanned_at, note, op, end*)"
```

---

### Task 3: `ScreenAutoplay` emits `media:queue-op` — via an extracted, testable dispatch map

The emit chain in `ScreenAutoplay` (`ScreenRenderer.jsx:107-125`) is an untestable if/else inside a component. Extract it into a pure function co-located with the parser (SSOT for parse→action), add the `queueOp` branch, and have the component use it.

**Files:**
- Modify: `frontend/src/lib/parseAutoplayParams.js` (add `autoplayToAction` export)
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx` (ScreenAutoplay, lines ~107-125)
- Test: `tests/isolated/assembly/player/parseAutoplayParams.test.mjs`

**Step 1: Write the failing tests**

```js
// extend the import once more:
import { parseAutoplayParams, AUTOPLAY_ACTIONS, autoplayToAction } from '#frontend/lib/parseAutoplayParams.js';
```

```js
  describe('autoplayToAction', () => {
    test('queueOp result maps to media:queue-op with payload intact', () => {
      const search = '?play-next=plex%3A621568&op=play-next&endBehavior=tv-off&endDeviceId=livingroom-tv&endLocation=living_room';
      const action = autoplayToAction(parseAutoplayParams(search, AUTOPLAY_ACTIONS));
      expect(action.event).toBe('media:queue-op');
      expect(action.payload.op).toBe('play-next');
      expect(action.payload.contentId).toBe('plex:621568');
      expect(action.payload.endBehavior).toBe('tv-off');
    });

    test('queue result maps to media:queue (parity with old inline chain)', () => {
      const action = autoplayToAction(parseAutoplayParams('?queue=plex:67890', AUTOPLAY_ACTIONS));
      expect(action.event).toBe('media:queue');
      expect(action.payload.contentId).toBe('plex:67890');
    });

    test('open result maps to menu:open with menuId', () => {
      const action = autoplayToAction(parseAutoplayParams('?open=webcam', AUTOPLAY_ACTIONS));
      expect(action).toEqual({ event: 'menu:open', payload: { menuId: 'webcam' } });
    });

    test('null autoplay maps to null', () => {
      expect(autoplayToAction(null)).toBeNull();
    });
  });
```

**Step 2: Run tests to verify they fail**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/assembly/player/parseAutoplayParams.test.mjs --config vitest.config.mjs
```

Expected: FAIL — `autoplayToAction` is not exported.

**Step 3: Implement the pure function**

Append to `frontend/src/lib/parseAutoplayParams.js` (before the default export; add `autoplayToAction` alongside):

```js
/**
 * Map a parseAutoplayParams result to an ActionBus (event, payload) pair.
 * Single source of truth for the ScreenAutoplay dispatch chain — priority
 * order mirrors the original inline if/else in ScreenRenderer.jsx.
 * Returns null when there is nothing to emit.
 */
export function autoplayToAction(autoplay) {
  if (!autoplay) return null;
  if (autoplay.compose) return { event: 'media:queue', payload: { compose: true, sources: autoplay.compose.sources, ...autoplay.compose } };
  if (autoplay.queue) return { event: 'media:queue', payload: { contentId: autoplay.queue.contentId, ...autoplay.queue } };
  if (autoplay.play) return { event: 'media:play', payload: { contentId: autoplay.play.contentId, ...autoplay.play } };
  if (autoplay.queueOp) return { event: 'media:queue-op', payload: autoplay.queueOp };
  if (autoplay.display) return { event: 'display:content', payload: autoplay.display };
  if (autoplay.read) return { event: 'display:content', payload: { ...autoplay.read, mode: 'reader' } };
  if (autoplay.launch) return { event: 'media:play', payload: { contentId: autoplay.launch.contentId, ...autoplay.launch } };
  if (autoplay.open) return { event: 'menu:open', payload: { menuId: autoplay.open.app } };
  if (autoplay.list) return { event: 'menu:open', payload: { menuId: autoplay.list.contentId } };
  return null;
}
```

**Step 4: Run tests to verify they pass**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/assembly/player/parseAutoplayParams.test.mjs --config vitest.config.mjs
```

Expected: ALL pass.

**Step 5: Wire it into ScreenAutoplay**

In `frontend/src/screen-framework/ScreenRenderer.jsx`:

Update the import (line ~25):

```js
import { parseAutoplayParams, autoplayToAction, AUTOPLAY_ACTIONS } from '../lib/parseAutoplayParams.js';
```

Replace the query-autoplay emit block (the `setTimeout` containing the if/else chain, lines ~107-125) with:

```js
    const action = autoplayToAction(autoplay);
    if (action) {
      // Emit after a brief delay to let the screen framework mount
      setTimeout(() => {
        bus.emit(action.event, action.payload);
      }, 500);
    }
```

Keep everything around it (the `parseAutoplayParams` call, the `screen-autoplay.parsed` log, the URL-clean `replaceState`) unchanged.

**Step 6: Verify the frontend still builds and the full isolated player/screen suites pass**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/assembly/player/ tests/isolated/screen-framework/ --config vitest.config.mjs
npx vite build --config vite.config.js 2>&1 | tail -5
```

Expected: tests pass; build succeeds (no unresolved import). If `vite.config.js` isn't at root, find it: `ls vite.config.* frontend/vite.config.*` — run the build the way `npm run build` does (check `package.json` scripts).

**Step 7: Commit**

```bash
git add frontend/src/lib/parseAutoplayParams.js frontend/src/screen-framework/ScreenRenderer.jsx tests/isolated/assembly/player/parseAutoplayParams.test.mjs
git commit -m "feat(screen-framework): ScreenAutoplay dispatches media:queue-op via extracted autoplayToAction"
```

---

### Task 4: `NfcResolver` stops leaking tag metadata into intent params

**Files:**
- Modify: `backend/src/2_domains/trigger/services/NfcResolver.mjs` (RESERVED_KEYS block ~line 26, `expandShorthand` ~line 32, params loop ~line 104)
- Test: `tests/isolated/domain/trigger/services/NfcResolver.test.mjs` (append; READ the file first and reuse its existing registry/resolver helper fixtures if it has them)

**Step 1: Write the failing test**

Append (adapt fixture shape to the file's existing helpers — the shape below matches the resolver's API directly):

```js
  describe('tag metadata exclusion', () => {
    const registry = {
      locations: {
        livingroom: { action: 'play-next', target: 'livingroom-tv' },
      },
      tags: {
        '04_28_d4_71_cc_2a_81': {
          global: {
            scanned_at: '2026-05-10 11:51:19',
            note: 'Eyes shuts',
            plex: '621568',
          },
          overrides: {},
        },
      },
    };
    const contentIdResolver = { resolve: (id) => (id.startsWith('plex:') ? { source: 'plex' } : null) };

    test('scanned_at and note do not leak into intent.params', () => {
      const intent = NfcResolver.resolve({
        location: 'livingroom', value: '04_28_D4_71_CC_2A_81',
        registry, contentIdResolver,
      });
      expect(intent).not.toBeNull();
      expect(intent.content).toBe('plex:621568');
      expect(intent.params).not.toHaveProperty('scanned_at');
      expect(intent.params).not.toHaveProperty('note');
    });

    test('metadata-only tag still resolves to null (unknown-tag capture flow)', () => {
      const metaOnly = {
        ...registry,
        tags: { 'aa_bb': { global: { scanned_at: '2026-01-01 00:00:00', note: 'unnamed' }, overrides: {} } },
      };
      const intent = NfcResolver.resolve({
        location: 'livingroom', value: 'aa_bb',
        registry: metaOnly, contentIdResolver,
      });
      expect(intent).toBeNull();
    });
  });
```

**Step 2: Run test to verify the leak test fails**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/domain/trigger/services/NfcResolver.test.mjs --config vitest.config.mjs
```

Expected: `scanned_at and note do not leak` FAILS (params currently contains both). The metadata-only test should already PASS (regression pin).

**Step 3: Implement**

In `NfcResolver.mjs`, below `RESERVED_KEYS`:

```js
// Tag bookkeeping written by YamlTriggerConfigRepository on first scan.
// Never actionable, never a shorthand candidate, and — critically — never
// forwarded in intent.params: params become the device-URL query string,
// where a leaked scanned_at was mis-parsed as a content id (2026-07-07 bug).
const METADATA_KEYS = new Set(['scanned_at', 'note']);
```

In `expandShorthand`, extend the candidate filter:

```js
  const candidates = Object.entries(merged).filter(([k]) => !RESERVED_KEYS.has(k) && !METADATA_KEYS.has(k));
```

In the params-building loop inside `resolve`:

```js
    const params = {};
    for (const [k, v] of Object.entries(merged)) {
      if (RESERVED_KEYS.has(k)) continue;
      if (METADATA_KEYS.has(k)) continue;
      if (k === consumedKey) continue;
      params[k] = v;
    }
```

Also update the stale comment at the dispatchable check (line ~125): it says tags with only metadata "resolve to no intent" — still true; no change needed there beyond confirming.

**Step 4: Run tests to verify they pass**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/domain/trigger/services/NfcResolver.test.mjs tests/isolated/domain/trigger/services/NfcResolver.endBehavior.test.mjs tests/isolated/application/trigger/ --config vitest.config.mjs
```

Expected: ALL pass (including the endBehavior and TriggerDispatchService/actionHandlers suites — they consume `intent.params`).

**Step 5: Commit**

```bash
git add backend/src/2_domains/trigger/services/NfcResolver.mjs tests/isolated/domain/trigger/services/NfcResolver.test.mjs
git commit -m "fix(trigger): NfcResolver excludes scanned_at/note metadata from intent params (no more URL leakage)"
```

---

### Task 5: Playback watchdog arms for `play-next` (kill the silent failure)

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` (watchdog arming gate ~line 630; `expectedContentId` derivation ~lines 717-722)
- Test: `tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs` (append; reuse the file's existing `makeLogger`/`makeEventBus`/`makeDevice` helpers and its fake-timer pattern — read the whole file first)

**Step 1: Write the failing test**

Append, following the exact construction pattern of the existing "broadcasts timeout event" test in that file (same service deps; only the query differs):

```js
  test('arms watchdog for play-next queries and times out when nothing plays', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      logger,
    });

    const result = await svc.execute('living-room', { 'play-next': 'plex:621568', op: 'play-next' });
    expect(result.ok).toBe(true);

    await vi.advanceTimersByTimeAsync(90_000);

    expect(logger.warn).toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.objectContaining({ expectedContentId: 'plex:621568' })
    );
    vi.useRealTimers();
  });

  test('play-next watchdog resolves when matching playback.log arrives', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast: vi.fn(),
      eventBus,
      logger,
    });

    await svc.execute('living-room', { 'play-next': 'plex:621568', op: 'play-next' });
    eventBus.publish('playback.log', { contentId: 'plex:621568' });
    await vi.advanceTimersByTimeAsync(90_000);

    expect(logger.warn).not.toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.anything()
    );
    expect(logger.info).toHaveBeenCalledWith(
      'wake-and-load.playback.confirmed',
      expect.objectContaining({ contentId: 'plex:621568' })
    );
    vi.useRealTimers();
  });
```

CAUTION: the existing tests in this file may construct the service with more/fewer deps — mirror them exactly (e.g. if they pass `commandHandlerLivenessService` or a prewarm stub, do the same). The WS-first path must be skipped in this test: the shared `makeEventBus` returns `getTopicSubscriberCount: () => 0`, which yields `wsSkipReason: 'no-subscribers'` → FKB URL path → watchdog arming. That is exactly the incident's code path shape.

**Step 2: Run test to verify it fails**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs --config vitest.config.mjs
```

Expected: both new tests FAIL — the watchdog never arms because the gate requires `contentQuery.queue` and the id-derivation list omits `play-next`. (`logger.warn` never called with `playback.timeout`; `playback.confirmed` never logged.)

**Step 3: Implement**

In `WakeAndLoadService.mjs`:

(a) Watchdog arming gate (line ~630) — arm whenever the run succeeded and isn't adopt-mode; let the watchdog's own `expectedContentId` check decide:

```js
    // Arm the playback watchdog — non-blocking. The response returns now;
    // the watchdog fires asynchronously if playback never starts.
    // Armed for ANY resolvable content query (queue, play, play-next, …) —
    // gating on `queue` alone let play-next dispatches fail silently
    // (2026-07-07 NFC bug: trigger.fired ok:true, nothing played, no alarm).
    if (result.ok && !isAdopt) {
      this.#armPlaybackWatchdog({
        deviceId, dispatchId, topic, contentQuery
      });
    }
```

(b) `expectedContentId` derivation inside `#armPlaybackWatchdog` (lines ~717-722) — delegate to the shared `resolveContentId` (already imported at the top of this file; `CONTENT_ID_KEYS` covers queue/play/play-next/plex/hymn/primary/scripture/contentId), keeping prewarm and `list` handling:

```js
    // Preference order: prewarmContentId (queue resolved to a concrete id)
    // > explicit contentId > shared CONTENT_ID_KEYS resolution (queue, play,
    // play-next, …) > list. resolveContentId keeps this in lockstep with the
    // WS-envelope delivery paths.
    const expectedContentId =
      contentQuery.prewarmContentId
      || contentQuery.contentId
      || resolveContentId(contentQuery)?.contentId
      || contentQuery.list;
    if (!expectedContentId) return;
```

**Step 4: Run tests to verify they pass — including all other WakeAndLoadService suites (the gate change affects every execute path)**

```bash
frontend/node_modules/.bin/vitest run tests/isolated/application/devices/ --config vitest.config.mjs
```

Expected: ALL pass. Watch specifically `WakeAndLoadService.op.test.mjs`, `.endBehavior.test.mjs`, `.retry.test.mjs`, `.prewarm-permanent.test.mjs` — if any of them assert that the watchdog does NOT arm for their queries, reconcile: the new behavior (arm when an id resolves) is intended; update such an assertion only if it exists purely to pin the old gate, and say so in the commit message.

**Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs
git commit -m "fix(devices): playback watchdog arms for play-next (and any resolvable content id), not just queue"
```

---

### Task 6: Full regression pass, docs, wrap-up

**Step 1: Run the full isolated suite**

```bash
npm run test:isolated
```

Expected: PASS. This is the same suite CI/pre-merge expects. If unrelated tests were already failing at Task 0 baseline, only compare against that baseline.

**Step 2: Update the bug report status**

Edit `docs/_wip/bugs/2026-07-07-nfc-play-next-url-fallback-misparse-nothing-plays.md`: change the `**Status:**` line to:

```markdown
**Status:** Fix implemented on `fix/nfc-play-next-url-fallback` (see `docs/_wip/plans/2026-07-07-nfc-play-next-url-fallback-fix.md`) — pending merge + deploy + live verification. Q1 (WS ack timeout despite fresh subscribers) still open.
```

**Step 3: Commit docs**

```bash
git add docs/_wip/bugs/2026-07-07-nfc-play-next-url-fallback-misparse-nothing-plays.md
git commit -m "docs(bugs): mark NFC play-next URL-fallback bug as fix-implemented"
```

**Step 4: Finish the branch**

REQUIRED SUB-SKILL: Use superpowers:finishing-a-development-branch. Per project rules: merge directly into main (no PRs) — but ONLY with the user's go-ahead, and record/delete the branch per the Branch Management section of CLAUDE.md. Do not deploy.

---

## Post-deploy verification (manual — for the user / a later session)

1. **Warm path:** with the living-room screen already up, scan the "Eyes shuts" tag → expect `wake-and-load.load.ws-ack` in prod logs and the album playing.
2. **Cold path (the fixed one):** TV off → scan → expect `fullykiosk.load.builtUrl` **without** `scanned_at`/`note` params, then frontend `screen-autoplay.parsed`, `queue.resolve {source:'plex', localId:'621568'}`, and `wake-and-load.playback.confirmed`.
3. **Alarm check:** deliberately scan with Plex stopped → expect `wake-and-load.playback.timeout {expectedContentId:'plex:621568'}` within 90 s.
4. Grep prod for regressions: `queue.source.unknown`, `playback.timeout`, and the 1 Hz `playback.overlay-summary` Loading spam.

## Explicitly out of scope (tracked in the bug report)

- Q1: why WS-first device-ack timed out despite `subscriberCount:2, handlerFresh:true` (suspected zombie WebView).
- Prewarm for `play-next` content (gate at `WakeAndLoadService.mjs:314` still queue-only).
- Player UX: surface a queue-404 as an error state instead of infinite "Loading…".
