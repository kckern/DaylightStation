# Governance Detection Bug - Root Cause Analysis

## Summary

The FitnessGovernance overlay is not detecting users because the `updateSnapshot()` method in FitnessSession.js is **hanging** before it reaches the governance evaluation code.

## Root Cause Hypothesis

The `ensureSeriesCapacity()` function contains a while loop that could hang if `intervalIndex` is extremely large:

```javascript
// From frontend/src/hooks/fitness/types.js
export const ensureSeriesCapacity = (arr, index) => {
  if (!Array.isArray(arr)) return;
  while (arr.length <= index) {  // ← POTENTIAL INFINITE/LONG LOOP
    arr.push(null);
  }
};
```

This function is called in `updateSnapshot()` at line 1371:

```javascript
// From FitnessSession.js updateSnapshot() method
allUsers.forEach(user => {
  const series = this.snapshot.participantSeries.get(userId) || [];
  ensureSeriesCapacity(series, intervalIndex);  // ← HANG HERE
  series[intervalIndex] = hrValue > 0 ? hrValue : null;
  this.snapshot.participantSeries.set(userId, series);
});
```

If `intervalIndex` is calculated incorrectly (e.g., millions instead of tens), this while loop will try to allocate a massive array, causing the browser to hang or run out of memory.

## Evidence

1. ✅ `PHASE_4_CODE_LOADED_updateSnapshot` logs appear - method IS being called
2. ❌ `GOVERNANCE_SECTION_REACHED` logs never appear - method stops before line 1412
3. ❌ No JavaScript exceptions in logs - not a thrown error, likely a hang
4. The code between start and governance section includes `ensureSeriesCapacity(series, intervalIndex)` called for EACH user

## How intervalIndex is Calculated

```javascript
const intervalMs = this.treasureBox?.coinTimeUnitMs || this.timebase.intervalMs || 5000;
const now = Date.now();
const elapsed = this.timebase.startAbsMs ? Math.max(0, now - this.timebase.startAbsMs) : 0;
const intervalIndex = intervalMs > 0 ? Math.floor(elapsed / intervalMs) : 0;
```

**Potential Issues:**
- If `this.timebase.startAbsMs` is set to a very old timestamp (e.g., Unix epoch 0, or a timestamp from years ago)
- If `intervalMs` is very small (e.g., 1ms instead of 5000ms)
- Then `intervalIndex` could be in the millions or billions

**Example:**
```javascript
// If startAbsMs is from yesterday (24 hours ago):
elapsed = 24 * 60 * 60 * 1000 = 86,400,000 ms
intervalIndex = 86,400,000 / 5000 = 17,280

// If startAbsMs is from a week ago:
elapsed = 7 * 24 * 60 * 60 * 1000 = 604,800,000 ms
intervalIndex = 604,800,000 / 5000 = 120,960

// With 5 users, this would try to create 5 arrays each with 120,960+ elements
// This could cause significant slowdown or browser hang
```

## Fixes Implemented

### 1. Added Guard Against Large intervalIndex (Line 1358-1369)

```javascript
// CRITICAL DEBUG: Check if intervalIndex is reasonable
if (intervalIndex > 100000) {
  getLogger().error('🚨 CRITICAL: intervalIndex TOO LARGE', {
    intervalIndex,
    intervalMs,
    elapsed,
    startAbsMs: this.timebase.startAbsMs,
    now,
    userId
  });
  // Skip this user to prevent hang
  return;
}
```

This prevents the hang by skipping users if intervalIndex is unreasonably large (>100,000).

### 2. Added Interval Calculation Logging (Line 1316-1324)

```javascript
// CRITICAL DEBUG: Log interval calculation
getLogger().error('📊 INTERVAL_CALC', {
  intervalIndex,
  intervalMs,
  elapsed,
  elapsedHours: (elapsed / 1000 / 60 / 60).toFixed(2),
  startAbsMs: this.timebase.startAbsMs,
  now
});
```

This will show us exactly what intervalIndex is being calculated and why.

### 3. Added Checkpoint Logs Throughout updateSnapshot()

- `🔵 CHECKPOINT_1_sessionId_ok` (line 1299) - After sessionId check
- `🔵 CHECKPOINT_2_roster_synced` (line 1337) - After roster sync
- `🔵 CHECKPOINT_3_users_processed` (line 1377) - After user processing
- `🔵 CHECKPOINT_4_about_to_reach_governance` (line 1420) - Before governance section

These will pinpoint exactly where execution stops.

## Next Steps

### 1. Refresh Your Browser

The new logging and safeguards need to be loaded:

```bash
# Hard refresh in browser:
# Mac: Cmd+Shift+R
# Windows/Linux: Ctrl+Shift+R
```

### 2. Check Logs for New Markers

After refreshing, check dev.log for:

```bash
tail -100 dev.log | grep -E "INTERVAL_CALC|CHECKPOINT|CRITICAL"
```

### 3. Expected Outcomes

**If intervalIndex is TOO LARGE:**
You'll see:
```json
{
  "event": "🚨 CRITICAL: intervalIndex TOO LARGE",
  "intervalIndex": 999999,
  "elapsed": ...,
  "startAbsMs": ...
}
```

**Solution:** Fix the `timebase.startAbsMs` initialization - it's probably being set to an old timestamp instead of the current session start time.

**If intervalIndex is reasonable:**
You'll see:
```json
{
  "event": "📊 INTERVAL_CALC",
  "intervalIndex": 42,
  "intervalMs": 5000,
  "elapsedHours": "0.06"
}
```

And then governance should work (you'll see `GOVERNANCE_SECTION_REACHED` logs).

## Permanent Fix

Once we confirm the root cause, we should:

1. **Fix timebase initialization** - Ensure `this.timebase.startAbsMs` is set to the current session start time, not an old timestamp
2. **Add bounds checking** - Keep the `intervalIndex > 100000` check as a safeguard
3. **Add max capacity** - Modify `ensureSeriesCapacity` to have a maximum capacity limit:

```javascript
export const ensureSeriesCapacity = (arr, index, maxCapacity = 100000) => {
  if (!Array.isArray(arr)) return;
  if (index > maxCapacity) {
    console.error('Series capacity exceeded:', { index, maxCapacity });
    return;
  }
  while (arr.length <= index) {
    arr.push(null);
  }
};
```

## Timeline

- **Issue Reported:** 2026-01-03 ~02:59 UTC
- **Diagnosis:** 2026-01-03 ~03:00 UTC
- **Fixes Added:** 2026-01-03 ~03:01 UTC
- **Status:** Awaiting browser refresh to confirm diagnosis

## Related Files

- `frontend/src/hooks/fitness/FitnessSession.js` - Main session management (updateSnapshot method)
- `frontend/src/hooks/fitness/types.js` - Contains ensureSeriesCapacity function
- `frontend/src/hooks/fitness/GovernanceEngine.js` - Target that's not being reached
- `docs/governance-debug-status.md` - Previous debugging documentation
- `docs/entityId-migration-complete.md` - Phase 4 migration context
