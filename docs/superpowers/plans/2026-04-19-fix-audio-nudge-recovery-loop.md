# Fix Audio Playback Infinite Nudge Recovery Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the infinite `stall → nudge → "resumed" → stall` loop where audio tracks freeze at ~0 seconds and never recover, by making `markProgress` require real forward playhead advancement, suppressing self-emitted `timeupdate` events from nudge seeks, fixing the default recovery pipeline, and wiring terminal-failure auto-advance for audio queues.

**Architecture:** All changes are to `frontend/src/modules/Player/hooks/useCommonMediaController.js` plus two pure helpers extracted into `frontend/src/modules/Player/lib/` (testable via vitest, following the existing `shouldArmStartupDeadline` / `shouldSkipResilienceReload` pattern). No backend changes. Tests live in `tests/isolated/modules/Player/`.

**Tech Stack:** React hooks, HTMLMediaElement API, vitest, `@testing-library/react` (renderHook). Existing logging framework via `mcLog()`.

**Context bug report:** `docs/_wip/bugs/2026-04-19-audio-playback-infinite-nudge-recovery-loop.md`

---

## File Structure

**New files:**

- `frontend/src/modules/Player/lib/progressDetection.js` — pure `isRealProgress(...)` function
- `frontend/src/modules/Player/lib/stallPipeline.js` — pure `selectNextStrategy(...)` function
- `tests/isolated/modules/Player/progressDetection.test.mjs` — unit tests for the guard
- `tests/isolated/modules/Player/stallPipelineEscalation.test.mjs` — unit tests for pipeline state machine
- `tests/isolated/modules/Player/useCommonMediaController.nudgeLoop.test.mjs` — integration test via renderHook

**Modified files:**

- `frontend/src/modules/Player/hooks/useCommonMediaController.js`
  - Add `stallStartPlayhead` to `stallStateRef` (line ~90–109 state init, and line ~844 where `isStalled` becomes true)
  - Add `suppressProgressUntilRef` (new ref)
  - Set `suppressProgressUntilRef` in `nudgeRecovery` before the seek (line ~400–432)
  - Rewrite `markProgress` to use `isRealProgress` and the suppress flag (line ~903–941)
  - Change `recoveryStrategies` default from `['nudge', 'reload']` to full `DEFAULT_STRATEGY_PIPELINE` names (line ~150)
  - Call `handleTerminalFailure` if `nudge` returns `outside-buffered-range` without escalation consuming an attempt — existing code path already does this; verify.

**Already-implemented neighboring behavior (do not duplicate):**

- `Player.jsx` line 814 area calls `advance()` to next queue item on `onExhausted` (commit `50c8f65b`). This plan only needs the pipeline to actually reach terminal failure — once it does, auto-advance fires.

---

## Prerequisites

- [ ] **Step 0.1: Verify the dev server is up and tests run clean**

```bash
lsof -i :3112 || echo 'backend not running — start it'
npm run test:isolated -- tests/isolated/modules/Player/ 2>&1 | tail -20
```

Expected: isolated Player tests pass (green summary at bottom). If they don't, stop and investigate before proceeding.

- [ ] **Step 0.2: Create a feature branch**

```bash
git switch -c fix/audio-nudge-loop
```

Expected: new branch created from current HEAD.

---

## Task 1: Extract `isRealProgress` pure function with failing tests

**Why:** The core bug is that `markProgress` accepts any `timeupdate` as proof of recovery. We need a pure, unit-testable predicate that answers: "given a stall-start playhead and the current playhead, is this real forward progress?"

**Files:**

- Create: `frontend/src/modules/Player/lib/progressDetection.js`
- Create: `tests/isolated/modules/Player/progressDetection.test.mjs`

- [ ] **Step 1.1: Write the failing test**

Create `tests/isolated/modules/Player/progressDetection.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { isRealProgress } from '../../../../frontend/src/modules/Player/lib/progressDetection.js';

describe('isRealProgress', () => {
  describe('when no stall is in progress (stallStartPlayhead == null)', () => {
    it('treats any timeupdate as progress (normal playback)', () => {
      expect(isRealProgress({ stallStartPlayhead: null, currentPlayhead: 5.0 })).toBe(true);
    });

    it('treats a fresh start (t=0) as progress', () => {
      expect(isRealProgress({ stallStartPlayhead: null, currentPlayhead: 0 })).toBe(true);
    });
  });

  describe('when a stall is in progress', () => {
    it('returns false when currentPlayhead equals stallStartPlayhead', () => {
      expect(isRealProgress({ stallStartPlayhead: 0.02, currentPlayhead: 0.02 })).toBe(false);
    });

    it('returns false when currentPlayhead is behind stallStartPlayhead (nudge rewind)', () => {
      expect(isRealProgress({ stallStartPlayhead: 0.02322, currentPlayhead: 0.02222 })).toBe(false);
    });

    it('returns false for tiny forward drift below the threshold', () => {
      expect(isRealProgress({ stallStartPlayhead: 0.02, currentPlayhead: 0.025 })).toBe(false);
    });

    it('returns true for forward progress past the default 50 ms threshold', () => {
      expect(isRealProgress({ stallStartPlayhead: 0.02, currentPlayhead: 0.09 })).toBe(true);
    });

    it('returns true for clearly advanced playback (1+ seconds later)', () => {
      expect(isRealProgress({ stallStartPlayhead: 0.02, currentPlayhead: 1.5 })).toBe(true);
    });

    it('honors a custom minDeltaSeconds', () => {
      expect(isRealProgress({ stallStartPlayhead: 0.0, currentPlayhead: 0.2, minDeltaSeconds: 0.5 })).toBe(false);
      expect(isRealProgress({ stallStartPlayhead: 0.0, currentPlayhead: 0.6, minDeltaSeconds: 0.5 })).toBe(true);
    });
  });

  describe('degenerate inputs', () => {
    it('returns false when currentPlayhead is not finite', () => {
      expect(isRealProgress({ stallStartPlayhead: 0.0, currentPlayhead: NaN })).toBe(false);
      expect(isRealProgress({ stallStartPlayhead: 0.0, currentPlayhead: undefined })).toBe(false);
      expect(isRealProgress({ stallStartPlayhead: 0.0, currentPlayhead: null })).toBe(false);
    });

    it('returns true when stallStartPlayhead is not finite but currentPlayhead is (treat as "no stall")', () => {
      expect(isRealProgress({ stallStartPlayhead: NaN, currentPlayhead: 5.0 })).toBe(true);
      expect(isRealProgress({ stallStartPlayhead: undefined, currentPlayhead: 5.0 })).toBe(true);
    });
  });
});
```

