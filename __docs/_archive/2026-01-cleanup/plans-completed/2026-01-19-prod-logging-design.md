# Production Logging Enhancement Design

**Date:** 2026-01-19
**Purpose:** Add logging to diagnose FPS degradation during governance warning state, detect render thrashing, and correlate memory growth with system events.

## Overview

Enhance production logging to capture correlations between:
- Governance state changes and video FPS
- Render frequency and memory growth
- Challenge triggers and system performance

## 1. Governance Event Logging

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js`

### New Events

| Event | Fields | Rate Limit |
|-------|--------|------------|
| `governance.challenge_triggered` | challengeId, zone, requiredCount, participantCount, phase | 30/min |
| `governance.challenge_completed` | challengeId, success, durationMs, participantResults | 30/min |
| `governance.challenge_expired` | challengeId, reason, participantsAtExpiry | 30/min |
| `governance.user_zone_change` | oderId, odeName, fromZone, toZone, hr, hrPercent | 30/min |
| `governance.warning_started` | deadline, participantsBelowThreshold, lockRequirements | 30/min |
| `governance.lock_triggered` | reason, participantStates, timeSinceWarning | 30/min |

### Implementation Notes

- Zone changes only log on actual transitions (compare previous zone)
- Store `previousZoneMap` in engine to detect changes
- Include `mediaId` in all events for filtering

## 2. Video FPS Monitoring

**File:** `frontend/src/Apps/FitnessApp.jsx` (extend fitness-profile interval)

### New Events

| Event | Fields | Trigger |
|-------|--------|---------|
| `fitness.video_fps` | fps, droppedFrames, dropRate, totalFrames, governancePhase, governanceVideoLocked, timeSincePhaseChange, heapMB | Every 30s (5s during warning) |
| `fitness.video_fps_warning_correlation` | fps, dropRate, warningDurationMs, participantCount, heapMB | When fps < 24 AND phase === 'warning' |

### Data Source

```javascript
const video = document.querySelector('video, dash-video');
const quality = video?.getVideoPlaybackQuality?.();
// quality.totalVideoFrames, quality.droppedVideoFrames, quality.corruptedVideoFrames
```

### Sampling Strategy

- Normal operation: 30s interval (aligned with fitness-profile)
- During `warning` phase: 5s interval
- On phase transition to/from `warning`: immediate snapshot

## 3. Render Thrashing Detection

**File:** `frontend/src/hooks/fitness/useRenderProfiler.js` (new hook)

### New Events

| Event | Fields | Threshold |
|-------|--------|-----------|
| `fitness.render_thrashing` | component, rendersInWindow, renderRate, governancePhase | >10 renders/sec for 2s |
| `fitness.component_remount` | component, mountCount, avgMountDurationMs | >3 mounts in 60s |
| `fitness.effect_cascade` | effectName, triggerCount, dependencies | >20 triggers in 10s |

### Implementation

```javascript
// useRenderProfiler.js
export function useRenderProfiler(componentName) {
  const renderCount = useRef(0);
  const renderTimestamps = useRef([]);
  const mountCount = useRef(0);

  // Track renders
  renderCount.current++;
  renderTimestamps.current.push(performance.now());

  // Prune old timestamps (keep last 5s)
  const cutoff = performance.now() - 5000;
  renderTimestamps.current = renderTimestamps.current.filter(t => t > cutoff);

  // Check for thrashing
  const renderRate = renderTimestamps.current.length / 5;
  if (renderRate > 10) {
    logger.warn('fitness.render_thrashing', { component: componentName, renderRate, ... });
  }

  // Track mounts
  useEffect(() => {
    mountCount.current++;
    return () => {
      // Log unmount with mount count
    };
  }, []);
}
```

### Components to Profile

- `FitnessPlayer`
- `FitnessChart`
- `FitnessPlayerOverlay`
- `GovernancePanel`
- `FitnessSidebar`

## 4. Enhanced Memory Profile

**File:** `frontend/src/Apps/FitnessApp.jsx` (extend logProfile function)

### Additional Fields for fitness-profile

```javascript
logger.sampled('fitness-profile', {
  // Existing fields...

  // Governance correlation
  governancePhase: window.__fitnessGovernance?.phase || null,
  governanceWarningDurationMs: window.__fitnessGovernance?.warningDuration || 0,
  challengeActive: Boolean(window.__fitnessGovernance?.activeChallenge),

  // Video correlation
  videoFps: videoStats?.fps || null,
  videoDroppedFrames: videoStats?.droppedFrames || 0,
  videoState: getVideoState(), // 'playing'|'paused'|'stalled'|'governance-locked'

  // Render correlation
  renderRatePer5s: window.__fitnessRenderStats?.ratePer5s || null,
  remountCountLast60s: window.__fitnessRenderStats?.remountCount || 0,

  // GC pressure
  heapGrowthRateMBperMin: calculateGrowthRate(heapSamples),
}, { maxPerMinute: dynamicRate }); // 2/min normal, 12/min during warning
```

### New Warning Events

| Event | Condition |
|-------|-----------|
| `fitness-profile-memory-governance-correlation` | heapGrowthMB > 15 AND governancePhase === 'warning' |
| `fitness-profile-memory-render-correlation` | heapGrowthMB > 15 AND renderRatePer5s > 50 |

## 5. Global State Exposure

Components expose stats via `window` for cross-component correlation:

```javascript
// GovernanceEngine.js - expose governance state
window.__fitnessGovernance = {
  phase: this.phase,
  warningDuration: this.meta?.warningStartTime ? Date.now() - this.meta.warningStartTime : 0,
  activeChallenge: this.challengeState?.activeChallenge?.id || null
};

// useRenderProfiler.js - expose render stats
window.__fitnessRenderStats = {
  ratePer5s: calculateRate(),
  remountCount: getMountCount()
};
```

## 6. Log Analysis Queries

### Grep patterns for prod log analysis

```bash
# FPS degradation during warning
grep "video_fps_warning_correlation" prod.log

# Memory growth during governance warning
grep "memory-governance-correlation" prod.log

# Render thrashing events
grep "render_thrashing" prod.log

# All governance phase changes
grep "governance.phase_change" prod.log | jq 'select(.data.to == "warning")'

# Challenge lifecycle
grep -E "challenge_(triggered|completed|expired)" prod.log
```

## 7. Implementation Order

1. **Governance events** - GovernanceEngine.js changes
2. **Window state exposure** - Enable cross-component correlation
3. **FPS monitoring** - Add to fitness-profile interval
4. **useRenderProfiler hook** - Create and integrate
5. **Enhanced fitness-profile** - Add correlation fields
6. **Warning thresholds** - Add correlation warnings

## 8. Testing

- Run 15-minute simulation with governance cycling
- Verify all events appear in dev.log
- Confirm correlation fields populated correctly
- Check log volume is reasonable (<100 lines/min during active session)
