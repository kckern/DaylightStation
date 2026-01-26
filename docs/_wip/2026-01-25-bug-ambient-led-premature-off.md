# Bug Report: Ambient LED Turns Off During Active Workout Session

**Date:** 2026-01-25  
**Severity:** Medium  
**Component:** Fitness - Ambient LED Integration  
**Status:** Fixed

## Summary

The ambient LED garage lighting system incorrectly turns off during active workout sessions when there is a temporary loss of heart rate zone data, even though the user remains actively exercising in a specific zone.

## Resolution

**Fix implemented:** 2026-01-25

Grace period added to `AmbientLedAdapter` that delays LED-off for 30 seconds when zones become empty during an active session (`sessionEnded: false`). The grace period:

1. Prevents immediate LED-off when zone data is lost
2. Clears when zones return (zone recovery)
3. Expires after 30 seconds if zones don't return
4. Is bypassed when `sessionEnded: true` (explicit session end always turns off immediately)

**Files changed:**
- `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs`
- `tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs`

## Evidence

### Timeline of Events (2026-01-25 18:13-18:16 PST)

```
18:13:01 - LED activated (blue scene)
           - activeCount: 1
           - zoneIds: ["cool"]
           - User confirmed in cool/blue heart rate zone

18:13:25 - LED deactivated (off scene) ⚠️ BUG
           - activeCount: 0
           - zoneIds: []
           - Only 24 seconds after activation
           - User was STILL actively working out

18:14:42 - LED reactivated (blue scene)
           - activeCount: 1
           - zoneIds: ["cool"]
           - 77 seconds after premature shutoff
           - User back in cool zone

18:15:46 - LED deactivated again (off scene)
           - activeCount: 0
           - zoneIds: []
           - Another premature shutoff after 64 seconds
```

### Log Excerpts

**LED Activation (correct):**
```json
{
  "ts": "2026-01-25T18:13:01.546",
  "event": "fitness.zone_led.activated",
  "data": {
    "scene": "garage_led_blue",
    "previousScene": null,
    "activeCount": 1,
    "sessionEnded": false
  }
}
```

**Premature Shutoff (bug):**
```json
{
  "ts": "2026-01-25T18:13:25.344",
  "event": "fitness.zone_led.activated",
  "data": {
    "scene": "garage_led_off",
    "previousScene": "garage_led_blue",
    "activeCount": 0,
    "sessionEnded": false  // ← Session NOT ended!
  }
}
```

**Frontend Zone State Loss:**
```json
{
  "ts": "2026-01-26T02:13:25.344Z",
  "event": "fitness.zone_led.activated",
  "data": {
    "zoneCount": 0,
    "zoneIds": [],
    "sessionEnded": false
  },
  "context": {
    "source": "frontend"
  }
}
```

### HomeAssistant API Confirmation

HomeAssistant logs show the rapid on/off sequence:
```
2026-01-25T14:27:00 - Garage Led Light Color on
2026-01-25T14:27:00 - Garage Led Light Color off  (immediately after)
```

## Root Cause Analysis

The ambient LED system responds immediately to zone state changes from the fitness frontend. When there is a **temporary data drop or connectivity issue** between the heart rate monitor and the frontend:

1. Frontend temporarily loses heart rate data
2. Zone calculation returns empty array `zoneIds: []`
3. Frontend sends zone_led sync with `activeCount: 0`
4. Backend immediately turns LED off
5. Frontend recovers connection and detects zone again
6. LED turns back on

**The bug:** The system does not distinguish between:
- **Intentional zone exit** (user's heart rate actually drops)
- **Data loss** (temporary sensor/connection issue during active workout)

## Expected Behavior

During an active fitness session (`sessionEnded: false`), the LED should:
1. **NOT turn off immediately** when zone data is lost
2. **Maintain last known state** for a grace period (e.g., 30-60 seconds)
3. Only turn off if:
   - Session explicitly ends, OR
   - Grace period expires without zone data recovery

## Actual Behavior

LED turns off immediately when zone data is lost, even during active sessions, causing:
- Distracting on/off flickering during workouts
- Loss of ambient zone feedback when it's most needed
- Poor user experience during temporary sensor disconnections

## Impact

**User Experience:**
- **High:** Frequent disruption during workouts
- Users rely on LED color to maintain target heart rate zones
- Flickering lights are distracting and reduce workout quality

**Functional Impact:**
- **Medium:** Feature still works but unreliable
- Defeats purpose of continuous zone monitoring
- May cause users to disable the feature entirely

## Affected Components

### Frontend
- `frontend/src/apps/fitness/` - Zone state calculation and LED sync logic
- Zone monitoring sends updates too aggressively without debouncing
- No grace period for transient data loss

### Backend
- `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs`
- Accepts zone state changes without validation
- No historical state tracking or grace period logic

## Reproduction Steps

1. Start fitness session with heart rate monitor
2. Enter a heart rate zone (e.g., cool/blue zone)
3. Observe LED activate (blue)
4. Experience brief sensor disconnection:
   - Move too far from device
   - Bluetooth interference
   - Brief sensor contact loss
5. Observe LED immediately turn off
6. Observe LED turn back on when connection recovers

**Frequency:** Intermittent, depends on sensor reliability (appears to happen every 1-2 minutes)

## Proposed Solutions

### Solution 1: Grace Period (Recommended)
Add debouncing/grace period to LED state changes:
```javascript
// In AmbientLedAdapter or frontend zone logic
const ZONE_LOSS_GRACE_PERIOD_MS = 30000; // 30 seconds

if (zoneCount === 0 && !sessionEnded) {
  // Don't immediately turn off - start grace timer
  if (!graceTimer) {
    graceTimer = setTimeout(() => {
      // Still no zones after grace period - turn off
      syncLED(0, []);
    }, ZONE_LOSS_GRACE_PERIOD_MS);
  }
} else if (zoneCount > 0) {
  // Clear grace timer if zones detected
  clearTimeout(graceTimer);
  syncLED(zoneCount, zoneIds);
}
```

### Solution 2: Historical State Tracking
Track zone history and require multiple consecutive empty zone reports before turning off.

### Solution 3: Session-Aware Logic
Only allow LED off when `sessionEnded: true` is explicitly signaled.

## Related Configuration

Fitness ambient LED config (working correctly):
```yaml
ambient_led:
  scenes:
    off: garage_led_off
    cool: garage_led_blue
    active: garage_led_green
    warm: garage_led_yellow
    hot: garage_led_orange
    fire: garage_led_red
    fire_all: garage_led_red_breathe
  throttle_ms: 2000  # Already has throttling for HA calls
```

## Testing Recommendations

After fix implementation:
1. ✅ LED stays on during brief sensor disconnections (< 30s)
2. ✅ LED turns off after grace period if session truly ends
3. ✅ LED responds to genuine zone changes within throttle period
4. ✅ No flickering during stable workout sessions
5. ✅ Explicit session end immediately turns off LED

## References

- HomeAssistant Integration: `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs`
- Frontend Zone Logic: `frontend/src/apps/fitness/`
- Configuration: `data/households/default/apps/fitness/config.yml`
- API Endpoint: `POST /api/v1/fitness/zone_led`

## Notes

- Bug discovered during production testing 2026-01-25
- HomeAssistant API integration itself is working correctly
- Issue is in zone state change handling logic, not HA communication
- Similar pattern may affect other real-time fitness features
