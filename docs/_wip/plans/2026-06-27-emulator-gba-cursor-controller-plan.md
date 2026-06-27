# Emulator: GBA LCD alignment, kiosk cursor, BT controller UX — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the GBA dot-matrix grid alignment, hide the cursor over the bezel in kiosk, and add a controller-connected indicator + full pair/remove management UX to the game menu.

**Architecture:** Part 1 makes the LCD native resolution data-driven (auto-defaulted by EmulatorJS core) so the integer-locked screen box scales to GBA's 240×160. Part 2 mirrors the existing kiosk cursor-hide rule onto the portaled fullscreen wrapper. Parts 3a/3b reuse the existing `ControllerStatus`/`useGamepadStatus` components and the fitness extension's existing `btPairing`/`btInventory` infra, wiring them to the game menu through a new whitelisted `bt.*` bus relay in the backend.

**Tech Stack:** React (Vite/vitest), SCSS, Node ESM backend (`ws` event bus), the fitness Docker extension (`bluetoothctl` via BlueZ on the garage box).

**Design doc:** `docs/_wip/plans/2026-06-27-emulator-gba-cursor-controller-design.md`

**Conventions found in repo:**
- Frontend/backend tests are co-located (`EmulatorConsole.test.jsx`, `loadEmulatorConfig.test.mjs`). Run with `npx vitest run <path>`.
- Extension tests live in `_extensions/fitness/test/` (`btPairing.test.mjs`). Run with `cd _extensions/fitness && npm test` (confirm the runner in its `package.json` first).
- All new components/hooks ship with structured logging via `getLogger().child(...)` (CLAUDE.md).
- Never raw `console.*` in frontend; use the logging framework.

---

## Phase 1 — GBA LCD alignment (config-driven native resolution)

### Task 1.1: `CORE_NATIVE` map + native resolution in `loadEmulatorConfig`

**Files:**
- Modify: `backend/src/3_applications/emulator/loadEmulatorConfig.mjs`
- Test: `backend/src/3_applications/emulator/loadEmulatorConfig.test.mjs` (existing — add cases)

**Step 1: Write failing tests.** Add to the existing test file:

```js
// Native resolution: auto-defaulted by core, explicit override wins.
it('defaults native resolution to 160×144 for a gb-core game', () => {
  const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => ([
    { system: 'gb', manifest: { system: 'gb', core: { ejs_core: 'gb' }, games: [{ id: 'pkmn', rom: 'r.gb' }] } },
  ]) });
  expect(cfg.games[0].native).toEqual({ width: 160, height: 144 });
});

it('auto-defaults native resolution to 240×160 for a per-game gba core', () => {
  const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => ([
    { system: 'gb', manifest: { system: 'gb', core: { ejs_core: 'gb' }, games: [
      { id: 'msc', rom: 'msc.gba', core: 'gba' },
    ] } },
  ]) });
  expect(cfg.games[0].native).toEqual({ width: 240, height: 160 });
});

it('honors an explicit per-game native override over the core default', () => {
  const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => ([
    { system: 'gb', manifest: { system: 'gb', core: { ejs_core: 'gb' }, games: [
      { id: 'odd', rom: 'odd.gb', native: { width: 256, height: 224 } },
    ] } },
  ]) });
  expect(cfg.games[0].native).toEqual({ width: 256, height: 224 });
});

it('honors a system-level native default when no per-game core/native', () => {
  const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => ([
    { system: 'gba', manifest: { system: 'gba', core: { ejs_core: 'gba' }, native: { width: 240, height: 160 }, games: [{ id: 'g', rom: 'g.gba' }] } },
  ]) });
  expect(cfg.games[0].native).toEqual({ width: 240, height: 160 });
  expect(cfg.systems.gba.native).toEqual({ width: 240, height: 160 });
});
```

**Step 2: Run to verify they fail.** `npx vitest run backend/src/3_applications/emulator/loadEmulatorConfig.test.mjs` → FAIL (`native` undefined).

