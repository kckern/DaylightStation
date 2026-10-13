# Bug 01: RPM Device Display & Timeout Logic

**Date:** 2026-02-04
**Status:** Investigation Complete
**Area:** Fitness App - Device Sensors

## Summary

UI shows "0" inconsistently for RPM devices (e.g., bicycle cadence meters) and remains on screen too long after activity stops.

## Investigation Findings

### Current Implementation

**Display Logic** (`RpmDeviceCard.jsx:29-34`):
```javascript
const isStale = device.timestamp && (Date.now() - device.timestamp > STALENESS_THRESHOLD_MS);
const rpm = device.cadence ?? 0;
const rpmValue = isStale ? '--' : (Number.isFinite(rpm) && rpm > 0 ? `${Math.round(rpm)}` : '--');
```

**Timeout Constants** (`FitnessSession.js:25-30`):
```javascript
const FITNESS_TIMEOUTS = {
  inactive: 60000,      // 60 seconds - device marked inactive
  remove: 180000,       // 180 seconds - device removed from UI
  rpmZero: 3000,        // 3 seconds - reset RPM display to 0
  emptySession: 60000
};
```

**Staleness Threshold** (`RpmDeviceCard.jsx:15`):
```javascript
const STALENESS_THRESHOLD_MS = 5000;  // 5 seconds
```

### Discrepancy Analysis

The code shows `--` (not "0") when:
- `isStale` is true (no data for 5 seconds)
- `rpm <= 0` or not finite

**However**, the bug report says "UI shows 0" - this suggests:

1. **Race condition**: The `device.cadence` value may be `0` (not `null`/`undefined`) when transmission stops, and `isStale` check happens BEFORE the cadence check in the ternary
2. **Timing gap**: Between `rpmZero` timeout (3s) setting cadence to 0 and `STALENESS_THRESHOLD_MS` (5s) marking as stale, there's a 2-second window where `cadence === 0` AND `isStale === false`
3. **Order of operations**: `rpm > 0` check should prevent "0" display, but the `device.cadence ?? 0` fallback may be interfering

### Timeout Behavior

Current removal timeline:
- 0-60s: Device active (or showing `--` if no data)
- 60-180s: Device inactive (50% opacity), countdown bar visible
- 180s+: Device removed

**Bug claim**: Device "remains on screen too long" - current 180s total may be perceived as too long. The requested 10-second hard timeout is significantly shorter than the current 180s.

## Hypothesis

### H1: 2-Second "0" Display Window
The `rpmZero` timeout (3s) resets cadence to 0, but `STALENESS_THRESHOLD_MS` (5s) hasn't triggered yet. During this 2-second gap, the display logic shows:
- `isStale = false` (only 3-5 seconds elapsed)
- `rpm = 0` (reset by rpmZero timeout)
- Result: Should show `--` due to `rpm > 0` check... unless there's a rendering timing issue

**Counter-evidence**: The ternary logic explicitly checks `rpm > 0`, so "0" should never display. Need to verify with live debugging.

### H2: Different Code Path for Certain Devices
Some RPM devices may be rendered through a different component that lacks the `rpm > 0` check.

### H3: Stale Check Bypassed
If `device.timestamp` is `undefined`/`null`, the `isStale` check returns `false`, falling through to the rpm check. This should still show `--` for `rpm === 0`, but warrants verification.

## Files Involved

| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceCard.jsx` | RPM display rendering |
| `frontend/src/hooks/fitness/FitnessSession.js` | Timeout constants |
| `frontend/src/hooks/fitness/DeviceManager.js` | Device lifecycle, `resetMetrics()` |

## Proposed Test Strategy

1. **RPM Simulator**: Create test harness that sends cadence data, then sends `0`, then stops transmission
2. **Assertions**:
   - Never display literal "0" string
   - Display `--` within 5 seconds of transmission stop
   - Remove from UI within 10 seconds (if implementing new timeout)
3. **Visual verification**: Capture DOM snapshots at 1-second intervals

## Proposed Fix Direction

1. **Immediate**: Audit all code paths that display RPM to ensure `> 0` check is present
2. **Timeout reduction**: If 10s hard timeout is desired, update `FITNESS_TIMEOUTS.remove` from 180000 to 10000 (or add device-type-specific timeouts)
3. **Two-stage exit**: Implement immediate transparency on `cadence === 0`, separate from stale timeout
