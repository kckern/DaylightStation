# Fitness Session Bug Bash Report
**Date**: 2026-01-30  
**Session Analyzed**: `fs_20260130190121`  
**Log File**: `logs/prod-logs-20260130-193842.txt`  
**Participants**: 
**Media**: Mario Kart Wii (media_key: 606440, duration: 7243s)

---

## Executive Summary

Analysis of production logs from a 35-minute fitness session revealed **5 critical issues** affecting user experience and system observability. The session experienced 3 UI reloads, a major 8-second playhead stall, timer thrashing, memory pressure, and significant telemetry gaps that obscure root cause analysis.

### Issue Severity Matrix

| Issue | Severity | User Impact | Frequency | Fix Complexity |
|-------|----------|-------------|-----------|----------------|
| Playhead Stall (8+ seconds) | Critical | Session interruption | 1x this session | Medium |
| Timer Thrashing | High | UI instability, battery drain | Recurring | Medium |
| Memory Pressure | High | Performance degradation | Ongoing | High |
| Overlay Telemetry Gap | High | Cannot diagnose issues | Systemic | Low |
| Governance Timing Gap | Medium | Misleading metrics | Systemic | Low |

---

## Issue #1: Playhead Stall at Position 5595.24s

### Description
Video playback became stuck at position 5595.24 seconds for approximately 8 seconds, requiring user to manually reload the UI.

### Timeline
| Time | Event | Evidence |
|------|-------|----------|
| 03:15:34.152 | Stall begins | `fitness-profile` shows `videoFps: 0`, `videoState: "paused"` |
| 03:15:34 - 03:15:42 | Playhead stuck | Multiple log entries show `currentTime: 5595.24593` unchanged |
| 03:15:34.621 | Playhead goes backwards | Position regresses from `5595.24593` to `5595.24493` (-0.001s) |
| 03:15:42.295 | Last stalled position | `currentTime: 5595.2459` still unchanged |
| 03:15:45.158 | User reloads | `fitness-app-mount` event indicates manual refresh |

### Log Evidence

```json
// 03:15:34.152 - Zero FPS detected
{"ts":"2026-01-30T03:15:34.152Z","event":"fitness-profile","data":{
  "videoFps":0,
  "videoState":"paused",
  "heapMB":184.3,
  "memoryGrowthMBPerMin":14.5,
  "currentTime":5595.24593
}}

// 03:15:34.621 - Playhead regression (impossible in normal playback)
{"ts":"2026-01-30T03:15:34.621Z","event":"playback.resumed","data":{
  "currentTime":5595.24493  // DECREASED by 0.001s
}}

// 03:15:42.295 - Still stuck 8 seconds later
{"ts":"2026-01-30T03:15:42.295Z","event":"playback.paused","data":{
  "currentTime":5595.2459
}}
```

### Root Cause Analysis
1. **Zero FPS Condition**: Video decoder stopped producing frames
2. **Buffer Corruption**: Playhead regression indicates corrupted buffer state
3. **Auto-Recovery Failure**: Pause/resume cycles attempted but failed (1ms apart)
4. **Memory Pressure**: 184MB heap with 14.5 MB/min growth rate approaching limits

### Proposed Remediation

#### Immediate (Code Fix)
```javascript
// In VideoPlayer or PlaybackManager
const STALL_THRESHOLD_MS = 3000;
const MAX_RECOVERY_ATTEMPTS = 3;

let lastPlayheadPosition = 0;
let stallStartTime = null;
let recoveryAttempts = 0;

function detectStall(currentTime) {
  if (Math.abs(currentTime - lastPlayheadPosition) < 0.01) {
    if (!stallStartTime) stallStartTime = Date.now();
    const stallDuration = Date.now() - stallStartTime;
    
    if (stallDuration > STALL_THRESHOLD_MS) {
      sessionInstance.logEvent('playback.stall_detected', {
        position: currentTime,
        stallDurationMs: stallDuration,
        recoveryAttempts,
        videoFps: getVideoFps(),
        heapMB: performance.memory?.usedJSHeapSize / 1024 / 1024
      });
      
      if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
        attemptRecovery();
        recoveryAttempts++;
      } else {
        // Escalate to user notification
        showStallRecoveryPrompt();
      }
    }
  } else {
    stallStartTime = null;
    recoveryAttempts = 0;
    lastPlayheadPosition = currentTime;
  }
}
```