**Step 3: Implement.** In `loadEmulatorConfig.mjs`:

Add near the top (after `NOOP_LOGGER`):

```js
// EmulatorJS core → native framebuffer resolution. The dot-matrix grid + the
// integer-locked screen box must scale to the ACTUAL game resolution, not GB's
// 160×144, or the LCD cells drift off a GBA title's pixels.
const CORE_NATIVE = {
  gb: { width: 160, height: 144 },
  gbc: { width: 160, height: 144 },
  gambatte: { width: 160, height: 144 },
  gba: { width: 240, height: 160 },
  mgba: { width: 240, height: 160 },
};
const DEFAULT_NATIVE = { width: 160, height: 144 };

function resolveNative({ gameNative, systemNative, core }) {
  if (gameNative && Number.isFinite(gameNative.width) && Number.isFinite(gameNative.height)) {
    return { width: gameNative.width, height: gameNative.height };
  }
  if (systemNative && Number.isFinite(systemNative.width) && Number.isFinite(systemNative.height)) {
    return { width: systemNative.width, height: systemNative.height };
  }
  const key = typeof core === 'string' ? core.toLowerCase() : core;
  return CORE_NATIVE[key] || DEFAULT_NATIVE;
}
```

In the `systems[systemId]` object literal, add the system's native (so the catalog can expose it):

```js
systems[systemId] = {
  core: manifest.core?.ejs_core || manifest.core?.name || systemId,
  label: manifest.label || systemId,
  native: manifest.native && Number.isFinite(manifest.native.width)
    ? { width: manifest.native.width, height: manifest.native.height }
    : null,
};
```

Inside the games loop, compute the effective core and native, then add `native` to the pushed game object. Replace the `core: game.core ?? null,` push with the existing line and add after `chrome`:

```js
// Native framebuffer res for the LCD grid / integer screen box. Per-game
// override → system manifest native → core default → 160×144.
native: resolveNative({
  gameNative: game.native,
  systemNative: manifest.native,
  core: game.core ?? manifest.core?.ejs_core ?? manifest.core?.name ?? systemId,
}),
```

**Step 4: Run to verify pass.** Same command → PASS.

**Step 5: Commit.**
```bash
git add backend/src/3_applications/emulator/loadEmulatorConfig.mjs backend/src/3_applications/emulator/loadEmulatorConfig.test.mjs
git commit -m "feat(emulator): resolve per-game native resolution (gba 240x160) in config"
```

### Task 1.2: Verify `native` survives `buildCatalog`/the library API

**Files:**
- Read: `backend/src/3_applications/emulator/buildCatalog.mjs` (and `resolveGameRules`), `backend/src/4_api/v1/routers/emulator.mjs` (the `/library` handler around line 191–209).

**Step 1:** Trace whether the per-game object returned by `loadEmulatorConfig` is passed through to the `/library` response with `native` intact, or whether `buildCatalog`/`resolveGameRules` rebuilds a whitelist of fields (dropping `native`).

**Step 2:** If a field whitelist drops `native`, add `native` to it (mirror how `core`/`shader`/`chrome` flow). Add/extend a test in the corresponding `.test.mjs` asserting a built library game carries `native`.

**Step 3:** Commit:
```bash
git commit -am "feat(emulator): carry native resolution through catalog to /library"
```

> NOTE for executor: if `native` already flows through untouched (objects spread, not whitelisted), this task is just the verifying test + commit.

### Task 1.3: Use `native` in `EmulatorConsole` screen-box math

**Files:**
- Modify: `frontend/src/modules/Emulator/EmulatorConsole.jsx` (lines ~204–237)
- Test: `frontend/src/modules/Emulator/EmulatorConsole.test.jsx` (existing)

The screen-box math is inside a `useLayoutEffect` keyed on DOM measurement, which is hard to unit-test directly. Extract the integer-lock math into a pure helper and test that.

**Step 1: Write failing test.** Add to `EmulatorConsole.test.jsx` (import the new helper):

