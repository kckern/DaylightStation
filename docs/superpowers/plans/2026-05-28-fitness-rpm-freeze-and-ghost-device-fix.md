# Fitness RPM Cadence Freeze and Post-Session Ghost Device Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two confirmed defects in fitness device tracking: (1) RPM avatars freeze at the last broadcast value for 60-120s after a rider stops pedaling, and (2) ANT+ devices that register after a session ends are never pruned and accumulate indefinitely.

**Architecture:** Two surgical changes, each in a single function.

1. **Bug 1** — `frontend/src/hooks/fitness/DeviceManager.js` (`Device.update`): the `hasXxx` significance checks currently read from the **post-merge persisted state** (`this.cadence > 0`). That perpetuates `lastSignificantActivity` indefinitely whenever any non-cadence ANT+ frame (battery, manufacturer, common pages) arrives. Fix: read from the **incoming payload** (`data.cadence > 0`) so the bump tracks fresh activity, not stale memory.

2. **Bug 2** — `frontend/src/context/FitnessContext.jsx` (prune `useEffect`): the 3-second device-sweep interval is gated by `currentSessionId`. When the session ends, the interval is torn down and any subsequently-registered device persists forever. Fix: run the sweep unconditionally while `FitnessProvider` is mounted.

The full root-cause analysis is in `docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md`.

