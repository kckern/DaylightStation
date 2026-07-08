# Piano "Who's Playing" Screen-Off + MIDI-Wake Cooldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Turn off screen" button to the Who's-Playing prompt that turns the piano tablet dark and keeps it dark while the person keeps playing — the screen only re-arms to MIDI-wake after a configurable quiet gap (default 30 min of no input).

**Architecture:** A single **suppress-wake deadline** (`now + cooldownMinutes`) coordinates all three MIDI-wake paths. The frontend button (1) turns the screen off via the existing kill-switch, (2) self-suppresses the in-browser screensaver's MIDI-wake locally, and (3) POSTs the deadline to the backend. The backend endpoint arms `PianoMidiWakeService` (which then skips its own FKB screen-on pokes until the deadline) and relays the deadline to the piano-bridge APK's control plane (`POST :8770/config` → `fkbWakeSuppressUntilEpochMs`), which the APK's `ScreenWaker` already honors. Any **touch** (deliberate interaction) or the quiet-gap elapsing clears the suppression early.

**Tech Stack:** React (frontend kiosk), Express (backend API), Node service (`PianoMidiWakeService`), YAML config (`piano.yml`), Vitest (frontend + isolated backend), the piano-bridge Android APK's existing HTTP control plane (no rebuild).

## Global Constraints

- **No APK rebuild.** The APK already supports `fkbWakeSuppressUntilEpochMs` (read in `ScreenWaker.poke()`), settable at runtime via `POST http://<tablet>:8770/config` with a `key: value` YAML body. Do not modify Java.
- **Cooldown default = 30 minutes**, configurable at `piano.yml` → `screensaver.offCooldownMinutes`. Code must default to 30 when the key is absent.
- **The quiet gap is "no input," not a fixed timer.** MIDI activity during suppression keeps the screen dark AND refreshes the idle clock (so a continuously-played piano stays dark indefinitely); only `offCooldownMinutes` of *no* MIDI clears it. A touch clears it immediately (deliberate wake).
- **Touch still wakes; only MIDI is suppressed.** (Touch-wake may not be fully reliable on a dark WebView — that is out of scope; the requirement is only that playing does not wake it.)
- **Two-tap arm/confirm** on the screen-off button, mirroring the Connect-gate pattern (`useArmedAction`, `armMs: 3000`), so a stray tap can't blank the screen.
- **Presentational component stays presentational.** `WhoIsPlayingPrompt` receives an `onScreenOff` handler as a prop; it owns only the 2-tap UI state, not device side-effects.
- **Graceful degradation.** If `midi_wake` is disabled or the tablet is unreachable, the backend endpoint still returns 200 and logs; the frontend-local suppression (path 1) must never depend on the backend call succeeding.
- Run frontend tests with the worktree-safe invocation: `./node_modules/.bin/vitest run --config vitest.config.mjs <file> --exclude '**/.claire/**'`.

---

## File Structure

