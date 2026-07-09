# Piano Tablet Button → Screen Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the physical Zigbee button at the yellow-room piano authority over the tablet's FKB backlight (single-press toggle; double-press sticky-off for a hold window) by introducing a shared, timed screen-override that all three existing screen writers honor.

**Architecture:** A new `ScreenOverrideService` (a `Map<deviceId,{state,until}>` with an injected clock) is the single source of "is there a live manual screen intent?". It's created as a shared singleton and injected into `PianoScreenAuthorityService` (which early-returns from its poll and enforces the override's state in reconcile while a window is live), into `PianoMidiWakeService` (whose note-on wake and `suppressWakeUntil` read/write that window), and into the device router (three new routes). The FKB adapter is never made to lie — the override only gates *whether a caller decides to call `setScreen`*, so the existing verify→retry→loadStartUrl→notify ladder is untouched. The frontend screensaver folds a `GET override` into its existing 15s poll.

**Tech Stack:** Node ESM (backend), Vitest (`tests/isolated/**`, root `vitest.config.mjs`) + `node:test` (co-located `PianoMidiWakeService.test.mjs`) + `supertest` (new router test), React (frontend). `#apps/` = `backend/src/3_applications/`, `#composition/` = `backend/src/5_composition/`.

## Global Constraints

- Override entry shape: `{ state: 'on'|'off', until: number }`; `get(deviceId)` returns `null` once `now >= until`. Injected `clock` with `.now()` (default `Date`).
- `ScreenOverrideService.set(deviceId, state, minutes)` — `until = clock.now() + max(0, minutes)*60000`. Throws on a state other than `'on'`/`'off'`.
- Single-press-OFF is SOFT: clears the override (MIDI/piano-power/touch can re-light). Double-press-OFF is STICKY: sets an `off` window (only touch re-lights).
- Single-press-ON: sets an `on` window for `onHoldMinutes` (reconcile can't kill it).
- `offHoldMinutes` inherits `screensaver.offCooldownMinutes` when not explicitly set (they must not drift). `onHoldMinutes` default 10; off/cooldown default 30.
- `PianoScreenAuthorityService.#applyScreen` / `#verify` / the FKB adapter are NOT modified. The override is read only in `#tickPoll` (early return on live window) and `#tickReconcile` (enforce the window's state).
- Screen writers must all read the SAME shared `ScreenOverrideService` instance (the singleton from `#composition/modules/screenOverride.mjs`). Services receive it by constructor injection; only factories/router-wiring touch the singleton.
- No changes to `livingroom-tv` / the Shield FKB. No change to `FullyKioskContentAdapter`.
- `getStatus()` failing during a toggle ⇒ fail-safe assume screen is OFF ⇒ turn it ON (a press is never a no-op).
- Test commands (run from repo root `/opt/Code/DaylightStation`):
  - vitest: `npx vitest run <path>`
  - node:test: `node --test <path>`

---

### Task 1: `ScreenOverrideService`

**Files:**
- Create: `backend/src/3_applications/devices/services/ScreenOverrideService.mjs`
- Test: `tests/isolated/application/devices/ScreenOverrideService.test.mjs`

**Interfaces:**
- Produces: `class ScreenOverrideService` with `set(deviceId, state, minutes) -> {state, until}`, `get(deviceId) -> {state, until}|null`, `clear(deviceId) -> void`. Constructor `{ clock = Date }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/isolated/application/devices/ScreenOverrideService.test.mjs
import { describe, it, expect } from 'vitest';
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';

function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('ScreenOverrideService', () => {
  it('set() stores a state + expiry computed from minutes', () => {
    const clock = makeClock();
    const svc = new ScreenOverrideService({ clock });
    const r = svc.set('dev', 'off', 30);
    expect(r).toEqual({ state: 'off', until: 1_000_000 + 30 * 60_000 });
    expect(svc.get('dev')).toEqual({ state: 'off', until: 1_000_000 + 30 * 60_000 });
  });

  it('get() returns null once the window has expired (and drops it)', () => {
    const clock = makeClock();
    const svc = new ScreenOverrideService({ clock });
    svc.set('dev', 'on', 10);
    clock.advance(10 * 60_000);            // now === until → expired
    expect(svc.get('dev')).toBeNull();
    clock.advance(-1);                      // proof it was deleted, not just time-gated
    expect(svc.get('dev')).toBeNull();
  });

  it('set() replaces an existing window', () => {
    const clock = makeClock();
    const svc = new ScreenOverrideService({ clock });
    svc.set('dev', 'off', 30);
    svc.set('dev', 'on', 5);
    expect(svc.get('dev')).toEqual({ state: 'on', until: 1_000_000 + 5 * 60_000 });
  });

  it('clear() removes the window', () => {
    const clock = makeClock();
    const svc = new ScreenOverrideService({ clock });
    svc.set('dev', 'off', 30);
    svc.clear('dev');
    expect(svc.get('dev')).toBeNull();
  });

  it('get() for an unknown device is null; set() rejects a bad state', () => {
    const svc = new ScreenOverrideService({ clock: makeClock() });
    expect(svc.get('nope')).toBeNull();
    expect(() => svc.set('dev', 'dim', 5)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/devices/ScreenOverrideService.test.mjs`
Expected: FAIL — cannot resolve `#apps/devices/services/ScreenOverrideService.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/3_applications/devices/services/ScreenOverrideService.mjs
/**
 * ScreenOverrideService — the single source of "is there a live manual screen
 * intent for this device, and what is it?". A Map<deviceId,{state,until}> with an
 * injected clock. Knows nothing about pianos, FKB, or Home Assistant.
 *
 * Read by PianoScreenAuthorityService (poll early-return + reconcile enforce),
 * PianoMidiWakeService (note-on suppression), the device router (toggle/override
 * routes), and — over HTTP — the browser screensaver.
 *
 * @module 3_applications/devices/services/ScreenOverrideService
 */
export class ScreenOverrideService {
  #map;
  #clock;

  constructor({ clock = Date } = {}) {
    this.#map = new Map();
    this.#clock = clock;
  }

  /** @returns {{state:'on'|'off', until:number}} */
  set(deviceId, state, minutes) {
    if (state !== 'on' && state !== 'off') {
      throw new Error(`ScreenOverrideService: invalid state '${state}' (expected 'on'|'off')`);
    }
    const mins = Math.max(0, Number(minutes) || 0);
    const entry = { state, until: this.#clock.now() + mins * 60_000 };
    this.#map.set(deviceId, entry);
    return entry;
  }

  /** @returns {{state:'on'|'off', until:number}|null} — null once expired (and drops it). */
  get(deviceId) {
    const entry = this.#map.get(deviceId);
    if (!entry) return null;
    if (this.#clock.now() >= entry.until) {
      this.#map.delete(deviceId);
      return null;
    }
    return entry;
  }

  clear(deviceId) {
    this.#map.delete(deviceId);
  }
}

export default ScreenOverrideService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/devices/ScreenOverrideService.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/ScreenOverrideService.mjs tests/isolated/application/devices/ScreenOverrideService.test.mjs
git commit -m "feat(devices): ScreenOverrideService — shared timed screen-intent window"
```

---

### Task 2: Shared singleton module

**Files:**
- Create: `backend/src/5_composition/modules/screenOverride.mjs`
- Test: `tests/isolated/composition/screenOverride.test.mjs`

**Interfaces:**
- Consumes: `ScreenOverrideService` (Task 1).
- Produces: `getScreenOverrideService({ clock } = {}) -> ScreenOverrideService` (lazy singleton; `clock` used only on first construction) and `_resetForTests() -> void`.

- [ ] **Step 1: Write the failing test**

```js
// tests/isolated/composition/screenOverride.test.mjs
import { describe, it, expect, afterEach } from 'vitest';
import { getScreenOverrideService, _resetForTests } from '#composition/modules/screenOverride.mjs';

afterEach(() => _resetForTests());

describe('getScreenOverrideService', () => {
  it('returns the same instance across calls (shared singleton)', () => {
    const a = getScreenOverrideService();
    const b = getScreenOverrideService();
    expect(a).toBe(b);
  });

  it('the shared instance stores + reads windows', () => {
    const svc = getScreenOverrideService();
    svc.set('dev', 'off', 30);
    expect(getScreenOverrideService().get('dev')?.state).toBe('off');
  });

  it('_resetForTests() drops the singleton', () => {
    const a = getScreenOverrideService();
    _resetForTests();
    expect(getScreenOverrideService()).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/composition/screenOverride.test.mjs`
Expected: FAIL — cannot resolve `#composition/modules/screenOverride.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/5_composition/modules/screenOverride.mjs
/**
 * Shared ScreenOverrideService singleton. All three screen writers (piano
 * authority service, midi-wake service, device router) must read the SAME window,
 * so they obtain it here rather than each constructing their own.
 *
 * @module 5_composition/modules/screenOverride
 */
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';

/** @type {ScreenOverrideService | null} */
let instance = null;

/** @param {{clock?:{now:()=>number}}} [opts] clock is used only on first construction. */
export function getScreenOverrideService({ clock } = {}) {
  if (!instance) instance = new ScreenOverrideService(clock ? { clock } : {});
  return instance;
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  instance = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/composition/screenOverride.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/5_composition/modules/screenOverride.mjs tests/isolated/composition/screenOverride.test.mjs
git commit -m "feat(devices): shared ScreenOverrideService singleton for the composition root"
```

---

### Task 3: `PianoScreenAuthorityService` honors the override

**Files:**
- Modify: `backend/src/3_applications/devices/services/PianoScreenAuthorityService.mjs`
- Test: `tests/isolated/application/devices/PianoScreenAuthorityService.test.mjs` (add cases)

**Interfaces:**
- Consumes: an injected `screenOverrideService` with `get(deviceId)` (Task 1 shape). Optional — absent ⇒ today's behavior exactly.
- Produces: no new exports; behavior change only.

- [ ] **Step 1: Write the failing tests (append to the existing describe block)**

Add these `it(...)` blocks inside the existing top-level `describe` in `PianoScreenAuthorityService.test.mjs`. They use a small override stub:

```js
  // ── override coordination ────────────────────────────────────────────────
  function makeOverride(entry = null) {
    return { get: vi.fn(() => entry) };
  }

  it('poll: a live override window suppresses the OFF→ON edge pulse', async () => {
    // piano was confirmed off, override 'off' live → an ON reading must NOT pulse the screen.
    const device = makeStatefulDevice(false);
    const gateway = makeGateway(async () => ({ state: 'on' }));
    const override = makeOverride({ state: 'off', until: Number.MAX_SAFE_INTEGER });
    const { svc } = makeService({ gateway, device, overrides: { screenOverrideService: override } });
    // Force the "was confirmed off" precondition, then poll with piano ON.
    svc.start();
    await Promise.resolve();
    // Two poll ticks would normally: commit off (debounce) then edge-pulse on. With a
    // live override, neither the debounce fire nor the edge pulse should call setScreen.
    // Drive ticks directly for determinism:
    await svc._tickPollForTest();  // ON reading under override → no-op
    expect(device.setScreen).not.toHaveBeenCalled();
    svc.stop();
  });

  it('reconcile: a live override enforces the override state, not piano power', async () => {
    // Panel drifted ON but override says OFF → reconcile drives it OFF even though
    // committedPower is not 'off'.
    const device = makeStatefulDevice(true); // panel currently ON
    const gateway = makeGateway(async () => ({ state: 'on' })); // piano ON
    const override = makeOverride({ state: 'off', until: Number.MAX_SAFE_INTEGER });
    const { svc } = makeService({ gateway, device, overrides: { screenOverrideService: override } });
    await svc._tickReconcileForTest();
    expect(device.setScreen).toHaveBeenCalledWith(false);
  });

  it('reconcile: an expired/absent override falls back to piano-power control', async () => {
    // No override → existing behavior: reconcile only acts when committedPower==='off'.
    const device = makeStatefulDevice(true);
    const gateway = makeGateway(async () => ({ state: 'on' }));
    const override = makeOverride(null);
    const { svc } = makeService({ gateway, device, overrides: { screenOverrideService: override } });
    await svc._tickReconcileForTest(); // committedPower is null (never polled) → no-op
    expect(device.setScreen).not.toHaveBeenCalled();
  });
```

Also add, near the other helpers at the top of the file, nothing else is needed — `makeService` already spreads `overrides` into the constructor, so `screenOverrideService` threads through.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/application/devices/PianoScreenAuthorityService.test.mjs`
Expected: FAIL — `svc._tickPollForTest is not a function` (and the reconcile override case asserts a call that today's code doesn't make).

- [ ] **Step 3: Implement — add the override field, test seams, and the two reads**

In `PianoScreenAuthorityService.mjs`:

3a. Add the field to the private declarations (after `#notifyService; #sleep;`):

```js
  #notifyService; #sleep; #override;
```

3b. Accept + store it in the constructor. Change the destructure to add `screenOverrideService`:

```js
  constructor({
    haGateway, deviceService, logger = console, clock = Date,
    deviceId, pianoPowerEntity,
    pollIntervalMs = DEFAULT_POLL_MS,
    offDebounceMs = DEFAULT_OFF_DEBOUNCE_MS,
    reconcileIntervalMs = DEFAULT_RECONCILE_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    notifyService = null,
    sleep,
    screenOverrideService = null,
  } = {}) {
```

and, alongside the other `this.#… =` assignments (after `this.#notifyService = notifyService;`):

```js
    this.#override = screenOverrideService;
```

3c. Early-return in `#tickPoll` when a window is live. Add this as the FIRST statement inside the `try` of `#tickPoll` (before `const now = this.#clock.now();`):

```js
      // A live manual override owns the screen — no edge pulse, no continuous-off
      // debounce. (Reconcile enforces the window's state; see #tickReconcile.)
      if (this.#override?.get(this.#deviceId)) return;
```

3d. Enforce the window's state in `#tickReconcile`. Insert at the START of the `try` (before `if (this.#committedPower !== 'off') return;`):

```js
      const ov = this.#override?.get(this.#deviceId);
      if (ov) {
        const device = this.#deviceService.get(this.#deviceId);
        if (!device) {
          this.#logger.warn?.('piano-screen-authority.reconcile.no-device', { deviceId: this.#deviceId });
          return;
        }
        const status = await device.getStatus();
        const desiredOn = ov.state === 'on';
        if (status?.screenOn !== desiredOn) {
          this.#logger.info?.('piano-screen-authority.reconcile.override', { deviceId: this.#deviceId, state: ov.state });
          await this.#applyScreen(desiredOn, 'override');
        }
        return;
      }
```

3e. Add two test seams (place right after `stop()`):

```js
  /** Test seam: run one poll tick without the interval. */
  async _tickPollForTest() { return this.#tickPoll(); }

  /** Test seam: run one reconcile tick without the interval. */
  async _tickReconcileForTest() { return this.#tickReconcile(); }
```

- [ ] **Step 4: Run the full authority-service suite**

Run: `npx vitest run tests/isolated/application/devices/PianoScreenAuthorityService.test.mjs`
Expected: PASS — the 15 pre-existing tests (no override injected → `#override` is null → unchanged) plus the 3 new override cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/PianoScreenAuthorityService.mjs tests/isolated/application/devices/PianoScreenAuthorityService.test.mjs
git commit -m "feat(devices): PianoScreenAuthorityService reads the shared screen override"
```

---

### Task 4: `PianoMidiWakeService` reads the shared window

**Files:**
- Modify: `backend/src/3_applications/devices/services/PianoMidiWakeService.mjs`
- Test: `backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs` (node:test)

**Interfaces:**
- Consumes: an injected `screenOverride` with `get(deviceId)`/`set(deviceId,state,minutes)` (Task 1). Optional — absent ⇒ no suppression, `suppressWakeUntil` still relays to the APK.
- Produces: `suppressWakeUntil(deadlineMs)` unchanged signature; now writes an `off` window to the shared service instead of a private field.

- [ ] **Step 1: Update the failing test**

Replace the top of `PianoMidiWakeService.test.mjs` (the imports + `makeService`) so the fake device/clock feed a real `ScreenOverrideService`, and note-on suppression is driven by that shared window:

```js
// backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoMidiWakeService } from './PianoMidiWakeService.mjs';
import { ScreenOverrideService } from './ScreenOverrideService.mjs';

class FakeWs { on() {} close() {} }

function makeService(overrides = {}) {
  const screenCalls = [];
  const setScreen = (on) => { screenCalls.push(on); return Promise.resolve({ ok: true }); };
  const deviceService = { get: () => ({ setScreen }) };
  let t = 1_000_000;
  const clock = { now: () => t };
  const advance = (ms) => { t += ms; };
  const fetchCalls = [];
  const fetchImpl = (url, opts) => { fetchCalls.push([url, opts]); return Promise.resolve({ ok: true }); };
  const screenOverride = new ScreenOverrideService({ clock });
  const svc = new PianoMidiWakeService({
    deviceService,
    deviceId: 'yellow-room-tablet',
    bridgeUrl: 'ws://10.0.0.245:8770',
    cooldownMs: 8000,
    clock,
    fetchImpl,
    WebSocketImpl: FakeWs,
    screenOverride,
    logger: { info() {}, warn() {} },
    ...overrides,
  });
  return { svc, screenCalls, advance, fetchCalls, screenOverride };
}
```

The two existing `test(...)` bodies stay unchanged — `suppressWakeUntil(deadline)` now writes an `off` window to the shared service, the note-on handler reads it, and after the deadline `get()` returns null so a note wakes. The HTTP-relay test is unaffected.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs`
Expected: FAIL — the service ignores `screenOverride` today (still uses `#suppressUntil`), so after the change the shared-window read is what makes it pass; before the change, the new import/props compile but the suppression still relies on the private field (test currently passes only because the private field is set — this step confirms the harness runs; the behavioral guarantee is locked by Step 4 after the field is removed).

> Determinism note: to guarantee a red-first, temporarily add `screenOverride: null` to the `makeService` override in the first test only, run it, and confirm the "skips while suppressed" assertion FAILS (no shared window ⇒ note wakes immediately). Then remove that temporary line before Step 3.

- [ ] **Step 3: Implement — swap the private field for the shared window**

In `PianoMidiWakeService.mjs`:

3a. Replace the `#suppressUntil` field declaration line:

```js
  #suppressUntil; // epoch-ms; note-ons before this don't wake (manual screen-off)
```

with:

```js
  #screenOverride; // shared ScreenOverrideService; note-ons are muted while its window is 'off'
```

3b. In the constructor destructure, replace `fetchImpl,` with:

```js
    fetchImpl,
    screenOverride = null,
```

3c. In the constructor body, replace `this.#suppressUntil = 0;` with:

```js
    this.#screenOverride = screenOverride;
```

3d. Rewrite `suppressWakeUntil` to write the shared `off` window (keeping the APK relay). Replace the body's first line `this.#suppressUntil = deadlineMs;` with:

```js
    const minutes = Math.max(0, (deadlineMs - this.#clock.now()) / 60_000);
    this.#screenOverride?.set(this.#deviceId, 'off', minutes);
```

(the logging + the `httpBase`/`fetchImpl` relay below it stay exactly as-is.)

3e. In `#onNoteOn`, replace the suppression guard:

```js
    if (now < this.#suppressUntil) return; // manually muted (screen-off cooldown)
```

with:

```js
    if (this.#screenOverride?.get(this.#deviceId)?.state === 'off') return; // manually muted
```

- [ ] **Step 4: Run both midi-wake test files**

Run: `node --test backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs`
Expected: PASS (2 tests).

Run: `npx vitest run backend/tests/unit/suite/3_applications/devices/PianoMidiWakeService.test.mjs`
Expected: PASS (5 tests) — that suite constructs the service without `screenOverride`; the optional param defaults to `null`, so WS/wake/reconnect behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/PianoMidiWakeService.mjs backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs
git commit -m "feat(devices): PianoMidiWakeService reads/writes the shared screen override window"
```

---

### Task 5: Device router — toggle + override routes

**Files:**
- Modify: `backend/src/4_api/v1/routers/device.mjs`
- Test: `tests/isolated/api/deviceScreenOverride.test.mjs` (new; supertest)

**Interfaces:**
- Consumes: `deviceService.get(deviceId) -> { getStatus(), setScreen(bool) }`; `screenOverrideService` (Task 1); `pianoMidiWakeService.suppressWakeUntil(deadlineMs)`; `configService.getHouseholdAppConfig(null, 'piano')`.
- Produces: `GET /:deviceId/screen/toggle`, `POST /:deviceId/screen/override`, `GET /:deviceId/screen/override`.

- [ ] **Step 1: Write the failing test**

```js
// tests/isolated/api/deviceScreenOverride.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';

function makeDevice(initialScreenOn, { statusThrows = false } = {}) {
  let screenOn = initialScreenOn;
  return {
    setScreen: async (on) => { screenOn = on; return { ok: true }; },
    getStatus: async () => { if (statusThrows) throw new Error('unreachable'); return { ready: true, screenOn }; },
    _screenOn: () => screenOn,
  };
}

function makeApp({ device, screenOverrideService, pianoMidiWakeService, piano = {} }) {
  const app = express();
  app.use(express.json());
  app.use('/device', createDeviceRouter({
    deviceService: { get: () => device },
    screenOverrideService,
    pianoMidiWakeService,
    configService: { getHouseholdAppConfig: () => piano },
    logger: { info() {}, warn() {}, error() {} },
  }));
  return app;
}

describe('device screen override routes', () => {
  let override;
  beforeEach(() => { override = new ScreenOverrideService(); });

  it('toggle from OFF turns the screen ON and sets an on-hold window', async () => {
    const device = makeDevice(false);
    const app = makeApp({ device, screenOverrideService: override, piano: { button: { onHoldMinutes: 10 } } });
    const res = await request(app).get('/device/yellow-room-tablet/screen/toggle');
    expect(res.status).toBe(200);
    expect(res.body.screenOn).toBe(true);
    expect(device._screenOn()).toBe(true);
    expect(override.get('yellow-room-tablet')?.state).toBe('on');
  });

  it('toggle from ON turns the screen OFF and clears the window (soft off)', async () => {
    const device = makeDevice(true);
    const app = makeApp({ device, screenOverrideService: override });
    const res = await request(app).get('/device/yellow-room-tablet/screen/toggle');
    expect(res.body.screenOn).toBe(false);
    expect(device._screenOn()).toBe(false);
    expect(override.get('yellow-room-tablet')).toBeNull();
  });

  it('toggle fails safe to ON when getStatus throws', async () => {
    const device = makeDevice(false, { statusThrows: true });
    const app = makeApp({ device, screenOverrideService: override });
    const res = await request(app).get('/device/yellow-room-tablet/screen/toggle');
    expect(res.body.screenOn).toBe(true);
    expect(device._screenOn()).toBe(true);
  });

  it('POST override off drives the screen off and relays to midi-wake suppress', async () => {
    const device = makeDevice(true);
    const relayed = [];
    const pianoMidiWakeService = { suppressWakeUntil: (until) => { relayed.push(until); override.set('yellow-room-tablet', 'off', 30); } };
    const app = makeApp({ device, screenOverrideService: override, pianoMidiWakeService, piano: { screensaver: { offCooldownMinutes: 30 } } });
    const res = await request(app).post('/device/yellow-room-tablet/screen/override').send({ state: 'off' });
    expect(res.status).toBe(200);
    expect(device._screenOn()).toBe(false);
    expect(relayed.length).toBe(1);
    expect(override.get('yellow-room-tablet')?.state).toBe('off');
  });

  it('GET override reflects the live window', async () => {
    override.set('yellow-room-tablet', 'off', 30);
    const app = makeApp({ device: makeDevice(false), screenOverrideService: override });
    const res = await request(app).get('/device/yellow-room-tablet/screen/override');
    expect(res.body.override?.state).toBe('off');
  });

  it('404 when the device is unknown', async () => {
    const app = express();
    app.use(express.json());
    app.use('/device', createDeviceRouter({
      deviceService: { get: () => null },
      screenOverrideService: override,
      configService: { getHouseholdAppConfig: () => ({}) },
      logger: { info() {}, warn() {}, error() {} },
    }));
    const res = await request(app).get('/device/nope/screen/toggle');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/api/deviceScreenOverride.test.mjs`
Expected: FAIL — routes 404 (they don't exist yet) so `screenOn`/`override` assertions fail.

- [ ] **Step 3: Implement — destructure the service, add config helpers + three routes**

3a. Add `screenOverrideService` to the router config destructure in `createDeviceRouter` (after `pianoMidiWakeService,`):

```js
    pianoMidiWakeService,
    screenOverrideService,
```

3b. Immediately AFTER the existing `POST /:deviceId/screen/suppress-wake` route (right before the `// ===== Content Loading` banner at ~line 759), insert:

```js
  // --- Manual screen override (physical piano button + on-screen action) --------
  // Hold windows: single-press-ON = onHoldMinutes; sticky-OFF inherits
  // screensaver.offCooldownMinutes so the physical double-press can't drift from
  // the on-screen "turn off screen" action. All three screen writers read the
  // shared ScreenOverrideService, so a press outlives the 45s power reconcile.
  const pianoAppCfg = () => (configService?.getHouseholdAppConfig?.(null, 'piano')) || {};
  const onHoldMinutes = () => Number(pianoAppCfg().button?.onHoldMinutes) || 10;
  const offHoldMinutes = () => Number(pianoAppCfg().button?.offHoldMinutes)
    || Number(pianoAppCfg().screensaver?.offCooldownMinutes) || 30;

  /**
   * GET /device/:deviceId/screen/toggle
   * Flip the screen. ON → set an on-hold window (reconcile can't kill it).
   * OFF → clear the window (soft: MIDI / piano-power / touch can re-light).
   * getStatus() failure ⇒ assume OFF ⇒ turn ON (a press is never a no-op).
   */
  router.get('/:deviceId/screen/toggle', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const device = deviceService.get(deviceId);
    if (!device) {
      return res.status(404).json(buildErrorBody({ error: 'Device not found', code: ERROR_CODES.DEVICE_NOT_FOUND }));
    }
    let currentlyOn = false;
    try { currentlyOn = (await device.getStatus())?.screenOn === true; } catch { currentlyOn = false; }
    const next = !currentlyOn;
    if (screenOverrideService) {
      if (next) screenOverrideService.set(deviceId, 'on', onHoldMinutes());
      else screenOverrideService.clear(deviceId);
    }
    logger.info?.('device.router.screen.toggle', { deviceId, next });
    const result = await device.setScreen(next);
    res.json({ screenOn: next, override: screenOverrideService?.get(deviceId) ?? null, result });
  }));

  /**
   * POST /device/:deviceId/screen/override   body: { state:'on'|'off', minutes?:number }
   * Set a held window and drive the screen to it. OFF also relays to the midi-wake
   * suppress (which owns the APK relay + writes the shared 'off' window).
   */
  router.post('/:deviceId/screen/override', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const state = req.body?.state;
    if (state !== 'on' && state !== 'off') {
      return res.status(400).json(buildErrorBody({ error: `Invalid override state '${state}' (expected 'on'|'off')` }));
    }
    const device = deviceService.get(deviceId);
    if (!device) {
      return res.status(404).json(buildErrorBody({ error: 'Device not found', code: ERROR_CODES.DEVICE_NOT_FOUND }));
    }
    const minutes = Number(req.body?.minutes) > 0
      ? Number(req.body.minutes)
      : (state === 'off' ? offHoldMinutes() : onHoldMinutes());
    if (state === 'off') {
      // suppressWakeUntil sets the shared 'off' window AND relays to the APK.
      if (pianoMidiWakeService?.suppressWakeUntil) pianoMidiWakeService.suppressWakeUntil(Date.now() + minutes * 60_000);
      else screenOverrideService?.set(deviceId, 'off', minutes);
    } else {
      screenOverrideService?.set(deviceId, 'on', minutes);
    }
    logger.info?.('device.router.screen.override', { deviceId, state, minutes });
    const result = await device.setScreen(state === 'on');
    res.json({ ok: true, override: screenOverrideService?.get(deviceId) ?? null, result });
  }));

  /**
   * GET /device/:deviceId/screen/override — the live window (polled by the browser screensaver).
   */
  router.get('/:deviceId/screen/override', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    res.json({ override: screenOverrideService?.get(deviceId) ?? null });
  }));
```

> Note on route ordering: Express matches in declaration order, and `screen/toggle` / `screen/override` are declared here AFTER `screen/:state`. `:state` would greedily match `toggle`/`override` if it came first — but `screen/:state` is a GET with a two-value guard, and our new GETs use distinct literal paths. Because `GET /:deviceId/screen/:state` is registered earlier at line ~717, a `GET .../screen/toggle` would match `:state='toggle'` and 400. **To avoid that, move the two new GET routes ABOVE the existing `GET /:deviceId/screen/:state` route** (cut the `screen/toggle` and `screen/override` GET handlers and paste them immediately before the `GET /:deviceId/screen/:state` block at line ~717; leave the POST `screen/override` where it is). Re-run the test to confirm.

- [ ] **Step 4: Run the router test**

Run: `npx vitest run tests/isolated/api/deviceScreenOverride.test.mjs`
Expected: PASS (6 tests). If `toggle`/`override` return 400, the ordering fix in the note above hasn't been applied — apply it.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/device.mjs tests/isolated/api/deviceScreenOverride.test.mjs
git commit -m "feat(devices): screen toggle + override routes reading the shared window"
```

---

### Task 6: Wire the shared singleton into the composition

**Files:**
- Modify: `backend/src/5_composition/modules/pianoScreenPowerSync.mjs`
- Modify: `backend/src/5_composition/modules/pianoMidiWake.mjs`
- Modify: `backend/src/5_composition/modules/deviceApi.mjs`
- Test: `tests/isolated/composition/pianoScreenOverrideWiring.test.mjs` (new)

**Interfaces:**
- Consumes: `getScreenOverrideService` (Task 2); the three factories.
- Produces: all three consumers receive the SAME `ScreenOverrideService` instance.

- [ ] **Step 1: Write the failing test**

```js
// tests/isolated/composition/pianoScreenOverrideWiring.test.mjs
import { describe, it, expect, afterEach } from 'vitest';
import { createPianoScreenPowerSync, _resetForTests as resetPsas } from '#composition/modules/pianoScreenPowerSync.mjs';
import { createPianoMidiWake, _resetForTests as resetMidi } from '#composition/modules/pianoMidiWake.mjs';
import { getScreenOverrideService, _resetForTests as resetOverride } from '#composition/modules/screenOverride.mjs';

afterEach(() => { resetPsas(); resetMidi(); resetOverride(); });

const fakeDevice = { getStatus: async () => ({ screenOn: true }), setScreen: async () => ({ ok: true }) };
const deviceService = { get: () => fakeDevice };
const haGateway = { getState: async () => ({ state: 'off' }), callService: async () => ({}) };

function configService(block) {
  return { getHouseholdAppConfig: () => block };
}

describe('screen-override composition wiring', () => {
  it('the authority service factory injects the shared override (no throw, service constructed)', () => {
    const cfg = configService({ screen_power_sync: { enabled: true, device_id: 'yellow-room-tablet', piano_power_entity: 'binary_sensor.x' } });
    const { pianoScreenAuthorityService } = createPianoScreenPowerSync({ haGateway, deviceService, configService: cfg, logger: { info() {}, warn() {} } });
    expect(pianoScreenAuthorityService).not.toBeNull();
    // The singleton exists and is shared.
    expect(getScreenOverrideService()).toBeTruthy();
  });

  it('the midi-wake factory injects the shared override', () => {
    const cfg = configService({ midi_wake: { enabled: true, device_id: 'yellow-room-tablet', bridge_url: 'ws://x:8770' } });
    const { pianoMidiWakeService } = createPianoMidiWake({ deviceService, configService: cfg, logger: { info() {}, warn() {} } });
    expect(pianoMidiWakeService).not.toBeNull();
    // suppressWakeUntil should write to the shared singleton window.
    pianoMidiWakeService.suppressWakeUntil(Date.now() + 30 * 60_000);
    expect(getScreenOverrideService().get('yellow-room-tablet')?.state).toBe('off');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/composition/pianoScreenOverrideWiring.test.mjs`
Expected: FAIL — the midi-wake case fails because the factory doesn't yet inject `screenOverride`, so `suppressWakeUntil` writes nowhere (`get(...)` is null).

- [ ] **Step 3a: Inject into `pianoScreenPowerSync.mjs`**

Add the import after the existing service import:

```js
import { PianoScreenAuthorityService } from '#apps/devices/services/PianoScreenAuthorityService.mjs';
import { getScreenOverrideService } from '#composition/modules/screenOverride.mjs';
```

Add the injected dep in the `new PianoScreenAuthorityService({ … })` call (after `notifyService: …,`):

```js
    notifyService: cfg.notify_service ?? cfg.notifyService ?? null,
    screenOverrideService: getScreenOverrideService({ clock }),
```

- [ ] **Step 3b: Inject into `pianoMidiWake.mjs`**

Add the import after the existing service import:

```js
import { PianoMidiWakeService } from '#apps/devices/services/PianoMidiWakeService.mjs';
import { getScreenOverrideService } from '#composition/modules/screenOverride.mjs';
```

Add the injected dep in the `new PianoMidiWakeService({ … })` call (after `cooldownMs: …,`):

```js
    cooldownMs: cfg.cooldown_ms ?? cfg.cooldownMs,
    screenOverride: getScreenOverrideService(),
```

- [ ] **Step 3c: Inject into the device router wiring (`deviceApi.mjs`)**

Read `backend/src/5_composition/modules/deviceApi.mjs`. Add the import at the top:

```js
import { getScreenOverrideService } from '#composition/modules/screenOverride.mjs';
```

In the `createDeviceRouter({ … })` call (line ~27), add:

```js
    screenOverrideService: getScreenOverrideService(),
```

- [ ] **Step 4: Run the wiring test + both factory suites for regressions**

Run: `npx vitest run tests/isolated/composition/pianoScreenOverrideWiring.test.mjs`
Expected: PASS (2 tests).

Run: `npx vitest run tests/isolated/composition/` (or the specific existing factory tests if present)
Expected: PASS — existing factory tests unaffected (the new injected args are additive).

- [ ] **Step 5: Commit**

```bash
git add backend/src/5_composition/modules/pianoScreenPowerSync.mjs backend/src/5_composition/modules/pianoMidiWake.mjs backend/src/5_composition/modules/deviceApi.mjs tests/isolated/composition/pianoScreenOverrideWiring.test.mjs
git commit -m "feat(devices): inject the shared screen override into both piano services + router"
```

---

### Task 7: Frontend — screensaver reads the override; on-screen off POSTs it

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/useScreenControl.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/useScreenControl.test.js` (add/modify a case) and rely on the existing `usePianoScreensaver.test.jsx`

**Interfaces:**
- Consumes: `GET api/v1/device/:deviceId/screen/override -> { override: {state,until}|null }`; `POST api/v1/device/:deviceId/screen/override { state:'off' }`.
- Produces: an `off` override window suppresses MIDI-wake in the screensaver; the on-screen "turn off screen" fallback POSTs the override instead of a bare `screen/off`.

- [ ] **Step 1: Write the failing test (useScreenControl)**

Check whether `frontend/src/modules/Piano/PianoKiosk/useScreenControl.test.js` exists (`ls`). If it does not, create it. Either way it must assert the fallback POSTs the override:

```js
// frontend/src/modules/Piano/PianoKiosk/useScreenControl.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));
vi.mock('../../../lib/fkb.js', () => ({ screenOff: () => false })); // force the backend fallback
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: { screensaver: { deviceId: 'yellow-room-tablet' } } }) }));

import { useScreenControl } from './useScreenControl.js';

describe('useScreenControl backend fallback', () => {
  beforeEach(() => { apiMock.mockReset(); apiMock.mockResolvedValue({ ok: true }); });

  it('POSTs the screen override (state off) instead of a bare screen/off', async () => {
    const { result } = renderHook(() => useScreenControl());
    await act(async () => { await result.current.turnOffScreen(); });
    expect(apiMock).toHaveBeenCalledWith(
      'api/v1/device/yellow-room-tablet/screen/override',
      expect.objectContaining({ method: 'POST', body: expect.objectContaining({ state: 'off' }) }),
    );
  });
});
```

> Verify the `DaylightAPI` POST calling convention first by reading `frontend/src/lib/api.mjs` — match its `(path, options)` signature exactly (some wrappers take `{ method, body }`, others positional). Adjust the assertion and the implementation in Step 3 to the real signature.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/useScreenControl.test.js`
Expected: FAIL — current code calls `DaylightAPI(\`api/v1/device/${deviceId}/screen/off\`)` (a GET-style bare path), not the override POST.

- [ ] **Step 3: Implement**

3a. In `useScreenControl.js`, replace the backend fallback call (line ~54) so it POSTs the override. Using the `DaylightAPI(path, options)` signature (confirm against `api.mjs`):

```js
        const res = await DaylightAPI(`api/v1/device/${deviceId}/screen/override`, { method: 'POST', body: { state: 'off' } });
```

(leave the surrounding `try/catch`, logging, and return shape unchanged.)

3b. In `usePianoScreensaver.jsx`, fold a `GET screen/override` read into the existing idle poll so a server `off` window suppresses MIDI-wake. Add a ref beside `midiSuppressedRef` (after line 167):

```js
  // Server-side manual override (physical button / on-screen action). An 'off'
  // window mutes MIDI-wake exactly like the local button-armed cooldown.
  const serverOffRef = useRef(false);
```

In the idle poll interval (inside the `setInterval` callback in the effect at lines 241-256), add a fetch of the override at the top of the callback:

```js
    const id = setInterval(() => {
      // Fold the shared server override into the poll: an 'off' window mutes MIDI-wake.
      if (deviceId) {
        DaylightAPI(`api/v1/device/${deviceId}/screen/override`)
          .then((r) => { serverOffRef.current = r?.override?.state === 'off'; })
          .catch(() => { /* leave prior value; a transient failure shouldn't unmute */ });
      }
      // Lift the manual screen-off cooldown once the player has been idle long
      // enough — MIDI-wake resumes on the next note (see the MIDI effect above).
      if (midiSuppressedRef.current && Date.now() - lastActivityRef.current >= cooldownMs) {
```

Then make the MIDI-wake gate honor the server window. Change line ~213:

```js
    if (enabled && !midiSuppressedRef.current && !serverOffRef.current && !isWithinQuietHours(new Date(), quietRef.current)) setScreen(true);
```

(Leave the touch handler as-is: a physical touch still clears the local cooldown and wakes; the server `off` window is the authority service's to expire. This matches the design's "the hold protects against notes and piano power, not against a person tapping the glass.")

- [ ] **Step 4: Run the frontend tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/useScreenControl.test.js frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.test.jsx`
Expected: PASS — the override POST test passes, and the existing screensaver suite still passes (the added poll fetch is guarded by `deviceId` and the existing tests mock `DaylightAPI`; if a screensaver test asserts an exact call count to `DaylightAPI`, update it to tolerate the extra override GET — read the test first).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.jsx frontend/src/modules/Piano/PianoKiosk/useScreenControl.js frontend/src/modules/Piano/PianoKiosk/useScreenControl.test.js
git commit -m "feat(piano): screensaver honors the server screen override; on-screen off POSTs it"
```

---

## Post-implementation (manual — NOT code tasks; do NOT deploy until KC gives the word)

1. **Backend is independently verifiable** (per the design's Sequencing). After the code lands, without any HA wiring:
   - `curl "http://localhost:3111/api/v1/device/yellow-room-tablet/screen/toggle"` and watch the panel.
   - `curl -X POST -H 'Content-Type: application/json' -d '{"state":"off"}' "http://localhost:3111/api/v1/device/yellow-room-tablet/screen/override"` — confirm sticky-off.
   - `curl "http://localhost:3111/api/v1/device/yellow-room-tablet/screen/override"` — confirm the live window.
2. **`data/household/config/piano.yml`** (runtime, not in repo) gains the `button:` block per the design (`enabled`, `deviceId: yellow-room-tablet`, `onHoldMinutes: 10`; `offHoldMinutes` omitted → inherits `screensaver.offCooldownMinutes`). Write via `sudo docker exec daylight-station sh -c 'cat > … <<EOF … EOF'` (never `sed -i`).
3. **Home Assistant** (`/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/`): add `rest_commands/devices.yaml` entries `yellow_room_tablet_screen_toggle` / `yellow_room_tablet_screen_override`; two MQTT-triggered automations on `zigbee2mqtt-usb/Yellow Room Tablet Button/action` (`single` → toggle, `double` → override off) — no state/timers. Run `reload_config.sh`; regenerate `home_inventory.yaml`.
4. **Verify on-device open question first:** `mosquitto_sub` the action topic — does `double` fire alone, or `single` then `double`? If `single` fires first, add a short debounce to the single automation that a subsequent `double` cancels.
5. **Deploy** (`docker build` → gate check garage/Player idle → `sudo deploy-daylight` → reload piano tablet FKB) — ONLY after KC gives the word.

---

## Self-Review

**Spec coverage** (design "Change list", doc lines 209-249):
- `ScreenOverrideService.mjs` (new) → Task 1. ✓
- `PianoScreenAuthorityService` override reads in `#tickPoll`/`#tickReconcile` → Task 3. ✓
- `PianoMidiWakeService` shared-window read + `suppressWakeUntil` setter → Task 4. ✓
- `device.mjs` three routes → Task 5. ✓
- `pianoScreenPowerSync.mjs` constructs/injects the shared service (+ midi-wake + router) → Task 2 (singleton) + Task 6 (wiring). ✓ (Deviation from the design's "construct it inside pianoScreenPowerSync": a dedicated singleton module is used so all three consumers share one instance without threading through `app.mjs`. Same single-shared-instance guarantee, less coupling.)
- `usePianoScreensaver.jsx` folds `GET override` into the 15s poll → Task 7. ✓
- `useScreenControl.js` POSTs the override → Task 7. ✓
- `piano.yml` `button:` block, HA rest_commands/automations/inventory → post-impl manual steps (runtime data / separate repo). ✓
- Tests: ScreenOverrideService (T1), authority override (T3), midi-wake shared-window (T4), router toggle incl. getStatus-fails-assume-off (T5). ✓

**Placeholder scan:** No TBD/TODO. Two "verify the real signature first" notes (DaylightAPI POST shape in T7; a red-first tweak in T4) are explicit, bounded verification steps with concrete fallbacks, not open-ended work.

**Type consistency:** override entry `{state,until}` and the trio `set(deviceId,state,minutes)` / `get(deviceId)` / `clear(deviceId)` are used identically across Tasks 1,3,4,5,6. `getScreenOverrideService({clock})` / `_resetForTests()` consistent in Tasks 2 and 6. `screenOverrideService` is the injected name in the authority service + router; `screenOverride` is the injected name in the midi-wake service (matches its existing terse private-field style) — intentional and consistent within each file.

**Route-ordering risk** flagged and mitigated inline (Task 5 Step 3 note): the new literal-path GETs must precede `GET /:deviceId/screen/:state`.
