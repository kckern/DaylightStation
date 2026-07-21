# Portal Touch Kiosk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Portal touch panel fully usable — on-screen chrome so a touch-only user can always exit and control playback, and a backend fix so MediaApp can cast to self-powered panels.

**Architecture:** Two independent slices. (A) Backend: `WakeAndLoadService` currently hard-fails dispatch for any device without `device_control`; skip the power step *and* the display-verify step for those devices. (B) Frontend: `ScreenOverlayProvider` reserves an 80px chrome lane below a 1280×720 content box when `input.type` is `touch`, rendering a `TouchChrome` component that emits existing ActionBus actions.

**Tech Stack:** Node ESM backend (`.mjs`), React 18 frontend (`.jsx`), vitest + node:test, YAML config in a Docker-bind-mounted data volume.

## Global Constraints

- **Never edit `frontend/src/modules/Player/` or `frontend/src/lib/Player/`.** Project rule: fix in the consumer. The consumer seams are `ScreenOverlayProvider.jsx`, `ScreenActionHandler.jsx`, `ScreenPlayer.jsx`.
- **Chrome emits existing ActionBus actions only.** Never call `dismissOverlay()` directly from a button — that would bypass the escape interceptor chain (MenuStack pop-one-level, PiP dismiss, YAML `actions.escape`).
- **No sliders.** Touch surfaces use discrete tap targets. Established project rule.
- **Seek buttons carry direction-only icons, never a duration.** `rew`/`fwd` map to `ArrowLeft`/`ArrowRight`; the Player owns the step size.
- **The capability key is `deviceControl`, never `power`.** `Device.getCapabilities()` (`Device.mjs:345-353`) emits only `deviceControl, osControl, contentControl, volume, audioDevice`. `hasCapability('power')` is always `false`.
- **Do not touch `WakeAndLoadService.mjs:294`.** It is dead code (see Known Issue below) and reviving it is out of scope.
- **Logging:** use the framework (`getLogger().child({...})`), never raw `console.*`.
- Data-volume YAML is not writable directly by this user. Write via
  `sudo docker exec daylight-station sh -c "cat > <path> << 'EOF' … EOF"`, then
  `sudo docker exec daylight-station chown node:node <path>`.

## Test Commands (verified working 2026-07-20)

| Suite | Command | Baseline |
|---|---|---|
| Isolated device specs (vitest) | `npx vitest run tests/isolated/application/devices/` | 11 files, 76 tests pass, exit 0 |
| Power degradation (node:test) | `node --test backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs` | 5 pass, exit 0 |
| Frontend screen-framework (vitest) | `npx vitest run frontend/src/screen-framework/` | run before starting to record baseline |

`npx vitest run --reporter=basic` is NOT valid in vitest 4.1.5 — omit the flag.
Always capture the real exit code separately (`cmd >/dev/null 2>&1; echo $?`); a piped
exit code belongs to the last pipe stage, not the runner.

## Known Issue (document, do not fix)

`WakeAndLoadService.mjs:294` guards the "Step 4b re-verify TV power" block with
`device.hasCapability('power')`, which is always `false` — the block has never executed.
It is *doubly* dead: line 296 reads `postPreparePower.wasPoweredOff`, a property no adapter
in the repo produces. Reviving it would add a redundant `powerOn()` after prepare, carrying
livingroom-tv's 80s verify budget (`powerOnWaitOptions.timeoutMs: 80000`). Task 2 files this
as a documented issue only.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | modify | Skip power + verify when device has no `device_control` |
| `tests/isolated/application/devices/WakeAndLoadService.selfPowered.test.mjs` | create | Covers the new skip path |
| `tests/isolated/application/devices/WakeAndLoadService.retry.test.mjs` | modify | Fix `hasCapability` stub |
| `backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs` | modify | Fix `hasCapability` stub |
| `frontend/src/screen-framework/overlays/TouchChrome.jsx` | create | Presentational button row; emits ActionBus actions |
| `frontend/src/screen-framework/overlays/TouchChrome.css` | create | Lane + button sizing |
| `frontend/src/screen-framework/overlays/TouchChrome.test.jsx` | create | Button → action/payload coverage |
| `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx` | modify | `inputType` prop, `chrome` option, lane layout |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | modify | `chrome: 'media'` on Player mounts |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | modify | Pass `inputType` to provider |
| `data/household/screens/portal.yml` (data volume) | modify | Software volume master |

---