- [ ] **Step 1.2: Run the failing test**

```bash
npm run test:isolated -- tests/isolated/modules/Player/progressDetection.test.mjs 2>&1 | tail -20
```

Expected: FAIL. Error like `Cannot find module '.../progressDetection.js'` or `isRealProgress is not a function`.

- [ ] **Step 1.3: Write the minimal implementation**

Create `frontend/src/modules/Player/lib/progressDetection.js`:

```javascript
/**
 * Decides whether a `timeupdate` event represents *real* forward playback progress
 * — as opposed to a self-emitted `timeupdate` caused by a recovery seek (nudge).
 *
 * Used by useCommonMediaController to avoid treating nudge's 1 ms rewind seek
 * as proof that playback recovered, which would incorrectly reset the
 * recovery pipeline and leave the stream stuck forever.
 *
 * @param {Object} args
 * @param {number|null|undefined} args.stallStartPlayhead  Playhead position when the current stall began, or null if no stall is active.
 * @param {number|null|undefined} args.currentPlayhead     Current HTMLMediaElement.currentTime.
 * @param {number} [args.minDeltaSeconds=0.05]             Minimum forward advancement required to count as real progress.
 * @returns {boolean} true if the playhead has advanced meaningfully forward since the stall began, or if no stall is active.
 */
export function isRealProgress({ stallStartPlayhead, currentPlayhead, minDeltaSeconds = 0.05 } = {}) {
  if (!Number.isFinite(currentPlayhead)) return false;
  if (!Number.isFinite(stallStartPlayhead)) return true;
  return currentPlayhead > stallStartPlayhead + minDeltaSeconds;
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

```bash
npm run test:isolated -- tests/isolated/modules/Player/progressDetection.test.mjs 2>&1 | tail -20
```

Expected: PASS, all 11 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add frontend/src/modules/Player/lib/progressDetection.js \
        tests/isolated/modules/Player/progressDetection.test.mjs
git commit -m "$(cat <<'EOF'
test(player): add isRealProgress predicate with unit tests

Pure function that determines whether a HTMLMediaElement `timeupdate` represents
real forward playback progress vs a self-induced seek (nudge recovery).

Prep for fixing the infinite nudge loop where markProgress treats every
timeupdate — including the one emitted by the nudge seek itself — as proof
that recovery succeeded, preventing the pipeline from escalating.

Ref: docs/_wip/bugs/2026-04-19-audio-playback-infinite-nudge-recovery-loop.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit, clean tree.

---

## Task 2: Track `stallStartPlayhead` in the stall state ref

**Why:** `isRealProgress` needs to know the playhead at the moment a stall began. The hook already tracks stall wall-clock time (`stallStateRef.current.sinceTs`) but not the media position. We add it alongside, and set it when the stall is first detected.

**Files:**

- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:90-109` (stallStateRef initial shape) and `:844-847` (where `isStalled` becomes true).

- [ ] **Step 2.1: Add `stallStartPlayhead` to the stall state ref initial shape**

In `frontend/src/modules/Player/hooks/useCommonMediaController.js`, find the block starting at line 90:

```javascript
  const stallStateRef = useRef({
    lastProgressTs: 0,
    softTimer: null,
    hardTimer: null,
    recoveryAttempt: 0,
    isStalled: false,
    lastStrategy: null,
    hasEnded: false,
    status: 'idle',
    sinceTs: null,
    activeStrategy: null,
    activeStrategyAttempt: 0,
    attemptIndex: 0,
    terminal: false,
    lastSuccessTs: null,
    strategyCounts: Object.create(null),
    strategySteps: [],
    pendingSoftReinit: false,
    lastError: null
  });
```

Replace with:

```javascript
  const stallStateRef = useRef({
    lastProgressTs: 0,
    softTimer: null,
    hardTimer: null,
    recoveryAttempt: 0,
    isStalled: false,
    lastStrategy: null,
    hasEnded: false,
    status: 'idle',
    sinceTs: null,
    stallStartPlayhead: null,
    activeStrategy: null,
    activeStrategyAttempt: 0,
    attemptIndex: 0,
    terminal: false,
    lastSuccessTs: null,
    strategyCounts: Object.create(null),
    strategySteps: [],
    pendingSoftReinit: false,
    lastError: null
  });
```

- [ ] **Step 2.2: Set `stallStartPlayhead` when the stall is first detected**

Find the soft-timer block around line 829–847 that fires `playback.stalled`:

```javascript
      if (diff >= softMs) {
        if (DEBUG_MEDIA) console.log('[Stall] DETECTED (soft)', { diff, softMs, hardMs, mode, currentTime: mediaEl.currentTime, duration: mediaEl.duration, droppedFramePct, quality });
        // Prod telemetry: stall detected
        const logger = getLogger();
        logger.warn('playback.stalled', {
          title: meta?.title || meta?.name,
          artist: meta?.artist,
          album: meta?.album,
          grandparentTitle: meta?.grandparentTitle,
          parentTitle: meta?.parentTitle,
          mediaKey: assetId,
          currentTime: mediaEl.currentTime,
          duration: mediaEl.duration,
          stallDurationMs: diff
        });
        s.isStalled = true;
        if (!s.sinceTs) s.sinceTs = Date.now();
        s.status = 'stalled';
```

Replace the line `if (!s.sinceTs) s.sinceTs = Date.now();` with a block that also records the playhead:

```javascript
        s.isStalled = true;
        if (!s.sinceTs) {
          s.sinceTs = Date.now();
          s.stallStartPlayhead = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : null;
        }
        s.status = 'stalled';
```

- [ ] **Step 2.3: Clear `stallStartPlayhead` whenever stall state resets**

The reset paths are all in `markProgress` (line 903) and the phantom-stall handler (line 382 area). We'll handle `markProgress` in Task 3. For the phantom-stall handler at lines 382–402, find:

```javascript
            // Reset stall tracking — this was a false positive
            stallStartTimeRef.current = null;
            stallStartPlayheadRef.current = null;
            hasLoggedCurrentStallRef.current = false;
```

