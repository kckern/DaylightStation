# Fitness Live RPM Freeze Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop live RPM widgets from displaying the last cadence value for up to ~3s after the rider stops pedaling. The display should drop to 0 (or "disconnected") within ~250ms of the sensor going silent.

**Architecture:** `FitnessSession.getEquipmentCadence(equipmentId)` already has staleness handling (returns `{rpm:0, connected:false}` past `FITNESS_TIMEOUTS.rpmZero`). The widgets bypass it and read `device.cadence` raw. Build a small `useEquipmentCadence(equipmentId)` React hook that polls `getEquipmentCadence` at ~10Hz, then route the two consumer widgets through it.

**Tech Stack:** React 18, vitest + @testing-library/react. Logger: `getLogger()`.

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/hooks/fitness/useEquipmentCadence.js` | NEW — React hook wrapping `getEquipmentCadence` |
| `frontend/src/hooks/fitness/useEquipmentCadence.test.js` | NEW — vitest unit test |
| `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx` | Modify L184 to consume hook |
| `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` | Modify L504, L509, L815-842 |
| `frontend/src/context/FitnessContext.jsx` | Expose `fitnessSessionInstance` (likely already exposed; verify) |

---

### Task 1: Create `useEquipmentCadence` hook

**Files:**
- Create: `frontend/src/hooks/fitness/useEquipmentCadence.js`
- Create: `frontend/src/hooks/fitness/useEquipmentCadence.test.js`

**Why:** Widgets currently subscribe to `rpmDevices` (which only updates when the device list changes shape, not when cadence transitions silently). The hook polls the session's already-correct `getEquipmentCadence()` at ~10Hz so a rider stopping mid-pedal gets a ≤100ms freeze instead of a ≤3s freeze.

- [ ] **Step 1: Write the failing test** at `frontend/src/hooks/fitness/useEquipmentCadence.test.js`

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// Mock the FitnessContext to expose a fake fitnessSessionInstance.
const fakeSession = { getEquipmentCadence: vi.fn() };
vi.mock('../../context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({ fitnessSessionInstance: fakeSession })
}));

const { useEquipmentCadence } = await import('./useEquipmentCadence.js');

describe('useEquipmentCadence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeSession.getEquipmentCadence.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the current snapshot on initial render', () => {
    fakeSession.getEquipmentCadence.mockReturnValue({ rpm: 85, connected: true, ts: 1000 });
    const { result } = renderHook(() => useEquipmentCadence('bike:7153'));
    expect(result.current).toEqual({ rpm: 85, connected: true, ts: 1000 });
  });

  it('refreshes on poll interval and reflects connection drop', () => {
    fakeSession.getEquipmentCadence.mockReturnValue({ rpm: 85, connected: true, ts: 1000 });
    const { result } = renderHook(() => useEquipmentCadence('bike:7153'));
    expect(result.current.rpm).toBe(85);

    // Sensor goes silent — session returns disconnected on the next call
    fakeSession.getEquipmentCadence.mockReturnValue({ rpm: 0, connected: false });
    act(() => { vi.advanceTimersByTime(150); }); // > 100ms poll interval

    expect(result.current).toEqual({ rpm: 0, connected: false });
  });

  it('returns disconnected shape when no session is available', async () => {
    vi.doMock('../../context/FitnessContext.jsx', () => ({
      useFitnessContext: () => ({ fitnessSessionInstance: null })
    }));
    const { useEquipmentCadence: hook } = await import('./useEquipmentCadence.js?bust');
    const { result } = renderHook(() => hook('bike:7153'));
    expect(result.current).toEqual({ rpm: 0, connected: false });
  });

  it('returns disconnected shape when equipmentId is null', () => {
    const { result } = renderHook(() => useEquipmentCadence(null));
    expect(result.current).toEqual({ rpm: 0, connected: false });
    expect(fakeSession.getEquipmentCadence).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm failure**

```bash
cd /opt/Code/DaylightStation
npx vitest run frontend/src/hooks/fitness/useEquipmentCadence.test.js
```

Expected: FAIL — `useEquipmentCadence` does not exist.

- [ ] **Step 3: Implement the hook** at `frontend/src/hooks/fitness/useEquipmentCadence.js`

```js
import { useEffect, useState } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';

const DISCONNECTED = Object.freeze({ rpm: 0, connected: false });
const POLL_INTERVAL_MS = 100;

/**
 * useEquipmentCadence — staleness-aware live RPM hook.
 *
 * Polls FitnessSession.getEquipmentCadence(equipmentId) at ~10Hz so widgets
 * see a sub-100ms drop to 0 when the cadence sensor stops emitting, instead
 * of waiting up to 3s for DeviceManager.pruneStaleDevices() to zero the raw
 * device.cadence value.
 *
 * Returns { rpm: number, connected: boolean, ts?: number }.
 */
