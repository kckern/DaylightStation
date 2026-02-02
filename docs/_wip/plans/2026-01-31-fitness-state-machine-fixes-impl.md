# Fitness State Machine Fixes - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical state machine bugs causing 17 page reloads, 42 unrecovered playback stalls, and governance timer unfairness in 10-minute sessions.

**Architecture:** Connect existing infrastructure (dead stall detection hook, local event bus, governance engine) via pub/sub events. Add diagnostics for unknown reload trigger and safety net rate limiting.

**Tech Stack:** React hooks, FitnessContext event bus (`emitAppEvent`/`subscribeToAppEvent`), GovernanceEngine class, playbackLogger

---

## Task 1: Add `onRecovered` Callback to Stall Detection Hook

**Files:**
- Modify: `frontend/src/modules/Player/hooks/usePlayheadStallDetection.js:75-82`

**Step 1: Read current hook signature**

Verify the hook accepts these callbacks: `onStallDetected`, `onRecoveryAttempt`, `onRecoveryExhausted`. We need to add `onRecovered`.

**Step 2: Add onRecovered to destructured options**

In `usePlayheadStallDetection.js` at line 75-82, add `onRecovered` to the parameter list:

```javascript
export function usePlayheadStallDetection({
  getMediaEl,
  enabled = true,
  meta = {},
  onStallDetected,
  onRecoveryAttempt,
  onRecoveryExhausted,
  onRecovered  // ← Add this
}) {
```

**Step 3: Call onRecovered when stall clears**

Find the stall recovery section (around line 314-324) where `playback.stall_recovered` is logged. Add the callback invocation after the log:

```javascript
// Around line 318-324, after:
logEvent('playback.stall_recovered', {
  position: currentTime,
  stallDurationMs: stallDuration,
  recoveryAttempts: recoveryAttemptsRef.current
});

// Add this:
if (typeof onRecovered === 'function') {
  onRecovered({
    position: currentTime,
    stallDurationMs: stallDuration,
    recoveryAttempts: recoveryAttemptsRef.current
  });
}
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/hooks/usePlayheadStallDetection.js
git commit -m "feat(player): add onRecovered callback to stall detection hook

Enables consumers to react when playback recovers from a stall,
completing the stall lifecycle: detected → recovery attempts → recovered.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Wire Stall Detection Hook into FitnessPlayer

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:1-20` (imports)
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:170-180` (context destructure)
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:180-220` (hook usage)

**Step 1: Add import for usePlayheadStallDetection**

At the top of FitnessPlayer.jsx (around line 5), add:

```javascript
import { usePlayheadStallDetection } from '../Player/hooks/usePlayheadStallDetection.js';
```

**Step 2: Destructure emitAppEvent from context**

Find the `useFitness()` destructure (around line 170-179). Add `emitAppEvent`:

```javascript
const {
  fitnessPlayQueue,
  setFitnessPlayQueue,
  // ... existing destructures ...
  registerVideoPlayer,
  setCurrentMedia,
  trackRecentlyPlayed,
  emitAppEvent  // ← Add this
} = useFitness() || {};
```

**Step 3: Add the hook call after playerRef definition**

After the `playerRef` definition (around line 180), add:

```javascript
// Stall detection and recovery - wires dead hook into live system
usePlayheadStallDetection({
  getMediaEl: () => playerRef.current?.getMediaElement?.(),
  enabled: true,
  meta: currentItem,
  onStallDetected: (info) => {
    emitAppEvent?.('playback:stalled', info, 'fitness-player');
  },
  onRecoveryAttempt: (info) => {
    emitAppEvent?.('playback:recovery_attempt', info, 'fitness-player');
  },
  onRecoveryExhausted: (info) => {
    emitAppEvent?.('playback:recovery_failed', info, 'fitness-player');
  },
  onRecovered: (info) => {
    emitAppEvent?.('playback:recovered', info, 'fitness-player');
  }
});
```

**Step 4: Verify playerRef has getMediaElement method**

Confirm `playerRef.current?.getMediaElement?.()` is the correct API. The Player component exposes this via `useImperativeHandle`.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "feat(fitness): wire stall detection hook into FitnessPlayer