## Task 1: Skip power + verify for self-powered devices

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:147-186`
- Test: `tests/isolated/application/devices/WakeAndLoadService.selfPowered.test.mjs` (create)

**Interfaces:**
- Consumes: `device.hasCapability(cap)` → boolean; `device.powerOn()` → `{ok, verifyFailed?, verified?, verifySkipped?, elapsedMs?, error?}`
- Produces: `result.steps.power = { ok: true, skipped: 'no_device_control' }` and `result.steps.verify = { ready: true, skipped: 'no_sensor' }` for self-powered devices.

**Why both steps:** skipping only the power step moves the failure to verify.
`WakeAndLoadService.mjs:185-186` reads `powerResult.verified` and `powerResult.verifySkipped`;
a synthesized result lacking both falls through to `readinessPolicy.isReady()`, which returns
`{ready:false, reason:'no_sensor'}` for a device with no `state_sensor`, producing
`failedStep: 'verify'` **and** a 45s ghost retry (line 207).

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/application/devices/WakeAndLoadService.selfPowered.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// A self-powered surface: content_control but NO device_control (portal, yellow-room-tablet).
function makeSelfPoweredDevice(overrides = {}) {
  return {
    id: 'portal',
    screenPath: '/screen/portal',
    defaultVolume: null,
    notifyService: null,
    hasCapability: vi.fn((cap) => cap === 'contentControl'),
    powerOn: vi.fn().mockResolvedValue({ ok: false, error: 'No device control configured' }),
    setVolume: vi.fn().mockResolvedValue({ ok: true }),
    prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeSvc(device, readinessPolicy) {
  return new WakeAndLoadService({
    deviceService: { get: vi.fn().mockReturnValue(device) },
    readinessPolicy,
    broadcast: vi.fn(),
    haGateway: undefined,
    logger: makeLogger(),
  });
}

describe('WakeAndLoadService self-powered devices (no device_control)', () => {
  it('skips the power step instead of failing the dispatch', async () => {
    const device = makeSelfPoweredDevice();
    const svc = makeSvc(device, { isReady: vi.fn() });

    const result = await svc.execute('portal', { plex: '620669' });

    expect(device.powerOn).not.toHaveBeenCalled();
    expect(result.steps.power).toEqual({ ok: true, skipped: 'no_device_control' });
    expect(result.failedStep).toBeUndefined();
  });

  it('skips display verification and never consults the readiness policy', async () => {
    const device = makeSelfPoweredDevice();
    const readinessPolicy = { isReady: vi.fn() };
    const svc = makeSvc(device, readinessPolicy);

    const result = await svc.execute('portal', { plex: '620669' });

    expect(readinessPolicy.isReady).not.toHaveBeenCalled();
    expect(result.steps.verify).toEqual({ ready: true, skipped: 'no_sensor' });
  });

  it('reaches loadContent and reports overall success', async () => {
    const device = makeSelfPoweredDevice();
    const svc = makeSvc(device, { isReady: vi.fn() });

    const result = await svc.execute('portal', { plex: '620669' });

    expect(device.loadContent).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('still powers on a device that HAS device_control', async () => {
    const device = makeSelfPoweredDevice({
      id: 'livingroom-tv',
      hasCapability: vi.fn((cap) => cap === 'deviceControl' || cap === 'contentControl'),
      powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true, elapsedMs: 1200 }),
    });
    const svc = makeSvc(device, { isReady: vi.fn() });

    await svc.execute('livingroom-tv', { plex: '620669' });

    expect(device.powerOn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/isolated/application/devices/WakeAndLoadService.selfPowered.test.mjs`

Expected: FAIL. The first three tests fail because `powerOn()` is called and returns
`{ok:false}` with no `verifyFailed`, producing `failedStep: 'power'`.

- [ ] **Step 3: Implement the skip**

In `WakeAndLoadService.mjs`, replace lines 147-152:

```javascript
    // --- Step 1: Power On ---
    // Self-powered surfaces (touch panels, speakers) declare content_control but no
    // device_control: there is nothing to switch on and no state sensor to verify
    // against. Skip the step rather than hard-failing the whole dispatch.
    //
    // The predicate is 'deviceControl', NOT 'power' — getCapabilities() emits no
    // `power` key, so hasCapability('power') is always false. (That is exactly why
    // the Step 4b block at ~line 294 has never executed; see the plan's Known Issue.)
    const canPowerOn = device.hasCapability('deviceControl');

    this.#emitProgress(topic, dispatchId, 'power', 'running');
    this.#logger.info?.('wake-and-load.power.start', { deviceId, dispatchId, canPowerOn });

    const powerResult = canPowerOn
      ? await device.powerOn()
      : { ok: true, skipped: 'no_device_control' };
    result.steps.power = powerResult;
```