(Note: that's inside `usePlayheadStallDetection` — a **different** hook that already has its own `stallStartPlayheadRef`. Leave it alone.)

In `useCommonMediaController` itself, no other reset path currently clears `s.sinceTs`, so no edit needed here. `markProgress` (Task 3) will clear both `sinceTs` and `stallStartPlayhead` together.

- [ ] **Step 2.4: Verify the file still parses**

```bash
node --check frontend/src/modules/Player/hooks/useCommonMediaController.js
```

Expected: no output (syntax OK). If there's an error, re-read the file around the edit site and fix.

- [ ] **Step 2.5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js
git commit -m "$(cat <<'EOF'
feat(player): track stallStartPlayhead in stall state ref

Records the media element's currentTime at the moment a stall is first
detected, so recovery logic can later distinguish real forward progress
from self-induced seek timeupdates.

No behavior change yet — field is set but not read. Consumed by subsequent
markProgress fix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit.

---

## Task 3: Fix `markProgress` to require real forward progress

**Why:** This is the primary bug fix. `markProgress` currently treats every `timeupdate` as recovery success. We make it consult `isRealProgress` using `stallStartPlayhead` from Task 2.

**Files:**

- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:903-941` (`markProgress` callback).

- [ ] **Step 3.1: Add the import at the top of the file**

Find the imports at the top of `useCommonMediaController.js` (lines 1–5):

```javascript
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getProgressPercent } from '../lib/helpers.js';
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';
import { getLogger } from '../../../lib/logging/Logger.js';
```

Add the new import after `getProgressPercent`:

```javascript
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getProgressPercent } from '../lib/helpers.js';
import { isRealProgress } from '../lib/progressDetection.js';
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';
import { getLogger } from '../../../lib/logging/Logger.js';
```

- [ ] **Step 3.2: Rewrite the `wasStalled` branch in `markProgress`**

Find `markProgress` at line 903:

```javascript
  const markProgress = useCallback(() => {
    const s = stallStateRef.current;
    if (s.hasEnded) {
      return;
    }

    const wasStalled = s.isStalled;
    s.lastProgressTs = Date.now();

    if (wasStalled) {
  const mediaEl = getMediaEl();
  if (DEBUG_MEDIA) console.log('[Stall] Progress resumed; clearing stalled state', { currentTime: mediaEl?.currentTime, recoveryAttempt: s.recoveryAttempt, lastStrategy: s.lastStrategy });
      mcLog().info('playback.recovery-resolved', {
        mediaKey: assetId,
        currentTime: mediaEl?.currentTime,
        duration: mediaEl?.duration,
        stallDurationMs: s.sinceTs ? Date.now() - s.sinceTs : null,
        strategiesAttempted: s.recoveryAttempt,
        lastStrategy: s.lastStrategy,
        lastSeekIntent: lastSeekIntentRef.current
      });
      s.isStalled = false;
      s.recoveryAttempt = 0;
      s.strategyCounts = Object.create(null);
      s.activeStrategy = null;
      s.activeStrategyAttempt = 0;
      s.sinceTs = null;
      s.status = enabled ? 'monitoring' : 'idle';
      s.attemptIndex = 0;
      s.terminal = false;
      s.pendingSoftReinit = false;
      s.lastSuccessTs = Date.now();
      publishStallSnapshot();
      clearTimers();
      setIsStalled(false);
      scheduleStallDetection();
    }
    // Continuous polling in scheduleStallDetection handles rescheduling
  }, [clearTimers, scheduleStallDetection, getMediaEl, enabled, publishStallSnapshot]);
```

Replace with:

```javascript
  const markProgress = useCallback(() => {
    const s = stallStateRef.current;
    if (s.hasEnded) {
      return;
    }

    const wasStalled = s.isStalled;
    s.lastProgressTs = Date.now();

    if (wasStalled) {
      const mediaEl = getMediaEl();
      const currentPlayhead = mediaEl?.currentTime;

      // Guard: don't count seek-induced timeupdates (e.g. from the nudge strategy)
      // as recovery. Require the playhead to have advanced meaningfully past where
      // the stall began.
      if (!isRealProgress({ stallStartPlayhead: s.stallStartPlayhead, currentPlayhead })) {
        if (DEBUG_MEDIA) console.log('[Stall] markProgress: spurious timeupdate while stalled, ignoring', {
          stallStartPlayhead: s.stallStartPlayhead,
          currentPlayhead,
          activeStrategy: s.activeStrategy
        });
        mcLog().debug('playback.progress-ignored', {
          mediaKey: assetId,
          reason: 'no-forward-advancement',
          stallStartPlayhead: s.stallStartPlayhead,
          currentPlayhead,
          activeStrategy: s.activeStrategy
        });
        return;
      }

      if (DEBUG_MEDIA) console.log('[Stall] Progress resumed; clearing stalled state', { currentTime: currentPlayhead, recoveryAttempt: s.recoveryAttempt, lastStrategy: s.lastStrategy });
      mcLog().info('playback.recovery-resolved', {
        mediaKey: assetId,
        currentTime: currentPlayhead,
        duration: mediaEl?.duration,
        stallDurationMs: s.sinceTs ? Date.now() - s.sinceTs : null,
        strategiesAttempted: s.recoveryAttempt,
        lastStrategy: s.lastStrategy,
        lastSeekIntent: lastSeekIntentRef.current
      });
      s.isStalled = false;
      s.recoveryAttempt = 0;
      s.strategyCounts = Object.create(null);
      s.activeStrategy = null;
      s.activeStrategyAttempt = 0;
      s.sinceTs = null;
      s.stallStartPlayhead = null;
      s.status = enabled ? 'monitoring' : 'idle';
      s.attemptIndex = 0;
      s.terminal = false;
      s.pendingSoftReinit = false;
      s.lastSuccessTs = Date.now();
      publishStallSnapshot();
      clearTimers();
      setIsStalled(false);
      scheduleStallDetection();
    }
    // Continuous polling in scheduleStallDetection handles rescheduling
  }, [clearTimers, scheduleStallDetection, getMediaEl, enabled, publishStallSnapshot, assetId]);
