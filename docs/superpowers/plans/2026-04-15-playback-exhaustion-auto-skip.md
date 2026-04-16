# Playback Exhaustion Auto-Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When video playback fails repeatedly and the resilience system exhausts all recovery attempts, automatically skip to the next queue item instead of showing an infinite spinner.

**Architecture:** Add an `onExhausted` callback to the resilience system that the Player invokes when max recovery attempts are reached. In queue mode, this calls `advance()` to skip to the next item. In single-play mode, it calls `clear()` to dismiss. A toast/log event communicates the skip to the user. The MediaApp-level stall detector is also hardened to catch the `currentTime=0` edge case where it currently fails to arm.

**Tech Stack:** React hooks, existing resilience state machine, existing queue controller, existing playback logging framework

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/modules/Player/hooks/useMediaResilience.js` | Modify | Call `onExhausted` callback when status becomes exhausted |
| `frontend/src/modules/Player/Player.jsx` | Modify | Wire `onExhausted` to advance/clear, pass callback to resilience hook |
| `frontend/src/Apps/MediaApp.jsx` | Modify | Fix stall detector to catch never-started playback (currentTime stuck at 0) |

---

### Task 1: Add `onExhausted` callback to useMediaResilience

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:53-173`

The resilience hook currently sets `STATUS.exhausted` and returns silently when `maxAttempts` is exceeded (line 148-154). It needs to also call an `onExhausted` callback so the Player can react.

- [ ] **Step 1: Add `onExhausted` to the hook's destructured parameters**

In `useMediaResilience.js`, add `onExhausted` to the parameter list at line 53-79:

```javascript
export function useMediaResilience({
  getMediaEl,
  meta = {},
  seconds = 0,
  isPaused = false,
  isSeeking = false,
  pauseIntent = null,
  initialStart = 0,
  explicitStartProvided = false,
  waitKey,
  onStateChange,
  onReload,
  onExhausted,       // NEW: called when all recovery attempts are exhausted
  configOverrides,
  controllerRef,
  plexId,
  playbackSessionKey,
  debugContext,
  message,
  mediaTypeHint,
  playerFlavorHint,
  externalPauseReason = null,
  externalStalled = null,
  externalStallState = null,
  disabled = false
}) {
```

- [ ] **Step 2: Call `onExhausted` when recovery exhausts in `triggerRecovery`**

Replace lines 148-154 of `triggerRecovery` (inside the `maxAttempts` check block):

```javascript
    // Max attempts check — prevents infinite remount loop
    if (tracker.count >= maxAttempts) {
      playbackLog('resilience-recovery-exhausted', {
        reason, waitKey: logWaitKey,
        attempts: tracker.count, maxAttempts
      });
      actions.setStatus(STATUS.exhausted);
      if (typeof onExhausted === 'function') {
        onExhausted({ reason, attempts: tracker.count, waitKey });
      }
      return;
    }
```

- [ ] **Step 3: Add `onExhausted` to the `triggerRecovery` useCallback dependency array**

Update the dependency array at line 173 to include `onExhausted`:

```javascript
  }, [actions, logWaitKey, meta, onReload, onExhausted, playbackHealth.lastProgressSeconds, recoveryCooldownMs, recoveryCooldownBackoffMultiplier, maxAttempts, seconds, statusRef, targetTimeSeconds, initialStart, waitKey, playbackSessionKey]);
```

- [ ] **Step 4: Verify no other references break**

Run: `cd /opt/Code/DaylightStation && npx grep-ast "triggerRecovery" frontend/src/modules/Player/hooks/useMediaResilience.js 2>/dev/null || grep -n "triggerRecovery" frontend/src/modules/Player/hooks/useMediaResilience.js`
Expected: Only the definition (line ~139), calls (lines ~225, ~257), and dependency arrays reference it. No external callers.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.js
git commit -m "feat(player): add onExhausted callback to useMediaResilience