Then extend the verify-skip condition at line 186:

```javascript
    const alreadyVerified = powerResult.verified === true;
    // `skipped` covers self-powered devices, which have no sensor to consult at all;
    // without this they fall into readinessPolicy.isReady() and fail with 'no_sensor'
    // plus a spurious 45s retry.
    const noSensor = powerResult.verifySkipped === 'no_state_sensor'
      || powerResult.skipped === 'no_device_control';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/isolated/application/devices/WakeAndLoadService.selfPowered.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs \
        tests/isolated/application/devices/WakeAndLoadService.selfPowered.test.mjs
git commit -m "fix(devices): skip power+verify for self-powered surfaces

Devices with content_control but no device_control (portal,
yellow-room-tablet) hard-failed /device/:id/load at the power step.
Skip both power and display-verify for them; skipping power alone
just relocates the failure to verify and arms a 45s ghost retry."
```

---

## Task 2: Repair test stubs invalidated by Task 1

**Files:**
- Modify: `tests/isolated/application/devices/WakeAndLoadService.retry.test.mjs:17`
- Modify: `backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs`
- Create: `docs/_wip/bugs/2026-07-20-wakeandload-dead-power-recheck.md`

**Interfaces:**
- Consumes: the Task 1 predicate `device.hasCapability('deviceControl')`.
- Produces: no new exports. Restores both suites to green.

**Why:** both suites stub `hasCapability: vi.fn().mockReturnValue(false)` (or the node:test
equivalent). Those suites model devices that *do* have `device_control` (a TV whose power
script runs but whose sensor doesn't confirm). Under Task 1 their blanket-false stub now
routes them down the skip path, so `powerOn` is never consulted and the power semantics they
exist to guard never execute. The stub was always inaccurate; Task 1 merely exposes it.

- [ ] **Step 1: Run both suites to observe the breakage**

```bash
npx vitest run tests/isolated/application/devices/
node --test backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs
```

Expected: failures in `retry.test.mjs` and `powerDegradation.test.mjs`. Record which.

- [ ] **Step 2: Fix the vitest stub**

In `tests/isolated/application/devices/WakeAndLoadService.retry.test.mjs`, in `makeDevice()`,
replace:

```javascript
    hasCapability: vi.fn().mockReturnValue(false),
```

with:

```javascript
    // This suite models a TV that HAS device_control — its power script dispatches
    // but the state sensor never confirms. A blanket-false stub would send it down
    // the self-powered skip path and bypass the power semantics under test.
    hasCapability: vi.fn((cap) => cap === 'deviceControl'),
```

- [ ] **Step 3: Fix the node:test stub**

In `backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs`,
find the device factory and apply the same change, using plain functions (this file uses
`node:test`, so there is no `vi`):

```javascript
    hasCapability: (cap) => cap === 'deviceControl',
```

- [ ] **Step 4: Run both suites to verify green**

```bash
npx vitest run tests/isolated/application/devices/ >/dev/null 2>&1; echo "vitest exit: $?"
node --test backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs >/dev/null 2>&1; echo "node:test exit: $?"
```

Expected: both `0`. vitest should report 12 files / 80 tests (76 baseline + 4 from Task 1).

- [ ] **Step 5: File the dead-code issue**

Create `docs/_wip/bugs/2026-07-20-wakeandload-dead-power-recheck.md`:

```markdown
# WakeAndLoadService Step 4b power re-check is dead code

**Found:** 2026-07-20, while fixing casting to self-powered panels.
**Status:** Documented, not fixed. Deliberately out of scope.

`WakeAndLoadService.mjs:294` guards the "Step 4b — Re-verify TV power" block with
`device.hasCapability('power')`. `Device.getCapabilities()` (`Device.mjs:345-353`)
returns only `deviceControl, osControl, contentControl, volume, audioDevice` — there
is no `power` key, so the guard is always false and the block has never executed.

Every other `hasCapability` call site uses a real key (`'volume'` at
WakeAndLoadService.mjs:218 and device.mjs:1117, `'audioDevice'` at device.mjs:1154),
so line 294 is the lone typo.

It is doubly dead: line 296 reads `postPreparePower.wasPoweredOff`, which no adapter
in the repo produces. Correcting the guard to `'deviceControl'` would therefore never
take the `restarted: true` branch — it would only add a redundant `powerOn()` round
trip after prepare, carrying livingroom-tv's 80s verify budget
(`powerOnWaitOptions.timeoutMs: 80000` in devices.yml).

**Consequence:** the CEC auto-sleep protection described in the comment at lines
290-293 does not exist. If TVs are observed powering off during a long prepare, this
needs a real fix: correct the guard AND have the device-control adapter emit
`wasPoweredOff`.
```

- [ ] **Step 6: Commit**

```bash
git add tests/isolated/application/devices/WakeAndLoadService.retry.test.mjs \
        backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs \
        docs/_wip/bugs/2026-07-20-wakeandload-dead-power-recheck.md
git commit -m "test(devices): stub hasCapability accurately for powered devices

Both suites model devices WITH device_control but stubbed hasCapability
to blanket false, which now routes them down the self-powered skip path.
Also documents the dead Step 4b power re-check found while investigating."
```

---

## Task 3: TouchChrome component

**Files:**
- Create: `frontend/src/screen-framework/overlays/TouchChrome.jsx`
- Create: `frontend/src/screen-framework/overlays/TouchChrome.css`
- Test: `frontend/src/screen-framework/overlays/TouchChrome.test.jsx`

**Interfaces:**
- Consumes: `getActionBus()` from `../input/ActionBus.js` (method `emit(action, payload)`).
- Produces: `export function TouchChrome({ mode })` where `mode` is `'back' | 'media'`;
  default export is the same component. Renders `<div className="touch-chrome">` with
  buttons carrying `data-testid` values: `touch-chrome-back`, `touch-chrome-prev`,
  `touch-chrome-playpause`, `touch-chrome-next`, `touch-chrome-rew`, `touch-chrome-fwd`,
  `touch-chrome-vol-down`, `touch-chrome-vol-up`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/screen-framework/overlays/TouchChrome.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TouchChrome } from './TouchChrome.jsx';