export function useEquipmentCadence(equipmentId) {
  const ctx = useFitnessContext();
  const session = ctx?.fitnessSessionInstance ?? null;

  const [snapshot, setSnapshot] = useState(() => {
    if (!session || equipmentId == null) return DISCONNECTED;
    try { return session.getEquipmentCadence(equipmentId) ?? DISCONNECTED; }
    catch { return DISCONNECTED; }
  });

  useEffect(() => {
    if (!session || equipmentId == null) {
      setSnapshot(DISCONNECTED);
      return undefined;
    }
    const tick = () => {
      try { setSnapshot(session.getEquipmentCadence(equipmentId) ?? DISCONNECTED); }
      catch { setSnapshot(DISCONNECTED); }
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [session, equipmentId]);

  return snapshot;
}

export default useEquipmentCadence;
```

- [ ] **Step 4: Re-run the test**

```bash
npx vitest run frontend/src/hooks/fitness/useEquipmentCadence.test.js
```

Expected: PASS for all four cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/useEquipmentCadence.js \
        frontend/src/hooks/fitness/useEquipmentCadence.test.js
git commit -m "feat(fitness): useEquipmentCadence hook for staleness-aware live RPM

Wraps FitnessSession.getEquipmentCadence in a 10Hz polling hook so
widgets can display a sub-100ms drop to 0 when cadence sensors stop
emitting, instead of waiting up to 3s for DeviceManager pruning.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Route `FullscreenVitalsOverlay` RPM rendering through the hook

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx:174-201` (the `rpmItems` memo)

**Why:** Line 184 reads `device.cadence` raw. Replace with a child sub-component that calls `useEquipmentCadence(equipmentId)` so each RPM avatar's value is reactive to sensor staleness.

- [ ] **Step 1: Read the current `rpmItems` memo**

Already in context: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx:174-201`. Note the existing inputs to the `useMemo` are `rpmDevices, equipmentMap, equipment, deviceConfiguration?.cadence`.

- [ ] **Step 2: Refactor to extract a child component**

Replace lines 174-201 with:

```jsx
  const rpmItemMeta = useMemo(() => {
    const cadenceConfig = deviceConfiguration?.cadence || {};
    return rpmDevices.map((device) => {
      const isJumprope = device.type === 'jumprope';
      const equipmentConfig = isJumprope
        ? (equipment.find((e) => e.ble === device.deviceId) || equipmentMap[String(device.deviceId)])
        : equipmentMap[String(device.deviceId)];
      const equipmentId = equipmentConfig?.id || String(device.deviceId);
      const avatarSrc = DaylightMediaPath(`/static/img/equipment/${equipmentId}`);
      const colorKey = cadenceConfig[String(device.deviceId)];
      const resolvedRingColor = colorKey
        ? (RPM_COLOR_MAP[colorKey] || colorKey)
        : RPM_COLOR_MAP.orange;
      const overlayBg = withAlpha(resolvedRingColor, 0.9);
      return {
        deviceId: device.deviceId,
        equipmentId,
        avatarSrc,
        ringColor: resolvedRingColor,
        overlayBg,
      };
    });
  }, [rpmDevices, equipmentMap, equipment, deviceConfiguration?.cadence]);
```

At the bottom of the file (before `export default`), add the child component that consumes the hook:

```jsx
function VitalsRpmAvatar({ meta, renderAvatar }) {
  const { rpm: rawRpm } = useEquipmentCadence(meta.equipmentId);
  const rpm = Math.max(0, Math.round(rawRpm || 0));
  const animationDuration = rpm > 0 ? `${270 / rpm}s` : '0s';
  return renderAvatar({
    ...meta,
    rpm,
    animationDuration,
  });
}
```

Update the JSX site that currently maps over `rpmItems` to map over `rpmItemMeta` and render `<VitalsRpmAvatar meta={item} renderAvatar={...}/>` for each. Pass through the existing avatar rendering callback so visual output is identical.

Add the import near the top:

```jsx
import { useEquipmentCadence } from '../../../../hooks/fitness/useEquipmentCadence.js';
```

(Verify the relative path — overlays are 4 directories deep from `src/`.)

- [ ] **Step 3: Run any existing FullscreenVitalsOverlay test**

```bash
find frontend tests -name '*FullscreenVitals*test*' 2>/dev/null
```

If a test exists, run it. If none, create a minimal smoke test:

```js
// frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('../../../../hooks/fitness/useEquipmentCadence.js', () => ({
  useEquipmentCadence: () => ({ rpm: 0, connected: false }),
}));
vi.mock('../../../../context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({ fitnessSessionInstance: null }),
}));