When all recovery attempts are exhausted, calls onExhausted so the
Player can auto-skip instead of showing an infinite spinner."
```

---

### Task 2: Wire `onExhausted` in Player.jsx to advance or clear

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx:521-643`

The Player needs to handle the exhausted callback by advancing to the next queue item (queue mode) or calling `clear` (single-play mode). This is the core fix — it bridges the gap between the resilience system and the queue.

- [ ] **Step 1: Add `handleResilienceExhausted` callback**

Add this new callback after `handleResilienceReload` (after line 605):

```javascript
  const handleResilienceExhausted = useCallback(({ reason, attempts, waitKey: exhaustedWaitKey }) => {
    if (isQueue && hasNextQueueItem) {
      playbackLog('resilience-exhausted-auto-skip', {
        reason,
        attempts,
        waitKey: exhaustedWaitKey,
        action: 'advance',
        queueRemaining: playQueue?.length ?? 0
      }, { level: 'warn' });
      advance();
    } else {
      playbackLog('resilience-exhausted-dismiss', {
        reason,
        attempts,
        waitKey: exhaustedWaitKey,
        action: isQueue ? 'queue-end' : 'clear',
        queueRemaining: playQueue?.length ?? 0
      }, { level: 'warn' });
      clear();
    }
  }, [isQueue, hasNextQueueItem, advance, clear, playQueue]);
```

- [ ] **Step 2: Pass `onExhausted` to useMediaResilience**

In the `useMediaResilience` call (line ~611-643), add the new prop:

```javascript
  const { overlayProps, state: resilienceState, onStartupSignal, cancelDeadline } = useMediaResilience({
    getMediaEl: transportAdapter.getMediaEl,
    meta: effectiveMeta,
    maxVideoBitrate: effectiveMeta?.maxVideoBitrate
      ?? singlePlayerProps?.maxVideoBitrate
      ?? maxVideoBitrate
      ?? null,
    seconds: effectiveMeta ? playbackMetrics.seconds : 0,
    isPaused: effectiveMeta ? playbackMetrics.isPaused : false,
    isSeeking: effectiveMeta ? playbackMetrics.isSeeking : false,
    pauseIntent: effectiveMeta ? playbackMetrics.pauseIntent : null,
    playbackDiagnostics: effectiveMeta ? playbackMetrics.diagnostics : null,
    initialStart: explicitStartSeconds ?? 0,
    explicitStartProvided,
    waitKey: resolvedWaitKey,
    fetchVideoInfo: mediaAccess.fetchVideoInfo,
    nudgePlayback: transportAdapter.nudge,
    diagnosticsProvider: transportAdapter.readDiagnostics,
    onStateChange: compositeAwareOnState,
    onReload: handleResilienceReload,
    onExhausted: handleResilienceExhausted,
    configOverrides: resolvedResilience.config,
    controllerRef: resilienceControllerRef,
    plexId,
    playbackSessionKey,
    debugContext: { scope: 'player', mediaGuid: currentMediaGuid || null },
    externalPauseReason: pauseDecision?.reason,
    externalPauseActive: pauseDecision?.paused,
    externalStalled: effectiveMeta ? playbackMetrics.stalled : null,
    externalStallState: effectiveMeta ? playbackMetrics.stallState : null,
    disabled: isSelfContainedFormat
  });
```

- [ ] **Step 3: Run the dev server and verify no console errors**

Run: `cd /opt/Code/DaylightStation && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): auto-skip to next queue item when resilience exhausts

When all recovery attempts fail for a video, advance() to next queue
item instead of showing infinite spinner. In single-play mode, dismiss
the player. Fixes Shield TV infinite spinner on unplayable content."
```

---