#### Long-term
- Implement proactive buffer health monitoring
- Add video decoder reset capability
- Consider HLS segment retry logic for network issues

---

## Issue #2: Timer Thrashing

### Description
The `tick_timer` started 10+ times within 5 seconds, indicating React component re-mounting creating duplicate timers without proper cleanup.

### Log Evidence

```
03:15:34.152Z tick_timer.started
03:15:34.156Z tick_timer.started  // 4ms later - DUPLICATE
03:15:34.612Z tick_timer.started  // Another start
03:15:34.615Z tick_timer.stopped
03:15:34.616Z tick_timer.started  // 1ms after stop
03:15:34.621Z tick_timer.stopped
03:15:34.622Z tick_timer.started  // 1ms after stop
03:15:35.128Z tick_timer.started  // Multiple concurrent
03:15:35.633Z tick_timer.started
03:15:36.139Z tick_timer.started
```

### Impact
- Battery drain from excessive timer operations
- UI jank from competing state updates
- Memory leaks from uncleared intervals
- Potential race conditions in state management

### Proposed Remediation

```javascript
// Current problematic pattern (inferred)
useEffect(() => {
  const timer = setInterval(tick, 1000);
  // Missing cleanup or improper dependency array
}, [someDependency]);

// Fixed pattern
const timerRef = useRef(null);

useEffect(() => {
  // Clear any existing timer first
  if (timerRef.current) {
    clearInterval(timerRef.current);
  }
  
  timerRef.current = setInterval(tick, 1000);
  
  return () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };
}, [/* stable dependencies only */]);
```

### Files to Audit
- `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`
- `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx`
- Any component using `setInterval` or `setTimeout`

---

## Issue #3: Memory Pressure

### Description
Heap memory reached 184MB with a growth rate of 14.5 MB/min, indicating memory leaks or insufficient garbage collection.

### Log Evidence

```json
{"ts":"2026-01-30T03:15:34.152Z","event":"fitness-profile","data":{
  "heapMB": 184.3,
  "memoryGrowthMBPerMin": 14.5
}}
```