**Backend**
- `backend/src/3_applications/devices/services/PianoMidiWakeService.mjs` — add `suppressWakeUntil(deadlineMs)`: store deadline, skip `#onNoteOn` while active, relay to APK `/config`.
- `backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs` — suppression unit tests (create if absent; it's a Vitest isolated spec).
- `backend/src/4_api/v1/routers/device.mjs` — add `POST /:deviceId/screen/suppress-wake`.
- `backend/src/app.mjs` — capture the `pianoMidiWakeService` from `createPianoMidiWake(...)` and pass it into `createDeviceApiRouter(...)`.

**Frontend**
- `frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.jsx` — add `PianoScreenControlProvider` + `useScreenOffCooldown()`; teach `usePianoScreensaver` to consume the arm signal + `offCooldownMinutes` and suppress MIDI-wake.
- `frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx` — `resolveScreensaver` returns `offCooldownMinutes` (default 30).
- `frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx` — render the armed "Turn off screen" button when `onScreenOff` is provided.
- `frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx` — button render/arm/confirm tests.
- `frontend/src/Apps/PianoApp.jsx` — mount `PianoScreenControlProvider`; `ScreensaverDriver` passes `offCooldownMinutes`; `PianoShell` builds `onScreenOff` and passes it to `WhoIsPlayingPrompt`.
- `frontend/src/Apps/PianoApp.scss` — `.piano-userpicker__device` / `__screen-off` button styles (mirror `.piano-connect-gate__device`).

**Config (data volume, applied at deploy)**
- `data/household/config/piano.yml` → `screensaver.offCooldownMinutes: 30`.

---

## Task 1: Backend — `PianoMidiWakeService.suppressWakeUntil()`

**Files:**
- Modify: `backend/src/3_applications/devices/services/PianoMidiWakeService.mjs`
- Test: `backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs`

**Interfaces:**
- Consumes: existing ctor `{ deviceService, deviceId, bridgeUrl, cooldownMs, clock=Date, WebSocketImpl }`. Note `bridgeUrl` is `ws://host:port` (e.g. `ws://10.0.0.245:8770`).
- Produces: `suppressWakeUntil(deadlineMs: number): void` — sets internal `#suppressUntil`; `#onNoteOn()` becomes a no-op while `clock.now() < #suppressUntil`; also fires a fire-and-forget `POST http://host:port/config` with body `fkbWakeSuppressUntilEpochMs: <deadlineMs>` so the APK's ScreenWaker is muted too. Injectable `fetchImpl` (defaults to global `fetch`) for tests.

- [ ] **Step 1: Write the failing test**

Create `backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { PianoMidiWakeService } from './PianoMidiWakeService.mjs';

function makeService(overrides = {}) {
  const setScreen = vi.fn().mockResolvedValue({ ok: true });
  const deviceService = { get: vi.fn(() => ({ setScreen })) };
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
  const svc = new PianoMidiWakeService({
    deviceService,
    deviceId: 'yellow-room-tablet',
    bridgeUrl: 'ws://10.0.0.245:8770',
    cooldownMs: 8000,
    clock,
    fetchImpl,
    WebSocketImpl: class { on() {} close() {} },
    logger: { info() {}, warn() {} },
    ...overrides,
  });
  return { svc, setScreen, clock, fetchImpl };
}

describe('PianoMidiWakeService.suppressWakeUntil', () => {
  it('skips FKB wake pokes while suppressed, resumes after the deadline', async () => {
    const { svc, setScreen, clock } = makeService();
    svc.suppressWakeUntil(clock.now() + 30 * 60_000);

    // A note during suppression must NOT wake the screen.
    svc._handleNoteOnForTest();
    await Promise.resolve();
    expect(setScreen).not.toHaveBeenCalled();

    // After the deadline, a note wakes normally.
    clock.advance(30 * 60_000 + 1);
    svc._handleNoteOnForTest();
    await Promise.resolve();
    expect(setScreen).toHaveBeenCalledWith(true);
  });

  it('relays the deadline to the APK control plane over HTTP', () => {
    const { svc, fetchImpl, clock } = makeService();
    const deadline = clock.now() + 30 * 60_000;
    svc.suppressWakeUntil(deadline);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://10.0.0.245:8770/config');
    expect(opts.method).toBe('POST');
    expect(opts.body).toContain(`fkbWakeSuppressUntilEpochMs: ${deadline}`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs`
Expected: FAIL — `svc.suppressWakeUntil is not a function` / `svc._handleNoteOnForTest is not a function`.

- [ ] **Step 3: Implement `suppressWakeUntil` + gate `#onNoteOn`**

In `PianoMidiWakeService.mjs`:

1. Add `fetchImpl` to the destructured ctor options and store it; add the two private fields:

```js
  #suppressUntil;   // epoch-ms; note-ons before this don't wake (manual screen-off)
  #fetchImpl;
```

In the constructor body (near the other assignments), add:

```js
    this.#fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.#suppressUntil = 0;
```

(Change the ctor signature to capture the whole options object as `opts` if it isn't already, or add `fetchImpl` to the existing destructure and read `opts` — keep it consistent with the file's current style: add `fetchImpl,` to the destructured list and `this.#fetchImpl = fetchImpl ?? ((...a) => fetch(...a));`.)

2. Gate `#onNoteOn()` — add at the very top of the method:

```js
    if (this.#clock.now() < this.#suppressUntil) return; // manually muted
```

3. Add the public method + a test seam, after `stop()`:

```js
  /**
   * Mute MIDI-driven screen wakes until `deadlineMs` (epoch-ms). Skips this
   * service's own FKB pokes AND relays the deadline to the piano-bridge APK's
   * control plane so its on-device ScreenWaker is muted too (no APK rebuild —
   * the APK reads fkbWakeSuppressUntilEpochMs in ScreenWaker.poke()).
   * @param {number} deadlineMs
   */
  suppressWakeUntil(deadlineMs) {
    this.#suppressUntil = deadlineMs;
    this.#logger.info?.('piano-midi-wake.suppressed', {
      deviceId: this.#deviceId, until: deadlineMs,
    });
    // ws://host:port  →  http://host:port/config
    const httpBase = this.#bridgeUrl.replace(/^ws(s?):\/\//i, 'http$1://');
    const url = `${httpBase.replace(/\/+$/, '')}/config`;
    Promise.resolve()
      .then(() => this.#fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `fkbWakeSuppressUntilEpochMs: ${deadlineMs}\n`,
      }))
      .catch((err) => this.#logger.warn?.('piano-midi-wake.suppress-relay-failed', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      }));
  }

  /** Test seam: exercise the note-on handler without a live WS. */
  _handleNoteOnForTest() { this.#onNoteOn(); }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/PianoMidiWakeService.mjs backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs
git commit -m "feat(piano): PianoMidiWakeService.suppressWakeUntil mutes midi wake + relays to APK"
```

---

## Task 2: Backend — capture the service + `POST /screen/suppress-wake` endpoint

**Files:**
- Modify: `backend/src/app.mjs` (line ~1987 `createPianoMidiWake`, line ~2052 `createDeviceApiRouter`)
- Modify: `backend/src/4_api/v1/routers/device.mjs` (add route after the `/screen/:state` handler, ~line 736)

**Interfaces:**
- Consumes: `PianoMidiWakeService.suppressWakeUntil(deadlineMs)` from Task 1.
- Produces: `POST /api/v1/device/:deviceId/screen/suppress-wake` with JSON body `{ minutes?: number }` → computes `deadline = Date.now() + minutes*60000` (default 30), calls `pianoMidiWakeService?.suppressWakeUntil(deadline)`, responds `{ ok: true, until: deadline }`. Never 500s when the service is absent (returns `{ ok: true, until, relayed: false }`).

- [ ] **Step 1: Capture the service in `app.mjs`**

Change (line ~1987):

```js
  createPianoMidiWake({
```

to:

```js
  const { pianoMidiWakeService } = createPianoMidiWake({
```

- [ ] **Step 2: Pass it into the device router**

In the `createDeviceApiRouter({ ... })` call (line ~2052), add the field:

```js
  v1Routers.device = createDeviceApiRouter({
    deviceServices,
    wakeAndLoadService,
    dispatchIdempotencyService,
    configService,
    loadFile,
    pianoMidiWakeService,
    logger: rootLogger.child({ module: 'device-api' })
  });
```

- [ ] **Step 3: Accept the param + add the route in `device.mjs`**

Add `pianoMidiWakeService` to the `createDeviceApiRouter` destructured config (wherever the other deps like `wakeAndLoadService` are destructured near the top of the factory). Then add, immediately after the `/:deviceId/screen/:state` handler (after line ~736):

```js
  /**
   * POST /device/:deviceId/screen/suppress-wake   body: { minutes?: number }
   * Mute MIDI-driven screen wakes for `minutes` (default 30). Used by the piano
   * kiosk's "Turn off screen" action so playing the piano doesn't re-light the
   * tablet until the player has been idle. Coordinates the backend midi-wake
   * service + (via it) the on-device APK ScreenWaker.
   */
  router.post('/:deviceId/screen/suppress-wake', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const minutes = Number(req.body?.minutes) > 0 ? Number(req.body.minutes) : 30;
    const until = Date.now() + minutes * 60_000;
    logger.info?.('device.router.suppressWake', { deviceId, minutes, until });
    if (pianoMidiWakeService?.suppressWakeUntil) {
      pianoMidiWakeService.suppressWakeUntil(until);
      return res.json({ ok: true, until, relayed: true });
    }
    return res.json({ ok: true, until, relayed: false });
  }));
```

- [ ] **Step 4: Smoke-test the route boots**

Run: `node -e "import('./backend/src/4_api/v1/routers/device.mjs').then(m=>console.log(typeof m.createDeviceApiRouter))"`
Expected: prints `function` (module parses, no syntax error).

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/device.mjs
git commit -m "feat(piano): POST /device/:id/screen/suppress-wake arms midi-wake cooldown"
```

---

## Task 3: Frontend — screensaver MIDI-suppression context + hook

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.test.jsx` (append; create if absent)

**Interfaces:**
- Produces:
  - `PianoScreenControlProvider({ children })` — React provider holding `armNonce` (int) + `beginScreenOffCooldown()`.
  - `useScreenOffCooldown(): () => void` — returns `beginScreenOffCooldown` (no-op outside the provider).
  - `usePianoScreensaver({ ..., offCooldownMinutes })` — new arg; on an arm-nonce bump it marks the screen off + suppresses MIDI-wake; MIDI-wake is skipped while suppressed; suppression clears on touch or after `offCooldownMinutes` of no activity.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.test.jsx` (imports mirror the existing suite; if the file doesn't exist, create it with these imports):

```jsx
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PianoScreenControlProvider,
  useScreenOffCooldown,
  usePianoScreensaver,
} from './usePianoScreensaver.jsx';

