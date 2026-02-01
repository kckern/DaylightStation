# Fitness State Machine Fixes - Design Document

**Date**: 2026-01-31
**Status**: Ready for implementation
**Related**: `docs/_wip/bugs/2026-01-31-fitness-state-machine-audit.md`

---

## Problem Summary

Production logs from a 10-minute session revealed critical state machine instability:
- 17 page reloads (11 in a 6-second burst)
- 42 playback stalls with 0 recovery attempts
- 21 governance state resets
- Playhead regression (time going backwards)

## Root Cause Analysis

### Confirmed Root Causes

1. **BUG-002 (Stall Recovery)**: `usePlayheadStallDetection` hook exists with full recovery logic but is **never imported anywhere**. Dead code.

2. **BUG-003 (Timer Coordination)**: Governance timers keep counting during playback stalls, unfairly penalizing users.

3. **BUG-005 (Display Labels)**: Display label SSOT failure - sidebar shows "KC Kern" while governance shows "Dad".

### Unconfirmed Root Cause

4. **BUG-004 (Page Reloads)**: 11 reloads in 6 seconds. Trigger unknown - not player resilience, not error boundary, not user interaction. Possibly browser-level crash recovery or memory pressure.

---

## Architecture Decision

### Rejected: XState Unified State Machine
- Overkill given existing infrastructure
- Would require significant refactor
- Team has limited XState experience

### Accepted: Event-Driven Coordination Using Existing Infrastructure

The codebase already has:
- **FitnessContext**: Local event bus via `emitAppEvent` / `subscribeToAppEvent`
- **WebSocketService**: For backend → frontend communication (HR data)
- **Player Resilience**: Existing reducer-based state machine
- **GovernanceEngine**: Class-based phase management

**Decision**: Connect existing pieces via the local event bus rather than replacing them.

```
┌─────────────────────────────────────────────────────────────────┐
│                    FitnessContext                               │
│            (existing local event bus)                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   emitAppEvent('playback:stalled')                              │
│        │                                                        │
│        ▼                                                        │
│   subscribeToAppEvent('playback:stalled')                       │
│        │                                                        │
│        ▼                                                        │
│   GovernanceEngine._pauseTimers()                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Fix Stall Detection (BUG-002)

**Problem**: `usePlayheadStallDetection` hook is dead code.

**Files**:
- `frontend/src/modules/Fitness/FitnessPlayer.jsx` (or component with video element)
- `frontend/src/modules/Player/hooks/usePlayheadStallDetection.js` (minor addition)

**Changes**:

1. Import and use the existing hook:
```javascript
import { usePlayheadStallDetection } from '../Player/hooks/usePlayheadStallDetection.js';

// In component
const { stallInfo } = usePlayheadStallDetection({
  getMediaEl: () => videoRef.current,
  enabled: isPlaying && !isPaused,
  meta: currentMedia,
  onStallDetected: (info) => {
    emitAppEvent('playback:stalled', info, 'player');
  },
  onRecoveryAttempt: (info) => {
    emitAppEvent('playback:recovery_attempt', info, 'player');
  },
  onRecoveryExhausted: (info) => {
    emitAppEvent('playback:recovery_failed', info, 'player');
  }
});
```

2. Add `onRecovered` callback to the hook (currently missing):
```javascript
// In usePlayheadStallDetection.js, after stall clears
if (typeof onRecovered === 'function') {
  onRecovered({ position: currentTime, stallDurationMs: stallDuration });
}
```

---

### Phase 2: Fix Governance Timer Coordination (BUG-003)

**Problem**: Governance timers don't pause during playback stalls.

**Files**:
- `frontend/src/hooks/fitness/GovernanceEngine.js`

**Changes**:

1. Add subscription in constructor/init:
```javascript
// In GovernanceEngine
_setupPlaybackSubscription(subscribeToAppEvent) {
  this._unsubscribeStalled = subscribeToAppEvent('playback:stalled', () => {
    this._pauseTimers();
  });

  this._unsubscribeRecovered = subscribeToAppEvent('playback:recovered', () => {
    this._resumeTimers();
  });
}

destroy() {
  this._unsubscribeStalled?.();
  this._unsubscribeRecovered?.();
  // ... existing cleanup
}
```

2. Add timer pause/resume methods:
```javascript
_pauseTimers() {
  if (this._timersPaused) return;
  this._timersPaused = true;
  this._pausedAt = Date.now();

  if (this.deadline) {
    this._remainingMs = this.deadline - Date.now();
  }

  this._log('timers_paused', { phase: this.phase, remainingMs: this._remainingMs });
}

