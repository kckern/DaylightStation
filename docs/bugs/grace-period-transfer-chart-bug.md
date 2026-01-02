# Grace Period Transfer Chart Bug

## Summary
When a guest is assigned to a device within 1 minute of session start (grace period), the guest should seamlessly take over the previous user's chart line. Instead, the original user's line persists and the guest starts fresh.

## Expected Behavior
1. Soren starts exercising on Device A at 0:00
2. At 0:30, user assigns Jin to Device A (grace period transfer)
3. **Expected**: Soren's line transforms into Jin's line - same data, Jin's avatar
4. Soren should completely disappear from the chart
5. Jin's line should continue accumulating from where Soren left off

## Actual Behavior
1. Soren's line remains visible with "S" dropout badge
2. Jin appears as a new line starting from 0 (or with minimal data)
3. Two separate lines exist instead of one continuous line with changed identity

## Root Cause Analysis

### The Data Flow
1. **Timeline**: Stores per-user metrics in `user:{userId}:{metric}` format (e.g., `user:soren:coins_total`)
2. **Roster**: Contains current participants with `profileId`, `name`, `avatarUrl`, etc.
3. **Chart**: Uses `buildBeatsSeries()` to read timeline data for each roster entry
4. **Cache**: `participantCache` in `useRaceChartWithHistory` stores chart entries to persist dropped-out users

### The Problem
When Jin is assigned during grace period:
- Jin gets added to roster with `profileId: "jin"`
- Chart calls `buildBeatsSeries(jinRosterEntry, getSeries)` 
- `buildBeatsSeries` reads from `user:jin:*` series (which has no data)
- Meanwhile, `user:soren:*` series has all the accumulated data
- Soren is marked as "transferred" but his cache entry persists with old data

### Failed Approaches
1. **Timeline series transfer**: Copy `user:soren:*` to `user:jin:*` - didn't work because cache had stale data
2. **Entity-based routing**: Create entity for Jin - complicated the data flow without solving the issue  
3. **Cache invalidation**: Clear Soren from cache on transfer - race conditions, timing issues
4. **transferVersion state**: Trigger re-render on transfer - React reactivity didn't propagate correctly
5. **timelineUserId metadata**: Store original user ID to read their data - metadata not reaching buildBeatsSeries

## Key Files
- [GuestAssignmentService.js](../../frontend/src/hooks/fitness/GuestAssignmentService.js) - Handles guest assignment, grace period detection
- [FitnessChart.helpers.js](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js) - `buildBeatsSeries()` reads timeline data
- [FitnessChartApp.jsx](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx) - `useRaceChartWithHistory` manages cache
- [FitnessTimeline.js](../../frontend/src/hooks/fitness/FitnessTimeline.js) - Stores all time-series data

## Simplest Possible Fix (Not Yet Working)

The fix should be trivial: When Jin is assigned with `timelineUserId: "soren"`:

```javascript
// In buildBeatsSeries:
const timelineUserId = rosterEntry?.timelineUserId || rosterEntry?.metadata?.timelineUserId || targetId;
const userSeries = getSeries(timelineUserId, metric, seriesOptions);
```

This way Jin's roster entry reads Soren's timeline data. But the metadata isn't being passed through the roster correctly.

## Debugging Checklist
1. [ ] Verify `timelineUserId` is set in metadata during grace period assignment
2. [ ] Verify metadata is included in roster entry (`participantRoster` in FitnessContext)
3. [ ] Verify `buildBeatsSeries` receives the metadata in `rosterEntry`
4. [ ] Verify Soren is filtered out of chart (check `transferredUsers` Set propagation)

## Relevant Logs to Check
```bash
# Check if timelineUserId is being set
grep "timelineUserId" dev.log

# Check if transfer is detected
grep "Grace period transfer" dev.log

# Check transferred users marking
grep "Marked user as transferred" dev.log
```

## Test Scenario
1. Run simulation: `node ./_extentions/fitness/simulation.mjs`
2. Wait for Soren to accumulate ~10 coins (about 30 seconds)
3. Open guest assignment modal for Soren's device
4. Assign Jin to that device
5. Observe: Jin should have Soren's line, Soren should disappear completely
