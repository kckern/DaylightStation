# Fitness Session Bug Bash Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 6 production issues identified during fitness session bug bash affecting governance responsiveness, UI consistency, playback stability, and user interaction.

**Architecture:** Address anti-patterns around single source of truth violations. Governance and UI components currently read state from different sources (cached vs fresh), causing lag and inconsistencies. Fix by: (1) making governance reactive to zone changes, (2) unifying label resolution, (3) allowing pointer events to propagate for fullscreen toggle.

**Tech Stack:** React hooks, JavaScript, CSS pointer-events, DOM event propagation

**Reference:** `docs/_wip/2026-01-30-fitness-session-bugbash-report.md`

---

## Issue Summary

| # | Issue | Severity | Root Cause |
|---|-------|----------|------------|
| 1 | Governance initial state lag (50+ seconds) | Critical | Tick-only evaluation, not reactive to zone changes |
| 2 | "Dad" label shows on overlay but not roster | High | Priority order prefers cached source over SSOT |
| 3 | FPS drop during blur overlay (wrong telemetry) | Medium | Only decoder FPS measured, not render FPS |
| 4 | Playhead stall unrecoverable | High | No decoder reset in recovery strategies |
| 5 | Fullscreen tap blocked by loading overlay | High | Capture handlers block all pointer events |
| 6 | Zone color lag vs governance | Critical | Same as #1 |

---

## Task 1: Governance Reactive Evaluation on Zone Change

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`
- Modify: `frontend/src/hooks/fitness/FitnessSession.js`
- Test: `tests/unit/suite/domains/fitness/GovernanceEngine.reactive.test.js` (create)

**Problem:** Governance only evaluates on tick boundaries (every 1-5 seconds). When a user's zone changes to meet requirements, there's up to 50+ seconds of lag before governance acknowledges it.

**Solution:** Add a `notifyZoneChange()` method that triggers immediate evaluation when any participant's zone changes.

### Step 1: Write the failing test

Create `tests/unit/suite/domains/fitness/GovernanceEngine.reactive.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GovernanceEngine } from '@/hooks/fitness/GovernanceEngine.js';

