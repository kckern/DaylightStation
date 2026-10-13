# Bug 08: Jump Rope Counting Logic Resets

**Severity:** Medium
**Area:** Logic
**Status:** Open

## Summary

The current jump rope integration relies too heavily on device data, causing the counter to reset after 250 jumps (device limit/rollover). The app should handle accumulation internally, using device input only as a heartbeat/tick signal.

## Symptoms

1. Jump count resets to 0 after reaching 250
2. Total session jumps lost on rollover
3. Display shows device counter instead of accumulated total

## Current Architecture

### Device Decoder
**File:** `_extensions/fitness/src/decoders/jumprope.mjs`

**Class:** `RenphoJumpropeDecoder`

| Method | Purpose |
|--------|---------|
| `processPacket()` | Decodes BLE packets from RENPHO R-Q008 |
| `decode()` | Extracts counter from bytes 14-15 (0xAD packet) |
| `formatForWebSocket()` | Broadcasts revolution count |
| `getRevolutions()` | Returns raw device counter |

**Device limitation:** Counter wraps at 250 (8-bit or device firmware limit)

### Session State Manager
**File:** `frontend/src/hooks/fitness/JumpropeSessionState.js`

**Class:** `JumpropeSessionState`

| Method | Purpose |
|--------|---------|
| `ingest()` | Processes revolution count, returns `{ sessionJumps, rpm }` |
| `deriveRPM()` | RPM from rolling 10-second window |
| `getSessionJumps()` | Total jumps since session start |
| `reset()` | Clears state on disconnect |

### Event Router
**File:** `frontend/src/hooks/fitness/DeviceEventRouter.js`

Built-in BLE jump rope handler:
- Uses `JumpropeSessionState` to calculate RPM
- Passes revolution count through pipeline

### UI Component
**File:** `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx`

- Displays jumps count and RPM
- Staleness detection (5s threshold)
- Uses `JumpropeAvatar` for gauge visualization

## Root Cause

The `JumpropeSessionState` class likely:
1. Stores the device counter directly as the total
2. Doesn't handle rollover detection
3. Resets `sessionJumps` when device counter decreases

## Fix Direction

### 1. Implement Delta-Based Counting

```javascript
class JumpropeSessionState {
  constructor() {
    this.lastDeviceCount = null;
    this.accumulatedJumps = 0;
  }

  ingest(deviceCount, timestamp) {
    if (this.lastDeviceCount === null) {
      // First reading - don't count, just establish baseline
      this.lastDeviceCount = deviceCount;
      return { sessionJumps: this.accumulatedJumps, rpm: 0 };
    }

    let delta;
    if (deviceCount >= this.lastDeviceCount) {
      // Normal increment
      delta = deviceCount - this.lastDeviceCount;
    } else {
      // Rollover detected (e.g., 249 → 2)
      delta = (250 - this.lastDeviceCount) + deviceCount;
    }

    this.accumulatedJumps += delta;
    this.lastDeviceCount = deviceCount;

    return { sessionJumps: this.accumulatedJumps, rpm: this.deriveRPM() };
  }
}
```

### 2. Key Design Principles

- **Device input = tick signal:** Each packet indicates "jumps happened"
- **App owns accumulation:** Total count maintained in app state
- **Handle rollover:** Detect when counter wraps and compute delta correctly
- **Handle reconnection:** If device reconnects, treat as new baseline

### 3. Edge Cases to Handle

| Scenario | Behavior |
|----------|----------|
| Device reconnects | Reset baseline, keep accumulated count |
| Large gap in readings | Use timestamp to detect, possibly warn |
| Counter rollover | Calculate delta across rollover boundary |
| Session reset | Clear accumulated count |
| Multiple rollovers between reads | Assume single rollover (limitation) |

### 4. RPM Calculation

RPM should continue using delta-based approach:
- Track timestamps of recent deltas
- Calculate jumps per minute from rolling window
- Independent of absolute counter value

## Related Files

| File | Change Needed |
|------|---------------|
| `JumpropeSessionState.js` | Implement delta-based counting |
| `JumpropeCard.jsx` | Use accumulated total, not device count |
| `DeviceEventRouter.js` | Pass raw count, let state handle delta |

## Testing Approach

Runtime tests should:
1. Simulate continuous jumping past 250 count
2. Verify counter continues incrementing past rollover
3. Test rollover edge cases (249 → 0, 249 → 5)
4. Test device reconnection (maintains accumulated count)
5. Test session reset (clears accumulated count)
6. Verify RPM calculation unaffected by rollover