### Analysis
- At 14.5 MB/min growth, session would consume ~500MB in 35 minutes
- 184MB is approaching browser tab limits (~300-500MB typical)
- Correlates with timer thrashing (new closures not being GC'd)

### Proposed Remediation

1. **Immediate**: Add memory threshold alerting
```javascript
if (heapMB > 150) {
  sessionInstance.logEvent('memory.pressure_warning', {
    heapMB,
    growthRate: memoryGrowthMBPerMin,
    recommendation: heapMB > 200 ? 'RELOAD_RECOMMENDED' : 'MONITOR'
  });
}
```

2. **Long-term**:
   - Audit event listener cleanup in useEffect hooks
   - Review large object caching strategies
   - Implement periodic forced GC via object dereferencing
   - Consider Web Worker offloading for heavy computations

---

## Issue #4: Overlay Component Telemetry Gap (CRITICAL)

### Description
Frontend overlay components (`PlayerOverlayLoading.jsx`, `FitnessPlayerOverlay.jsx`) emit events that **never appear in production logs**, severely limiting diagnostic capability.

### Missing Events

| Component | Expected Event | Purpose | Found in Logs? |
|-----------|---------------|---------|----------------|
| `PlayerOverlayLoading.jsx` | `overlay-summary` | Loading state telemetry | ❌ NO |
| `PlayerOverlayLoading.jsx` | `overlay.hard-reset-*` | Reset attempt tracking | ❌ NO |
| `FitnessPlayerOverlay.jsx` | `challenge_start` | Challenge interaction start | ❌ NO |
| `FitnessPlayerOverlay.jsx` | `challenge_end` | Challenge interaction end | ❌ NO |

### Code Analysis

#### PlayerOverlayLoading.jsx (Lines 176-193)
```javascript
useEffect(() => {
  const interval = setInterval(() => {
    if (Math.random() > 0.75) {  // 25% sample rate - TOO LOW
      playbackLog('overlay-summary', {  // Uses debug-level logging
        currentOverlay,
        duration: overlayDuration,
        // ...
      });
    }
  }, 1000);
  return () => clearInterval(interval);
}, [currentOverlay, overlayDuration]);
```

**Problems Identified**:
1. `playbackLog` uses `log.debug()` - filtered out in production
2. 25% sample rate means 75% of events never logged even if level was correct
3. No remote transport configured for these events

#### FitnessPlayerOverlay.jsx (Lines 256-276)
```javascript
const handleChallengeInteraction = (challengeId, success) => {
  sessionInstance?.logEvent('challenge_start', {  // Uses sessionInstance
    challengeId,
    timestamp: Date.now()
  });
  // ...
};
```

**Problem Identified**:
- `sessionInstance.logEvent()` may not be wired to remote logging transport
- Backend receives `governance.challenge.started` from GovernanceEngine, not `challenge_start` from overlay

### Proposed Remediation

#### Option A: Elevate Log Levels (Quick Fix)
```javascript
// In PlayerOverlayLoading.jsx
import { log } from '@/utils/logging';

// Change from debug to info
playbackLog('overlay-summary', data);  // Currently debug
log.info({ event: 'overlay-summary', data });  // Should be info
```

#### Option B: Wire to Session Logger (Recommended)
```javascript
// In PlayerOverlayLoading.jsx
const { sessionInstance } = useContext(FitnessSessionContext);

useEffect(() => {
  const interval = setInterval(() => {
    // Remove sampling for critical telemetry
    sessionInstance?.logEvent('playback.overlay_state', {
      overlay: currentOverlay,
      duration: overlayDuration,
      buffering: isBuffering,
      stalled: isStalled
    });
  }, 1000);
  return () => clearInterval(interval);
}, [currentOverlay, overlayDuration, sessionInstance]);
```

#### Option C: Add Explicit Stall Detection Event
```javascript
// New event specifically for stall detection
useEffect(() => {
  if (currentOverlay === 'stall' && overlayDuration > 3000) {
    sessionInstance?.logEvent('playback.stall_threshold_exceeded', {
      duration: overlayDuration,
      playheadPosition: currentTime,
      videoFps,
      lastGoodPosition: lastPlayheadRef.current
    });
  }
}, [currentOverlay, overlayDuration]);
```

---

## Issue #5: Governance Warning Duration Reporting Gap

### Description
`fitness-profile` events report `governanceWarningDurationMs: 0` even when the user is actively in warning phase.

### Log Evidence

```json
// 03:06:42 - User IN warning phase (started at 03:06:37)
{"ts":"2026-01-30T03:06:42.091Z","event":"fitness-profile","data":{
  "governanceWarningDurationMs": 0,  // SHOULD BE ~5000ms
  "governancePhase": "warning"
}}
```

### Timeline Showing Gap
| Time | Event | Expected Warning Duration |
|------|-------|--------------------------|
| 03:06:37.123 | `governance.phase_changed` → warning | 0ms |
| 03:06:42.091 | `fitness-profile` emitted | ~5000ms |
| 03:06:47.091 | `fitness-profile` emitted | ~10000ms |
| 03:07:07.456 | `governance.phase_changed` → locked | 30000ms |

All `fitness-profile` events during warning phase showed `governanceWarningDurationMs: 0`.

### Root Cause
The `fitness-profile` event likely reads `warningStartTime` from a different source than the governance engine, or the field is only calculated when warning phase **ends**.

### Proposed Remediation

```javascript
// In fitness-profile emission logic
const calculateWarningDuration = () => {
  if (governancePhase === 'warning' && warningPhaseStartTime) {
    return Date.now() - warningPhaseStartTime;
  }
  return 0;
};

// Emit with live calculation
sessionInstance.logEvent('fitness-profile', {
  // ...other fields
  governanceWarningDurationMs: calculateWarningDuration(),
  governancePhase: currentPhase
});
```

---

## UI Reload Incidents

### Summary
Three `fitness-app-mount` events indicate UI reloads during the session:

| # | Time | Trigger | Impact |
|---|------|---------|--------|
| 1 | 03:01:21.766 | Initial page load | None (expected) |
| 2 | 03:15:45.158 | User recovery from stall | 11 seconds downtime |
| 3 | 03:24:51.321 | Navigation/refresh | Unknown |

### Log Evidence

```json
// Reload #2 - Stall recovery
{"ts":"2026-01-30T03:15:45.158Z","event":"fitness-app-mount","data":{
  "loadContext": "refresh",
  "previousSessionId": "fs_20260130190121"
}}
```

### Correlation with Stalls
Reload #2 occurred exactly 3 seconds after the last stalled playback event, confirming user manually recovered from the Issue #1 stall.

---

## Proposed Logging Improvements Summary

### Priority 1: Critical Observability Gaps

| Change | File | Effort | Impact |
|--------|------|--------|--------|
| Wire overlay events to session logger | `PlayerOverlayLoading.jsx` | Low | High |
| Add explicit `stall_detected` event | `PlaybackManager.js` | Low | Critical |
| Elevate overlay log level to `info` | `PlayerOverlayLoading.jsx` | Low | Medium |
| Remove 25% sampling for stall events | `PlayerOverlayLoading.jsx` | Low | High |

### Priority 2: Enhanced Diagnostics

| Change | File | Effort | Impact |
|--------|------|--------|--------|
| Add timer lifecycle logging | `FitnessPlayerOverlay.jsx` | Low | Medium |
| Add memory pressure alerts | `fitness-profile` emitter | Low | Medium |
| Fix `governanceWarningDurationMs` calculation | Governance module | Medium | Low |
| Add playhead regression detection | `PlaybackManager.js` | Medium | High |

### Priority 3: New Telemetry

| New Event | Trigger | Payload |
|-----------|---------|---------|
| `playback.stall_detected` | Playhead unchanged for 3s | `{position, duration, fps, heap}` |
| `playback.recovery_attempt` | Auto-recovery initiated | `{attempt, method, position}` |
| `memory.pressure_warning` | Heap > 150MB | `{heapMB, growthRate}` |
| `timer.lifecycle` | Timer start/stop | `{timerId, action, componentStack}` |
| `playback.regression_detected` | Playhead goes backwards | `{expected, actual, delta}` |

---

## Recommended Actions

### Immediate (This Sprint)
1. [ ] Add `stall_detected` event with 3-second threshold
2. [ ] Wire `PlayerOverlayLoading` to session logger
3. [ ] Fix timer cleanup in overlay components

### Short-term (Next Sprint)
4. [ ] Implement stall auto-recovery with max attempts
5. [ ] Add memory pressure monitoring and alerting
6. [ ] Fix `governanceWarningDurationMs` calculation

### Long-term (Backlog)
7. [ ] Implement video decoder reset capability
8. [ ] Add Web Worker for heavy computations
9. [ ] Build real-time observability dashboard

---

## Appendix: Search Commands Used

```bash
# Find governance transitions
grep 'governance.phase_changed' logs/prod-logs-20260130-193842.txt | jq -r '[.ts, .data.from, .data.to] | @tsv'

# Find stall evidence
grep 'playback.paused\|playback.resumed' logs/prod-logs-20260130-193842.txt | jq -r '[.ts, .event, .data.currentTime // 0] | @tsv' | tail -40

# Find UI reloads
grep 'fitness-app-mount' logs/prod-logs-20260130-193842.txt | jq .

# Check for overlay events (NONE FOUND)
grep 'overlay-summary\|PlayerOverlayLoading\|overlay.hard-reset' logs/prod-logs-20260130-193842.txt

# Check for challenge events from overlay (NONE FOUND)
grep 'challenge_start\|challenge_end\|FitnessPlayerOverlay' logs/prod-logs-20260130-193842.txt

# Timer thrashing evidence
grep 'tick_timer' logs/prod-logs-20260130-193842.txt | head -20
```

---

## Document History
| Date | Author | Changes |
|------|--------|---------|
| 2026-01-30 | AI Analysis | Initial bug bash report |