import { getActionBus } from '../input/ActionBus.js';

vi.mock('../input/ActionBus.js', () => {
  const emit = vi.fn();
  return { getActionBus: () => ({ emit }) };
});

describe('TouchChrome', () => {
  beforeEach(() => {
    getActionBus().emit.mockClear();
  });

  it('renders only Back in back mode', () => {
    render(<TouchChrome mode="back" />);
    expect(screen.getByTestId('touch-chrome-back')).toBeInTheDocument();
    expect(screen.queryByTestId('touch-chrome-playpause')).toBeNull();
    expect(screen.queryByTestId('touch-chrome-vol-up')).toBeNull();
  });

  it('renders transport and volume in media mode', () => {
    render(<TouchChrome mode="media" />);
    ['back', 'prev', 'playpause', 'next', 'rew', 'fwd', 'vol-down', 'vol-up'].forEach((id) => {
      expect(screen.getByTestId(`touch-chrome-${id}`)).toBeInTheDocument();
    });
  });

  it('Back emits escape so the interceptor chain still runs', () => {
    render(<TouchChrome mode="media" />);
    fireEvent.click(screen.getByTestId('touch-chrome-back'));
    expect(getActionBus().emit).toHaveBeenCalledWith('escape', {});
  });

  it.each([
    ['playpause', 'media:playback', { command: 'toggle' }],
    ['prev', 'media:playback', { command: 'prev' }],
    ['next', 'media:playback', { command: 'next' }],
    ['rew', 'media:playback', { command: 'rew' }],
    ['fwd', 'media:playback', { command: 'fwd' }],
    ['vol-down', 'display:volume', { command: '-1' }],
    ['vol-up', 'display:volume', { command: '+1' }],
  ])('%s emits %s', (testId, action, payload) => {
    render(<TouchChrome mode="media" />);
    fireEvent.click(screen.getByTestId(`touch-chrome-${testId}`));
    expect(getActionBus().emit).toHaveBeenCalledWith(action, payload);
  });
});
```

`handleVolume` (`ScreenActionHandler.jsx`) only accepts `'+1'`, `'-1'`, and `'mute_toggle'` —
`'up'`/`'down'` fall through to `volume.unknown-command` and do nothing. Use `'+1'`/`'-1'`,
matching the vocabulary the remote's Volume Up/Down already send (`RemoteAdapter.test.js`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/screen-framework/overlays/TouchChrome.test.jsx`
Expected: FAIL — cannot resolve `./TouchChrome.jsx`.

- [ ] **Step 3: Write the component**

Create `frontend/src/screen-framework/overlays/TouchChrome.jsx`:

```jsx
// frontend/src/screen-framework/overlays/TouchChrome.jsx
//
// TouchChrome — on-screen controls for touch-only screens (e.g. the Portal panel).
//
// Touch screens have no remote and no keyboard, and FullyKiosk kioskMode suppresses
// Android's Back button, so without this a user who opens content has no way out.
//
// This component is deliberately presentational: it holds no media state and never
// calls dismissOverlay() directly. Every button emits an existing ActionBus action so
// the established semantics still apply — Back emits `escape`, which runs the whole
// chain (MenuStack's pop-one-level interceptor, then PiP dismiss, then the YAML
// actions.escape fallback). Bypassing that would break menu navigation.
import React, { useMemo, useCallback } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import getLogger from '../../lib/logging/Logger.js';
import './TouchChrome.css';

export function TouchChrome({ mode = 'back' }) {
  const logger = useMemo(() => getLogger().child({ component: 'touch-chrome' }), []);

  const emit = useCallback((action, payload) => {
    logger.debug('touch-chrome.press', { action, ...payload });
    getActionBus().emit(action, payload);
  }, [logger]);

  const showMedia = mode === 'media';

  return (
    <div className="touch-chrome" role="toolbar" aria-label="Screen controls">
      <button
        type="button"
        className="touch-chrome__btn touch-chrome__btn--back"
        data-testid="touch-chrome-back"
        aria-label="Back"
        onClick={() => emit('escape', {})}
      >
        ←
      </button>

      {showMedia && (
        <>
          <div className="touch-chrome__group">
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-prev"
              aria-label="Previous" onClick={() => emit('media:playback', { command: 'prev' })}>⏮</button>
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-playpause"
              aria-label="Play or pause" onClick={() => emit('media:playback', { command: 'toggle' })}>⏯</button>
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-next"
              aria-label="Next" onClick={() => emit('media:playback', { command: 'next' })}>⏭</button>
          </div>

          {/* Direction-only labels: rew/fwd become ArrowLeft/ArrowRight and the Player
              owns the step size, so the control must not promise a duration. */}
          <div className="touch-chrome__group">
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-rew"
              aria-label="Seek backward" onClick={() => emit('media:playback', { command: 'rew' })}>↺</button>
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-fwd"
              aria-label="Seek forward" onClick={() => emit('media:playback', { command: 'fwd' })}>↻</button>
          </div>

          {/* handleVolume (ScreenActionHandler) only accepts '+1' / '-1' / 'mute_toggle' —
              anything else (e.g. 'up'/'down') falls through to volume.unknown-command and
              is silently ignored. Do not "modernise" these back to up/down. */}
          <div className="touch-chrome__group touch-chrome__group--end">
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-vol-down"
              aria-label="Volume down" onClick={() => emit('display:volume', { command: '-1' })}>–</button>
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-vol-up"
              aria-label="Volume up" onClick={() => emit('display:volume', { command: '+1' })}>+</button>
          </div>
        </>
      )}
    </div>
  );
}

export default TouchChrome;
```

`handleVolume` (`ScreenActionHandler.jsx`) only accepts `'+1'`, `'-1'`, and `'mute_toggle'` —
`'up'`/`'down'` fall through to `volume.unknown-command` and do nothing.

- [ ] **Step 4: Write the stylesheet**

Create `frontend/src/screen-framework/overlays/TouchChrome.css`:

```css
/* TouchChrome — the reserved control lane for touch-only screens.
   The lane sits BESIDE content, not over it, so it never occludes the picture.
   translateZ(0) is defensive: a playing <video> GPU-promotes above sibling
   elements and can cover controls that lack their own compositing layer. */
.touch-chrome {
  flex: 0 0 auto;
  height: 80px;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0 1.5rem;
  background: #101014;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  transform: translateZ(0);
  user-select: none;
}

.touch-chrome__group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Pushes volume to the far edge, away from Back, so a mis-tap can't exit. */
.touch-chrome__group--end {
  margin-left: auto;
}

.touch-chrome__btn {
  min-width: 64px;
  height: 64px;
  padding: 0 1rem;
  font-size: 1.75rem;
  line-height: 1;
  color: #e8e8ea;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  cursor: pointer;
  /* No transition: kiosk WebViews drop frames animating many elements at once. */
}

.touch-chrome__btn:active {
  background: rgba(255, 255, 255, 0.22);
}

.touch-chrome__btn--back {
  min-width: 88px;
  background: rgba(255, 255, 255, 0.14);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/src/screen-framework/overlays/TouchChrome.test.jsx`
