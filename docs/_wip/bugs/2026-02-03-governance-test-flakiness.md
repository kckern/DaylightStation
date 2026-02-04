# Bug Report: Governance Test Flakiness

**Date:** 2026-02-03 (Updated)
**Severity:** Medium
**Component:** GovernanceEngine / Fitness Tests
**Test File:** `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs`

---

## Summary

The governance comprehensive test suite exhibits significant flakiness, with 4 of 6 tests failing intermittently. The root cause is a **test synchronization issue** where tests check overlay visibility but don't verify the GovernanceEngine has completed its 500ms hysteresis window and set `satisfiedOnce = true`.

**Note:** An earlier version of this report incorrectly identified the root cause as a "zone requirement mismatch." That analysis was wrong—the zone hierarchy is correct and `warm` does satisfy `active`.

---

## Symptoms

### Test Results (Current State)

| Test | Status | Notes |
|------|--------|-------|
| `hydration-hr-first` | ✅ Pass | Consistent |
| `hydration-video-first` | ❌ Flaky | Can't observe "waiting" state |
| `challenge-success` | ❌ Fail | Phase doesn't stabilize to `unlocked` |
| `challenge-fail-recover` | ❌ Fail | Phase doesn't stabilize to `unlocked` |
| `grace-expire-lock` | ✅ Pass | Usually works |
| `grace-recover-normal` | ❌ Flaky | Warning phase not always triggered |

### Observable Behavior

1. **Unlock sequence completes but phase stays `pending`:**
   ```
   [UNLOCK] Moving users to target zone...
     Video unlocked!
     WARNING: Governance phase is pending, not 'unlocked'
   ```

2. **Phase cycles incorrectly on zone drop:**
   ```
   Phase changed: pending → unlocked
   Phase changed: unlocked → pending    // Should be: unlocked → warning
   ```

---

## Root Cause Analysis

### 1. Hysteresis Timing (Primary Cause)

The GovernanceEngine has a **500ms hysteresis requirement**:

```javascript
// GovernanceEngine.js:147, 1366-1371
this._hysteresisMs = 500;

if (satisfiedDuration >= this._hysteresisMs) {
  this.meta.satisfiedOnce = true;  // CRITICAL: Only set after 500ms
  this._setPhase('unlocked');
}
```

Requirements must be satisfied **continuously for 500ms** before:
- `satisfiedOnce` is set to `true`
- Phase transitions to `unlocked`

If the test doesn't maintain zone requirements for the full 500ms, `satisfiedOnce` never becomes `true`.

### 2. UI/Engine Phase Discrepancy (Secondary Cause)

The lock overlay visibility appears to be controlled by different logic than the GovernanceEngine phase:

| Behavior | Trigger |
|----------|---------|
| Lock overlay disappears | Unknown (possibly any HR signal?) |
| GovernanceEngine phase → `unlocked` | 500ms sustained zone satisfaction |

The test's `unlockVideo()` function checks overlay visibility:
```javascript
// governance-comprehensive.runtime.test.mjs:561
if (!state.visible) {
  unlocked = true;  // Test thinks we're unlocked
  // BUT: GovernanceEngine.phase may still be 'pending'
  // AND: satisfiedOnce may still be false
}
```

### 3. Why This Causes Grace Period Failures

When zone drops after an incomplete unlock:

```javascript
// GovernanceEngine.js:1379-1384
} else if (!this.meta.satisfiedOnce) {
  // satisfiedOnce is FALSE → goes to pending (not warning)
  this._setPhase('pending');
} else {
  // satisfiedOnce is TRUE → goes to warning (grace period)
  this._setPhase('warning');
}
```

The `grace-recover-normal` test expects `warning` phase but gets `pending` because `satisfiedOnce` was never set.

---

## Zone Hierarchy (Corrected)

**The original bug report had the zone hierarchy backwards.**

### Actual Zone Config (from `data/household/apps/fitness/config.yml`)

```yaml
zones:
  - id: cool    # rank 0 (index 0)
    min: 0
  - id: active  # rank 1 (index 1)
    min: 100
  - id: warm    # rank 2 (index 2)
    min: 120
  - id: hot     # rank 3 (index 3)
    min: 140
  - id: fire    # rank 4 (index 4)
    min: 160
```

**Correct hierarchy (lowest to highest):**
```
cool (0) → active (1) → warm (2) → hot (3) → fire (4)
```

### Zone Satisfaction Logic

```javascript
// GovernanceEngine.js:1548
if (participantRank >= requiredRank) {
  metUsers.push(participantId);
}
```

With requirement `active: all` (rank 1):
- `warm` (rank 2) >= `active` (rank 1) → **SATISFIED** ✓
- Tests using `warm` zone are correct

**The zone logic is not the problem.**

---

## Evidence