```js
import { computeScreenBox } from './EmulatorConsole.jsx';

describe('computeScreenBox', () => {
  const cut = { left: 0, top: 0, width: 320, height: 288 }; // device-independent px
  it('locks to integer multiples of 160×144 for GB', () => {
    const box = computeScreenBox({ cut, dpr: 1, native: { width: 160, height: 144 } });
    expect(box.scale).toBe(2);
    expect(box.width).toBe(320);
    expect(box.height).toBe(288);
  });
  it('locks to integer multiples of 240×160 for GBA', () => {
    const box = computeScreenBox({ cut: { left: 0, top: 0, width: 480, height: 320 }, dpr: 1, native: { width: 240, height: 160 } });
    expect(box.scale).toBe(2);
    expect(box.width).toBe(480);
    expect(box.height).toBe(320);
  });
  it('letterboxes GBA inside a GB-shaped cutout (centered)', () => {
    // 320×288 cutout, GBA 240×160 → max scale 1 (240≤320, 160≤288); centered.
    const box = computeScreenBox({ cut, dpr: 1, native: { width: 240, height: 160 } });
    expect(box.scale).toBe(1);
    expect(box.width).toBe(240);
    expect(box.height).toBe(160);
    expect(box.left).toBe(40); // (320-240)/2
    expect(box.top).toBe(64);  // (288-160)/2
  });
  it('falls back to 160×144 when native is absent', () => {
    const box = computeScreenBox({ cut, dpr: 1, native: undefined });
    expect(box.scale).toBe(2);
  });
});
```

**Step 2: Run → FAIL** (`computeScreenBox` not exported). `npx vitest run frontend/src/modules/Emulator/EmulatorConsole.test.jsx`

**Step 3: Implement.** In `EmulatorConsole.jsx`, add an exported pure helper above the component:

```js
/**
 * Pure integer-lock geometry: largest integer scale N where an
 * N×nativeW × N×nativeH device-px box fits the cutout, centered + pixel-snapped.
 * Exported for unit testing; the layout effect calls it with measured values.
 */
export function computeScreenBox({ cut, dpr, native }) {
  const nw = native && Number.isFinite(native.width) ? native.width : 160;
  const nh = native && Number.isFinite(native.height) ? native.height : 144;
  const scale = Math.max(1, Math.min(
    Math.floor((cut.width * dpr) / nw),
    Math.floor((cut.height * dpr) / nh),
  ));
  const width = (scale * nw) / dpr;
  const height = (scale * nh) / dpr;
  const left = Math.round((cut.left + (cut.width - width) / 2) * dpr) / dpr;
  const top = Math.round((cut.top + (cut.height - height) / 2) * dpr) / dpr;
  const cell = scale / dpr;
  return { left, top, width, height, cell, scale };
}
```

Then refactor the `useLayoutEffect` `compute()` to call it:

```js
const compute = () => {
  const rect = root.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  const sc = game?.presentation?.screen;
  const hasCut = sc && Number.isFinite(sc.x);
  const cut = {
    left: hasCut ? (sc.x / 100) * rect.width : 0,
    top: hasCut ? (sc.y / 100) * rect.height : 0,
    width: hasCut ? (sc.width / 100) * rect.width : rect.width,
    height: hasCut ? (sc.height / 100) * rect.height : rect.height,
  };
  const next = computeScreenBox({ cut, dpr, native: game?.native });
  setScreenBox((prev) => (prev && prev.scale === next.scale && prev.left === next.left
    && prev.top === next.top && prev.width === next.width && prev.height === next.height
    ? prev : next));
};
```

Update the comment block (lines 191–202) to say native resolution is config-driven, not a hardcoded 160×144.

**Step 4: Run → PASS.** Same command.

**Step 5: Commit.**
```bash
git add frontend/src/modules/Emulator/EmulatorConsole.jsx frontend/src/modules/Emulator/EmulatorConsole.test.jsx
git commit -m "feat(emulator): scale LCD screen box + grid to per-game native resolution"
```

### Task 1.4: Manual visual verification (GBA)

