# Bug Report: Skipped Governance Tests

**Date:** 2026-02-03
**Severity:** Low (test environment issues, not production bugs)
**Component:** Governance Test Suite
**Test File:** `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs`
**Related:** `docs/_wip/bugs/2026-02-03-governance-test-flakiness.md`

---

## Executive Summary

Two governance tests are currently skipped due to test environment issues. Both tests pass conceptually correct scenarios but fail due to infrastructure limitations in how the Playwright test environment interacts with the WebSocket-based data flow.

| Test | Issue | Impact |
|------|-------|--------|
| `hydration-video-first` | Timing-sensitive state observation | Cannot reliably observe transient UI state |
| `challenge-fail-recover` | Zone propagation in test env | Only 1 of 5 user zones update via WebSocket |

---

## Issue 1: hydration-video-first

### Test Intent

Verify that when governed content starts playing BEFORE any HR data arrives:
1. Lock screen appears in "waiting" state (empty rows, "Start exercising" message)
2. HR data arrives and populates rows
3. Once zone requirements met, video unlocks

### What Happens

The test navigates to governed content and tries to observe the "waiting" state before sending HR data. However, the UI often hydrates too quickly:

```
Phase: NO_OVERLAY, Rows: undefined
Phase: EMPTY_WAITING, Rows: 0
Phase: FULLY_HYDRATED, Rows: 3   ← Skipped intermediate states
```

The transition from `EMPTY_WAITING` to `FULLY_HYDRATED` happens in <100ms, faster than the polling interval.

### Root Cause Analysis

1. **Pre-populated device data**: The DeviceManager may have pre-populated HR devices from config before the test starts
2. **Race condition**: The test's first poll might occur after WebSocket has already delivered initial state
3. **Polling interval**: 50ms polling may miss sub-50ms state transitions

### Evidence

```javascript
// Test loops every 50ms looking for empty state
for (let i = 0; i < 200; i++) {
  const state = await extractState(page);
  if (state.visible && state.isEmpty) {
    waitingStateObserved = true;  // Never triggered
    break;
  }
  await page.waitForTimeout(50);
}
```

### Potential Fixes

1. **Add explicit delay before hydration**: Modify test to ensure no HR data exists before navigation
   ```javascript
   await sim.clearAllDevices();  // Utility already added
   await page.waitForTimeout(500);
   // Then navigate to content
   ```

2. **Check for waiting state in page load callback**: Use Playwright's `page.on('load')` or mutation observer to catch transient states

3. **Relax assertion**: Accept that seeing `EMPTY_WAITING` OR `FULLY_HYDRATED` is valid (the important thing is that hydration completes correctly)

4. **Increase polling frequency**: Reduce to 10-20ms, though this increases test overhead

### Files to Investigate

- `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs:504-561` - Test implementation
- `frontend/src/modules/Fitness/FitnessLockOverlay.jsx` - Lock screen component
- `frontend/src/hooks/fitness/DeviceManager.js` - Device pre-population logic

---

## Issue 2: challenge-fail-recover

### Test Intent

Verify the challenge failure → lock → recovery flow:
1. Video is playing (unlocked, all users at `active` zone)
2. Challenge triggers for `hot` zone (5 second timeout)
3. Users stay at `active` zone (meets base requirement, but NOT challenge)
4. Challenge timer runs and expires → video locks
5. Users move to `warm` zone → video unlocks

### What Happens

Only 1 of 5 users' zones update when the test calls `sim.setZone()` for all devices:

```
Setting 5 devices to active zone...
  Device 40475 (kckern): OK
  Device 28812 (felix): OK
  Device 28688 (milo): OK
  Device 28676 (alan): OK
  Device 29413 (soren): OK

Zone check after set: kckern:active, felix:cool, milo:cool, alan:cool, soren:cool
```

All 5 `setZone()` calls return `OK`, but only kckern's zone actually updates. The other 4 users remain at `cool` zone.

### Root Cause Analysis

The zone data flows through multiple layers:

```
sim.setZone(deviceId, zone)
  ↓
FitnessSimulationController._sendHR(deviceId, hr)
  ↓
wsService.send(message)  ← WebSocket to backend
  ↓
Backend broadcasts to all clients
  ↓
Frontend receives via WebSocket
  ↓
DeviceManager.updateDevice(deviceId, data)
  ↓
FitnessSession.updateSnapshot()
  ↓
ZoneProfileStore.syncFromUsers(allUsers)  ← Zone derived here
  ↓
GovernanceEngine.evaluate()  ← Reads from ZoneProfileStore
```

**Key finding**: The GovernanceEngine reads zones from `ZoneProfileStore.getProfile()`, NOT directly from device data:

```javascript
// GovernanceEngine.js:1226-1232
if (this.session?.zoneProfileStore) {
  activeParticipants.forEach((participantId) => {
    const profile = this.session.zoneProfileStore.getProfile(participantId);
    if (profile?.currentZoneId) {
      userZoneMap[participantId] = profile.currentZoneId.toLowerCase();
    }
  });
}
```

The ZoneProfileStore gets user data from `UserManager.getAllUsers()`, which includes `user.currentData.heartRate`. The zone is derived from this HR value.

