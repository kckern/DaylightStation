# Seek Lifecycle Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the "zoom resets while buffering" bug by introducing proper seek lifecycle tracking that distinguishes between position-reached and playback-resumed states.

**Architecture:** Replace fragmented seek completion detection (tolerance-based position matching) with a unified seek lifecycle state machine in useSeekState. The lifecycle (`idle` → `seeking` → `buffering` → `playing`) will be consumed by useZoomState to schedule zoom resets only after playback has truly resumed. All seek-related state clearing will be consolidated into a single function.

**Tech Stack:** React hooks, existing playerRef imperative handle, Playwright for E2E testing

**Scope:** Only Fitness footer hooks - no changes to Player.jsx or FitnessPlayer.jsx

---

## Task 1: Add Seek Lifecycle State to useSeekState

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/useSeekState.js`

**Step 1: Add lifecycle state and constants**

At the top of the file (after line 35, before the function), add:

```javascript
/**
 * Seek lifecycle states
 * - idle: No seek in progress
 * - seeking: Seek requested, waiting for playhead to reach target
 * - buffering: Playhead at target, waiting for playback to resume
 * - playing: Playback resumed at target position
 */
export const SEEK_LIFECYCLE = {
  IDLE: 'idle',
  SEEKING: 'seeking',
  BUFFERING: 'buffering',
  PLAYING: 'playing'
};
```

**Step 2: Add lifecycle state inside the hook**

After the existing state declarations (around line 46), add:

```javascript
  // Seek lifecycle state
  const [lifecycle, setLifecycle] = useState(SEEK_LIFECYCLE.IDLE);
```

**Step 3: Update commitSeek to set lifecycle to SEEKING**

In the `commitSeek` function, after setting `intentTime` (around line 147), add:

```javascript
    // Enter seeking state
    setLifecycle(SEEK_LIFECYCLE.SEEKING);
```

**Step 4: Add effect to transition seeking → buffering**

Add a new effect after the existing currentTime monitoring effect (around line 237):

```javascript
  /**
   * Transition from SEEKING to BUFFERING when playhead reaches target
   */
  useEffect(() => {
    if (lifecycle !== SEEK_LIFECYCLE.SEEKING) return;
    if (intentTime == null) return;

    const delta = Math.abs(currentTime - intentTime);
    if (delta <= TOLERANCES.CLEAR) {
      logSeekEvent('lifecycle-transition', { from: 'seeking', to: 'buffering', delta });
      setLifecycle(SEEK_LIFECYCLE.BUFFERING);
    }
  }, [lifecycle, currentTime, intentTime]);
```

**Step 5: Add effect to transition buffering → playing**

Add another effect to detect when video starts playing:

```javascript
  /**
   * Transition from BUFFERING to PLAYING when video actually plays
   * Uses 'playing' event from media element
   */
  useEffect(() => {
    if (lifecycle !== SEEK_LIFECYCLE.BUFFERING) return;

    const el = playerRef?.current?.getMediaElement?.();
    if (!el) return;

    const handlePlaying = () => {
      logSeekEvent('lifecycle-transition', { from: 'buffering', to: 'playing' });
      setLifecycle(SEEK_LIFECYCLE.PLAYING);
    };

    // Check if already playing
    if (!el.paused && el.readyState >= 3) {
      setLifecycle(SEEK_LIFECYCLE.PLAYING);
      return;
    }

    el.addEventListener('playing', handlePlaying);
    return () => el.removeEventListener('playing', handlePlaying);
  }, [lifecycle, playerRef]);
```

**Step 6: Add effect to transition playing → idle after delay**

```javascript
  /**
   * Transition from PLAYING to IDLE after a short delay
   * This gives zoom reset time to detect the PLAYING state
   */
  useEffect(() => {
    if (lifecycle !== SEEK_LIFECYCLE.PLAYING) return;

    const timer = setTimeout(() => {
      logSeekEvent('lifecycle-transition', { from: 'playing', to: 'idle' });
      setLifecycle(SEEK_LIFECYCLE.IDLE);
      clearIntent('lifecycle-complete');
    }, 100); // Small delay to ensure consumers see PLAYING state

    return () => clearTimeout(timer);
  }, [lifecycle, clearIntent]);