**Step 1:** Confirm Mario Super Circuit's manifest entry has `core: gba` (it should). If a dedicated GBA system/manifest exists instead, ensure it declares `core: { ejs_core: gba }` (auto-yields 240×160) or an explicit `native:`.
**Step 2:** Per `feedback_dont_ask_check_yourself`: use a vision check (screenshot harness like `tests/_scratch/shoot-session-chart.mjs` pattern, or the `/run` skill) to confirm the dot-matrix cells align to GBA pixels and the screen is centered/letterboxed in the GB bezel. Do not ask the user to eyeball it.

---

## Phase 2 — Kiosk cursor over the bezel

### Task 2.1: Tag the fullscreen portal wrapper with kiosk + hide cursor

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx` (line ~200)
- Modify: `frontend/src/modules/Emulator/EmulatorConsole.scss` (add rule)
- Test: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx` (existing)

**Step 1: Write failing test.** The widget already imports `isKioskEnv` from `@/lib/kioskEnv.js`. Add a test that mocks `isKioskEnv` → true and asserts the fullscreen wrapper carries `kiosk-ui`:

```js
import { vi } from 'vitest';
vi.mock('@/lib/kioskEnv.js', () => ({ isKioskEnv: () => true }));
// ... render the widget, drive it to view==='playing' (mock library + select a no-save game),
// then: expect(document.querySelector('.fitness-emulator-fullscreen').className).toContain('kiosk-ui');
```

> If driving to `playing` is heavy in jsdom, instead extract the className into a tiny pure helper `fullscreenClass(isKiosk)` in the widget and unit-test that: `expect(fullscreenClass(true)).toBe('fitness-emulator-fullscreen kiosk-ui')`.

**Step 2: Run → FAIL.** `npx vitest run frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx`

**Step 3: Implement.** In `EmulatorGameWidget.jsx`, change the portal wrapper:

```jsx
<div className={`fitness-emulator-fullscreen${isKioskEnv() ? ' kiosk-ui' : ''}`}>
```

