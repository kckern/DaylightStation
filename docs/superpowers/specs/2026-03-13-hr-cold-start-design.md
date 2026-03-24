# HR Cold Start Fix: Remove Stale Fallback Chain

**Date:** 2026-03-13
**Status:** Draft
**Scope:** Frontend state management (ParticipantRoster, UserManager, TimelineRecorder)

## Problem

When an HR device connects at the start of a fitness session, the chart shows a spike at the previous session's HR value before dropping to the real reading. Users see a brief flash of the wrong zone color (e.g., green/active from last session's 150 BPM) before the actual resting HR (~70 BPM) takes over.

### Root Cause

Three layers of stale data create the spike:

1. **`UserManager.#updateHeartRateData()`** (line 84) preserves `currentData.heartRate` when HR is 0/null (disconnect). The previous session's last HR persists indefinitely.
2. **`ParticipantRoster._buildRosterEntry()`** (lines 390-397) **unconditionally overwrites** `resolvedHeartRate` with `mappedUser.currentData.heartRate` when available — this is not a fallback, it always prefers the stale cached value over the device's current reading.
3. **`TimelineRecorder.stageUserEntry()`** (line 237) falls back to `user.currentData?.heartRate` via nullish coalescing when device snapshot has no HR. The stale value gets recorded as the first timeline tick.

### Evidence

Session log audit (20+ sessions) confirms:
- Device 40475 (Garmin): 5-550 seconds of null HR on cold start
- Multi-participant sessions: late-joining devices show 45s-18min null gaps
- No literal HR=0 in data (BLE decoder rejects at source)
- First real HR is always physiologically plausible (60-130 range), confirming the spike comes from stale cache, not the device

## Design

### Principle

**Device is the single source of truth for HR.** If the device has no reading, record null. Never fall back to cached user data.

### Change 1: ParticipantRoster — Remove stale `currentData` override

**File:** `frontend/src/hooks/fitness/ParticipantRoster.js`
**Lines:** 390-397

**Current behavior:**
```javascript
let resolvedHeartRate = heartRate;  // from device (line 354)
if (mappedUser?.currentData && Number.isFinite(mappedUser.currentData.heartRate)) {
  const candidateHr = Math.round(mappedUser.currentData.heartRate);
  if (candidateHr > 0) {
    resolvedHeartRate = candidateHr;  // ALWAYS overwrites, not just fallback
  }
}
```

**New behavior:** Delete this block entirely. `resolvedHeartRate` uses only the device value from line 354: `Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null`.

**Effect on roster:** The participant still appears in the roster with `heartRate: null`. They are NOT excluded from the roster — `_buildRosterEntry()` returns a valid entry regardless of HR value. The **chart rendering** layer already handles null HR by not drawing a line or zone segment for that participant. The participant's avatar will appear but with no chart data until real HR arrives.

### Change 2: UserManager — Clear HR on disconnect

**File:** `frontend/src/hooks/fitness/UserManager.js`
**Lines:** 84-88

**Current behavior:**
```javascript
#updateHeartRateData(heartRate) {
  if (!heartRate || heartRate <= 0) {
    return;  // Preserves stale data from previous session
  }
  // ... updates currentData with new HR, zone, color
}
```

**New behavior:** When HR is 0/null, explicitly clear HR-related fields:
```javascript
#updateHeartRateData(heartRate) {
  if (!heartRate || heartRate <= 0) {
    this.currentData.heartRate = null;
    this.currentData.zoneId = null;
    this.currentData.zoneColor = null;
    return;
  }
  // ... rest unchanged
}
```

**Downstream impact of clearing `currentData`:**

| Consumer | File | Behavior after clear |
|----------|------|---------------------|
| `ZoneProfileStore.#computeZoneSnapshot()` | `ZoneProfileStore.js:182` | `Number.isFinite(null)` → false → HR defaults to 0 → user drops to "cool" zone. **This is desired** — a disconnected device should not hold a stale zone. |
| `ZoneProfileStore.#userInputSignature()` | `ZoneProfileStore.js:364` | Signature changes → triggers zone recomputation. Benign. |
| `FitnessSession.js` | `FitnessSession.js:1486` | `Number.isFinite(null)` → false → falls through to legacy fallback or 0. Consistent with "no data" semantics. |
| `User.getMetricsSnapshot()` | `UserManager.js:220` | Returns `heartRate: null` in snapshot → TimelineRecorder records null. This **reinforces Change 3**. |
| `User.summary` getter | `UserManager.js:194` | `currentHR` becomes null. Display consumers see no HR. Correct. |

**Consistency fix:** Guest assignment code at `UserManager.js:435` and `:551` currently sets `currentData.heartRate = 0`. These should be aligned to use `null` for consistency (0 is not a valid HR).

### Change 3: TimelineRecorder — Remove `user.currentData` fallback

**File:** `frontend/src/hooks/fitness/TimelineRecorder.js`
**Lines:** ~237

**Current behavior:**
```javascript
metrics: {
  heartRate: sanitizeHeartRate(snapshot?.heartRate ?? user.currentData?.heartRate),
}
```

**New behavior:**
```javascript
metrics: {
  heartRate: sanitizeHeartRate(snapshot?.heartRate),
}
```

Only record what the device actually reports. If no snapshot HR, record null. This is belt-and-suspenders with Change 2 (which already causes `getMetricsSnapshot()` to return null HR), but removes the architectural dependency on `currentData` being clean.

### Change 4: UserManager — Align guest assignment HR clearing

**File:** `frontend/src/hooks/fitness/UserManager.js`
**Lines:** ~435, ~551

**Current behavior:** Sets `currentData.heartRate = 0` during guest assignment/clearing.

**New behavior:** Set `currentData.heartRate = null` instead, consistent with Change 2. HR=0 is not a valid heart rate and should never be stored.

## What Stays the Same

- **DeviceManager:** Already correct. `heartRate = null` on construct, only accepts `Number.isFinite`.
- **Chart rendering:** Already handles null HR (no line drawn, no zone segment).
- **Mid-session green dashed interpolation:** Unaffected. Only triggers between valid data points within a session.
- **BLE decoder:** Already rejects HR=0 at source.
- **Roster membership:** Participants still appear in roster with null HR — chart layer handles visibility.

## Behavioral Changes

| Scenario | Before | After |
|----------|--------|-------|
| Device connects, no HR yet | Spike at last session's HR, wrong zone color | Participant in roster with null HR; chart shows no line until first real reading |
| Device disconnects mid-session | Last HR preserved in cache, zone holds | HR/zone cleared to null; chart gap appears, existing green dashed interpolation bridges it |
| Device reconnects mid-session | Stale HR shown briefly | Gap until real data flows, then interpolation bridges |
| Session boundary | Stale HR from session N-1 used as initial value in session N | No carryover; clean null state until device delivers real data |
| Zone on disconnect | Preserved at last active zone (e.g., "warm") | Drops to null/cool — correct, device has no data |

## Risk Assessment

**Low risk.** All changes are deletions or simplifications of fallback paths. The happy path (device has real HR data) is completely unchanged.

**Edge case:** If a user has HR from a different device than the one that just connected, that HR is still valid — it comes from the other device's live data via DeviceManager, not from stale `currentData` cache.

## Testing

1. Start session with HR device — verify no spike, chart line appears only after first real HR
2. End session, start new session — verify no carryover from previous session's HR
3. Mid-session device dropout — verify gap appears, then green dashed interpolation bridges it
4. Multi-participant session with staggered device connections — verify late joiners don't spike
5. Verify zone clears on disconnect (not stuck at last active zone)