Connects the previously dead usePlayheadStallDetection hook to the
FitnessPlayer, enabling automatic recovery from playback stalls.
Emits events to the local event bus for governance coordination.

BUG-002: Stall recovery now executes (was 0 recovery attempts).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Timer Pause/Resume Methods to GovernanceEngine

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:137-160` (constructor area)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:727-760` (after _clearTimers)

**Step 1: Add timer pause state properties to constructor**

In the constructor (around line 138), add these properties after existing initialization:

```javascript
// Add after line 204 (after this._updateGlobalState())
this._timersPaused = false;
this._pausedAt = null;
this._remainingMs = null;
```

**Step 2: Add _pauseTimers method**

After the `_clearTimers()` method (around line 726), add:

```javascript
/**
 * Pause governance timers during playback stalls.
 * Preserves remaining time so countdown can resume accurately.
 */
_pauseTimers() {
  if (this._timersPaused) return;
  this._timersPaused = true;
  this._pausedAt = Date.now();

  if (this.meta?.deadline) {
    this._remainingMs = Math.max(0, this.meta.deadline - Date.now());
  }

  getLogger().info('governance.timers_paused', {
    phase: this.phase,
    remainingMs: this._remainingMs,
    mediaId: this.media?.id
  });
}
```

**Step 3: Add _resumeTimers method**

After `_pauseTimers()`, add:

```javascript
/**
 * Resume governance timers after playback recovers.
 * Restores deadline based on preserved remaining time.
 */
_resumeTimers() {
  if (!this._timersPaused) return;
  this._timersPaused = false;

  if (this._remainingMs > 0 && this.meta) {
    this.meta.deadline = Date.now() + this._remainingMs;
  }

  const pauseDuration = this._pausedAt ? Date.now() - this._pausedAt : 0;
  this._pausedAt = null;

  getLogger().info('governance.timers_resumed', {
    phase: this.phase,
    newDeadline: this.meta?.deadline,
    pauseDurationMs: pauseDuration,
    mediaId: this.media?.id
  });
}
```

**Step 4: Add early return guard in evaluate()**

At the start of the `evaluate()` method (around line 1005), add a guard:

```javascript
evaluate({ activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount } = {}) {
  // Skip evaluation while timers are paused (playback stalled)
  if (this._timersPaused) {
    getLogger().debug('governance.evaluate.skipped_paused', { phase: this.phase });
    return;
  }

  const now = Date.now();
  // ... rest of evaluate
```

**Step 5: Reset pause state in reset()**

In the `reset()` method (around line 728-775), add reset of pause state:

```javascript
// Add after this._lastEvaluationTs = null; (around line 767)
this._timersPaused = false;
this._pausedAt = null;
this._remainingMs = null;
```

Also add the same to `_resetToIdle()` (around line 821).

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "feat(governance): add timer pause/resume for playback stalls

Governance timers now pause during playback stalls and resume when
playback recovers. This prevents users from being penalized for
technical issues outside their control.

BUG-003: Grace period countdown now pauses during stalls.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Subscribe GovernanceEngine to Playback Events

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:394-422` (configure method)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:728-750` (reset/destroy area)

**Step 1: Add subscription setup method**

After the `_resumeTimers()` method, add:

```javascript
/**
 * Subscribe to playback events for timer coordination.
 * Call during configure() when subscribeToAppEvent is available.
 */
_setupPlaybackSubscription(subscribeToAppEvent) {
  if (!subscribeToAppEvent || typeof subscribeToAppEvent !== 'function') {
    return;
  }

  // Clean up any existing subscriptions
  this._cleanupPlaybackSubscription();

  this._unsubscribeStalled = subscribeToAppEvent('playback:stalled', () => {
    this._pauseTimers();
  });

  this._unsubscribeRecovered = subscribeToAppEvent('playback:recovered', () => {
    this._resumeTimers();
  });

  getLogger().debug('governance.playback_subscription_setup');
}

/**
 * Clean up playback event subscriptions.
 */
_cleanupPlaybackSubscription() {
  if (typeof this._unsubscribeStalled === 'function') {
    this._unsubscribeStalled();
    this._unsubscribeStalled = null;
  }
  if (typeof this._unsubscribeRecovered === 'function') {
    this._unsubscribeRecovered();
    this._unsubscribeRecovered = null;
  }
}
```