**Tech Stack:**
- React (FitnessProvider context, `useEffect`)
- Plain ES6 class (`Device`, `DeviceManager`)
- Vitest (test framework) — config at `vitest.config.mjs`, run via `frontend/node_modules/.bin/vitest run --config vitest.config.mjs <file>`
- Structured logger at `frontend/src/lib/logging/Logger.js`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/hooks/fitness/DeviceManager.js` | Modify | `Device.update()` — change significance check to read incoming payload, not persisted state. Remove existing diagnostic instrumentation. |
| `frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js` | Create | Vitest regression tests for Bug 1 — `Device.update` and end-to-end through `pruneStaleDevices`. |
| `frontend/src/context/FitnessContext.jsx` | Modify | Prune `useEffect` (lines ~1284-1296) — remove `currentSessionId` gate, run prune unconditionally. |
| `docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md` | Modify | Update status to "Fixed" with commit hash. |

---

## Pre-Flight: Current State of the Code

Before starting, here is exactly what `Device.update()` looks like today (`DeviceManager.js:57-87`):

```js
update(data = {}) {
  if (data.name) this.name = data.name;
  if (data.type) this.type = data.type;
  if (data.profile) this.profile = data.profile;
  
  if (Number.isFinite(data.batteryLevel)) this.batteryLevel = data.batteryLevel;
  if (typeof data.isCharging === 'boolean') this.isCharging = data.isCharging;
  if (data.lastSeen) this.lastSeen = data.lastSeen;
  if (data.connectionState) this.connectionState = data.connectionState;
  
  if (Number.isFinite(data.heartRate)) this.heartRate = data.heartRate;
  if (Number.isFinite(data.cadence)) this.cadence = data.cadence;
  if (Number.isFinite(data.power)) this.power = data.power;
  if (Number.isFinite(data.speed)) this.speed = data.speed;
  if (Number.isFinite(data.distance)) this.distance = data.distance;
  if (Number.isFinite(data.revolutionCount)) this.revolutionCount = data.revolutionCount;
  if (data.timestamp) this.timestamp = data.timestamp;

  // Check for significant activity to reset inactivity flags
  const hasHeartRate = Number.isFinite(this.heartRate) && this.heartRate > 0;
  const hasCadence = Number.isFinite(this.cadence) && this.cadence > 0;
  const hasPower = Number.isFinite(this.power) && this.power > 0;
  const hasSpeed = Number.isFinite(this.speed) && this.speed > 0;
  
  if (hasHeartRate || hasCadence || hasPower || hasSpeed) {
    this.lastSignificantActivity = Date.now();
    this.inactiveSince = null;
    this.removalAt = null;
    this.removalCountdown = null;
  }
}
```

**Note:** A temporary diagnostic log (`device.update.stale_cadence_bump`) was added on the parent session's working tree to confirm the bug. That instrumentation is **NOT** in this worktree branch — this plan operates from the clean baseline above. The "remove instrumentation" sub-step in Task 2 can therefore be skipped.

Current FitnessContext prune useEffect (`FitnessContext.jsx:1284-1296`):

```js
// MEMORY LEAK FIX: Only prune devices when session is active
const currentSessionId = fitnessSessionRef.current?.sessionId;
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!currentSessionId) return;

  const interval = setInterval(() => {
    const timeouts = getFitnessTimeouts();
    session.deviceManager.pruneStaleDevices(timeouts);
    batchedForceUpdate();
  }, 3000);
  return () => clearInterval(interval);
}, [batchedForceUpdate, currentSessionId]);
```

---

## Task 1: Write Failing Tests for Bug 1 (RPM Freeze)

**Files:**
- Create: `frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js`

- [ ] **Step 1: Write the failing test file**

```js
/**
 * Regression tests for Bug 1 (RPM cadence freeze).
 *
 * Bug: Device.update() bumps `lastSignificantActivity` based on POST-MERGE
 * persisted state (`this.cadence > 0`) rather than the incoming payload's
 * significance. ANT+ sensors broadcast non-cadence pages (battery,
 * manufacturer, common pages) for 60-120s after pedaling stops. Each such
 * frame preserves the stale `device.cadence` AND refreshes
 * `lastSignificantActivity`, so the 3-second rpmZero reset in
 * `pruneStaleDevices` never trips. The displayed RPM stays frozen at the
 * last broadcast value.
 *
 * Fix: significance must be derived from the incoming `data` payload, not
 * from the device's persisted state.
 *
 * See: docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Device, DeviceManager } from './DeviceManager.js';

describe('Device.update — lastSignificantActivity tracks payload, not persisted state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('bumps lastSignificantActivity when payload carries cadence > 0', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const device = new Device({ id: 'bike-1', type: 'cadence' });

    device.update({ cadence: 55, lastSeen: t0 });

    expect(device.cadence).toBe(55);
    expect(device.lastSignificantActivity).toBe(t0);
  });

  it('does NOT bump lastSignificantActivity when payload has no cadence, even if persisted cadence > 0', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const device = new Device({ id: 'bike-1', type: 'cadence' });

    // Real pedaling packet bumps the timer.
    device.update({ cadence: 55, lastSeen: t0 });
    expect(device.lastSignificantActivity).toBe(t0);

    // 5 seconds later, a battery-only ANT+ page arrives. No cadence in payload.
    const t1 = t0 + 5_000;
    vi.setSystemTime(t1);
    device.update({ batteryLevel: 80, lastSeen: t1 });

    // Persisted cadence is unchanged.
    expect(device.cadence).toBe(55);
    // BUG GUARD: lastSignificantActivity must NOT advance — the battery page
    // carried no fresh cadence reading.
    expect(device.lastSignificantActivity).toBe(t0);
  });

  it('does NOT bump lastSignificantActivity for a 0-cadence payload', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const device = new Device({ id: 'bike-1', type: 'cadence' });

    device.update({ cadence: 55, lastSeen: t0 });

    const t1 = t0 + 1_000;
    vi.setSystemTime(t1);
    device.update({ cadence: 0, lastSeen: t1 });

    // cadence: 0 is "no rotation since last frame" — not significant activity.
    expect(device.lastSignificantActivity).toBe(t0);
  });

  it('bumps lastSignificantActivity from heart rate or power, independently of cadence', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const device = new Device({ id: 'hr-1', type: 'heart_rate' });

    device.update({ heartRate: 120, lastSeen: t0 });
    expect(device.lastSignificantActivity).toBe(t0);

    const t1 = t0 + 5_000;
    vi.setSystemTime(t1);
    device.update({ power: 200, lastSeen: t1 });
    expect(device.lastSignificantActivity).toBe(t1);
  });
});

describe('DeviceManager.pruneStaleDevices — zeros cadence after rpmZero window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets cadence to 0 within rpmZero after pedaling stops, even if non-cadence frames keep arriving', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const mgr = new DeviceManager();

    // Rider pedals: cadence frame arrives.
    mgr.registerDevice({ id: 'bike-1', type: 'cadence', cadence: 55, lastSeen: t0 });
    expect(mgr.getDevice('bike-1').cadence).toBe(55);

    // 1 second later: battery-only ANT+ page arrives (no cadence in payload).
    const t1 = t0 + 1_000;
    vi.setSystemTime(t1);
    mgr.registerDevice({ id: 'bike-1', batteryLevel: 80, lastSeen: t1 });

    // 4 seconds later: another non-cadence page. Past the 3s rpmZero threshold now.
    const t2 = t0 + 4_000;
    vi.setSystemTime(t2);
    mgr.registerDevice({ id: 'bike-1', batteryLevel: 80, lastSeen: t2 });

    // Prune should detect the stale cadence and zero it.
    mgr.pruneStaleDevices({ inactive: 60_000, remove: 1_800_000, rpmZero: 3_000 });

    expect(mgr.getDevice('bike-1').cadence).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js
```

Expected: 5 tests total, **2 FAIL**:
- `does NOT bump lastSignificantActivity when payload has no cadence...` — fails because current code bumps from persisted state.
- `resets cadence to 0 within rpmZero...` — fails because `lastSignificantActivity` keeps getting bumped by non-cadence frames, so prune never zeros.

The 0-cadence test (`does NOT bump lastSignificantActivity for a 0-cadence payload`) **should already pass** on the current code (because the persisted-state check sees `this.cadence === 0` after the 0-payload update). It's there as a guard so the fix doesn't accidentally regress this case.

The heart-rate / power test should already pass.

- [ ] **Step 3: Commit the failing tests**

```bash
git add frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js
git commit -m "test(fitness): add failing regression tests for RPM cadence freeze

Tests prove Device.update() incorrectly bumps lastSignificantActivity
from post-merge persisted state when ANT+ non-cadence pages arrive.
Two tests currently fail; will pass after fix in next commit.

See docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md"
```

---

## Task 2: Fix Bug 1 — Significance From Payload, Not Persisted State

**Files:**
- Modify: `frontend/src/hooks/fitness/DeviceManager.js:75-86` (the `update` method tail)

- [ ] **Step 1: Replace the significance check**

Replace this block in `Device.update()`:

```js
    // Check for significant activity to reset inactivity flags
    const hasHeartRate = Number.isFinite(this.heartRate) && this.heartRate > 0;
    const hasCadence = Number.isFinite(this.cadence) && this.cadence > 0;
    const hasPower = Number.isFinite(this.power) && this.power > 0;
    const hasSpeed = Number.isFinite(this.speed) && this.speed > 0;
    
    if (hasHeartRate || hasCadence || hasPower || hasSpeed) {
      this.lastSignificantActivity = Date.now();
      this.inactiveSince = null;
      this.removalAt = null;
      this.removalCountdown = null;
    }
  }
```

with this block:

```js
    // Significance check: bump lastSignificantActivity based on the INCOMING
    // payload, not the device's persisted state. ANT+ sensors broadcast
    // non-cadence pages (battery, manufacturer, common 80-82) for 60-120s
    // after pedaling stops; reading post-merge `this.cadence` here would let
    // those frames refresh the timer forever via stale data.
    // See docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md
    const payloadHasHeartRate = Number.isFinite(data.heartRate) && data.heartRate > 0;
    const payloadHasCadence   = Number.isFinite(data.cadence)   && data.cadence   > 0;
    const payloadHasPower     = Number.isFinite(data.power)     && data.power     > 0;
    const payloadHasSpeed     = Number.isFinite(data.speed)     && data.speed     > 0;

    if (payloadHasHeartRate || payloadHasCadence || payloadHasPower || payloadHasSpeed) {
      this.lastSignificantActivity = Date.now();
      this.inactiveSince = null;
      this.removalAt = null;
      this.removalCountdown = null;
    }
  }
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js
```

Expected: **5/5 PASS**.

- [ ] **Step 3: Run the broader fitness test suite to check for regressions**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/
```

Expected: all existing tests in that directory pass. If `FitnessSession.cadenceTs.test.js` fails, **stop and investigate** — that test is closely related (`ts` advancement on every packet) and a regression there could mean the fix broke a downstream expectation.

- [ ] **Step 4: Commit the fix**

```bash
git add frontend/src/hooks/fitness/DeviceManager.js
git commit -m "fix(fitness): track cadence freshness from payload, not persisted state

Device.update() bumped lastSignificantActivity based on this.cadence > 0
(post-merge persisted value), so non-cadence ANT+ frames (battery,
manufacturer, common pages 80-82) kept refreshing the timer for 60-120s
after pedaling stopped. RPM avatars stayed frozen at the last broadcast
value because pruneStaleDevices' rpmZero check (3s) never tripped.

Now derive significance from the incoming payload (data.cadence > 0,
etc.), so only frames carrying real activity refresh the timer.

See docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md"
```

---

## Task 3: Fix Bug 2 — Run Prune Unconditionally

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:1284-1296`

- [ ] **Step 1: Replace the gated useEffect**

Replace this block in `FitnessContext.jsx`:

```js
  // MEMORY LEAK FIX: Only prune devices when session is active
  const currentSessionId = fitnessSessionRef.current?.sessionId;
  useEffect(() => {
    const session = fitnessSessionRef.current;
    if (!currentSessionId) return;

    const interval = setInterval(() => {
      const timeouts = getFitnessTimeouts();
      session.deviceManager.pruneStaleDevices(timeouts);
      batchedForceUpdate();
    }, 3000);
    return () => clearInterval(interval);
  }, [batchedForceUpdate, currentSessionId]);
```

with this block:

```js
  // Run device pruning unconditionally for the lifetime of FitnessProvider.
  // Previously gated by currentSessionId — but ANT+ packets can still arrive
  // between sessions (a sensor finishing its broadcast cycle, a leftover fob),
  // registering devices that then persist forever because no prune ran.
  // Pruning is cheap (small map iteration) and the staleness logic already
  // handles the empty-map and no-significant-activity cases correctly.
  // See docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md (Bug 2)
  useEffect(() => {
    const session = fitnessSessionRef.current;
    if (!session) return;

    const interval = setInterval(() => {
      const timeouts = getFitnessTimeouts();
      session.deviceManager.pruneStaleDevices(timeouts);
      batchedForceUpdate();
    }, 3000);
    return () => clearInterval(interval);
  }, [batchedForceUpdate]);
```

The key changes:
- Removed the `currentSessionId` lookup and the `if (!currentSessionId) return;` early-exit.
- Kept a `if (!session) return;` guard for the rare case where the ref hasn't been initialized yet.
- Removed `currentSessionId` from the dependency array so the interval is established once per provider mount instead of being torn down and re-created on every session start/end.

- [ ] **Step 2: Run the fitness test suite to confirm no regressions**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/
```

Expected: all tests still pass.

- [ ] **Step 3: Commit the fix**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "fix(fitness): prune device map unconditionally, not only during sessions

The 3-second device-prune useEffect was gated by currentSessionId. When
a session ended, the interval was torn down. Any ANT+ packet that
arrived after that registered a new device in DeviceManager.devices
that was never pruned. Observed in fitness-profile telemetry:
deviceCount stayed at 1 for 90+ minutes post-session.

Prune now runs whenever FitnessProvider is mounted. The sweep is cheap
(small Map iteration) and the staleness logic already handles the
no-devices and no-activity cases correctly.

See docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md"
```

---

## Task 4: Update Bug Report Status

**Files:**
- Modify: `docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md`

- [ ] **Step 1: Update the status line**

Replace:

```markdown
**Status:** Investigated — root causes for BOTH bugs now confirmed (2026-05-28); no fix proposed yet
```

with (filling in the actual commit hashes from `git log --oneline -3`):

```markdown
**Status:** Fixed (2026-05-28) — Bug 1 in commit `<hash>`, Bug 2 in commit `<hash>`. Plan: `docs/superpowers/plans/2026-05-28-fitness-rpm-freeze-and-ghost-device-fix.md`. Manual verification (next real cycling session) pending.
```

- [ ] **Step 2: Commit the status update**

```bash
git add docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md
git commit -m "docs(fitness): mark RPM freeze and ghost device bugs as fixed"
```

---

## Manual Verification (Post-Deploy)

Automated tests cover Bug 1 directly and Bug 2's underlying prune logic. The Bug 2 scheduler change (removing the gate) is too thin to test through React lifecycle without significant scaffolding; verify manually instead.

After deploying:

1. **Bug 1 (within-session freeze):**
   - Start a fitness session with an ANT+ cadence sensor / bike.
   - Pedal for ~30 s, then stop completely.
   - Watch the RPM avatar. Expected: drops to 0 and stops spinning within ~6 s (3 s `rpmZero` + up to 3 s prune interval). Previously: stayed pinned at last value for 60-120 s.

2. **Bug 2 (ghost devices):**
   - Complete a fitness session normally.
   - Leave the tab open for 30+ minutes (the `remove` threshold).
   - Open browser console, enable `window.DAYLIGHT_LOG_LEVEL = 'debug'`.
   - Inspect telemetry: in `media/logs/fitness/<latest>.jsonl`, `fitness-profile` events should show `deviceCount` returning to 0 within `remove` (30 min) after the last ANT+ packet, instead of staying at 1+ indefinitely.

If either symptom persists, the fix did not deploy or a different code path is involved — return to the bug report's "End-to-end timeline" and re-instrument.

---

## Self-Review Checklist (already completed by plan author)

- **Spec coverage:** Bug 1 → Tasks 1-2. Bug 2 → Task 3. Status doc → Task 4. ✓
- **Placeholder scan:** No "TBD" / "add appropriate" / placeholder code. Commit messages cite the bug report explicitly. The status doc step has `<hash>` placeholders that the executor fills in from real git history — this is unavoidable and clearly marked. ✓
- **Type consistency:** `payloadHasHeartRate / payloadHasCadence / payloadHasPower / payloadHasSpeed` named consistently. `Device.update`, `DeviceManager.registerDevice`, `pruneStaleDevices`, `getFitnessTimeouts` all match their actual signatures. ✓
- **Test runner consistency:** All test commands use the vitest binary at `frontend/node_modules/.bin/vitest` with `vitest.config.mjs` — matches the existing `FitnessSession.cadenceTs.test.js` pattern and the isolated harness. ✓