### Test Output Shows Incomplete Hysteresis

```
[UNLOCK] Moving users to target zone...
  Set device 28812 to warm zone
  Video unlocked!                    ← Overlay disappeared
  WARNING: Governance phase is pending, not 'unlocked'  ← But engine didn't complete hysteresis
```

The overlay disappears before the 500ms hysteresis completes.

### Phase Transitions Confirm `satisfiedOnce` Issue

```
Phase changed: unlocked → pending
```

This transition only happens when `satisfiedOnce === false`. If it were `true`, the transition would be `unlocked → warning`.

---

## The Fix

### Update `unlockVideo()` to Verify Full Unlock

The test helper needs to:
1. Keep sending HR to maintain zone requirements
2. Wait for GovernanceEngine phase to reach `unlocked`
3. Verify `satisfiedOnce` is implicitly true (by checking phase behavior)

```javascript
async function unlockVideo(page, sim, devices, timeline, issues) {
  // ... existing zone-setting logic ...

  // After overlay disappears, verify governance phase stabilized
  if (!state.visible) {
    // Keep sending HR through the 500ms hysteresis window
    for (let i = 0; i < 10; i++) {
      for (const device of devices) {
        await sim.setZone(device.deviceId, 'warm');
      }
      await page.waitForTimeout(100);

      const govState = await extractGovernanceState(page);
      if (govState?.phase === 'unlocked') {
        console.log('  Governance phase confirmed: unlocked');
        break;
      }
    }

    // Final verification
    const finalGovState = await extractGovernanceState(page);
    if (finalGovState?.phase !== 'unlocked') {
      console.warn(`  WARNING: Governance phase is ${finalGovState?.phase}, not 'unlocked'`);
      // Continue anyway but log the issue
    }
  }
}
```

### Key Points

1. **Keep sending HR** - Don't just set zone once and wait; maintain the zone
2. **Check governance phase** - Don't rely solely on overlay visibility
3. **Allow 500ms+** - The hysteresis window must complete

---

## Related Files

- `frontend/src/hooks/fitness/GovernanceEngine.js` - State machine logic (lines 1363-1384)
- `frontend/src/modules/Fitness/FitnessSimulationController.js` - Test simulator
- `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs` - Test file
- `data/household/apps/fitness/config.yml` - Zone config (production)

---

## Open Questions

### UI/Engine Discrepancy Investigation

Why does the lock overlay disappear before the governance phase is `unlocked`? Possible causes:

1. **Intentional UX** - Show video immediately when HR detected, overlay is just informational
2. **Bug** - Overlay should stay until `phase === 'unlocked'`
3. **Different trigger** - Overlay visibility tied to participant count, not zone satisfaction

This warrants separate investigation but doesn't block the test fix.

---

## Summary

| Original Analysis | Corrected Analysis |
|-------------------|-------------------|
| Zone mismatch (`warm` < `active`) | Zone logic is correct (`warm` > `active`) |
| Tests need to use `active` zone | Tests correctly use `warm` zone |
| GovernanceEngine bug | Test synchronization issue |

**The tests are conceptually correct. They just need better synchronization with the 500ms hysteresis window.**

---

## Resolution (2026-02-03)

### Actual Root Cause Found

The original analysis was **partially wrong**. The real root cause was NOT the 500ms hysteresis timing. It was a **React dependency array bug** that prevented zone data from reaching the GovernanceEngine entirely.

**The Bug:** In `FitnessContext.jsx`, the useEffect that calls `session.updateSnapshot()` had this dependency array:

```javascript
[users, fitnessDevices, fitnessPlayQueue, participantRoster, zoneConfig]
```

But `fitnessDevices = session.deviceManager.devices` is a **Map reference** that never changes even when items inside it are updated. So the effect never ran when new HR data arrived via WebSocket.

**The Fix:** Added `version` to the dependency array:

```javascript
[users, fitnessDevices, fitnessPlayQueue, participantRoster, zoneConfig, version]
```

The `version` state is incremented by `batchedForceUpdate()` whenever WebSocket data arrives.

### Diagnostic Improvements

Exposed internal GovernanceEngine state in `window.__fitnessGovernance` for test visibility:
- `satisfiedOnce` - whether hysteresis completed
- `userZoneMap` - what zones the engine sees
- `activeParticipants` - who the engine is tracking
- `zoneRankMap` - zone hierarchy

### Test Results

| Before | After |
|--------|-------|
| 2 passing, 4 failing | 4-5 passing, 1-2 flaky |

### Remaining Issues

Two tests still show intermittent failures:
- `hydration-video-first` - timing-sensitive, may pass on retry
- `challenge-fail-recover` - challenge timeout → lock detection issue

These are separate from the core data propagation fix and may require additional investigation.

### Commits

- `8c72d84c` - fix(fitness): fix governance data propagation from WebSocket updates