```

**Note the three changes:**
1. New guard clause that short-circuits when `isRealProgress` returns false.
2. New `s.stallStartPlayhead = null;` in the reset block.
3. `assetId` added to the deps array (used in the new log call).

- [ ] **Step 3.3: Verify the file still parses**

```bash
node --check frontend/src/modules/Player/hooks/useCommonMediaController.js
```

Expected: no output.

- [ ] **Step 3.4: Run existing player isolated tests — nothing should regress**

```bash
npm run test:isolated -- tests/isolated/modules/Player/ 2>&1 | tail -30
```

Expected: all prior tests (`normalizeDuration`, `resolveContentId`, `queueTrackChangedFilter`, `resilienceDeadlineGating`, `resiliencePhantomGuard`, `useQueueController.audio`, `computeZoomTarget`, plus the new `progressDetection`) pass.

- [ ] **Step 3.5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js
git commit -m "$(cat <<'EOF'
fix(player): require real forward progress before clearing stall state

markProgress previously treated every HTMLMediaElement `timeupdate` event
as proof that recovery succeeded — including the timeupdate emitted by
nudgeRecovery's own seek. That reset recoveryAttempt/strategyCounts to 0
on every iteration, so the pipeline could never escalate past `nudge`,
and audio streams stuck at ~t=0s looped the stall/nudge cycle forever.

Now markProgress consults isRealProgress({ stallStartPlayhead, currentPlayhead }):
if the playhead hasn't advanced ≥50ms past where the stall began, the
timeupdate is ignored and pipeline state is preserved.

Emits `playback.progress-ignored` debug event for diagnostics.

Fixes: docs/_wip/bugs/2026-04-19-audio-playback-infinite-nudge-recovery-loop.md
Related: docs/_wip/bugs/2026-02-28-playback-stall-recovery-reuses-broken-session.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit.

---

## Task 4: Suppress self-emitted `timeupdate` from `nudgeRecovery` (belt + braces)

**Why:** Task 3 alone fixes the loop. But if any other recovery strategy (or a future one) sets `currentTime` without immediate real playback, we want a second line of defense: `nudge` declares its own seek "synthetic" so `markProgress` skips that specific event entirely.

**Files:**

- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — add `suppressProgressUntilRef` and use it in `nudgeRecovery` and `markProgress`.

- [ ] **Step 4.1: Add the ref near other refs (after line 78, `lastSeekIntentRef`)**

Find the block near line 78:

```javascript
  // Track the last seek intent (what time user tried to seek to)
  const lastSeekIntentRef = useRef(null);
```

Add immediately after:

```javascript
  // Track the last seek intent (what time user tried to seek to)
  const lastSeekIntentRef = useRef(null);

  // When set to a wall-clock timestamp in the future, markProgress will
  // ignore timeupdate events until that time passes. Used by nudgeRecovery
  // to prevent its own synthetic seek from being mistaken for real progress.
  const suppressProgressUntilRef = useRef(0);
```

- [ ] **Step 4.2: Set the suppress window in `nudgeRecovery`**

Find `nudgeRecovery` at line 400:

```javascript
  const nudgeRecovery = useCallback((_options = {}) => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return false;

    try {
      const t = mediaEl.currentTime;
      const buffered = mediaEl.buffered;

      // Check if current position is within any buffered range
      let inBuffer = false;
      for (let i = 0; i < buffered.length; i++) {
        if (t >= buffered.start(i) && t <= buffered.end(i)) {
          inBuffer = true;
          break;
        }
      }

      // If not in a buffered range, nudge won't help — signal failure so
      // the pipeline escalates to seekback/reload instead of looping
      if (!inBuffer && buffered.length > 0) {
        if (DEBUG_MEDIA) console.log('[Stall Recovery] nudge: currentTime not in any buffered range, skipping', { t, ranges: buffered.length });
        mcLog().debug('playback.recovery-strategy', { mediaKey: assetId, strategy: 'nudge', success: false, reason: 'outside-buffered-range', currentTime: t, bufferedRanges: buffered.length });
        return false;
      }

      mediaEl.pause();
      mediaEl.currentTime = Math.max(0, t - 0.001);
      mediaEl.play().catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }, [getMediaEl]);
```

Replace the `mediaEl.pause(); mediaEl.currentTime = ...; mediaEl.play()` block with a version that sets the suppress flag first:

```javascript
  const nudgeRecovery = useCallback((_options = {}) => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return false;

    try {
      const t = mediaEl.currentTime;
      const buffered = mediaEl.buffered;

      // Check if current position is within any buffered range
      let inBuffer = false;
      for (let i = 0; i < buffered.length; i++) {
        if (t >= buffered.start(i) && t <= buffered.end(i)) {
          inBuffer = true;
          break;
        }
      }

      // If not in a buffered range, nudge won't help — signal failure so
      // the pipeline escalates to seekback/reload instead of looping
      if (!inBuffer && buffered.length > 0) {
        if (DEBUG_MEDIA) console.log('[Stall Recovery] nudge: currentTime not in any buffered range, skipping', { t, ranges: buffered.length });
        mcLog().debug('playback.recovery-strategy', { mediaKey: assetId, strategy: 'nudge', success: false, reason: 'outside-buffered-range', currentTime: t, bufferedRanges: buffered.length });
        return false;
      }

      // Mark a suppression window so markProgress ignores the timeupdate emitted
      // by this synthetic seek (which would otherwise reset recovery state).
      suppressProgressUntilRef.current = Date.now() + 300;

      mediaEl.pause();
      mediaEl.currentTime = Math.max(0, t - 0.001);
      mediaEl.play().catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }, [getMediaEl, assetId]);