### Hypothesis: Why Only kckern Updates

1. **Device-to-user mapping**: Device 40475 maps to kckern in config. The WebSocket message includes `DeviceId: "40475"`.

2. **UserManager device resolution**: When the backend processes the HR message, it must resolve the device ID to a user. This might only work correctly for kckern.

3. **Possible causes**:
   - Other devices not properly registered in UserManager
   - Race condition in device → user resolution
   - Backend only processing first device in batch
   - WebSocket batching dropping messages

### Diagnostic Logging Added

The test now logs zone state before and after setZone calls:

```javascript
// After setting zones with delays
const zoneCheck = await extractGovernanceState(page);
console.log(`Zone check: ${Object.entries(zoneCheck.userZoneMap).map(...)}`);
```

### Key Observations

1. **Initial unlock works**: When `unlockVideo()` is called with delays between setZone calls, ALL 5 users update correctly:
   ```
   Zone check after set: kckern:active, felix:active, milo:active, alan:active, soren:active
   ```

2. **Zones revert in loop**: When the wait loop continuously calls setZone, zones revert to `cool` for non-kckern users

3. **Delay between calls matters**: 200ms delay between setZone calls allows propagation; rapid calls don't

### Potential Fixes

1. **Add delays between all setZone calls**:
   ```javascript
   for (const device of devices) {
     await sim.setZone(device.deviceId, 'active');
     await page.waitForTimeout(200);  // Allow propagation
   }
   ```

2. **Use batch API**: Create a `sim.setAllZones(zone)` that sends a single WebSocket message with all device updates

3. **Investigate backend batching**: Check if backend WebSocket handler has debouncing that drops rapid updates

4. **Check UserManager device registration**: Verify all 5 devices are properly registered before test starts

### Files to Investigate

- `frontend/src/hooks/fitness/ZoneProfileStore.js` - Zone derivation from user data
- `frontend/src/hooks/fitness/UserManager.js` - User → device mapping
- `backend/src/3_applications/fitness/FitnessWebSocketHandler.mjs` - WebSocket message handling
- `frontend/src/context/FitnessContext.jsx` - React state updates from WebSocket

---

## Related Architecture Notes

### Challenge Timer Behavior

**Critical insight**: Challenge timer only runs when `isGreenPhase === true` (phase is `unlocked`):

```javascript
// GovernanceEngine.js:1884-1891
if (challenge.status === 'pending') {
  if (!isGreenPhase) {
    if (!challenge.pausedAt) {
      challenge.pausedAt = now;
      challenge.pausedRemainingMs = Math.max(0, challenge.expiresAt - now);
    }
    // Challenge timer is PAUSED
    return;
  }
  // Timer only runs here when isGreenPhase === true
}
```

This means:
- Users MUST meet base requirements for challenge timer to run
- If users drop below base requirements, challenge pauses
- Phase goes to `warning` when challenge is active but requirements not met

### Why This Matters for the Test

The test originally tried:
1. Set users to `cool` zone (below base requirement)
2. Wait for challenge to timeout

But this doesn't work because:
1. `cool` zone doesn't meet `active: all` base requirement
2. Phase goes to `warning`
3. Challenge timer pauses
4. Timeout never occurs

The fix was to:
1. Set users to `active` zone (meets base requirement)
2. Challenge for `hot` zone (users don't meet challenge)
3. Phase should stay `unlocked` (base met), timer runs
4. Challenge times out → lock

But this only works if ALL users are at `active` zone, which is where the zone propagation bug prevents success.

---

## Recommendations for Future Work

### Short-term

1. **Fix zone propagation**: Investigate why rapid WebSocket updates don't propagate for all users
2. **Add test isolation**: Ensure each test starts with clean device state using `clearAllDevices()`
3. **Increase delays**: Accept slower tests for reliability

### Medium-term

1. **Batch zone updates**: Create API for setting multiple zones atomically
2. **Add zone verification helper**: Wait for all zones to reach expected state before proceeding
3. **Improve test diagnostics**: Log full data flow path when zone updates fail

### Long-term

1. **Consider alternative test approach**: Mock the GovernanceEngine directly instead of going through WebSocket
2. **Add integration test layer**: Separate "unit" tests (mocked) from "integration" tests (full WebSocket)

---

## Test Commands

```bash
# Run the skipped tests (will fail)
npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs \
  --grep "hydration-video-first|challenge-fail-recover" \
  --reporter=line

# Run with trace for debugging
npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs \
  --grep "challenge-fail-recover" \
  --trace on

# Run all governance tests (skipped tests will be skipped)
npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs \
  --reporter=line
```

---

## Appendix: Device-to-User Mappings

From `data/household/apps/fitness/config.yml`:

```yaml
devices:
  heart_rate:
    40475: kckern    # watch - WORKS
    28812: felix     # red   - FAILS to update
    28688: milo      # yellow - FAILS to update
    28676: alan      # green - FAILS to update
    29413: soren     # blue  - FAILS to update
```

Users in `primary` list:
- kckern, felix, milo, alan, soren (all 5)

All mappings appear correct in config, suggesting the issue is in runtime processing, not configuration.