```

**Step 7: Update return statement to export lifecycle**

Update the return statement (around line 286) to include:

```javascript
  return {
    // State
    displayTime,
    intentTime,
    previewTime,
    isSeekPending: intentTime != null,
    lifecycle,  // NEW: Seek lifecycle state

    // Actions
    commitSeek,
    setPreview,
    setPreviewThrottled,
    clearPreview,
    clearIntent,
  };
```

**Step 8: Run linter to verify syntax**

Run: `npm run lint -- --fix frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/useSeekState.js`
Expected: No errors (warnings OK)

**Step 9: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/useSeekState.js
git commit -m "feat(fitness): add seek lifecycle state machine to useSeekState

Introduces SEEK_LIFECYCLE states (idle → seeking → buffering → playing)
to properly track when a seek has fully completed including playback
resumption, not just position matching.

Part of BUG-06 fix for zoom-seek-offset issues."
```

---

## Task 2: Update useZoomState to Consume Lifecycle

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/useZoomState.js`

**Step 1: Add seekLifecycle to hook parameters**

Update the function signature (around line 34):

```javascript
export default function useZoomState({
  baseDuration,
  baseRange = null,
  playerRef,
  onZoomChange,
  disabled = false,
  seekLifecycle = null  // NEW: Lifecycle from useSeekState
}) {
```

**Step 2: Add effect to schedule zoom reset on PLAYING transition**

Replace the existing BUG-06 cleanup effect (lines 140-154) with:

```javascript
  /**
   * Schedule zoom reset when seek lifecycle reaches PLAYING
   * This ensures we don't zoom out while still buffering
   */
  const prevLifecycleRef = useRef(seekLifecycle);
  useEffect(() => {
    const prev = prevLifecycleRef.current;
    prevLifecycleRef.current = seekLifecycle;

    // Only act on transition TO 'playing' state
    if (prev !== 'playing' && seekLifecycle === 'playing' && zoomRange) {
      logger.info('seek-lifecycle-playing-detected', { zoomRange });
      scheduleZoomReset(800);
    }

    // Cancel scheduled reset if new seek starts
    if (prev !== 'seeking' && seekLifecycle === 'seeking') {
      cancelZoomReset();
    }
  }, [seekLifecycle, zoomRange, scheduleZoomReset, cancelZoomReset]);

  /**
   * Clear resilience seek intent on unzoom
   */
  useEffect(() => {
    if (!playerRef?.current) return;

    if (!zoomRange && typeof playerRef.current.clearSeekIntent === 'function') {
      playerRef.current.clearSeekIntent('zoom-range-reset');
      logger.info('cleared-seek-intent-on-unzoom');
    }
  }, [zoomRange, playerRef]);
```

**Step 3: Run linter**

Run: `npm run lint -- --fix frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/useZoomState.js`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/useZoomState.js
git commit -m "feat(fitness): useZoomState consumes seek lifecycle for zoom reset

Zoom reset now waits for seekLifecycle === 'playing' instead of just
!isSeekPending. This fixes the bug where zoom resets while video is
still buffering at the target position.

Part of BUG-06 fix."
```

---

## Task 3: Wire Lifecycle Through FitnessPlayerFooterSeekThumbnails

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx`

**Step 1: Import SEEK_LIFECYCLE constant**

Update the import (line 13):

```javascript
import useSeekState, { SEEK_LIFECYCLE } from './hooks/useSeekState.js';
import useZoomState from './hooks/useZoomState.js';
```

Note: You may need to update the hooks/index.js to re-export SEEK_LIFECYCLE, or import directly from the file.

**Step 2: Extract lifecycle from useSeekState**

Update the destructuring (around line 67):

```javascript
  const {
    displayTime,
    intentTime,
    previewTime,
    isSeekPending,
    lifecycle,  // NEW
    commitSeek,
    setPreview,
    setPreviewThrottled,
    clearPreview,
    clearIntent
  } = useSeekState({
```

**Step 3: Pass lifecycle to useZoomState**

Update the useZoomState call (around line 102):

```javascript
  } = useZoomState({
    baseDuration,
    baseRange: range,
    playerRef,
    onZoomChange,
    disabled,
    seekLifecycle: lifecycle  // NEW
  });
```

**Step 4: Remove the old isSeekPending-based zoom reset effect**

Delete the effect at lines 121-138 that watches `isSeekPending`:

```javascript
  // DELETE THIS ENTIRE EFFECT:
  // --- AUTO-RESET ZOOM AFTER SEEK COMPLETES ---
  // const prevSeekPendingRef = useRef(isSeekPending);
  // useEffect(() => { ... }, [isSeekPending, isZoomed, zoomRange, scheduleZoomReset, cancelZoomReset]);
```

**Step 5: Simplify the zoom-change clearIntent effect**

The effect at lines 112-119 can stay but update the comment:

```javascript
  // --- CLEAR LOCAL SEEK INTENT ON ZOOM CHANGES ---
  // This clears the local intentTime to prevent stale display
  const prevZoomRangeRef = useRef(zoomRange);
  useEffect(() => {
    if (prevZoomRangeRef.current !== zoomRange) {
      prevZoomRangeRef.current = zoomRange;
      clearIntent('zoom-change');
    }
  }, [zoomRange, clearIntent]);
```

**Step 6: Run linter**

Run: `npm run lint -- --fix frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx`
Expected: No errors

**Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx
git commit -m "refactor(fitness): wire seek lifecycle through footer thumbnails

- Pass lifecycle state from useSeekState to useZoomState
- Remove old isSeekPending-based zoom reset effect
- Zoom reset now handled entirely in useZoomState based on lifecycle

Part of BUG-06 fix - zoom no longer resets while buffering."
```

---

## Task 4: Update hooks/index.js Export

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/index.js`

**Step 1: Check current exports and add SEEK_LIFECYCLE**

Read the file first, then update to include:

```javascript
export { default as useSeekState, SEEK_LIFECYCLE } from './useSeekState.js';
export { default as useZoomState } from './useZoomState.js';
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/index.js
git commit -m "chore(fitness): export SEEK_LIFECYCLE from hooks index"
```

---

## Task 5: Manual Testing Verification

**Files:**
- Reference: `docs/_wip/bugs/2026-02-02-fitness-zoom-seek-offset-bug.md`

**Step 1: Start dev server**

Run: `npm run dev`
Expected: Server starts on configured ports

**Step 2: Test zoom-seek-unzoom flow**

Manual test steps:
1. Open fitness player with a video
2. Double-click a thumbnail to zoom in
3. Click a different thumbnail to seek (while zoomed)
4. **Verify**: Zoom does NOT reset while loading spinner is showing
5. **Verify**: Zoom resets ~800ms AFTER video starts playing
6. Repeat 2-5 several times to verify no cumulative offset

**Step 3: Test rapid interactions**

1. Zoom in, click seek, immediately zoom out manually
2. Zoom in, click seek, click different thumbnail before first seek completes
3. **Verify**: No offset bugs, no stuck states

**Step 4: Update bug report status**

Edit `docs/_wip/bugs/2026-02-02-fitness-zoom-seek-offset-bug.md`:
- Change status from "Open - Fix Ineffective" to "Fixed"
- Add implementation notes referencing seek lifecycle

**Step 5: Commit docs update**

```bash
git add docs/_wip/bugs/2026-02-02-fitness-zoom-seek-offset-bug.md
git commit -m "docs: mark BUG-06 zoom-seek-offset as fixed

Implemented seek lifecycle state machine that properly tracks
playback resumption before allowing zoom reset."
```

---

## Task 6: Add Playwright Test for Zoom-Seek Behavior

**Files:**
- Create: `tests/live/flow/fitness/zoom-seek-lifecycle.runtime.test.mjs`

**Step 1: Create test file**

```javascript
/**
 * Zoom-Seek Lifecycle Runtime Test
 *
 * Verifies that zoom does not reset while video is still buffering
 * after a seek operation. Tests the fix for BUG-06.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;

test.describe('Fitness Player Zoom-Seek Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to fitness with a test video
    await page.goto(`${BASE_URL}/fitness`);
    // Wait for player to be ready
    await page.waitForSelector('.fitness-player', { timeout: 30000 });
  });

  test('zoom should not reset while seek is buffering', async ({ page }) => {
    // Find and click first thumbnail to start playback
    const thumbnail = page.locator('.seek-thumbnail-container').first();
    await thumbnail.waitFor({ state: 'visible' });

    // Double-click to zoom in
    await thumbnail.dblclick();

    // Verify we're zoomed (zoom overlay should appear)
    await expect(page.locator('.zoom-overlay')).toBeVisible({ timeout: 2000 });

    // Click a different thumbnail to seek
    const secondThumbnail = page.locator('.seek-thumbnail-container').nth(2);
    await secondThumbnail.click();

    // Immediately check that zoom is still active (not reset during buffering)
    await expect(page.locator('.zoom-overlay')).toBeVisible();

    // Wait for video to actually start playing (loading overlay should disappear)
    await page.waitForSelector('.loading-overlay', { state: 'hidden', timeout: 10000 });

    // Now zoom should reset after ~800ms delay
    await expect(page.locator('.zoom-overlay')).toBeHidden({ timeout: 2000 });
  });

  test('zoom reset should be cancelled if new seek starts', async ({ page }) => {
    const thumbnail = page.locator('.seek-thumbnail-container').first();
    await thumbnail.waitFor({ state: 'visible' });

    // Zoom in
    await thumbnail.dblclick();
    await expect(page.locator('.zoom-overlay')).toBeVisible({ timeout: 2000 });

    // Click to seek
    const secondThumbnail = page.locator('.seek-thumbnail-container').nth(2);
    await secondThumbnail.click();

    // Quickly click another thumbnail before first seek completes
    const thirdThumbnail = page.locator('.seek-thumbnail-container').nth(4);
    await thirdThumbnail.click();

    // Zoom should still be active (reset was cancelled)
    await expect(page.locator('.zoom-overlay')).toBeVisible();
  });
});
```

**Step 2: Run the test to verify it works**

Run: `npx playwright test tests/live/flow/fitness/zoom-seek-lifecycle.runtime.test.mjs --headed`
Expected: Tests pass (or provide useful failure info for debugging)

**Step 3: Commit test**

```bash
git add tests/live/flow/fitness/zoom-seek-lifecycle.runtime.test.mjs
git commit -m "test(fitness): add Playwright test for zoom-seek lifecycle

Verifies BUG-06 fix - zoom does not reset while buffering,
only after playback resumes."
```

---

## Summary

**Changes made:**
1. `useSeekState.js` - Added seek lifecycle state machine
2. `useZoomState.js` - Consumes lifecycle for smarter zoom reset
3. `FitnessPlayerFooterSeekThumbnails.jsx` - Wires lifecycle between hooks
4. `hooks/index.js` - Exports SEEK_LIFECYCLE constant
5. Bug report updated
6. Playwright test added

**Not changed:**
- `Player.jsx` - Untouched
- `FitnessPlayer.jsx` - Untouched
- Any cross-module APIs

**Risk:** Low - changes isolated to Fitness footer hooks