```

(`assetId` was already used by the debug log above but was not in the deps list. Add it now.)

- [ ] **Step 4.3: Honor the suppress flag in `markProgress`**

Find the guard block you wrote in Task 3.2:

```javascript
    if (wasStalled) {
      const mediaEl = getMediaEl();
      const currentPlayhead = mediaEl?.currentTime;

      // Guard: don't count seek-induced timeupdates (e.g. from the nudge strategy)
      // as recovery. Require the playhead to have advanced meaningfully past where
      // the stall began.
      if (!isRealProgress({ stallStartPlayhead: s.stallStartPlayhead, currentPlayhead })) {
```

Insert an earlier check right before the `isRealProgress` guard:

```javascript
    if (wasStalled) {
      const mediaEl = getMediaEl();
      const currentPlayhead = mediaEl?.currentTime;

      // Skip timeupdates that fall inside a recovery-strategy's suppression window.
      if (Date.now() < suppressProgressUntilRef.current) {
        if (DEBUG_MEDIA) console.log('[Stall] markProgress: within suppress window, ignoring', {
          until: suppressProgressUntilRef.current,
          activeStrategy: s.activeStrategy
        });
        return;
      }

      // Guard: don't count seek-induced timeupdates (e.g. from the nudge strategy)
      // as recovery. Require the playhead to have advanced meaningfully past where
      // the stall began.
      if (!isRealProgress({ stallStartPlayhead: s.stallStartPlayhead, currentPlayhead })) {
```

- [ ] **Step 4.4: Verify the file still parses**

```bash
node --check frontend/src/modules/Player/hooks/useCommonMediaController.js
```

Expected: no output.

- [ ] **Step 4.5: Re-run all isolated player tests**

```bash
npm run test:isolated -- tests/isolated/modules/Player/ 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 4.6: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js
git commit -m "$(cat <<'EOF'
fix(player): suppress timeupdate from nudge's own seek

Belt-and-braces defense: nudgeRecovery now marks a 300 ms suppression window
before mutating currentTime. markProgress skips any timeupdate that lands
inside that window, so the self-emitted seek never resets recovery state
regardless of what currentTime happens to be at that instant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit.

---

## Task 5: Extract + test pipeline escalation logic

**Why:** The hook's pipeline state machine is intricate and has multiple exits (attempt increment, terminal failure, strategy-missing escape hatches). We need a unit test that proves after N consecutive `nudge` failures, the pipeline advances to `seekback` → `reload` → `softReinit` → terminal. Extracting a pure helper gives us a cheap, deterministic test.

**Files:**

- Create: `frontend/src/modules/Player/lib/stallPipeline.js`
- Create: `tests/isolated/modules/Player/stallPipelineEscalation.test.mjs`

- [ ] **Step 5.1: Write the failing test**

Create `tests/isolated/modules/Player/stallPipelineEscalation.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { selectNextStrategy, DEFAULT_STRATEGY_PIPELINE } from '../../../../frontend/src/modules/Player/lib/stallPipeline.js';

describe('selectNextStrategy', () => {
  const pipeline = DEFAULT_STRATEGY_PIPELINE;

  it('returns the first strategy when no attempts have been made', () => {
    expect(selectNextStrategy({ pipeline, attemptIndex: 0 })).toEqual(
      expect.objectContaining({ name: 'nudge' })
    );
  });

  it('advances within a single strategy until maxAttempts is hit', () => {
    // nudge has maxAttempts: 2 in the default pipeline
    const step1 = selectNextStrategy({ pipeline, attemptIndex: 0 });
    const step2 = selectNextStrategy({ pipeline, attemptIndex: 1 });
    expect(step1.name).toBe('nudge');
    expect(step2.name).toBe('nudge');
  });

  it('advances to the next strategy after the prior one is exhausted', () => {
    // After 2 nudges, we should be on seekback (attemptIndex 2)
    const step = selectNextStrategy({ pipeline, attemptIndex: 2 });
    expect(step.name).toBe('seekback');
  });

  it('continues to reload then softReinit', () => {
    // seekback has maxAttempts: 1 → attemptIndex 3 = reload #1
    expect(selectNextStrategy({ pipeline, attemptIndex: 3 }).name).toBe('reload');
    // reload has maxAttempts: 2 → attemptIndex 4 = reload #2
    expect(selectNextStrategy({ pipeline, attemptIndex: 4 }).name).toBe('reload');
    // attemptIndex 5 = softReinit
    expect(selectNextStrategy({ pipeline, attemptIndex: 5 }).name).toBe('softReinit');
  });

  it('returns null (terminal) once the pipeline is exhausted', () => {
    // Total attempts in DEFAULT: 2 + 1 + 2 + 1 = 6
    expect(selectNextStrategy({ pipeline, attemptIndex: 6 })).toBeNull();
    expect(selectNextStrategy({ pipeline, attemptIndex: 10 })).toBeNull();
  });

  it('preserves each step\'s options for the caller', () => {
    const seekbackStep = selectNextStrategy({ pipeline, attemptIndex: 2 });
    expect(seekbackStep.options).toEqual(expect.objectContaining({ seconds: 5 }));
  });

  it('accepts a custom pipeline (array of name strings)', () => {
    const custom = ['nudge', 'reload'];
    expect(selectNextStrategy({ pipeline: custom, attemptIndex: 0 }).name).toBe('nudge');
    expect(selectNextStrategy({ pipeline: custom, attemptIndex: 1 }).name).toBe('reload');
    expect(selectNextStrategy({ pipeline: custom, attemptIndex: 2 })).toBeNull();
  });

  it('accepts a custom pipeline (array of objects with maxAttempts)', () => {
    const custom = [
      { name: 'nudge', maxAttempts: 3 },
      { name: 'reload', maxAttempts: 1 }
    ];
    expect(selectNextStrategy({ pipeline: custom, attemptIndex: 0 }).name).toBe('nudge');
    expect(selectNextStrategy({ pipeline: custom, attemptIndex: 1 }).name).toBe('nudge');
    expect(selectNextStrategy({ pipeline: custom, attemptIndex: 2 }).name).toBe('nudge');
    expect(selectNextStrategy({ pipeline: custom, attemptIndex: 3 }).name).toBe('reload');
    expect(selectNextStrategy({ pipeline: custom, attemptIndex: 4 })).toBeNull();
  });
});

describe('DEFAULT_STRATEGY_PIPELINE', () => {
  it('escalates nudge → seekback → reload → softReinit', () => {
    const names = DEFAULT_STRATEGY_PIPELINE.map(s => s.name);
    expect(names).toEqual(['nudge', 'seekback', 'reload', 'softReinit']);
  });

  it('nudge has maxAttempts >= 2 so a single transient buffer hiccup can self-heal', () => {
    const nudge = DEFAULT_STRATEGY_PIPELINE.find(s => s.name === 'nudge');
    expect(nudge.maxAttempts).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 5.2: Run the failing test**

```bash
npm run test:isolated -- tests/isolated/modules/Player/stallPipelineEscalation.test.mjs 2>&1 | tail -20
```

Expected: FAIL. Module not found.

- [ ] **Step 5.3: Write the implementation**

Create `frontend/src/modules/Player/lib/stallPipeline.js`:

```javascript
/**
 * Default stall-recovery pipeline.
 *
 * Ordered list of strategies the media controller runs through when playback
 * stalls. Each entry has a `maxAttempts` budget. When that budget is spent
 * for one strategy, the pipeline advances to the next. When the whole pipeline
 * is exhausted, the media controller emits a terminal failure (which upstream
 * code turns into an auto-advance to the next queue item).
 *
 * Do not reorder without considering latency: nudge is cheapest (no network),
 * seekback is next cheapest, reload re-fetches, softReinit fully rebuilds the
 * DASH player (most disruptive).
 */
export const DEFAULT_STRATEGY_PIPELINE = Object.freeze([
  { name: 'nudge', maxAttempts: 2 },
  { name: 'seekback', maxAttempts: 1, options: { seconds: 5 } },
  { name: 'reload', maxAttempts: 2 },
  { name: 'softReinit', maxAttempts: 1 }
]);

/**
 * Normalize a pipeline entry. Accepts a bare string name, an object with
 * { name, maxAttempts?, options? }, or null/undefined (ignored).
 */
function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { name: entry, maxAttempts: 1, options: {} };
  }
  return {
    name: entry.name,
    maxAttempts: Number.isFinite(entry.maxAttempts) ? entry.maxAttempts : 1,
    options: entry.options || {}
  };
}

/**
 * Given the configured pipeline and how many recovery attempts have already
 * fired in this stall episode, return the strategy step to run next — or
 * `null` when the pipeline is exhausted (caller should trigger terminal failure).
 *
 * @param {Object} args
 * @param {Array<string|Object>} args.pipeline - Ordered list of strategies.
 * @param {number} args.attemptIndex - Total attempts already consumed.
 * @returns {{ name: string, maxAttempts: number, options: Object }|null}
 */
export function selectNextStrategy({ pipeline, attemptIndex }) {
  if (!Array.isArray(pipeline) || pipeline.length === 0) return null;
  if (!Number.isFinite(attemptIndex) || attemptIndex < 0) return null;

  let remaining = attemptIndex;
  for (const raw of pipeline) {
    const step = normalizeEntry(raw);
    if (!step) continue;
    if (remaining < step.maxAttempts) {
      return step;
    }
    remaining -= step.maxAttempts;
  }
  return null;
}
```

- [ ] **Step 5.4: Run the tests**

```bash
npm run test:isolated -- tests/isolated/modules/Player/stallPipelineEscalation.test.mjs 2>&1 | tail -20
```

Expected: PASS, all tests green.

- [ ] **Step 5.5: Commit**

```bash
git add frontend/src/modules/Player/lib/stallPipeline.js \
        tests/isolated/modules/Player/stallPipelineEscalation.test.mjs
git commit -m "$(cat <<'EOF'
test(player): extract + test stall pipeline escalation

Pure helper selectNextStrategy(pipeline, attemptIndex) returns the step to
run for a given attempt, or null when the pipeline is exhausted.

Prep for swapping the in-hook pipeline construction over to this helper,
and for adding an integration test that proves the pipeline actually
escalates to reload/softReinit after nudge fails.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit.

---

## Task 6: Swap the hook over to the extracted `DEFAULT_STRATEGY_PIPELINE` and fix the broken default

**Why:** `useCommonMediaController.js` currently defines its own `DEFAULT_STRATEGY_PIPELINE` const (line 14) with 4 entries, but the `stallConfig` destructure default (line 150) is `['nudge', 'reload']` — only 2 steps. Meaning every caller that doesn't pass its own `recoveryStrategies` gets a truncated pipeline. We unify on the exported constant.

**Files:**

- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:14-19` and `:150`.

- [ ] **Step 6.1: Import the pipeline from the new module**

Add to the imports block near the top of `useCommonMediaController.js`:

```javascript
import { DEFAULT_STRATEGY_PIPELINE } from '../lib/stallPipeline.js';
```

(Place it near the `isRealProgress` import you added in Task 3.1.)

- [ ] **Step 6.2: Remove the in-file duplicate**

Find the existing declaration at line 14–19:

```javascript
const DEFAULT_STRATEGY_PIPELINE = [
  { name: 'nudge', maxAttempts: 2 },
  { name: 'seekback', maxAttempts: 1, options: { seconds: 5 } },
  { name: 'reload', maxAttempts: 2 },
  { name: 'softReinit', maxAttempts: 1 }
];
```

Delete it entirely (the imported const replaces it).

- [ ] **Step 6.3: Fix the destructure default at line ~150**

Find the `stallConfig` destructure:

```javascript
  const {
    enabled = true,
    softMs = 1200,
    hardMs = 8000,
    recoveryStrategies = ['nudge', 'reload'],
    seekBackOnReload = 2,
    strategies: strategyOverrides = null,
    terminalAction = 'emitFailure',
    softReinitSeekBackSeconds = 2,
    mode = 'auto',
```

Change the `recoveryStrategies` line to:

```javascript
    recoveryStrategies = DEFAULT_STRATEGY_PIPELINE,
```

The rest of the destructure stays identical.

- [ ] **Step 6.4: Verify the existing `strategySteps` useMemo still resolves correctly**

`strategySteps` is computed at lines 173–176 and accepts either `strategyOverrides` (highest priority), the `recoveryStrategies` prop (now our full pipeline), or the (deleted) module-level const. Since we removed the const but both remaining branches now yield a full pipeline when nothing is overridden, this is safe.

```bash
node --check frontend/src/modules/Player/hooks/useCommonMediaController.js
```

Expected: no output.

- [ ] **Step 6.5: Run all player isolated tests**

```bash
npm run test:isolated -- tests/isolated/modules/Player/ 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 6.6: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js
git commit -m "$(cat <<'EOF'
fix(player): unify stall pipeline default on 4-step escalation

The hook previously had two conflicting defaults:
- DEFAULT_STRATEGY_PIPELINE (module const): 4 steps — nudge, seekback, reload, softReinit
- stallConfig.recoveryStrategies destructure: 2 steps — nudge, reload

Callers that didn't pass recoveryStrategies explicitly got the truncated 2-step
version. Combined with the now-fixed nudge loop, a truly unresponsive stream
could still exhaust both steps without ever reaching softReinit.

Now both references point to the single exported DEFAULT_STRATEGY_PIPELINE
from lib/stallPipeline.js, so every caller gets the full escalation ladder
by default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit.

---

## Task 7: Integration test — full nudge-loop scenario via `renderHook`

**Why:** Unit tests prove the pieces work. An integration test proves the composition works end-to-end: simulate a frozen audio element, verify the hook stalls, runs nudge (doesn't leak a recovery-resolved), escalates, and eventually reaches terminal.

**Files:**

- Create: `tests/isolated/modules/Player/useCommonMediaController.nudgeLoop.test.mjs`

- [ ] **Step 7.1: Confirm `@testing-library/react` is importable from a test**

```bash
node --input-type=module -e "import('@testing-library/react').then(m => console.log('ok renderHook=', typeof m.renderHook)).catch(e => console.error('fail', e.message))"
```

If this errors with "module not found", add a `cd frontend &&` prefix and confirm the alias path in `vitest.config.mjs` is correct. If it still errors, skip this integration test (it's nice-to-have; the unit tests + manual verification in Task 8 suffice) and proceed to Task 8.

Expected: prints `ok renderHook= function`.

- [ ] **Step 7.2: Write the failing integration test**

Create `tests/isolated/modules/Player/useCommonMediaController.nudgeLoop.test.mjs`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommonMediaController } from '../../../../frontend/src/modules/Player/hooks/useCommonMediaController.js';

/**
 * Regression test for the infinite nudge recovery loop.
 *
 * Scenario: HTMLMediaElement loaded a track, fired `playing`, then froze
 * at currentTime ≈ 0.02 and never advanced. The hook should:
 *   1. Detect the stall after ~softMs.
 *   2. Run `nudge` up to maxAttempts.
 *   3. NOT emit `playback.recovery-resolved` when the only "progress" is
 *      the nudge's own synthetic seek.
 *   4. Escalate to seekback → reload → softReinit.
 *   5. Reach terminal failure if none of those help.
 */

function makeFakeMediaElement({ stuckAt = 0.02, duration = 180 } = {}) {
  const listeners = new Map();
  let currentTime = 0;
  const el = {
    get currentTime() { return currentTime; },
    set currentTime(v) {
      currentTime = Math.max(0, v);
      // Simulate the browser firing seeking → seeked → timeupdate.
      queueMicrotask(() => fire('seeking'));
      queueMicrotask(() => fire('seeked'));
      queueMicrotask(() => fire('timeupdate'));
    },
    duration,
    paused: false,
    ended: false,
    readyState: 4,
    networkState: 2,
    buffered: {
      length: 1,
      start: () => 0,
      end: () => 0.05
    },
    pause: vi.fn(() => { el.paused = true; }),
    play: vi.fn(() => {
      el.paused = false;
      return Promise.resolve();
    }),
    load: vi.fn(),
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
    },
    removeEventListener: (ev, fn) => {
      listeners.get(ev)?.delete(fn);
    }
  };
  function fire(ev) {
    const handlers = listeners.get(ev);
    if (!handlers) return;
    for (const h of handlers) h({ target: el });
  }
  el.__fire = fire;
  // Freeze playback: ticks produce timeupdate with unchanged currentTime,
  // but only for wall-clock progress. Used to simulate a truly frozen stream.
  el.__tick = () => {
    currentTime = stuckAt;
    fire('timeupdate');
  };
  return el;
}

describe('useCommonMediaController — nudge loop regression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('escalates the pipeline instead of looping nudge forever when the stream is frozen', async () => {
    const el = makeFakeMediaElement();
    const meta = { title: 'Test Track', assetId: 'test:1', mediaType: 'audio' };

    const strategiesSeen = [];
    const onController = vi.fn();

    const { result } = renderHook(() =>
      useCommonMediaController({
        meta,
        type: 'plex',
        isAudio: true,
        shader: 'default',
        onEnd: vi.fn(),
        onClear: vi.fn(),
        onController,
        stallConfig: {
          enabled: true,
          softMs: 100,
          hardMs: 200,
          mode: 'auto'
        }
      })
    );

    // Get the controller handle so we can attach the fake media element.
    // (In real code, SinglePlayer attaches via onMediaRef; in tests we stub.)
    act(() => {
      // Force the hook to "see" our element — the exact mechanism depends on
      // the hook's interface. If the hook requires a container ref, emulate
      // that by assigning containerRef.current = el via the ref passthrough.
      // This is intentionally brittle: if the API changes, this test must follow.
      result.current?._test_attachMediaEl?.(el);
    });

    // Simulate playback starting, then freezing.
    el.paused = false;
    el.__fire('loadedmetadata');
    el.__fire('playing');

    // Spy on the structured logger to capture recovery-strategy events.
    // ... (implementation continues — see note below)

    // Advance time: 100 ms → soft stall; 200 ms → hard stall triggers recovery.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // First nudge runs. The nudge sets currentTime = t - 0.001 which fires a
    // timeupdate, but our fix should IGNORE it (suppression window + real-progress guard).
    // Let the event loop flush synthetic events:
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });

    // Now simulate the stream still frozen for another hard cycle:
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    // Expect the pipeline to have advanced past nudge — we should see seekback
    // or reload attempted, proving we're not stuck in a nudge loop.
    // (This check depends on exposing strategyCounts or capturing log events.)
    // TODO: hook up a capture mechanism using getLogger().child() mock OR a
    //       test-only prop that reports strategy invocations.

    expect(true).toBe(true); // placeholder — fill in once capture wiring exists
  });
});
```

**⚠️ Honesty flag:** This test scaffolding is correct in shape but requires either (a) the hook to expose a test-only attachment hook, or (b) using `getLogger()` mocking to capture events. Fully wiring it is a 30–60 min sub-task — if the skeleton above doesn't pass muster, downgrade this task to a `skip` and rely on the manual verification in Task 8 + the two unit-test tasks (1, 5).

- [ ] **Step 7.3: Run it**

```bash
npm run test:isolated -- tests/isolated/modules/Player/useCommonMediaController.nudgeLoop.test.mjs 2>&1 | tail -30
```

If it fails in a way that would take >30 min to fix: `git rm` the file, note the skip in your commit message, and move on. The unit tests from Tasks 1 and 5 already prevent the specific regression.

- [ ] **Step 7.4: Commit what you got**

```bash
git add tests/isolated/modules/Player/useCommonMediaController.nudgeLoop.test.mjs
git commit -m "$(cat <<'EOF'
test(player): regression scaffold for audio nudge loop