**Step 2: Update configure() to accept subscribeToAppEvent**

Modify the `configure()` method signature (around line 394) to accept the subscription function:

```javascript
configure(config, policies, { subscribeToAppEvent } = {}) {
  this.config = config || {};
  // ... existing code ...

  // Add at end of configure(), before _evaluateFromTreasureBox()
  if (subscribeToAppEvent) {
    this._setupPlaybackSubscription(subscribeToAppEvent);
  }

  // Initial evaluation from current state
  this._evaluateFromTreasureBox();
}
```

**Step 3: Add cleanup to reset() and _resetToIdle()**

In `reset()` (around line 728), add cleanup call:

```javascript
reset() {
  this._clearTimers();
  this._cleanupPlaybackSubscription();  // ← Add this
  if (this._zoneChangeDebounceTimer) {
    // ... rest unchanged
```

Also add to `_resetToIdle()` (around line 782):

```javascript
_resetToIdle() {
  this._clearTimers();
  this._cleanupPlaybackSubscription();  // ← Add this
  if (this._zoneChangeDebounceTimer) {
```

**Step 4: Add destroy() method if not present**

If no `destroy()` method exists, add one after `reset()`:

```javascript
/**
 * Full cleanup for component unmount.
 */
destroy() {
  this.reset();
  this._cleanupPlaybackSubscription();
}
```

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "feat(governance): subscribe to playback events for timer coordination

GovernanceEngine now listens to playback:stalled and playback:recovered
events from the local event bus. Timers automatically pause/resume
to prevent unfair penalties during technical issues.

Completes BUG-003 fix.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Pass subscribeToAppEvent to GovernanceEngine

**Files:**
- Explore: Find where GovernanceEngine is instantiated and configured
- Modify: The file that calls `governanceEngine.configure()`

**Step 1: Find GovernanceEngine instantiation**

Search for `new GovernanceEngine` or `.configure(` calls:

```bash
grep -rn "new GovernanceEngine\|\.configure(" frontend/src/hooks/fitness/ frontend/src/context/
```

**Step 2: Update the configure call to pass subscribeToAppEvent**

Wherever `governanceEngine.configure()` is called, update it to pass the subscription function from FitnessContext:

```javascript
// Example - actual location may vary
governanceEngine.configure(
  fitnessConfig,
  policies,
  { subscribeToAppEvent }  // ← Add this
);
```

**Step 3: Commit**

```bash
git add [modified-file]
git commit -m "feat(fitness): pass subscribeToAppEvent to GovernanceEngine

Enables GovernanceEngine to subscribe to playback events for
timer coordination.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Create Reload Guard Utility

**Files:**
- Create: `frontend/src/lib/reloadGuard.js`

**Step 1: Create the reloadGuard module**

```javascript
/**
 * Reload Guard - Rate limiting for page reloads
 *
 * Prevents reload loops by tracking recent reloads and blocking
 * when the rate exceeds safe thresholds.
 *
 * BUG-004 safety net: Even if we don't know what triggers rapid
 * reloads, this prevents the 11-reloads-in-6-seconds scenario.
 */

import getLogger from './logging/Logger.js';

const reloadHistory = [];
const MAX_RELOADS = 3;
const WINDOW_MS = 30000; // 30 seconds

/**
 * Check if a reload is allowed within rate limits.
 */
export function canReload() {
  const now = Date.now();
  // Prune old entries
  while (reloadHistory.length && reloadHistory[0] < now - WINDOW_MS) {
    reloadHistory.shift();
  }
  return reloadHistory.length < MAX_RELOADS;
}

/**
 * Track a reload attempt.
 */
export function trackReload() {
  reloadHistory.push(Date.now());
}

/**
 * Get current reload count in window.
 */
export function getReloadCount() {
  const now = Date.now();
  while (reloadHistory.length && reloadHistory[0] < now - WINDOW_MS) {
    reloadHistory.shift();
  }
  return reloadHistory.length;
}