### Task 3: Fix MediaApp stall detector for never-started playback

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx:124-165`

The MediaApp has a stall detector that auto-advances after 30s of no progress. But it has a blind spot: when `currentTime` is 0 (video never started), the detector's `stallRef.current.since` never gets set because the initial comparison (`Math.abs(playbackState.currentTime - prev.time) > 0.5`) is false when both are 0. The `since` field stays at 0, and `prev.since > 0` check on line 138 is never true.

- [ ] **Step 1: Read the current stall detector code**

Read `frontend/src/Apps/MediaApp.jsx` lines 124-165 to confirm the exact current implementation.

- [ ] **Step 2: Fix the effect-based stall detector to handle zero-start case**

Replace the effect-based stall detection (lines 124-147) with a version that arms on the first tick when `currentTime` is 0 and something is playing:

```javascript
  // Stall detection: if playback hasn't advanced for 30s while not paused, auto-advance
  const stallRef = useRef({ time: 0, since: 0 });
  useEffect(() => {
    if (!queue.currentItem || playbackState.paused) {
      stallRef.current = { time: 0, since: 0 };
      return;
    }
    const now = Date.now();
    const prev = stallRef.current;
    if (Math.abs(playbackState.currentTime - prev.time) > 0.5) {
      stallRef.current = { time: playbackState.currentTime, since: now };
      return;
    }
    // Time hasn't changed — arm the timer if not already armed
    if (prev.since === 0) {
      stallRef.current = { time: prev.time, since: now };
      return;
    }
    // Check if stalled long enough
    if (now - prev.since > 30000) {
      logger.warn('media-app.stall-recovery', {
        contentId: queue.currentItem.contentId,
        stalledAt: playbackState.currentTime,
        stallDurationMs: now - prev.since,
      });
      stallRef.current = { time: 0, since: 0 };
      queue.advance(1, { auto: true });
    }
  }, [queue.currentItem?.contentId, playbackState.currentTime, playbackState.paused, queue, logger]);
```

The key change: when `prev.since === 0` and time hasn't changed, we **arm the timer** (`since: now`) instead of ignoring it. This means the very first update where `currentTime` is 0 starts the 30s countdown.

- [ ] **Step 3: Verify the polling-based stall detector still works as backup**

Read lines 150-165 — the polling interval already checks `prev.since > 0`, so with the fix above (which now sets `since` on first tick), the polling backup will also fire correctly.

No changes needed to the polling detector. The fix in step 2 is sufficient because it ensures `stallRef.current.since` gets set to a non-zero value.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx
git commit -m "fix(media): arm stall detector when playback never starts

Previously the stall detector only armed when currentTime changed,
missing the case where video never loads (currentTime stays 0).
Now arms on first tick so the 30s auto-advance fires even for
completely broken playback."
```

---

### Task 4: Verify the fix end-to-end

**Files:**
- Read: `frontend/src/modules/Player/hooks/useMediaResilience.js`
- Read: `frontend/src/modules/Player/Player.jsx`
- Read: `frontend/src/Apps/MediaApp.jsx`

- [ ] **Step 1: Trace the fix path mentally**

Confirm the following sequence will now occur for an unplayable video in queue mode:

1. Video loads, `duration=null`, no progress
2. After 15s: `startup-deadline-exceeded` → `triggerRecovery()` → attempt 1
3. Hard reset → still no progress → 15s → attempt 2 (cooldown: 12s)
4. ... attempts 3, 4, 5 with increasing cooldowns
5. Attempt 5: `tracker.count >= maxAttempts` → `onExhausted()` called
6. `handleResilienceExhausted` → `advance()` → next queue item plays
7. **Backup:** MediaApp stall detector also arms at first tick → auto-advances after 30s independently

- [ ] **Step 2: Build check**

Run: `cd /opt/Code/DaylightStation && npx vite build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Verify no regressions in existing resilience tests**

Run: `cd /opt/Code/DaylightStation && npx vitest run --reporter=verbose frontend/src/modules/Player 2>&1 | tail -20`
Expected: All existing player tests pass.

- [ ] **Step 4: Commit (only if any fixup was needed)**

Only needed if steps 1-3 revealed issues that required code changes.