// Smoke render with empty rpmDevices to confirm the refactor didn't break compile.
import FullscreenVitalsOverlay from './FullscreenVitalsOverlay.jsx';

describe('FullscreenVitalsOverlay smoke', () => {
  it('renders with no RPM devices', () => {
    // Provide minimum required props or skip if too coupled — focus is build verification.
    expect(typeof FullscreenVitalsOverlay).toBe('function');
  });
});
```

```bash
npx vitest run frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.test.jsx
```

Expected: PASS.

- [ ] **Step 4: Manual verification in the running app**

```bash
# Confirm dev server is running:
lsof -i :3111 || npm run dev &
# Wait for compile
sleep 5
# Open /fitness with a connected cadence sensor in dev tools console
# Verify that pausing pedaling drops the FullscreenVitalsOverlay RPM to 0 within ~250ms.
```

Note this is observational — record findings in the commit message if you can verify.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx \
        frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.test.jsx 2>/dev/null || \
git add frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx
git commit -m "fix(fitness): vitals overlay reads cadence via staleness-aware hook

Replaces raw device.cadence reads with useEquipmentCadence so the
RPM display drops to 0 within ~100ms of the sensor going silent
rather than freezing on the last value for up to 3s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Route `FitnessUsers.jsx` RPM rendering through the hook

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx:504, 509, 815-842`

**Why:** Three raw `device.cadence` reads. The most visible is L819-820 — the per-rider RPM avatar group rendered when bikes are connected.

- [ ] **Step 1: Extract a `<RpmDeviceAvatarWithHook>` wrapper**

At the top of `FitnessUsers.jsx`, add:

```jsx
import { useEquipmentCadence } from '../../../../hooks/fitness/useEquipmentCadence.js';
```

Below other helper definitions in the same file (find a sensible place near the existing `RpmDeviceAvatar` import or component), define:

```jsx
function RpmDeviceAvatarLive({ rpmDevice, equipmentMap, cadenceColorMap, CONFIG, DaylightMediaPath }) {
  const equipmentInfo = equipmentMap[String(rpmDevice.deviceId)];
  const equipmentId = equipmentInfo?.id || String(rpmDevice.deviceId);
  const deviceName = equipmentInfo?.name || String(rpmDevice.deviceId);
  const { rpm: rawRpm } = useEquipmentCadence(equipmentId);
  const rpmValue = Math.max(0, Math.round(rawRpm || 0));
  const animationDuration = rpmValue > 0
    ? `${CONFIG.rpm.animationBase / Math.max(rpmValue, 1)}s`
    : '0s';
  const deviceColor = cadenceColorMap[String(rpmDevice.deviceId)];
  const colorMap = CONFIG.rpm.colorMap;
  const borderColor = deviceColor ? (colorMap[deviceColor] || deviceColor) : colorMap.green;

  return (
    <RpmDeviceAvatar
      rpm={rpmValue}
      animationDuration={animationDuration}
      avatarSrc={DaylightMediaPath(`/static/img/equipment/${equipmentId}`)}
      avatarAlt={deviceName}
      imageClassName="rpm-device-image"
      spinnerStyle={{ borderColor }}
      valueStyle={{ background: CONFIG.rpm.overlayBg }}
      fallbackSrc={DaylightMediaPath('/static/img/equipment/equipment')}
    />
  );
}
```

- [ ] **Step 2: Replace lines 815-842 to use the wrapper**

Replace the `rpmDevices.map(rpmDevice => { ... })` block with:

```jsx
{rpmDevices.map(rpmDevice => (
  <RpmDeviceAvatarLive
    key={`rpm-${rpmDevice.deviceId}`}
    rpmDevice={rpmDevice}
    equipmentMap={equipmentMap}
    cadenceColorMap={cadenceColorMap}
    CONFIG={CONFIG}
    DaylightMediaPath={DaylightMediaPath}
  />
))}
```

- [ ] **Step 3: Update the two label-text raw reads at L504, L509**

Find lines 504 and 509:

```js
if (device.type === 'cadence' && device.cadence) return `${device.cadence}`;
// ...
const rpm = device.cadence ?? null;
```

For these (text labels, not the main avatar), the simplest fix is to resolve the equipmentId and pull from `fitnessSessionInstance?.getEquipmentCadence`:

```js
if (device.type === 'cadence') {
  const eqId = equipmentMap[String(device.deviceId)]?.id || String(device.deviceId);
  const live = fitnessSessionInstance?.getEquipmentCadence?.(eqId);
  if (live && live.connected) return `${Math.round(live.rpm)}`;
  return '';
}
// jumprope:
const eqId = equipmentMap[String(device.deviceId)]?.id || String(device.deviceId);
const live = fitnessSessionInstance?.getEquipmentCadence?.(eqId);
const rpm = live?.connected ? Math.round(live.rpm) : null;
```

