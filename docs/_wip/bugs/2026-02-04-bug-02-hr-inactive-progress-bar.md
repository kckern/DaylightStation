# Bug 02: Heart Rate Inactive State & Progress Bar

**Date:** 2026-02-04
**Status:** Investigation Complete
**Area:** Fitness App - Device Sensors

## Summary

HR devices hang on "0" for too long before turning transparent, and the countdown progress bar (visual timeout indicator) is missing.

## Investigation Findings

### Current Implementation

**HR Display Logic** (`PersonCard.jsx:61-63`):
```javascript
const hrValue = Number.isFinite(heartRate) && heartRate > 0
  ? `${Math.round(heartRate)}`
  : '--';
```

**Inactive State Detection** (`FitnessUsers.jsx:928`):
```javascript
const isInactive = device.isActive === false || !!device.inactiveSince;
```

**Countdown Calculation** (`DeviceManager.js:274-279`):
```javascript
if (device.removalAt) {
  const totalGracePeriod = timeouts.remove - timeouts.inactive;  // 120 seconds
  const remaining = device.removalAt - now;
  device.removalCountdown = Math.max(0, Math.min(1, remaining / totalGracePeriod));
}
```

**Countdown Bar Rendering** (`BaseRealtimeCard.jsx:96-104`):
```javascript
{isCountdownActive && (
  <div className="device-timeout-bar">
    <div className="device-timeout-fill" style={{ width: `${countdownWidth}%` }} />
  </div>
)}
```

### Discrepancy Analysis

**"0" Display Issue**: Code explicitly shows `--` when `heartRate <= 0`. Same pattern as RPM - should never show "0". Need to verify if there's a different rendering path.

**Time-to-Inactive**: Currently 60 seconds. Bug report requests 10 seconds. This is a significant reduction.

**Progress Bar "Missing"**: The countdown bar infrastructure exists (`device-timeout-bar`), but may not render because:

1. `isCountdownActive` check requires `Number.isFinite(removalCountdown)`
2. `removalCountdown` is only set when `device.removalAt` exists
3. `device.removalAt` is only set when `device.inactiveSince` is set (at 60s mark)

### Key Difference from RPM

HR devices use `lastSeen` timestamp tracking (updated on every data packet), while RPM uses `lastSignificantActivity` (only updated when cadence > 0). This means:

- HR: Device goes inactive when no packets received for 60s
- RPM: Device goes inactive when no pedaling detected for 60s (even if packets arrive with cadence=0)

## Hypothesis

### H1: Countdown Bar Conditional Not Met
The `isCountdownActive` check in `FitnessUsers.jsx:924-926`:
```javascript
const removalCountdown = device.removalCountdown;
const isCountdownActive = Number.isFinite(removalCountdown);
```

If `device.removalCountdown` is never being set on HR devices, the bar won't render. This could happen if:
- HR devices use a different code path in `DeviceManager.pruneStaleDevices()`
- The `removalAt` timestamp isn't being set for HR-only devices

### H2: PersonCard vs BaseRealtimeCard Rendering
HR devices render via `PersonCard`, which may not include the countdown bar logic that `BaseRealtimeCard` has. Need to verify if PersonCard extends or uses BaseRealtimeCard.

### H3: CSS/Visibility Issue
The progress bar element may exist but be hidden via CSS (wrong z-index, zero height, or parent overflow hidden).

## Files Involved

| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/PersonCard.jsx` | HR device rendering |
| `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/BaseRealtimeCard.jsx` | Countdown bar rendering |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx` | Inactive state detection, countdown props |
| `frontend/src/hooks/fitness/DeviceManager.js` | Device lifecycle, removalCountdown calculation |

## Proposed Test Strategy

1. **HR Simulator**: Send HR data, then stop transmission
2. **DOM Monitoring**:
   - Check for `device-timeout-bar` element presence after data stops
   - Verify `device-timeout-fill` width decreases over time
3. **Timing Assertions**:
   - Inactive class applied within 10 seconds (new threshold)
   - Progress bar visible during countdown phase
   - Device removed after countdown completes

## Proposed Fix Direction

1. **Verify countdown bar rendering path**: Ensure PersonCard includes or delegates to countdown bar rendering
2. **Reduce inactive timeout**: Change from 60s to 10s for HR devices (may need device-type-specific timeouts)
3. **CSS audit**: Check `.device-timeout-bar` styling for visibility issues
4. **Add missing integration**: If PersonCard doesn't render countdown, add it
