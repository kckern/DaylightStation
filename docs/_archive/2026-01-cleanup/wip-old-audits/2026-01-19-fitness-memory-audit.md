# Fitness App Memory & Crash Audit

**Date:** 2026-01-19
**Log file:** `logs/prod-logs-20260119-131804.txt` (27.6MB)
**Session:** `fs_20260119123957`
**Duration:** ~36 minutes (20:30 - 21:16 UTC)

## Executive Summary

Analysis of production logs reveals two critical issues:
1. **Memory leak** causing heap growth from ~15MB to ~405MB over 36 minutes
2. **VoiceMemoOverlay render loop** causing rapid-fire state resets at session end

---

## Issue 1: Memory Leak in FitnessApp.jsx

### Symptoms
- 146 memory warnings (`fitness-profile-memory-warning`)
- 140 excessive render warnings (`fitness-profile-excessive-renders`)
- Peak heap: **405.6 MB** (heapGrowthMB: 381.9)
- ForceUpdate count reaching **317/30s** at peak

### Timeline (from fitness-profile samples)

| Time | heapMB | seriesPoints | snapshotPoints | treasureBox | forceUpdates |
|------|--------|--------------|----------------|-------------|--------------|
| 0s   | 14.7   | 0            | 0              | 0           | 1            |
| 60s  | 28.7   | 42           | 34             | 2           | 65           |
| 630s | 88.7   | 1,638        | 1,972          | 323         | 152          |
| 2160s| 405.6  | 11,421       | 7,174          | 1,585       | 317          |

### Root Causes

**1. Series Data Accumulation (Primary)**
- `totalSeriesPoints`: Grew from 0 to 11,421
- `snapshotSeriesPoints`: Grew from 0 to 7,174
- `maxSeriesLength`: Reached 423 points per series
- No pruning threshold triggered (threshold is 2,500)

**2. TreasureBox Timeline Growth**
- `treasureBoxCumulativeLen`: Grew to 422 entries
- `treasureBoxPerColorPoints`: Grew to 1,585
- Below warning threshold (1,500) so no alert fired

**3. Excessive Renders**
- `forceUpdateCount` consistently 100-317 per 30s interval
- `renderCount` tracking 87-296 renders per interval
- Indicates unnecessary re-renders from state thrashing

### Affected Code
- `frontend/src/Apps/FitnessApp.jsx:59-195` - Memory profiling effect
- Session data accumulation in FitnessContext
- Series data structures lacking aggressive pruning

---

## Issue 2: VoiceMemoOverlay Render Loop

### Symptoms
At session end (21:15:59.763Z), a rapid-fire loop occurred:
- 26 `overlay-redo-start-recording` events in 15ms
- Alternating pattern of:
  - `overlay-redo-start-recording`
  - `recording-start-request`
  - `overlay-open-stale-state-reset` (previousState: "requesting")

### Root Cause
The VoiceMemoOverlay has a stale state detection mechanism that:
1. Detects "requesting" state as stale
2. Resets to "redo" mode
3. "redo" mode auto-triggers `start-recording`
4. This sets state to "requesting"
5. Next render detects "requesting" as stale
6. Loop continues

### Trigger Condition
```json
{
  "event": "overlay-open-capture",
  "memoId": null,
  "autoAccept": true,
  "fromFitnessVideoEnd": true
}
```

This occurs when a video ends and auto-capture is enabled, but no memo exists yet.

### Affected Code
- `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`
- `frontend/src/hooks/fitness/VoiceMemoManager.js`

---

## Session Statistics at End

```json
{
  "sample": 73,
  "elapsedSec": 2160,
  "heapMB": 405.6,
  "heapGrowthMB": 381.9,
  "rosterSize": 2,
  "deviceCount": 2,
  "seriesCount": 27,
  "totalSeriesPoints": 11421,
  "maxSeriesLength": 423,
  "eventLogSize": 500,
  "snapshotSeriesPoints": 7174,
  "treasureBoxCumulativeLen": 422,
  "treasureBoxPerColorPoints": 1585,
  "voiceMemoCount": 0,
  "forceUpdateCount": 317,
  "renderCount": 296
}
```

---

## Recommendations

### High Priority

1. **Add debouncing to VoiceMemoOverlay state transitions**
   - Prevent `overlay-open-stale-state-reset` from firing multiple times
   - Add a "recentlyReset" flag with cooldown period
   - Location: `VoiceMemoOverlay.jsx` useEffect for stale state detection

2. **Lower series pruning thresholds**
   - Current: 2,500 points triggers warning
   - Suggested: 1,000 points triggers pruning
   - Location: FitnessSession series management

3. **Add TreasureBox timeline pruning**
   - Prune old entries beyond rendering viewport
   - Keep only last N entries per color

### Medium Priority

4. **Investigate forceUpdate frequency**
   - 100-300+ forceUpdates per 30s is excessive
   - Review what's calling `_notifyMutation()` so frequently
   - Consider batching updates with requestAnimationFrame

5. **Add circuit breaker for voice memo recording**
   - Prevent recording start if already in "requesting" state
   - Location: `VoiceMemoManager.js` or recorder component

### Low Priority

6. **Reduce treasurebox logging verbosity**
   - Currently logs every heart rate reading
   - Consider sampling or aggregating

---

## No Issues Found

- No orphan timer errors (`fitness-profile-orphan-timer`: 0)
- No series pruning warnings (`fitness-profile-series-warning`: 0)
- No snapshot series warnings (`fitness-profile-snapshot-series-warning`: 0)
- No treasurebox warnings (`fitness-profile-treasurebox-warning`: 0)
- No TypeError/ReferenceError crashes
- Session saved successfully (ticks=16, series=7)

---

## Related Files

- `frontend/src/Apps/FitnessApp.jsx` - Main app with profiling
- `frontend/src/hooks/fitness/VoiceMemoManager.js` - Memo management
- `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx` - UI with loop bug
- `frontend/src/context/FitnessContext.jsx` - Session state management