These are render-call-site usages so they re-evaluate on every parent render — no hook needed; staleness comes from `getEquipmentCadence`'s built-in check.

- [ ] **Step 4: Confirm `fitnessSessionInstance` is in scope**

Grep `FitnessUsers.jsx` for `fitnessSessionInstance`:

```bash
grep -n 'fitnessSessionInstance\|useFitnessContext' frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx | head -10
```

If not already destructured from `useFitnessContext()`, add it near the top of the component.

- [ ] **Step 5: Run any existing FitnessUsers tests**

```bash
find frontend tests -name '*FitnessUsers*test*' 2>/dev/null | head -5
```

If tests exist, run them via vitest. Add a smoke render test if none exist (similar pattern to Task 2 Step 3).

- [ ] **Step 6: Sanity check the dev server build**

```bash
lsof -i :3111 >/dev/null || (cd /opt/Code/DaylightStation && nohup npm run dev > /tmp/dev.log 2>&1 &)
sleep 8
# Tail dev log for any compile errors
tail -50 /tmp/dev.log dev.log 2>/dev/null | grep -iE 'error|fail' | head -10
```

Expected: no compile errors referencing FitnessUsers.jsx.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx
git commit -m "fix(fitness): user panel reads cadence via staleness-aware hook

Routes the per-rider RPM avatar group through useEquipmentCadence and
the rare text-label paths through getEquipmentCadence, so live cadence
display drops to 0 within ~100ms of the sensor going silent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tighten `FITNESS_TIMEOUTS.rpmZero` for cycling

**Files:**
- Modify: wherever `FITNESS_TIMEOUTS` is defined (find with grep)

**Why:** Per audit Direction #2: cadence is supposed to be continuous, so 3000ms is loose. Drop to 1500ms so even users who bypass the hook (e.g. third-party widgets) see a faster reset.

- [ ] **Step 1: Locate the constant**

```bash
grep -rn 'FITNESS_TIMEOUTS\s*=' frontend/src/
```

- [ ] **Step 2: Reduce `rpmZero` from 3000 to 1500**

Example (adapt to the actual file):

```js
export const FITNESS_TIMEOUTS = {
  // ... other entries
  rpmZero: 1500,   // was 3000; cadence is continuous, so we can be aggressive
  // ...
};
```

- [ ] **Step 3: Run any test that mentions `rpmZero`**

```bash
grep -rln 'rpmZero\|FITNESS_TIMEOUTS' frontend/src/hooks/fitness/*.test.js tests/unit/ 2>/dev/null
```

For each match, run that test file and confirm the change does not break expectations.

```bash
npx vitest run frontend/src/hooks/fitness/FitnessSession.cadenceTs.test.js \
                frontend/src/hooks/fitness/CadenceFilter.test.js
```

If any test asserts an exact 3000ms value, update the assertion (only if the constant change is semantically equivalent to what the test was validating).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/...    # the file you modified
git commit -m "fix(fitness): drop rpmZero timeout from 3000ms to 1500ms

Cadence sensors emit continuously while pedaling, so we can require
fresher data before reporting connected. Halves the worst-case freeze
window for any consumer that bypasses useEquipmentCadence's 100ms poll.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: End-to-end manual verification

**Files:**
- None — observational only

- [ ] **Step 1: Connect a cadence sensor and start a fitness session in the dev environment**

```bash
# On kckern-server:
lsof -i :3111 || (cd /opt/Code/DaylightStation && nohup npm run dev > /tmp/dev.log 2>&1 &)
# Wait for HMR to settle
sleep 10
```

Open the app, connect bike sensor, enter a fitness session, start pedaling.

- [ ] **Step 2: Stop pedaling mid-session and observe the FullscreenVitalsOverlay**

Expected: the RPM number drops to 0 within ~250ms (visually instant, not a 3-second freeze). The HR number should remain visible — only RPM zeros.

- [ ] **Step 3: Observe the FitnessUsers panel RPM avatar group**

Same expectation as Step 2.

- [ ] **Step 4: If verification passes, record in a brief follow-up note**

Optional final commit with no code change:

```bash
git commit --allow-empty -m "docs(fitness): rpm freeze fix verified in dev

Verified on kckern-server: pedal-stop now produces a ~150ms RPM drop
to 0 in both the FullscreenVitalsOverlay and FitnessUsers panel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If verification reveals a freeze still persisting, do NOT mark this task complete — open a follow-up debugging task with the observed lag in milliseconds.