_resumeTimers() {
  if (!this._timersPaused) return;
  this._timersPaused = false;

  if (this._remainingMs > 0) {
    this.deadline = Date.now() + this._remainingMs;
  }

  this._log('timers_resumed', { phase: this.phase, newDeadline: this.deadline });
}
```

3. Guard deadline checks:
```javascript
// In evaluate() or anywhere deadline is checked
if (this._timersPaused) {
  return; // Skip evaluation while paused
}
```

---

### Phase 3: Add Reload Diagnostics (BUG-004)

**Problem**: Unknown cause of rapid page reloads.

**Files**:
- `frontend/src/Apps/FitnessApp.jsx`

**Changes**:

1. Add beforeunload listener to capture reload triggers:
```javascript
// At module scope in FitnessApp.jsx
if (typeof window !== 'undefined') {
  let reloadDiagnosticsAttached = false;

  if (!reloadDiagnosticsAttached) {
    reloadDiagnosticsAttached = true;

    window.addEventListener('beforeunload', () => {
      const logger = getLogger();
      logger.error('page_unload_triggered', {
        timestamp: Date.now(),
        url: window.location.href,
        stack: new Error('Unload stack trace').stack,
        performanceMemory: performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize
        } : null
      });
    });
  }
}
```

2. Add visibility change tracking:
```javascript
document.addEventListener('visibilitychange', () => {
  const logger = getLogger();
  logger.info('page_visibility_changed', {
    hidden: document.hidden,
    visibilityState: document.visibilityState
  });
});
```

---

### Phase 4: Add Reload Rate Limiting (Safety Net)

**Problem**: Even if we don't know the cause, prevent reload loops.

**Files**:
- `frontend/src/Apps/FitnessApp.jsx`
- `frontend/src/modules/Player/Player.jsx`

**Changes**:

1. Create shared rate limiter (module scope):
```javascript
// frontend/src/lib/reloadGuard.js
const reloadHistory = [];
const MAX_RELOADS = 3;
const WINDOW_MS = 30000;

export function canReload() {
  const now = Date.now();
  while (reloadHistory.length && reloadHistory[0] < now - WINDOW_MS) {
    reloadHistory.shift();
  }
  return reloadHistory.length < MAX_RELOADS;
}

export function trackReload() {
  reloadHistory.push(Date.now());
}

export function guardedReload(logger, fallbackAction) {
  if (canReload()) {
    trackReload();
    logger?.info('guarded_reload_allowed', { count: reloadHistory.length });
    window.location.reload();
  } else {
    logger?.error('guarded_reload_blocked', {
      count: reloadHistory.length,
      windowMs: WINDOW_MS
    });
    if (typeof fallbackAction === 'function') {
      fallbackAction();
    }
  }
}
```

2. Use in Player.jsx:
```javascript
import { guardedReload } from '../../lib/reloadGuard.js';

const reloadDocument = () => {
  guardedReload(getLogger(), () => {
    // Fallback: show error state instead of reloading
    setFatalError(new Error('App is unstable. Please refresh manually.'));
  });
};
```

---

### Phase 5: Fix Display Label SSOT (BUG-005)

**Problem**: Sidebar shows "KC Kern" while governance shows "Dad".

**Files**:
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx`

**Changes**:

1. Add household config lookup:
```javascript
// Get displayLabel from household config via FitnessContext
const { fitnessConfiguration } = useFitnessContext();

const getHouseholdDisplayLabel = (profileId) => {
  const users = fitnessConfiguration?.fitness?.users;
  if (!users) return null;

  const allUsers = [
    ...(users.primary || []),
    ...(users.secondary || [])
  ];

  const user = allUsers.find(u => u.id === profileId || u.profileId === profileId);
  return user?.displayLabel || null;
};
```

2. Update deviceName resolution:
```javascript
const householdDisplayLabel = profileId ? getHouseholdDisplayLabel(profileId) : null;

const deviceName = isHeartRate ?
  (guestAssignment?.occupantName ||
   guestAssignment?.metadata?.name ||
   householdDisplayLabel ||     // ← Household SSOT first
   displayLabel ||
   ownerName ||
   participantEntry?.name ||
   deviceIdStr)
  : (device.name || String(device.deviceId));
```

---

## Event Schema

New events on the local event bus:

| Event | Payload | Publisher | Subscribers |
|-------|---------|-----------|-------------|
| `playback:stalled` | `{ position, stallDurationMs, videoFps, heapMB }` | Player | Governance |
| `playback:recovered` | `{ position, stallDurationMs, recoveryAttempts }` | Player | Governance |
| `playback:recovery_attempt` | `{ attempt, maxAttempts, strategy }` | Player | (logging) |
| `playback:recovery_failed` | `{ position, recoveryAttempts }` | Player | (logging) |

---

## Testing Plan

### Unit Tests
- [ ] `usePlayheadStallDetection` - verify recovery strategies execute
- [ ] `GovernanceEngine._pauseTimers()` - verify deadline preserved
- [ ] `reloadGuard` - verify rate limiting works

### Integration Tests
- [ ] Stall → recovery flow emits correct events
- [ ] Governance subscribes and pauses timers on stall
- [ ] Display labels resolve correctly from household config

### Manual Testing
- [ ] Simulate stall (network throttle) - verify recovery executes
- [ ] Verify governance countdown pauses during stall
- [ ] Trigger 4+ reloads rapidly - verify rate limiter blocks

---

## Rollout Plan

1. **Deploy Phase 1-2** (stall recovery + timer coordination) - highest impact
2. **Monitor** for 24 hours - check for `playback:recovery_attempt` events
3. **Deploy Phase 3** (diagnostics) - capture any remaining reload triggers
4. **Deploy Phase 4-5** (safety net + labels) - cleanup

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Stall recovery attempts | 0 | >0 when stalls occur |
| Extended stalls (>3s) | 5 per session | <1 per session |
| Page reloads per session | 17 | <3 |
| Governance resets | 21 | <5 |

---

## Open Questions

1. **What triggers the rapid reloads?** Phase 3 diagnostics should reveal this.
2. **Should we add memory pressure detection?** Could auto-reduce chart data if heap grows too fast.
3. **Should GovernanceEngine use XState long-term?** Current fix is tactical; may want strategic refactor later.