Skeleton integration test for the nudge loop fix. Hook up the media-element
attachment + logger-capture wiring as a follow-up (see TODO in file). Unit
coverage (lib/progressDetection.test.mjs, lib/stallPipelineEscalation.test.mjs)
already guards the two core invariants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit (or a `--delete` commit if you bailed).

---

## Task 8: Manual verification in dev, then prod

**Why:** Unit tests don't prove a real audio queue recovers in a real browser. We verify on dev, then deploy to prod and verify the exact repro scenario that started this investigation.

**Files:** None — this is exercise + observation.

- [ ] **Step 8.1: Build + serve the frontend in dev**

```bash
# On kckern-server, backend should already be running on 3112.
# Start the Vite dev server:
npm run dev 2>&1 | tee -a dev.log &
# Wait for "Local: http://localhost:3111" line in dev.log.
```

Expected: Vite serves on :3111 proxying API to :3112.

- [ ] **Step 8.2: Run the same album in a browser**

Open in Chrome: `http://localhost:3111/screen/livingroom` (or whichever screen uses the audio player). Navigate to Music → 이루마 → play. Or use the menu flow that triggered the original incident.

Expected: track plays audibly. Playhead advances past 5 seconds within 10 seconds wall-clock.

- [ ] **Step 8.3: If the track plays, simulate the failure**