// DaylightAPI is what setScreen calls; capture its screen state changes.
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({ ok: true }) }));
import { DaylightAPI } from '../../../lib/api.mjs';

function Harness({ notes }) {
  const begin = useScreenOffCooldown();
  usePianoScreensaver({
    deviceId: 'dev1', activeNotes: notes, noteHistory: [],
    timeoutMinutes: 3, offCooldownMinutes: 30,
  });
  return <button onClick={begin}>off</button>;
}

const screenCalls = () =>
  DaylightAPI.mock.calls.map(([p]) => p).filter((p) => p.includes('/screen/'));

describe('usePianoScreensaver MIDI-wake suppression', () => {
  beforeEach(() => { vi.useFakeTimers(); DaylightAPI.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not wake on MIDI after the screen-off cooldown is armed', () => {
    const { getByText, rerender } = render(
      <PianoScreenControlProvider><Harness notes={new Map()} /></PianoScreenControlProvider>,
    );
    DaylightAPI.mockClear();
    act(() => { getByText('off').click(); });         // arm cooldown
    // A fresh MIDI note (new activeNotes identity) must NOT call screen/on.
    rerender(
      <PianoScreenControlProvider><Harness notes={new Map([[60, {}]])} /></PianoScreenControlProvider>,
    );
    expect(screenCalls().filter((p) => p.endsWith('/screen/on'))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.test.jsx --exclude '**/.claire/**'`
Expected: FAIL — `useScreenOffCooldown`/`PianoScreenControlProvider` are not exported.

- [ ] **Step 3: Add the provider + hook, and wire suppression**

In `usePianoScreensaver.jsx`:

1. Add the context + provider (near the wake-lock context, after `usePianoWakeLockState`):

```js
// ── Manual screen-off cooldown ───────────────────────────────────────────────
// Bridges the Who's-Playing "Turn off screen" button (in PianoShell, below the
// connect gate) to the screensaver (in ScreensaverDriver, above it). The button
// bumps `armNonce`; the screensaver reacts by muting MIDI-wake until idle.
const PianoScreenControlContext = createContext(null);

export function PianoScreenControlProvider({ children }) {
  const [armNonce, setArmNonce] = useState(0);
  const beginScreenOffCooldown = useCallback(() => setArmNonce((n) => n + 1), []);
  const value = useMemo(() => ({ armNonce, beginScreenOffCooldown }), [armNonce, beginScreenOffCooldown]);
  return <PianoScreenControlContext.Provider value={value}>{children}</PianoScreenControlContext.Provider>;
}

/** Returns a function that arms the manual screen-off MIDI-wake cooldown. */
export function useScreenOffCooldown() {
  return useContext(PianoScreenControlContext)?.beginScreenOffCooldown ?? (() => {});
}
```

2. In `usePianoScreensaver`, add `offCooldownMinutes` to the destructured args and read the arm context:

```js
export function usePianoScreensaver({ deviceId, activeNotes, noteHistory, timeoutMinutes, quietHours, offCooldownMinutes = 30 }) {
```

Add near the other refs:

```js
  const midiSuppressedRef = useRef(false);
  const ctrl = useContext(PianoScreenControlContext);
  const armNonce = ctrl?.armNonce ?? 0;
  const prevArmRef = useRef(armNonce);
```

3. Arm reaction — add this effect (after `setScreen` is defined):

```js
  // Who's-Playing "Turn off screen": the button already turned the backlight
  // off, so just record that + start muting MIDI-wake. Not fired on mount
  // (prevArmRef starts equal to armNonce).
  useEffect(() => {
    if (armNonce === prevArmRef.current) return;
    prevArmRef.current = armNonce;
    if (!enabled) return;
    midiSuppressedRef.current = true;
    screenOnRef.current = false;
    lastActivityRef.current = Date.now();
    logger().info('piano.screen-off-cooldown.armed', { offCooldownMinutes });
  }, [armNonce, enabled, offCooldownMinutes]);
```

4. MIDI-wake effect — skip `setScreen(true)` while suppressed (keep updating `lastActivityRef` so the quiet-gap clock runs):

```js
  useEffect(() => {
    lastActivityRef.current = Date.now();
    if (enabled && !midiSuppressedRef.current && !isWithinQuietHours(new Date(), quietRef.current)) setScreen(true);
  }, [activeNotes, historyLen, enabled, setScreen]);
```

5. Touch bump — clear suppression on a deliberate touch:

```js
    const bump = () => {
      lastActivityRef.current = Date.now();
      if (midiSuppressedRef.current) {
        midiSuppressedRef.current = false;
        logger().info('piano.screen-off-cooldown.cleared', { via: 'touch' });
      }
      if (!isWithinQuietHours(new Date(), quietRef.current)) setScreen(true);
    };
```

6. Idle poll — clear suppression once idle ≥ `offCooldownMinutes` (add at the top of the interval callback):

```js
    const cooldownMs = offCooldownMinutes * 60_000;
    const id = setInterval(() => {
      if (midiSuppressedRef.current && Date.now() - lastActivityRef.current >= cooldownMs) {
        midiSuppressedRef.current = false;
        logger().info('piano.screen-off-cooldown.cleared', { via: 'idle' });
      }
      if (heldRef.current) { lastActivityRef.current = Date.now(); return; }
      if (isWithinQuietHours(new Date(), quietRef.current)) { setScreen(false); return; }
      if (Date.now() - lastActivityRef.current >= thresholdMs) setScreen(false);
    }, POLL_INTERVAL_MS);
```

Add `offCooldownMinutes` to that effect's dependency array.

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.test.jsx --exclude '**/.claire/**'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.jsx frontend/src/modules/Piano/PianoKiosk/usePianoScreensaver.test.jsx
git commit -m "feat(piano): screensaver MIDI-wake suppression + screen-off cooldown context"
```

---

## Task 4: Frontend — `offCooldownMinutes` config resolution

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx` (`PIANO_CONFIG_DEFAULTS.screensaver` ~line 42, `resolveScreensaver` ~line 55)

**Interfaces:**
- Produces: `resolveScreensaver(...)` result gains `offCooldownMinutes` (per-piano over shared over default 30).

- [ ] **Step 1: Add the default**

Line ~42, change:

```js
  screensaver: { deviceId: null, timeoutMinutes: 20, quietHours: null },
```

to:

```js
  screensaver: { deviceId: null, timeoutMinutes: 20, quietHours: null, offCooldownMinutes: 30 },
```

- [ ] **Step 2: Resolve it**

In `resolveScreensaver`, add to the returned object:

```js
    offCooldownMinutes: ps.offCooldownMinutes ?? s.offCooldownMinutes ?? d.offCooldownMinutes,
```

- [ ] **Step 3: Verify parse**

Run: `node -e "import('./frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx').catch(e=>{console.log('parse-only');process.exit(0)})"`
Expected: no syntax error (JSX won't execute under node; a parse-only note is fine — the real check is Task 6's build).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx
git commit -m "feat(piano): resolve screensaver.offCooldownMinutes (default 30)"
```

---

## Task 5: Frontend — the "Turn off screen" button in Who's-Playing

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx`
- Modify: `frontend/src/Apps/PianoApp.jsx` (provider mount, `ScreensaverDriver`, `PianoShell`)
- Modify: `frontend/src/Apps/PianoApp.scss` (button styles)

**Interfaces:**
- Consumes: `useArmedAction(fn, { armMs })` (existing), `useScreenControl().turnOffScreen()` (existing), `useScreenOffCooldown()` (Task 3), `POST api/v1/device/:id/screen/suppress-wake` (Task 2), `resolveScreensaver().offCooldownMinutes` (Task 4).
- Produces: `WhoIsPlayingPrompt` gains an optional `onScreenOff` prop; when present, renders a 2-tap armed "Turn off screen" button at the bottom of the sheet.

- [ ] **Step 1: Write the failing test**

Append to `WhoIsPlayingPrompt.test.jsx`:

```jsx
import { render, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import WhoIsPlayingPrompt from './WhoIsPlayingPrompt.jsx';

describe('WhoIsPlayingPrompt screen-off button', () => {
  const users = [{ id: 'kckern', name: 'Dad' }];

  it('renders no screen-off button without onScreenOff', () => {
    const { queryByRole } = render(
      <WhoIsPlayingPrompt open users={users} onPick={()=>{}} onDismiss={()=>{}} />,
    );
    expect(queryByRole('button', { name: /turn off screen/i })).toBeNull();
  });

  it('two-tap arms then confirms onScreenOff', () => {
    const onScreenOff = vi.fn();
    const { getByRole } = render(
      <WhoIsPlayingPrompt open users={users} onPick={()=>{}} onDismiss={()=>{}} onScreenOff={onScreenOff} />,
    );
    const btn = getByRole('button', { name: /turn off screen/i });
    fireEvent.click(btn);                 // arms only
    expect(onScreenOff).not.toHaveBeenCalled();
    fireEvent.click(getByRole('button', { name: /tap again to confirm/i }));
    expect(onScreenOff).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx --exclude '**/.claire/**'`
Expected: FAIL — no "turn off screen" button.

- [ ] **Step 3: Add the button to `WhoIsPlayingPrompt.jsx`**

Add the import:

```js
import useArmedAction from './useArmedAction.js';
```

Change the signature to accept `onScreenOff`:

```js
export default function WhoIsPlayingPrompt({ open, users = [], onPick, onDismiss, onScreenOff, timeoutMs = 30000 }) {
```

Add the armed action inside the component (before `if (!open)`):

```js
  const { armed: offArmed, trigger: triggerOff } = useArmedAction(() => onScreenOff?.(), { armMs: 3000 });
```

Render the button just before the closing `</div>` of `.piano-userpicker__sheet` (after the page-dots block):

```jsx
        {onScreenOff && (
          <div className="piano-userpicker__device">
            <button
              type="button"
              className={`piano-userpicker__screen-off${offArmed ? ' is-armed' : ''}`}
              aria-live="polite"
              onClick={triggerOff}
            >
              {offArmed ? 'Tap again to confirm' : 'Turn off screen'}
            </button>
          </div>
        )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx --exclude '**/.claire/**'`
Expected: PASS.

- [ ] **Step 5: Wire `PianoApp.jsx`**

(a) Import the provider + cooldown hook + screen control + API:

```js
import {
  PianoWakeLockProvider,
  usePianoScreensaver,
  PianoScreenControlProvider,
  useScreenOffCooldown,
} from '../modules/Piano/PianoKiosk/usePianoScreensaver.jsx';
import { useScreenControl } from '../modules/Piano/PianoKiosk/useScreenControl.js';
import { DaylightAPI } from '../lib/api.mjs';
```

(Replace the existing `usePianoScreensaver` import line; keep `screenOffFailureMessage` import as-is elsewhere.)

(b) `ScreensaverDriver` — pass `offCooldownMinutes`:

```js
  usePianoScreensaver({
    deviceId: config.screensaver?.deviceId,
    activeNotes,
    noteHistory,
    timeoutMinutes: config.screensaver?.timeoutMinutes,
    quietHours: config.screensaver?.quietHours,
    offCooldownMinutes: config.screensaver?.offCooldownMinutes,
  });
```

(c) `PianoShell` — build `onScreenOff` and pass it to the prompt. Add inside `PianoShell`, after the existing hooks:

```js
  const { turnOffScreen } = useScreenControl();
  const beginScreenOffCooldown = useScreenOffCooldown();
  const handleScreenOff = useMemo(() => async () => {
    const mins = config.screensaver?.offCooldownMinutes ?? 30;
    await turnOffScreen();                 // instant FKB / backend off
    beginScreenOffCooldown();              // mute in-browser MIDI wake (path 1)
    const deviceId = config.screensaver?.deviceId;
    if (deviceId) {
      DaylightAPI(`api/v1/device/${deviceId}/screen/suppress-wake`, { minutes: mins }, 'POST')
        .catch(() => {});                  // mute backend + APK (paths 2 & 3); best-effort
    }
    setCurrentUser('guest');               // "I don't want this" ⇒ dismiss to guest
    setWhoOpen(false);
  }, [config.screensaver, turnOffScreen, beginScreenOffCooldown, setCurrentUser]);
```

Then pass it:

```jsx
          <WhoIsPlayingPrompt
            open={whoOpen}
            users={users}
            onPick={(id) => { setCurrentUser(id); setWhoOpen(false); }}
            onDismiss={() => { setCurrentUser('guest'); setWhoOpen(false); }}
            onScreenOff={handleScreenOff}
          />
```

(d) Mount `PianoScreenControlProvider` in `ActivePiano` so it wraps BOTH `ScreensaverDriver` and `PianoShell`. Wrap the existing `PianoWakeLockProvider` children:

```jsx
        <PianoWakeLockProvider>
          <PianoScreenControlProvider>
            <ScreensaverDriver />
            <ConnectGate>
              <PianoPlaybackProvider>
                <PianoMixProvider>
                  <PianoShell />
                </PianoMixProvider>
              </PianoPlaybackProvider>
            </ConnectGate>
          </PianoScreenControlProvider>
        </PianoWakeLockProvider>
```

> **Verify the `DaylightAPI` POST signature** before finalizing (c): open `frontend/src/lib/api.mjs` and confirm the call form for a POST with a JSON body (it may be `DaylightAPI(path, body, method)` or an options object). Match the existing convention used elsewhere in the piano kiosk (e.g. grep `DaylightAPI(` for a POST example). Adjust the call in (c) accordingly.

- [ ] **Step 6: Add button styles to `PianoApp.scss`**

Find `.piano-userpicker {` (~line 2129) and add, within/after that block, styles mirroring the connect-gate screen-off button (grep `.piano-connect-gate__screen-off` in the same file for the reference rule and copy its visual treatment):

```scss
.piano-userpicker__device {
  margin-top: 1.5rem;
  display: flex;
  justify-content: center;
}
.piano-userpicker__screen-off {
  padding: 0.75rem 1.5rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 1rem;
  &.is-armed {
    border-color: #e0533d;
    color: #e0533d;
  }
}
```

- [ ] **Step 7: Run the full piano-kiosk test dir**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/ --exclude '**/.claire/**'`
Expected: PASS (existing + new specs).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx frontend/src/Apps/PianoApp.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): Who's-Playing 'Turn off screen' button arms MIDI-wake cooldown"
```

---

## Task 6: Config, build, deploy, verify

**Files:**
- Modify (data volume): `data/household/config/piano.yml` → `screensaver.offCooldownMinutes: 30`

- [ ] **Step 1: Add the config key (served file, inside the container)**

The `screensaver:` block is at `piano.yml` ~line 418. Insert `offCooldownMinutes: 30` under it. Use a full-file rewrite or a targeted append — NEVER `sed -i` on container YAML. Verify:

Run: `sudo docker exec daylight-station sh -c 'grep -n -A9 "^screensaver:" data/household/config/piano.yml'`
Expected: shows `offCooldownMinutes: 30`.

(The code defaults to 30 if the key is absent, so this step is for discoverability/tunability, not correctness.)

- [ ] **Step 2: Frontend build check**

Run: `cd /opt/Code/DaylightStation && npx vite build --config frontend/vite.config.* 2>&1 | tail -5` (or the repo's build script) to confirm the JSX compiles.
Expected: build succeeds (no unresolved imports / syntax errors).

- [ ] **Step 3: Confirm deploy gates are clear, then build + deploy**

Gate check (must be zero video render lines, `sessionActive:false`, `rosterSize:0`):

```bash
sudo docker logs --since 60s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 60s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Then build + deploy per CLAUDE.local.md (`sudo docker build ...`, `sudo docker stop/rm`, `sudo deploy-daylight`).

- [ ] **Step 4: End-to-end verification**

1. Backend endpoint responds:
   `curl -s -X POST http://localhost:3111/api/v1/device/yellow-room-tablet/screen/suppress-wake -H 'Content-Type: application/json' -d '{"minutes":30}'`
   Expected: `{"ok":true,"until":<epoch>,"relayed":true}`.
2. Backend logs show the relay attempt: `sudo docker logs --since 30s daylight-station 2>&1 | grep -E 'piano-midi-wake.suppressed|suppress-relay'`.
3. APK muted: `PB_HOST=10.0.0.245:8770 node _extensions/piano-bridge/pbctl.mjs config | grep -i fkbWakeSuppressUntilEpochMs` — shows a future epoch-ms.
4. On-device (garage/tablet): with the screen manually turned off from Who's-Playing, play the piano — the backlight must stay OFF. Stop for the cooldown, then a note wakes it. (Reload the piano kiosk first — Task 5 changed frontend bundle.)

- [ ] **Step 5: Commit any config file change**

```bash
git add -A && git commit -m "chore(piano): screensaver.offCooldownMinutes default in piano.yml"
```

(Note: `piano.yml` lives in the data volume, not the repo; if it is not tracked here, record the value in the plan/PR description instead.)

---

## Self-Review Notes

- **Spec coverage:** button on Who's-Playing (Task 5) ✓; screen off on press (Task 5, `turnOffScreen`) ✓; no MIDI re-wake until idle (Tasks 1–3 across all three paths) ✓; 30-min default, `piano.yml`-configurable (Tasks 4, 6) ✓; 2-tap arm/confirm (Task 5) ✓; touch still allowed to wake (Task 3 touch bump) ✓.
- **Type consistency:** `suppressWakeUntil(deadlineMs)` used identically in Tasks 1/2; `useScreenOffCooldown()`/`PianoScreenControlProvider`/`beginScreenOffCooldown` consistent across Tasks 3/5; `offCooldownMinutes` consistent across Tasks 3/4/5.
- **Open verification (do during execution, don't assume):** the `DaylightAPI` POST signature (Task 5 note); that the APK control plane serves HTTP `/config` on the same `:8770` as the WS (pbctl confirms it does); exact indentation when inserting into `piano.yml`.