Expected: PASS, 10 tests (3 + 7 parameterised).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/overlays/TouchChrome.jsx \
        frontend/src/screen-framework/overlays/TouchChrome.css \
        frontend/src/screen-framework/overlays/TouchChrome.test.jsx
git commit -m "feat(screens): add TouchChrome control lane for touch-only screens"
```

---

## Task 4: Wire the lane into ScreenOverlayProvider

**Files:**
- Modify: `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx`
- Test: `frontend/src/screen-framework/overlays/ScreenOverlayProvider.touch.test.jsx` (create)

**Interfaces:**
- Consumes: `TouchChrome` from Task 3.
- Produces: `<ScreenOverlayProvider inputType="touch">`; `showOverlay(Component, props, { chrome: 'media' })`.
  When `inputType === 'touch'`, the fullscreen overlay renders inside
  `<div className="screen-overlay--touch-shell">` containing
  `<div className="screen-overlay--touch-content">` plus `<TouchChrome mode={…} />`.
  `chrome` defaults to `'back'`. When `inputType !== 'touch'`, the DOM is unchanged.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/screen-framework/overlays/ScreenOverlayProvider.touch.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ScreenOverlayProvider, useScreenOverlay } from './ScreenOverlayProvider.jsx';

function Dummy() { return <div data-testid="dummy">content</div>; }

// Exposes showOverlay to the test without needing a real screen.
let api;
function Harness() {
  api = useScreenOverlay();
  return null;
}

function renderWith(inputType) {
  return render(
    <ScreenOverlayProvider inputType={inputType}>
      <Harness />
    </ScreenOverlayProvider>
  );
}

describe('ScreenOverlayProvider touch chrome', () => {
  it('renders no chrome when input is not touch', () => {
    renderWith('remote');
    act(() => { api.showOverlay(Dummy, {}, { chrome: 'media' }); });
    expect(screen.getByTestId('dummy')).toBeInTheDocument();
    expect(screen.queryByTestId('touch-chrome-back')).toBeNull();
  });

  it('renders Back-only chrome by default on a touch screen', () => {
    renderWith('touch');
    act(() => { api.showOverlay(Dummy, {}); });
    expect(screen.getByTestId('touch-chrome-back')).toBeInTheDocument();
    expect(screen.queryByTestId('touch-chrome-playpause')).toBeNull();
  });

  it('renders media chrome when the overlay declares it', () => {
    renderWith('touch');
    act(() => { api.showOverlay(Dummy, {}, { chrome: 'media' }); });
    expect(screen.getByTestId('touch-chrome-playpause')).toBeInTheDocument();
  });

  it('renders no chrome when there is no overlay', () => {
    renderWith('touch');
    expect(screen.queryByTestId('touch-chrome-back')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/screen-framework/overlays/ScreenOverlayProvider.touch.test.jsx`
Expected: FAIL — chrome never renders because the provider ignores `inputType`.

- [ ] **Step 3: Implement**

In `ScreenOverlayProvider.jsx`:

Add the import beside the existing ones:

```javascript
import TouchChrome from './TouchChrome.jsx';
```

Change the signature:

```javascript
export function ScreenOverlayProvider({ children, inputType = null }) {
```

In `showOverlay`, capture the new option and store it on the fullscreen record:

```javascript
  const showOverlay = useCallback((Component, props = {}, options = {}) => {
    const { mode = 'fullscreen', position = 'top-right', priority, timeout = 3000, chrome = 'back' } = options;

    if (mode === 'fullscreen') {
      setFullscreen((current) => {
        if (current && priority !== 'high') {
          return current;
        }
        return { Component, props, priority, chrome };
      });
    } else if (mode === 'pip') {
```

Replace the fullscreen render block:

```jsx
      {fullscreen && (
        inputType === 'touch' ? (
          // Touch screens get a reserved control lane rather than an overlaid one:
          // the content box shrinks so chrome never occludes the picture, and the
          // controls are always visible (no hidden affordance to hunt for).
          <div className="screen-overlay--fullscreen screen-overlay--touch-shell">
            <div className="screen-overlay--touch-content">
              <fullscreen.Component {...fullscreen.props} dismiss={() => dismissOverlay('fullscreen')} />
            </div>
            <TouchChrome mode={fullscreen.chrome || 'back'} />
          </div>
        ) : (
          <div className="screen-overlay--fullscreen">
            <fullscreen.Component {...fullscreen.props} dismiss={() => dismissOverlay('fullscreen')} />
          </div>
        )
      )}
```

Append to `ScreenOverlayProvider.css`:

```css
/* Touch shell: column layout so TouchChrome's fixed-height lane reserves space and
   the content box takes the remainder (1280x800 panel -> 720px content + 80px lane). */
.screen-overlay--touch-shell {
  display: flex;
  flex-direction: column;
}

.screen-overlay--touch-content {
  flex: 1 1 auto;
  min-height: 0; /* lets the content box actually shrink inside the flex column */
  position: relative;
  overflow: hidden;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/screen-framework/overlays/`
Expected: PASS — Task 3's 10 tests plus these 4.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/overlays/
git commit -m "feat(screens): reserve a touch chrome lane in ScreenOverlayProvider"
```

---

## Task 5: Declare media chrome on Player mounts and pass inputType

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` (4 `showOverlay(Player, …)` call sites)
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx:396`

**Interfaces:**
- Consumes: the `chrome` option and `inputType` prop from Task 4.
- Produces: no new exports.

- [ ] **Step 1: Pass inputType to the provider**

In `ScreenRenderer.jsx`, line 396, change:

```jsx
              <ScreenOverlayProvider>
```

to:

```jsx
              <ScreenOverlayProvider inputType={config.input?.type}>
```

- [ ] **Step 2: Declare media chrome on every Player mount**

There are five `showOverlay(Player, …)` call sites. Make each edit exactly as shown.

**2a — `handleMediaPlay`, line 154-157:**

```javascript
    showOverlay(Player, {
      play: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    }, { chrome: 'media' });
```

**2b — `handleMediaQueue`, line 163-166:**

```javascript
    showOverlay(Player, {
      queue: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    }, { chrome: 'media' });
```

**2c — `handleMediaQueueOp`, line 188-191:**

```javascript
      showOverlay(Player, {
        queue: { contentId: payload.contentId, ...payload },
        clear: () => dismissOverlay(),
      }, { chrome: 'media' });
```

**2d and 2e — the two idle-secondary fallbacks in `handleMediaPlayback`, lines 215 and 217:**

```javascript
        showOverlay(Player, { queue: { contentId: secPayload.contentId }, clear: () => dismissOverlay() }, { chrome: 'media' });
      } else if (action === 'media:play') {
        showOverlay(Player, { play: secPayload.contentId, clear: () => dismissOverlay() }, { chrome: 'media' });
```

Leave the `MenuStack` mount on line 219 and the `AppContainer` mount on line 113
untouched — they correctly default to `chrome: 'back'`. Note line 133's MenuStack mount
already passes `{ priority: 'high' }`; do not add `chrome` to it.

- [ ] **Step 3: Verify no Player mount was missed**

```bash
grep -n "showOverlay(Player" frontend/src/screen-framework/actions/ScreenActionHandler.jsx | grep -v "chrome: 'media'"
```

Expected: no output. Multi-line call sites will not match on one line — inspect those
manually to confirm each ends with `, { chrome: 'media' })`.

- [ ] **Step 4: Run the screen-framework suite**

```bash
npx vitest run frontend/src/screen-framework/ >/dev/null 2>&1; echo "exit: $?"
```

Expected: `0`, with no regression against the baseline recorded at the start.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx \
        frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(screens): declare media chrome on Player mounts; pass inputType"
```

---

## Task 6: Give the Portal a software volume master

**Files:**
- Modify: `data/household/screens/portal.yml` (data volume — NOT in git)

**Interfaces:**
- Consumes: nothing. Produces: a working `display:volume` path for Task 3's volume buttons.

**Why:** `volume.fixed: true` disables `setMaster`/`step`/`toggleMute`, so the chrome's
volume buttons would render but do nothing.

- [ ] **Step 1: Replace the volume block**

```bash
sudo docker exec daylight-station node -e "
const fs=require('fs');
const p='data/household/screens/portal.yml';
let s=fs.readFileSync(p,'utf8');
const next = \`# Per-screen volume
# The Portal has built-in speakers and the touch chrome exposes discrete volume
# buttons, so the software master must be steppable — \\\`fixed: true\\\` would disable
# setMaster/step/toggleMute and leave those buttons inert. The knee at 0.5 -> 0.1
# mirrors office.yml: the lower half shapes the quiet 0-10% band, the upper half
# the audible 10-100% band.
volume:
  defaultMaster: 0.6
  stepSize: 0.1
  curve:
    - { in: 0,   out: 0 }
    - { in: 0.5, out: 0.1 }
    - { in: 1,   out: 1 }
\`;
s = s.replace(/# Per-screen volume[\s\S]*\$/, next);
fs.writeFileSync(p, s);
" && sudo docker exec daylight-station chown node:node data/household/screens/portal.yml
```