/**
 * Perform a guarded reload with rate limiting.
 *
 * @param {Object} options
 * @param {Function} options.fallbackAction - Called if reload is blocked
 * @param {string} options.reason - Reason for the reload attempt
 */
export function guardedReload({ fallbackAction, reason = 'unknown' } = {}) {
  const logger = getLogger();

  if (canReload()) {
    trackReload();
    logger.info('reload_guard.allowed', {
      count: getReloadCount(),
      maxReloads: MAX_RELOADS,
      windowMs: WINDOW_MS,
      reason
    });
    window.location.reload();
  } else {
    logger.error('reload_guard.blocked', {
      count: getReloadCount(),
      maxReloads: MAX_RELOADS,
      windowMs: WINDOW_MS,
      reason
    });
    if (typeof fallbackAction === 'function') {
      fallbackAction();
    }
  }
}

// Export constants for testing
export { MAX_RELOADS, WINDOW_MS };
```

**Step 2: Commit**

```bash
git add frontend/src/lib/reloadGuard.js
git commit -m "feat(lib): add reload guard utility for rate limiting

Prevents reload loops by tracking recent reloads and blocking
when the rate exceeds 3 reloads per 30 seconds.

BUG-004: Safety net against rapid reload loops.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Wire Reload Guard into Player.jsx

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx:22-30` (reloadDocument function)

**Step 1: Import guardedReload**

At the top of Player.jsx, add:

```javascript
import { guardedReload } from '../../lib/reloadGuard.js';
```

**Step 2: Replace reloadDocument implementation**

Replace the existing `reloadDocument` function (lines 22-30) with:

```javascript
const reloadDocument = (reason = 'player-resilience') => {
  guardedReload({
    reason,
    fallbackAction: () => {
      // When reloads are blocked, set a state flag instead
      // This allows the UI to show a "please refresh manually" message
      if (typeof window !== 'undefined') {
        window.__playerReloadBlocked = true;
        // Dispatch event for any listeners
        window.dispatchEvent(new CustomEvent('player:reload-blocked', {
          detail: { reason, timestamp: Date.now() }
        }));
      }
    }
  });
};
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): use reload guard for rate limiting

Player now uses guardedReload() instead of direct window.location.reload().
When reloads exceed 3 per 30 seconds, dispatches event instead.

BUG-004: Prevents reload loop scenarios.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Add Reload Diagnostics to FitnessApp

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:21-50` (early in component, after imports)

**Step 1: Add beforeunload and visibilitychange listeners**

Find the start of the FitnessApp component (around line 22). Add diagnostic listeners in a useEffect:

```javascript
// Add after the logger useMemo (around line 43)

// Reload diagnostics - capture what triggers page unloads
useEffect(() => {
  if (typeof window === 'undefined') return;

  const handleBeforeUnload = () => {
    logger.error('page_unload_triggered', {
      timestamp: Date.now(),
      url: window.location.href,
      stack: new Error('Unload stack trace').stack,
      governancePhase: window.__fitnessGovernance?.phase || null,
      sessionStats: window.__fitnessSession?.getMemoryStats?.() || null,
      performanceMemory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      } : null
    });
  };

  const handleVisibilityChange = () => {
    logger.info('page_visibility_changed', {
      hidden: document.hidden,
      visibilityState: document.visibilityState,
      governancePhase: window.__fitnessGovernance?.phase || null
    });
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}, [logger]);
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "feat(fitness): add reload diagnostic listeners

Captures beforeunload events with stack traces and memory stats
to help identify what triggers rapid page reloads.

BUG-004: Diagnostic phase for unknown reload trigger.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Fix Display Label SSOT in FitnessUsers

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx:116` (context destructure)
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx:890-950` (deviceName resolution)

**Step 1: Ensure fitnessConfiguration is available from context**

Check if `fitnessConfiguration` is already destructured from `useFitnessContext()`. If not, add it:

```javascript
const {
  connected,
  fitnessDevices,
  // ... existing destructures ...
  fitnessConfiguration,  // ← Ensure this is present
  deviceOwnership,
} = fitnessContext;
```