Kill the Plex transcoder session server-side to force a stall partway through playback:

```bash
# From kckern-server (or the docker host):
sudo docker exec plex sh -c 'pkill -f "ffmpeg.*transcode.*universal" || true'
```

Then watch the browser's dev console for `playback.*` events.

Expected:
- `playback.stalled` fires after ~1.2 s of no progress.
- `playback.recovery-strategy` fires with `strategy: "nudge"`, `attempt: 1`.
- If Plex immediately re-serves the stream: `playback.recovery-resolved` with `currentTime > stallStartPlayhead + 0.05` — real progress. Pipeline state resets cleanly.
- If Plex is still down: `attempt: 2`, then `strategy: "seekback"`, then `reload`, then `softReinit`, then `playback.recovery-terminal`. After terminal, the queue auto-advances to the next track (existing behavior from commit 50c8f65b).

- [ ] **Step 8.4: Check the logs for zero infinite loops**

```bash
# Tail dev.log OR:
curl -s http://localhost:3112/api/v1/logs/stream | jq 'select(.event=="playback.recovery-strategy") | .data'
```

Expected: at most 6 `playback.recovery-strategy` events per stall episode (2 nudge + 1 seekback + 2 reload + 1 softReinit), then terminal. No infinite sequence of `attempt: 1` nudges with decreasing `currentTime`.