- [ ] **Step 2: Verify it parses and the old key is gone**

```bash
sudo docker exec daylight-station node -e "
const y=require('js-yaml'),fs=require('fs');
const s=y.load(fs.readFileSync('data/household/screens/portal.yml','utf8'));
console.log('volume:', JSON.stringify(s.volume));
console.log('fixed removed?', s.volume.fixed === undefined);
console.log('screen still parses:', s.screen === 'portal');
"
```

Expected: `fixed removed? true`, `screen still parses: true`, and a `curve` array of 3 points.

- [ ] **Step 3: Confirm the API serves it**

```bash
curl -s localhost:3111/api/v1/screens/portal | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('volume:',JSON.stringify(j.volume))})"
```

Expected: the new block. The screens router reads YAML per request, so no restart is needed.

No commit — this file is not in git.

---

## Task 7: Deploy and verify on the device

**Files:** none modified.

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Full test sweep**

```bash
npx vitest run tests/isolated/application/devices/ frontend/src/screen-framework/ >/dev/null 2>&1; echo "vitest exit: $?"
node --test backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs >/dev/null 2>&1; echo "node:test exit: $?"
```

Expected: both `0`. Do not proceed otherwise.

- [ ] **Step 2: Deploy gate — run as its own step and STOP if it trips**

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Clear means: `0` render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`.
**If either gate is active, halt and wait.** Do not chain this into the build.

- [ ] **Step 3: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Confirm the deployed image matches HEAD**

```bash
sudo docker exec daylight-station sh -c 'cat /build.txt'
git rev-parse --short HEAD
```

Expected: the `Commit:` line equals `HEAD`. A mismatch means a stale layer — rebuild with
`--no-cache`.

- [ ] **Step 5: Verify the cast fix end-to-end**

```bash
curl -s -m 90 "localhost:3111/api/v1/device/portal/load?plex=620669" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(JSON.stringify({ok:j.ok,failedStep:j.failedStep,error:j.error,power:j.steps?.power,verify:j.steps?.verify},null,1))})"
```

Expected: `ok: true`, no `failedStep`, `power: {ok:true, skipped:'no_device_control'}`,
`verify: {ready:true, skipped:'no_sensor'}`.

- [ ] **Step 6: Reload the Portal and verify the chrome**

```bash
export FKB_HOST=10.0.0.92:2323
export FKB_PW="$(node -e "const fs=require('fs');console.log((fs.readFileSync('/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/auth/fullykiosk.yml','utf8').match(/password:\s*[\"']?(.+?)[\"']?\s*$/m))[1]);")"
node cli/fkb.cli.mjs reload
sleep 12
node cli/fkb.cli.mjs shot /tmp/portal-chrome.png
```

Then read `/tmp/portal-chrome.png` and confirm: the menu renders, and after launching
content the 80px lane appears at the bottom with Back plus transport controls.

- [ ] **Step 7: Confirm non-touch screens are unaffected**

```bash
curl -s localhost:3111/api/v1/screens/living-room | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('living-room input type:', j.input?.type)})"
```

Expected: `remote`. Combined with the Task 4 test asserting no chrome renders for
non-touch `inputType`, this confirms living-room and office are untouched.

---

## Self-Review Notes

**Spec coverage:** every section of
`docs/superpowers/specs/2026-07-20-portal-touch-chrome-design.md` maps to a task —
components → Tasks 3-5, action mapping → Task 3, layout → Tasks 3-4, config change →
Task 6, testing → Tasks 3-5, deployment note → Task 7. The backend cast fix (Tasks 1-2)
is additional scope agreed after the spec was written.

**Deviation from the spec:** the spec's action table did not anticipate that skipping the
power step alone leaves the verify step failing. Task 1 therefore changes two places in
`WakeAndLoadService`, not one. The spec's frontend design is unchanged.

**Known side effects, accepted:**
- `yellow-room-tablet` also becomes castable. Its FKB is governed by
  `PianoScreenAuthorityService`; a cast may contend with the screen-off policy.
- Fleet-only entries (`garage-tv`, `speaker-*`) previously failed fast at the power step
  and will now proceed to the websocket-fallback branch
  (`WakeAndLoadService.mjs:557-614`), returning `ok: true`. Whether the receiving kiosk
  honours that envelope is untested. If a false success is unacceptable, gate dispatch on
  `content_control` presence — out of scope here, flag it if observed.