**Step 2: Add helper function to get household display label**

Before the device rendering loop (around line 880), add:

```javascript
/**
 * Get displayLabel from household config (SSOT for user names).
 * This ensures sidebar matches governance display.
 */
const getHouseholdDisplayLabel = useCallback((profileId) => {
  const users = fitnessConfiguration?.fitness?.users;
  if (!users || !profileId) return null;

  const allUsers = [
    ...(users.primary || []),
    ...(users.secondary || [])
  ];

  const user = allUsers.find(u =>
    u.id === profileId ||
    u.profileId === profileId ||
    u.slug === profileId
  );

  return user?.displayLabel || null;
}, [fitnessConfiguration]);
```

**Step 3: Update deviceName resolution to prioritize household config**

Find the deviceName resolution (around line 946-947). Update it to:

```javascript
// Get household SSOT label first
const householdDisplayLabel = profileId ? getHouseholdDisplayLabel(profileId) : null;

const deviceName = isHeartRate ?
  (guestAssignment?.occupantName ||
   guestAssignment?.metadata?.name ||
   householdDisplayLabel ||     // ← Household SSOT (e.g., "Dad")
   displayLabel ||
   ownerName ||
   participantEntry?.name ||
   deviceIdStr)
  : (device.name || String(device.deviceId));
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
git commit -m "fix(fitness): resolve display labels from household config SSOT

Sidebar now prioritizes household configuration displayLabel
(e.g., "Dad") over profile names (e.g., "KC Kern").

BUG-005: Sidebar and governance now show consistent labels.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Final Integration Verification

**Step 1: Verify all imports resolve**

Run the dev server and check for import errors:

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npm run dev
```

**Step 2: Check browser console for errors**

Open the fitness app and verify:
- No import/module resolution errors
- `playback:stalled` events emit when video stalls
- `governance.timers_paused` logs appear during stalls
- Sidebar shows configured displayLabel

**Step 3: Test stall recovery manually**

1. Open browser DevTools → Network tab
2. Enable network throttling (Slow 3G)
3. Play a video in FitnessApp
4. Watch for `playback.recovery_attempt` logs
5. Verify governance timer pauses (check logs)

**Step 4: Test reload guard**

1. Open console
2. Run: `for(let i=0; i<5; i++) window.location.reload()`
3. Verify only 3 reloads happen, then blocked

**Step 5: Commit verification notes**

```bash
git add -A
git commit -m "chore: integration verification complete

Verified:
- Stall detection hook wired and emitting events
- Governance timers pause/resume on playback events
- Reload guard blocks rapid reload loops
- Display labels resolve from household config

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | BUG | Files Modified | Status |
|------|-----|----------------|--------|
| 1 | BUG-002 | usePlayheadStallDetection.js | Add onRecovered callback |
| 2 | BUG-002 | FitnessPlayer.jsx | Wire hook to player |
| 3 | BUG-003 | GovernanceEngine.js | Add pause/resume methods |
| 4 | BUG-003 | GovernanceEngine.js | Add event subscriptions |
| 5 | BUG-003 | (varies) | Pass subscribeToAppEvent |
| 6 | BUG-004 | reloadGuard.js | Create rate limiter |
| 7 | BUG-004 | Player.jsx | Use reload guard |
| 8 | BUG-004 | FitnessApp.jsx | Add diagnostics |
| 9 | BUG-005 | FitnessUsers.jsx | Fix SSOT resolution |
| 10 | All | Integration | Verification |

---

## Event Schema Reference

| Event | Payload | Publisher | Subscribers |
|-------|---------|-----------|-------------|
| `playback:stalled` | `{ position, stallDurationMs, videoFps, heapMB }` | FitnessPlayer | GovernanceEngine |
| `playback:recovered` | `{ position, stallDurationMs, recoveryAttempts }` | FitnessPlayer | GovernanceEngine |
| `playback:recovery_attempt` | `{ attempt, maxAttempts, strategy }` | FitnessPlayer | (logging) |
| `playback:recovery_failed` | `{ position, recoveryAttempts }` | FitnessPlayer | (logging) |