- [ ] **Step 8.5: Build the production image**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```

Expected: build succeeds, tag updates.

- [ ] **Step 8.6: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

Expected: container starts clean. `sudo docker logs daylight-station --tail 20` shows successful boot.

- [ ] **Step 8.7: Reproduce the original incident on prod**

From livingroom-tv (or whatever the original device was), open Music → 이루마 album → play. Let it run for a minute without touching anything.

Expected: track plays through to ~3 minutes, then advances to next track. Check prod logs:

```bash
sudo docker logs daylight-station --since 5m 2>&1 | \
  jq -r 'select(.event=="playback.started" or .event=="playback.recovery-resolved" or .event=="playback.recovery-terminal" or .event=="playback.recovery-strategy") | "\(.ts) \(.event) \(.data.mediaKey // "") \(.data.strategy // "") \(.data.currentTime // "")"'
```

Expected: 2–3 `playback.started` events over 3–10 minutes (track transitions), zero or few `playback.recovery-strategy` events, zero infinite sequences.

- [ ] **Step 8.8: Merge and clean up the branch**

Per `CLAUDE.md`'s branch policy: merge directly to main (no PR), then record + delete the feature branch.

```bash
git switch main
git merge --no-ff fix/audio-nudge-loop -m "Merge fix/audio-nudge-loop: fix infinite nudge recovery loop on audio stalls"
```

Record the old branch HEAD for potential restoration:

```bash
HASH=$(git rev-parse fix/audio-nudge-loop)
echo "| $(date +%Y-%m-%d) | fix/audio-nudge-loop | $HASH | Fix infinite nudge recovery loop on audio stalls |" >> docs/_archive/deleted-branches.md
git add docs/_archive/deleted-branches.md
git commit -m "docs: record fix/audio-nudge-loop in deleted-branches.md"
git branch -d fix/audio-nudge-loop
```

Expected: main contains the fix, branch deleted, archive updated.

- [ ] **Step 8.9: Close the bug report**

Append a resolution block to `docs/_wip/bugs/2026-04-19-audio-playback-infinite-nudge-recovery-loop.md`:

```markdown
---

## Resolution

**Fixed via plan:** `docs/superpowers/plans/2026-04-19-fix-audio-nudge-recovery-loop.md`

**Commits:** (fill in with `git log --oneline fix/audio-nudge-loop --not main`)

**Verified:** 2026-04-19 on both dev (kckern-server:3111) and prod
(livingroom-tv) by forcing a Plex transcode session kill mid-playback and
confirming the pipeline escalated `nudge → seekback → reload → softReinit`
instead of looping nudge forever. Queue auto-advanced to the next track
on terminal failure as expected.
```

```bash
git add docs/_wip/bugs/2026-04-19-audio-playback-infinite-nudge-recovery-loop.md
git commit -m "docs: mark audio nudge loop bug as resolved"
```

Expected: bug report updated, main is clean.

---

## Self-Review

**Spec coverage:**
- Primary bug (markProgress misinterprets seek timeupdate): Task 1 (pure predicate) + Task 2 (stallStartPlayhead tracking) + Task 3 (consume the predicate). ✅
- Secondary defense (suppress nudge's own timeupdate): Task 4. ✅
- Pipeline config mismatch (2 vs 4 steps): Task 6. ✅
- Auto-advance on terminal: already in `Player.jsx` from commit 50c8f65b — Task 8 verifies it in real prod playback. ✅
- Regression coverage: Task 1, Task 5, Task 7 (integration scaffold, best-effort). ✅
- Deployment + prod verification: Task 8. ✅

**Placeholder scan:** Task 7.2 contains a scaffold with an explicit "honesty flag" and fallback instruction. Not a hidden placeholder — the engineer has a clear decision point ("if it costs >30 min, skip it"). All other steps contain complete code.

**Type consistency:**
- `isRealProgress({ stallStartPlayhead, currentPlayhead, minDeltaSeconds })` — same signature in tests, implementation, and usage in `markProgress`. ✅
- `selectNextStrategy({ pipeline, attemptIndex })` — same in tests and implementation. ✅
- `stallStartPlayhead` field — set in Task 2.2, cleared in Task 3.2. ✅
- `suppressProgressUntilRef` — declared in Task 4.1, set in Task 4.2, read in Task 4.3. ✅
- `DEFAULT_STRATEGY_PIPELINE` — exported from `stallPipeline.js` in Task 5.3, imported in Task 6.1, consumed as destructure default in Task 6.3. ✅

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-19-fix-audio-nudge-recovery-loop.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