---

## Addendum: group_label Fallback Test Reveals Deeper Device Count Discrepancy

**Date:** 2026-02-04
**Related Test:** `tests/live/flow/fitness/group-label-fallback.runtime.test.mjs`

### Background

While implementing a test for the `group_label` fallback behavior (switching from "KC Kern" to "Dad" when multiple HR devices join), I discovered a deeper architectural issue that affects device counting.

### The group_label Mechanism

When a single user exercises alone, the sidebar shows their full `display_name` (e.g., "KC Kern"). When multiple users join, the system switches to `group_label` (e.g., "Dad") for users who have one configured.

The trigger condition is `heartRateDevices.length > 1`.

### What the Test Revealed

The test consistently fails at Phase 1, showing "Dad" instead of "KC Kern" even when only 1 HR device is active:

```
[PHASE 1] Single device - expecting display_name
  Activating kckern (40475)...
  TIMEOUT: Device 40475 shows "Dad" (expected "KC Kern")
```

### Root Cause: Device Count Discrepancy Between Systems

**Diagnostic logs revealed conflicting device counts:**

| Component | Device Count | Source |
|-----------|-------------|--------|
| `FitnessUsers.jsx` hrDisplayNameMap | 1 | `allDevices.filter(d => d.type === 'heart_rate')` |
| `ParticipantRoster.getRoster()` | 5 | `this._deviceManager.getAllDevices()` |

Both supposedly reference the same `session.deviceManager`, but they see different device counts.

### The Device Count Flow

1. **FitnessUsers.jsx** computes `hrDisplayNameMap`:
   - Correctly sees 1 device
   - Returns `hrOwnerMap` (no group_label override) ✓
   - Log: `activeHrCount: 1, single_device_no_override`

2. **ParticipantRoster** computes `displayLabel` for roster entries:
   - Sees 5 devices (all configured primary users' HR devices)
   - Sets `preferGroupLabels = true`
   - Log: `heartRateDeviceCount: 5, preferGroupLabels: true, deviceIds: ["40475","28688","28676","28812","29413"]`

3. **Device name resolution** in FitnessUsers.jsx:
   - Priority: `guestAssignment` → **`displayLabel`** → `ownerName`
   - `displayLabel` = "Dad" (from `participantEntry.displayLabel`)
   - `ownerName` = "KC Kern" (from `hrDisplayNameMap`)
   - Result: "Dad" wins because `displayLabel` has higher priority

### The 5 Device IDs

The 5 device IDs match the configured primary users' HR devices:
- 40475 (kckern)
- 28688, 28676 (other users)
- 28812 (felix)
- 29413 (another user)

These devices are being **pre-populated** into the DeviceManager, even though only 1 device is actively sending HR data.

### Why Two Systems See Different Counts

**FitnessContext's `allDevicesRaw`:**
```javascript
const allDevicesRaw = React.useMemo(
  () => Array.from(fitnessDevices.values()),
  [fitnessDevices, version]
);
```
- Snapshot taken when `version` state changes
- Only updates when React re-renders
- Shows 1 device (correct for active devices)

**ParticipantRoster's direct query:**
```javascript
const heartRateDevices = this._deviceManager.getAllDevices()
  .filter(d => d.type === 'heart_rate');
```
- Queries DeviceManager directly (no React state)
- Sees all registered devices including pre-populated ones
- Shows 5 devices (all configured, not just active)

### Hypothesis: Device Pre-Population

The DeviceManager appears to be pre-populated with HR devices from the user configuration. This might be intentional (for device assignment UI) but breaks the `preferGroupLabels` logic which assumes `getAllDevices()` returns only **active** devices.

### Potential Fixes

1. **ParticipantRoster should filter for active devices:**
   ```javascript
   const heartRateDevices = this._deviceManager.getAllDevices()
     .filter(d => d.type === 'heart_rate' && !d.inactiveSince);
   ```

2. **Or device pre-population should not include HR devices:**
   Only pre-populate the DeviceManager when actual HR data arrives via WebSocket.

3. **Or use consistent device counting:**
   Both systems should use the same source for counting active HR devices.

### Impact

This affects:
- `group_label` display logic (shows group label with 1 user)
- Governance participant counting (may affect challenge rules)
- Any feature that depends on "how many HR users are active"

### Files Involved

- `frontend/src/hooks/fitness/ParticipantRoster.js` - Sees 5 devices
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx` - Sees 1 device
- `frontend/src/hooks/fitness/DeviceManager.js` - Source of truth (but which snapshot?)
- `frontend/src/context/FitnessContext.jsx` - React state snapshot

### Status

Investigation paused. The core `group_label` bug fix (checking `occupantType === 'guest'`) is correct but cannot be verified until this device count discrepancy is resolved.