In `EmulatorConsole.scss` (or the widget's stylesheet that already defines `.fitness-emulator-fullscreen`), add — mirroring `FitnessApp.scss:76-83`:

```scss
// Kiosk: the fullscreen emulator is portaled to <body>, escaping the
// .fitness-app-container.kiosk-ui cursor-hide scope — re-apply it here.
.fitness-emulator-fullscreen.kiosk-ui,
.fitness-emulator-fullscreen.kiosk-ui * {
  cursor: none !important;
}
```

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx frontend/src/modules/Emulator/EmulatorConsole.scss frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx
git commit -m "fix(emulator): hide cursor over the bezel in kiosk (portal escapes kiosk-ui scope)"
```

---

## Phase 3b-backend — BT bus relay + extension `bt.remove`

> Built before the frontend so the frontend can be verified end-to-end.

### Task 3.1: Whitelisted `bt.*` bus relay in `app.mjs`

**Files:**
- Modify: `backend/src/app.mjs` (register a new `onClientMessage` handler near the existing one at ~418)
- Test: locate the event-bus / app message-handler test (search `onClientMessage` usage in tests); if none, add a focused unit test for the relay predicate.

**Background:** The backend does NOT relay arbitrary client topics — only `source:'fitness'`, `homeline:*`, `playback_state`. Both directions of `bt.*` are dropped today. `onClientMessage` supports multiple registered handlers (app.mjs already registers several).

**Step 1: Write failing test** for a pure predicate `shouldRelayBtTopic(topic)`:

```js
// e.g. backend/src/0_system/eventbus/btRelay.test.mjs
import { shouldRelayBtTopic } from './btRelay.mjs';
it('relays bt control topics both directions', () => {
  ['bt.pair.request','bt.pair.progress','bt_inventory','bt.remove','bt.remove.result']
    .forEach((t) => expect(shouldRelayBtTopic(t)).toBe(true));
});
it('does not relay unrelated topics', () => {
  ['fitness','midi','homeline:abc','logging', undefined, ''].forEach((t) => expect(shouldRelayBtTopic(t)).toBe(false));
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement.** New file `backend/src/0_system/eventbus/btRelay.mjs`:

```js
// Whitelisted bidirectional relay for Bluetooth game-controller management.
// The garage fitness extension and the browser are both WS clients of the bus;
// neither talks to the other unless the backend explicitly rebroadcasts. We
// relay ONLY these BT control topics (never a blanket relay — that would turn
// the bus into an open relay).
export const BT_RELAY_TOPICS = new Set([
  'bt.pair.request',   // browser → extension
  'bt.pair.progress',  // extension → browser
  'bt_inventory',      // extension → browser
  'bt.remove',         // browser → extension
  'bt.remove.result',  // extension → browser
]);

export function shouldRelayBtTopic(topic) {
  return typeof topic === 'string' && BT_RELAY_TOPICS.has(topic);
}
```

In `app.mjs`, after the existing `eventBus.onClientMessage(...)` block (~line 458), register:

```js
import { shouldRelayBtTopic } from './0_system/eventbus/btRelay.mjs';
// ...
// Bluetooth controller management relay (browser ⇄ garage fitness extension).
eventBus.onClientMessage((clientId, message) => {
  if (message && shouldRelayBtTopic(message.topic)) {
    eventBus.broadcast(message.topic, message);
    rootLogger.debug?.('eventbus.bt.relay', { clientId, topic: message.topic });
  }
});
```

(Place the import with the other top-of-file imports.)

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add backend/src/0_system/eventbus/btRelay.mjs backend/src/0_system/eventbus/btRelay.test.mjs backend/src/app.mjs
git commit -m "feat(eventbus): whitelisted bt.* relay between browser and fitness extension"
```

### Task 3.2: Extension `bt.remove` handler

**Files:**
- Modify: `_extensions/fitness/src/btPairing.mjs` (add `handleBtRemoveRequest`)
- Modify: `_extensions/fitness/src/server.mjs` (subscribe + dispatch)
- Test: `_extensions/fitness/test/btPairing.test.mjs` (existing)

**Step 1: Write failing test.**

```js
import { handleBtRemoveRequest } from '../src/btPairing.mjs';
it('removes a device and emits bt.remove.result success', async () => {
  const calls = []; const sent = [];
  const exec = async (cmd) => { calls.push(cmd); return { stdout: '', stderr: '' }; };
  await handleBtRemoveRequest({ requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' },
    { exec, send: (t, p) => sent.push([t, p]), logger: { info(){}, warn(){}, error(){} } });
  expect(calls).toContain('bluetoothctl remove AA:BB:CC:DD:EE:FF');
  expect(sent).toEqual([['bt.remove.result', { requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF', success: true }]]);
});
it('emits failure on exec error', async () => {
  const sent = [];
  const exec = async () => { throw new Error('not found'); };
  await handleBtRemoveRequest({ requestId: 'r2', address: 'AA:BB:CC:DD:EE:FF' },
    { exec, send: (t, p) => sent.push([t, p]), logger: { info(){}, warn(){}, error(){} } });
  expect(sent[0][1]).toMatchObject({ success: false, error: 'not found' });
});
it('rejects a malformed MAC without shelling out', async () => {
  const calls = []; const sent = [];
  await handleBtRemoveRequest({ requestId: 'r3', address: 'nope' },
    { exec: async (c) => { calls.push(c); return { stdout: '' }; }, send: (t, p) => sent.push([t, p]) });
  expect(calls).toHaveLength(0);
  expect(sent[0][1]).toMatchObject({ success: false });
});
```

**Step 2: Run → FAIL.** `cd _extensions/fitness && npm test`

**Step 3: Implement** in `btPairing.mjs`:

```js
const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

/**
 * Forget/unpair a controller: `bluetoothctl remove <mac>`. Validates the MAC
 * (it is interpolated into a shell command) and never throws — result is
 * reported via the `bt.remove.result` bus topic.
 */
export async function handleBtRemoveRequest(message, { exec = defaultExec, send, logger = console } = {}) {
  const requestId = message?.requestId;
  const address = String(message?.address || '');
  const reply = (extra) => { try { send?.('bt.remove.result', { requestId, address, ...extra }); } catch (e) { logger?.error?.(e?.message); } };
  if (!MAC_RE.test(address)) {
    logger?.warn?.(`⚠️  bt.remove rejected malformed address: ${address}`);
    reply({ success: false, error: 'invalid-address' });
    return;
  }
  try {
    await exec(`bluetoothctl remove ${address}`);
    logger?.info?.(`🎮 bt.remove removed ${address}`);
    reply({ success: true });
  } catch (err) {
    logger?.warn?.(`⚠️  bt.remove failed for ${address}: ${err?.message}`);
    reply({ success: false, error: err?.message || String(err) });
  }
}
```

In `server.mjs`: add `'bt.remove'` to the subscribe topic list (line ~213), import `handleBtRemoveRequest`, and add a dispatch branch beside the `bt.pair.request` one:

```js
if (message.topic === 'bt.remove') {
  await handleBtRemoveRequest(message, { exec: execAsync, send: (t, p) => sendBus(t, p), logger: console });
  return;
}
```

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add _extensions/fitness/src/btPairing.mjs _extensions/fitness/src/server.mjs _extensions/fitness/test/btPairing.test.mjs
git commit -m "feat(fitness-ext): bt.remove handler to forget/unpair a controller"
```

---

## Phase 3-frontend — context actions, indicator, management panel

### Task 3.3: FitnessContext — BT feeds + pair/forget actions

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`
- Test: add `frontend/src/context/FitnessContext.bt.test.jsx` (or extend an existing context test) for the pure action builders.

**Goal:** Subscribe to `bt_inventory`, `bt.pair.progress`, `bt.remove.result`; expose `btInventory` (array), `controllerPairing` (latest progress object), and actions `pairController()` / `forgetController(address)` that publish via `wsService.send`.

**Step 1: Write failing test** for pure message builders (keep them exported + pure so they test without React/WS):

```js
import { buildPairRequest, buildRemoveRequest } from './fitnessBtActions.js';
it('builds a bt.pair.request with a requestId + duration', () => {
  const m = buildPairRequest({ requestId: 'p1', durationMs: 30000 });
  expect(m).toEqual({ topic: 'bt.pair.request', requestId: 'p1', durationMs: 30000 });
});
it('builds a bt.remove for an address', () => {
  expect(buildRemoveRequest({ requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' }))
    .toEqual({ topic: 'bt.remove', requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement.** New file `frontend/src/context/fitnessBtActions.js`:

```js
export function buildPairRequest({ requestId, durationMs = 30000 }) {
  return { topic: 'bt.pair.request', requestId, durationMs };
}
export function buildRemoveRequest({ requestId, address }) {
  return { topic: 'bt.remove', requestId, address };
}
```

In `FitnessContext.jsx`:
- Add state: `const [btInventory, setBtInventory] = useState(null);` and `const [controllerPairing, setControllerPairing] = useState(null);`
- Extend the existing `wsService.subscribe([...])` topic array (line ~1278) to include `'bt_inventory'`, `'bt.pair.progress'`, `'bt.remove.result'`, and in the callback handle them:

```js
if (data?.topic === 'bt_inventory') { setBtInventory(Array.isArray(data.devices) ? data.devices : []); return; }
if (data?.topic === 'bt.pair.progress') { setControllerPairing(data); return; }
if (data?.topic === 'bt.remove.result') { /* optional: surface a toast */ return; }
```

- Add actions (use the existing dynamic-import pattern for `wsService`, and a monotonically-increasing ref for requestIds — NOT `Date.now()`):

```js
const btReqRef = useRef(0);
const pairController = useCallback((durationMs = 30000) => {
  const requestId = `pair-${++btReqRef.current}`;
  setControllerPairing({ phase: 'scanning', durationMs });
  import('../services/WebSocketService').then(({ wsService }) => {
    wsService.send(buildPairRequest({ requestId, durationMs }));
  });
  getLogger().info('fitness.bt.pair-request', { requestId, durationMs });
  return requestId;
}, []);
const forgetController = useCallback((address) => {
  const requestId = `forget-${++btReqRef.current}`;
  import('../services/WebSocketService').then(({ wsService }) => {
    wsService.send(buildRemoveRequest({ requestId, address }));
  });
  getLogger().info('fitness.bt.remove-request', { requestId, address });
  return requestId;
}, []);
```

- Expose `btInventory`, `controllerPairing`, `pairController`, `forgetController` on the context value object (find the `value={{ ... }}` / provider value and add them).

**Step 4: Run → PASS** (the pure-builder test). 

**Step 5: Commit.**
```bash
git add frontend/src/context/fitnessBtActions.js frontend/src/context/FitnessContext.jsx frontend/src/context/fitnessBtActions.test.js
git commit -m "feat(fitness): subscribe to bt feeds + expose pairController/forgetController"
```

### Task 3.4: `ControllerStatus` — optional per-device Forget button

**Files:**
- Modify: `frontend/src/modules/Emulator/input/ControllerStatus.jsx`
- Test: `frontend/src/modules/Emulator/input/ControllerStatus.test.jsx` (create if absent)

**Step 1: Write failing test.** Render `ControllerStatus` with `controllers=[{id:'a',label:'8BitDo',address:'AA:..'}]`, `btInventory=[{address:'AA:..',connected:true}]`, and an `onForget` spy; assert a Forget button exists for that row and calls `onForget('AA:..')` on click. Also assert no Forget button when `onForget` is absent (backward-compatible).

**Step 2: Run → FAIL.**

**Step 3: Implement.** Add `onForget` to props (JSDoc + destructure). In the `ccs-known-row` `<li>`, when `typeof onForget === 'function'` and the row has an `os`/`address`, render:

```jsx
{typeof onForget === 'function' && k.address ? (
  <button type="button" className="ccs-forget-button"
          aria-label={`Forget ${k.label}`}
          onClick={() => onForget(k.address)}>Forget</button>
) : null}
```

Note: `mergeKnown` (in `useGamepadStatus.js`) currently does not carry `address` onto the row. Add `address: config.address ?? null` to the object it returns, and add a test there asserting it. (Small, do it in this task.)

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add frontend/src/modules/Emulator/input/ControllerStatus.jsx frontend/src/modules/Emulator/input/ControllerStatus.test.jsx frontend/src/modules/Emulator/input/useGamepadStatus.js
git commit -m "feat(emulator): optional per-controller Forget button in ControllerStatus"
```

### Task 3.5: Controller indicator + management panel in `ArcadeShell`

**Files:**
- Modify: `frontend/src/modules/Emulator/ui/ArcadeShell.jsx`
- Modify: `frontend/src/modules/Emulator/ui/ArcadeShell.scss`
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx` (pass new props)
- Test: `frontend/src/modules/Emulator/ui/ArcadeShell.test.jsx` (create if absent)

**Step 1: Write failing test.** Render `ArcadeShell` with `controllers`, a `getGamepads` stub returning one matching pad, and `btInventory`. Assert a status chip shows connected state (`data-connected="1"`); render with no pads → `data-connected="0"`. Assert clicking the chip toggles a panel containing `ControllerStatus`, and that the Pair button calls the injected `onPairController`.

**Step 2: Run → FAIL.**

**Step 3: Implement.** Extend `ArcadeShell` props:

```js
controllers = [],
btInventory,
controllerPairing,
onPairController,
onForgetController,
```

Add a compact status chip + collapsible panel. Use `useGamepadStatus(controllers, { getGamepads, btInventory })` for connection state:

```jsx
import { useGamepadStatus } from '../input/useGamepadStatus.js';
import { ControllerStatus } from '../input/ControllerStatus.jsx';
// inside component:
const [ctrlPanelOpen, setCtrlPanelOpen] = useState(false);
const { connected } = useGamepadStatus(controllers, { getGamepads, btInventory });
const anyConnected = connected.length > 0;
```

Render near the top of `.emu-arcade-shell`:

```jsx
<div className="emu-controller-indicator" data-connected={anyConnected ? '1' : '0'}>
  <button type="button" className="emu-controller-chip"
          aria-expanded={ctrlPanelOpen}
          onClick={() => setCtrlPanelOpen((v) => !v)}>
    🎮 {anyConnected ? 'Controller connected' : 'No controller'}
  </button>
  {ctrlPanelOpen && (
    <div className="emu-controller-panel" role="dialog" aria-label="Controllers">
      <ControllerStatus
        controllers={controllers}
        btInventory={btInventory}
        getGamepads={getGamepads}
        pairing={controllerPairing}
        onPair={onPairController}
        onForget={onForgetController}
      />
    </div>
  )}
</div>
```

Add structured logging (`getLogger().child({ component: 'emu-arcade-shell' })`) for panel open/close and connection-state changes.

In `EmulatorGameWidget.jsx`, pass the new props to `<ArcadeShell>`:

```jsx
controllers={library.input?.controllers || []}
btInventory={fitnessContext?.btInventory}
controllerPairing={fitnessContext?.controllerPairing}
onPairController={fitnessContext?.pairController}
onForgetController={fitnessContext?.forgetController}
```

Add SCSS for `.emu-controller-indicator` / `.emu-controller-chip` / `.emu-controller-panel` (corner placement, green when `[data-connected="1"]`, dim otherwise). Use Roboto Condensed (canonical font — see `feedback_roboto_condensed_is_canon`); get "bold" from color/glow, not a new typeface.

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add frontend/src/modules/Emulator/ui/ArcadeShell.jsx frontend/src/modules/Emulator/ui/ArcadeShell.scss frontend/src/modules/Emulator/ui/ArcadeShell.test.jsx frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx
git commit -m "feat(emulator): controller indicator + pair/forget panel in the game menu"
```

### Task 3.6: End-to-end verification (garage)

**Step 1:** Deploy the fitness extension to the garage box and confirm it's running: `ssh garage docker ps` (look for the fitness container). Rebuild/redeploy per `_extensions/fitness/deploy.sh` if `server.mjs`/`btPairing.mjs` changed.
**Step 2:** With the backend relay live, open the fitness app's Video Games menu, open the controller panel, click Pair, and confirm: the chip flips to connected when a controller pairs, battery shows, and Forget removes it (verify with `ssh garage 'bluetoothctl devices'`).
**Step 3:** Confirm the `bt_inventory` feed reaches the browser (DevTools WS frames or a `getLogger` debug event) — this proves the relay works both directions.

---

## Final steps

- Run the full relevant test suites: `npx vitest run frontend/src/modules/Emulator frontend/src/modules/Fitness/widgets/EmulatorGame frontend/src/context` and `cd _extensions/fitness && npm test` and the backend emulator/eventbus tests.
- Use superpowers:verification-before-completion before claiming done.
- Update docs: note the per-system `native:` manifest option in the emulator config docs (`docs/reference/core/configuration.md` or the emulator-specific doc) and the `bt.*` relay topics.
- Use superpowers:requesting-code-review before merging to main.
- Deploy: backend (relay) and fitness extension (bt.remove) must both be deployed for Part 3b to work end-to-end.

## Risks / watch-items
- **Task 1.2** may be a no-op if `native` flows through untouched — verify, don't assume.
- The GBA letterbox inside the GB cutout is expected (decision: keep GB bezel).
- The relay MUST stay a whitelist. Do not generalize it.
- `requestId`s use a ref counter, not `Date.now()` (consistent + testable).
- Verify the garage box has a BlueZ default agent registered (`bluetoothctl agent on`) or pairing PIN/confirm prompts won't auto-accept (noted in `btPairing.mjs` header).