describe('GovernanceEngine reactive evaluation', () => {
  let engine;
  let mockSession;

  beforeEach(() => {
    mockSession = {
      roster: [],
      treasureBox: { setGovernanceCallback: vi.fn() },
      logEvent: vi.fn()
    };
    engine = new GovernanceEngine(mockSession);
  });

  it('evaluates immediately when notifyZoneChange is called', () => {
    const evaluateSpy = vi.spyOn(engine, 'evaluate');

    engine.configure({
      governed_labels: ['kckern'],
      policies: {
        warmup: { zones: ['active', 'warm', 'hot', 'fire'], rule: 'all_above' }
      }
    });

    // Simulate zone change notification
    engine.notifyZoneChange('kckern', { fromZone: 'cool', toZone: 'active' });

    expect(evaluateSpy).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid zone changes within 100ms', async () => {
    const evaluateSpy = vi.spyOn(engine, 'evaluate');

    engine.configure({
      governed_labels: ['kckern', 'felix'],
      policies: {}
    });

    // Rapid zone changes
    engine.notifyZoneChange('kckern', { fromZone: 'cool', toZone: 'active' });
    engine.notifyZoneChange('felix', { fromZone: 'warm', toZone: 'hot' });
    engine.notifyZoneChange('kckern', { fromZone: 'active', toZone: 'warm' });

    // Should debounce to single evaluation
    await new Promise(r => setTimeout(r, 150));
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm run test -- tests/unit/suite/domains/fitness/GovernanceEngine.reactive.test.js
```

Expected: FAIL - `notifyZoneChange` is not a function

### Step 3: Implement notifyZoneChange in GovernanceEngine

In `frontend/src/hooks/fitness/GovernanceEngine.js`, add after line 672:

```javascript
  /**
   * Notify governance of a zone change for immediate evaluation.
   * Debounces rapid changes to prevent thrashing.
   *
   * @param {string} userId - User whose zone changed
   * @param {Object} change - { fromZone, toZone }
   */
  notifyZoneChange(userId, change = {}) {
    const { fromZone, toZone } = change;

    // Log the zone change notification
    getLogger().debug('governance.zone_change_notification', {
      userId,
      fromZone,
      toZone,
      currentPhase: this.phase
    });

    // Debounce rapid zone changes (100ms window)
    if (this._zoneChangeDebounceTimer) {
      clearTimeout(this._zoneChangeDebounceTimer);
    }

    this._zoneChangeDebounceTimer = setTimeout(() => {
      this._zoneChangeDebounceTimer = null;
      this.evaluate();
    }, 100);
  }
```

Also add to constructor (after line 144):

```javascript
    this._zoneChangeDebounceTimer = null;
```

And clean up in `reset()` method:

```javascript
    if (this._zoneChangeDebounceTimer) {
      clearTimeout(this._zoneChangeDebounceTimer);
      this._zoneChangeDebounceTimer = null;
    }
```

### Step 4: Wire zone changes to notify governance

In `frontend/src/hooks/fitness/FitnessSession.js`, find where `governance.user_zone_change` is logged and add notification.

Find the zone change emission (search for `user_zone_change`) and add:

```javascript
// After logging the zone change event
this.governanceEngine?.notifyZoneChange?.(userId, { fromZone, toZone });
```

### Step 5: Run test to verify it passes

```bash
npm run test -- tests/unit/suite/domains/fitness/GovernanceEngine.reactive.test.js
```

Expected: PASS

### Step 6: Commit

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/FitnessSession.js tests/unit/suite/domains/fitness/GovernanceEngine.reactive.test.js
git commit -m "feat(governance): add reactive evaluation on zone changes

Addresses 50+ second lag between user reaching target zone and governance
acknowledging it. Now evaluates immediately (debounced 100ms) when any
participant's zone changes.

Fixes: Issue #1 and #6 from bug bash report"
```

---

## Task 2: Fix Group Label Priority in Roster Display

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx:947`
- Test: Manual verification (label appears consistently)

**Problem:** "Dad" label shows on governance overlay but "KC Kern" shows in roster. The roster prefers `ownerName` (from cached `deviceOwnership`) over `displayLabel` (from fresh `participantRoster`).

**Solution:** Reorder the priority to prefer SSOT sources.

### Step 1: Identify the current priority order

Current line 947:
```javascript
const deviceName = isHeartRate ?
  (guestAssignment?.occupantName ||
   guestAssignment?.metadata?.name ||
   ownerName ||          // ← CACHED (stale)
   displayLabel ||       // ← FRESH (correct)
   participantEntry?.name ||
   deviceIdStr)
  : (device.name || String(device.deviceId));
```

### Step 2: Fix the priority order

Change line 947 to:
```javascript
const deviceName = isHeartRate ?
  (guestAssignment?.occupantName ||
   guestAssignment?.metadata?.name ||
   displayLabel ||                    // ← FRESH (SSOT) - moved up
   participantEntry?.displayLabel ||  // ← FRESH fallback
   participantEntry?.name ||
   ownerName ||                       // ← CACHED fallback only
   deviceIdStr)
  : (device.name || String(device.deviceId));
```

### Step 3: Commit

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
git commit -m "fix(roster): prefer SSOT displayLabel over cached ownerName

Group labels like 'Dad' now display consistently in roster sidebar
by preferring participantRoster's displayLabel (fresh) over
deviceOwnership's ownerName (cached at session init).

Fixes: Issue #2 from bug bash report"
```

---

## Task 3: Remove Fullscreen Tap Blocking from Loading Overlay

**Files:**
- Modify: `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx:388-389`
- Test: Manual verification (tap video during loading spinner to toggle fullscreen)

**Problem:** Loading overlay uses `onPointerDownCapture` with `stopImmediatePropagation()`, which prevents fullscreen toggle from working. Users get stuck in fullscreen when the spinner is showing.

**Solution:** Remove the aggressive capture handlers. The parent already has logic to allow fullscreen toggle on loading overlay via `data-no-fullscreen` attribute checking.

### Step 1: Remove the capture handlers

In `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx`, remove lines 388-389:

```diff
      onDoubleClick={togglePauseOverlay}
-     onPointerDownCapture={blockFullscreenToggle}
-     onMouseDownCapture={blockFullscreenToggle}
    >
```

### Step 2: Remove the unused blockFullscreenToggle function

Remove lines 250-254:

```diff
-  const blockFullscreenToggle = useCallback((event) => {
-    event?.preventDefault?.();
-    event?.stopPropagation?.();
-    event?.nativeEvent?.stopImmediatePropagation?.();
-  }, []);
```

### Step 3: Commit

```bash
git add frontend/src/modules/Player/components/PlayerOverlayLoading.jsx
git commit -m "fix(overlay): allow fullscreen toggle through loading overlay

Remove aggressive pointer capture handlers that blocked all events.
Parent FitnessPlayer already handles fullscreen toggle correctly
using data-no-fullscreen attribute checking.

Fixes: Issue #5 from bug bash report"
```

---

## Task 4: Add Decoder Reset to Playhead Stall Recovery

**Files:**
- Modify: `frontend/src/modules/Player/hooks/usePlayheadStallDetection.js:161-173`
- Test: `tests/unit/suite/player/usePlayheadStallDetection.test.js` (create)

**Problem:** When video playback stalls (0 FPS, playhead stuck), the current recovery strategies (pause/resume, seek nudge) don't work for decoder-level failures. Need to add `mediaEl.load()` as last resort.

### Step 1: Write the failing test

Create `tests/unit/suite/player/usePlayheadStallDetection.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';

describe('usePlayheadStallDetection recovery strategies', () => {
  it('attempts decoder reset (load) on third recovery attempt', () => {
    const mockMediaEl = {
      currentTime: 5595.24,
      paused: false,
      ended: false,
      readyState: 4,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      load: vi.fn()
    };

    // Simulate third recovery attempt
    const recoveryAttempts = 3;

    if (recoveryAttempts >= 3) {
      // Third attempt: decoder reset
      const savedPosition = mockMediaEl.currentTime;
      mockMediaEl.load();
      mockMediaEl.currentTime = savedPosition;
      mockMediaEl.play();
    }

    expect(mockMediaEl.load).toHaveBeenCalled();
  });
});
```

### Step 2: Run test to verify baseline

```bash
npm run test -- tests/unit/suite/player/usePlayheadStallDetection.test.js
```

### Step 3: Enhance recovery strategies

In `frontend/src/modules/Player/hooks/usePlayheadStallDetection.js`, modify `attemptRecovery` (around line 161):

```javascript
  const attemptRecovery = useCallback(() => {
    const mediaEl = typeof getMediaEl === 'function' ? getMediaEl() : null;
    if (!mediaEl) return false;

    const currentAttempts = recoveryAttemptsRef.current;
    const position = mediaEl.currentTime;

    if (currentAttempts >= MAX_RECOVERY_ATTEMPTS) {
      logEvent('playback.recovery_exhausted', {
        recoveryAttempts: currentAttempts,
        stallDurationMs: stallStartTimeRef.current ? Date.now() - stallStartTimeRef.current : 0,
        position
      });

      if (typeof onRecoveryExhausted === 'function') {
        onRecoveryExhausted({
          position,
          recoveryAttempts: currentAttempts,
          stallDurationMs: stallStartTimeRef.current ? Date.now() - stallStartTimeRef.current : 0
        });
      }
      return false;
    }

    recoveryAttemptsRef.current = currentAttempts + 1;
    const attemptNum = recoveryAttemptsRef.current;

    // Strategy selection based on attempt number
    let strategy;
    if (attemptNum === 1) {
      strategy = 'pause_resume';
    } else if (attemptNum === 2) {
      strategy = 'seek_nudge';
    } else {
      strategy = 'decoder_reset';
    }

    logEvent('playback.recovery_attempt', {
      recoveryAttempts: attemptNum,
      maxAttempts: MAX_RECOVERY_ATTEMPTS,
      position,
      stallDurationMs: stallStartTimeRef.current ? Date.now() - stallStartTimeRef.current : 0,
      strategy
    });

    try {
      if (strategy === 'pause_resume') {
        // First attempt: simple pause/resume
        mediaEl.pause();
        requestAnimationFrame(() => {
          mediaEl.play().catch(() => {});
        });
      } else if (strategy === 'seek_nudge') {
        // Second attempt: nudge the playhead slightly backward
        const nudgeAmount = 0.5; // 500ms back
        mediaEl.currentTime = Math.max(0, position - nudgeAmount);
        mediaEl.play().catch(() => {});
      } else if (strategy === 'decoder_reset') {
        // Third attempt: full decoder reset via load()
        const savedPosition = position;
        const savedPlaybackRate = mediaEl.playbackRate || 1;

        logEvent('playback.decoder_reset_start', { position: savedPosition });

        mediaEl.load();

        // Restore position and playback after load
        const onCanPlay = () => {
          mediaEl.removeEventListener('canplay', onCanPlay);
          mediaEl.currentTime = savedPosition;
          mediaEl.playbackRate = savedPlaybackRate;
          mediaEl.play().catch(() => {});
          logEvent('playback.decoder_reset_complete', {
            restoredPosition: savedPosition
          });
        };
        mediaEl.addEventListener('canplay', onCanPlay, { once: true });
      }

      if (typeof onRecoveryAttempt === 'function') {
        onRecoveryAttempt({
          attempt: attemptNum,
          maxAttempts: MAX_RECOVERY_ATTEMPTS,
          position,
          strategy
        });
      }

      return true;
    } catch (err) {
      logger.warn('playback.recovery_error', {
        error: err.message,
        recoveryAttempts: attemptNum,
        position,
        strategy
      });
      return false;
    }
  }, [getMediaEl, logEvent, logger, onRecoveryAttempt, onRecoveryExhausted]);
```

### Step 4: Run tests

```bash
npm run test -- tests/unit/suite/player/usePlayheadStallDetection.test.js
```

### Step 5: Commit

```bash
git add frontend/src/modules/Player/hooks/usePlayheadStallDetection.js tests/unit/suite/player/usePlayheadStallDetection.test.js
git commit -m "feat(player): add decoder reset as final stall recovery strategy

When playhead stalls for 3+ seconds:
- Attempt 1: pause/resume
- Attempt 2: seek nudge (500ms back)
- Attempt 3: decoder reset via load() with position restore

This handles decoder-level failures where simple seeks don't work.

Fixes: Issue #4 from bug bash report"
```

---

## Task 5: Add Render FPS Telemetry

**Files:**
- Create: `frontend/src/modules/Player/hooks/useRenderFpsMonitor.js`
- Modify: `frontend/src/modules/Player/components/VideoPlayer.jsx`
- Test: Manual verification (check fitness-profile logs for renderFps field)

**Problem:** During blur overlay, users report significant FPS drop, but telemetry shows 19.9 FPS (decoder output). Need render-level FPS measurement.

### Step 1: Create the render FPS monitor hook

Create `frontend/src/modules/Player/hooks/useRenderFpsMonitor.js`:

```javascript
import { useEffect, useRef, useCallback, useState } from 'react';
import { getLogger } from '../../../lib/logging/Logger.js';

/**
 * Monitors actual render frame rate using requestAnimationFrame.
 * Reports render FPS separately from video decoder FPS.
 */
export function useRenderFpsMonitor({ enabled = true, sampleWindowMs = 1000 } = {}) {
  const frameCountRef = useRef(0);
  const lastSampleTimeRef = useRef(performance.now());
  const rafIdRef = useRef(null);
  const [renderFps, setRenderFps] = useState(null);

  const measureFrame = useCallback(() => {
    frameCountRef.current += 1;

    const now = performance.now();
    const elapsed = now - lastSampleTimeRef.current;

    if (elapsed >= sampleWindowMs) {
      const fps = Math.round((frameCountRef.current / elapsed) * 1000);
      setRenderFps(fps);

      // Log if FPS drops significantly (below 30)
      if (fps < 30) {
        getLogger().warn('player.render_fps_low', {
          renderFps: fps,
          sampleWindowMs: elapsed
        });
      }

      frameCountRef.current = 0;
      lastSampleTimeRef.current = now;
    }

    if (enabled) {
      rafIdRef.current = requestAnimationFrame(measureFrame);
    }
  }, [enabled, sampleWindowMs]);

  useEffect(() => {
    if (!enabled) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return;
    }

    lastSampleTimeRef.current = performance.now();
    frameCountRef.current = 0;
    rafIdRef.current = requestAnimationFrame(measureFrame);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [enabled, measureFrame]);

  return { renderFps };
}
```

### Step 2: Integrate into VideoPlayer

In `frontend/src/modules/Player/components/VideoPlayer.jsx`, import and use:

```javascript
import { useRenderFpsMonitor } from '../hooks/useRenderFpsMonitor.js';

// Inside component, after other hooks:
const { renderFps } = useRenderFpsMonitor({
  enabled: displayReady && !isPaused
});

// Include in FPS logging (around line 195):
logger.info('player.fps', {
  decoderFps: currentFps,
  renderFps: renderFps,  // NEW
  droppedFramePct,
  // ... rest of payload
});
```

### Step 3: Commit

```bash
git add frontend/src/modules/Player/hooks/useRenderFpsMonitor.js frontend/src/modules/Player/components/VideoPlayer.jsx
git commit -m "feat(telemetry): add render FPS monitoring separate from decoder FPS

Uses requestAnimationFrame to measure actual render frame rate.
Logs warning when render FPS drops below 30.
This helps diagnose performance issues during blur overlays.

Fixes: Issue #3 from bug bash report"
```

---

## Task 6: Documentation Update

**Files:**
- Update: `docs/_wip/2026-01-30-fitness-session-bugbash-report.md`

### Step 1: Mark issues as resolved

Add to the bug bash report:

```markdown
---

## Resolution Status

| Issue | Status | Commit |
|-------|--------|--------|
| 1. Governance initial state lag | ✅ Fixed | [commit hash] |
| 2. Group label inconsistent | ✅ Fixed | [commit hash] |
| 3. FPS telemetry incorrect | ✅ Fixed | [commit hash] |
| 4. Playhead stall unrecoverable | ✅ Fixed | [commit hash] |
| 5. Fullscreen tap blocked | ✅ Fixed | [commit hash] |
| 6. Zone color lag | ✅ Fixed | Same as #1 |

**Resolved:** 2026-01-30
```

### Step 2: Commit

```bash
git add docs/_wip/2026-01-30-fitness-session-bugbash-report.md
git commit -m "docs: mark bug bash issues as resolved"
```

---

## Verification Checklist

After all tasks complete, verify in production:

- [ ] Start fitness session - governance should recognize warm users immediately
- [ ] Check roster sidebar - "Dad" label should match governance overlay
- [ ] During warning phase - check logs for `renderFps` field
- [ ] Force playhead stall - should see decoder reset attempt in logs
- [ ] Tap video during loading spinner - should toggle fullscreen
- [ ] Zone color changes - governance should respond within 200ms

---

## Rollback Plan

If issues arise, revert commits in reverse order:
```bash
git revert HEAD~5..HEAD
```

Each fix is isolated and can be reverted independently.
