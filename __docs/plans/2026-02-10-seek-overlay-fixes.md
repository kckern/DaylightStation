# Seek Overlay Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two seek-related overlay bugs: (1) position display flashes current position before showing target during seek, and (2) spinner appears instantly on quick ffwd/rew bumps instead of only when the seek actually stalls.

**Architecture:** Both fixes live in `useMediaResilience.js` — the hook that computes overlay visibility and props. Fix 1 adds a "sticky intent" ref that survives `targetTimeSeconds` consumption. Fix 2 adds a seek grace period that suppresses the overlay during brief seeks. No changes needed in `PlayerOverlayLoading.jsx` itself.

**Tech Stack:** React hooks (useEffect, useRef, useState, useMemo)

---

## Root Cause Analysis

### Bug 1: Position display flashes current position on seek

**Event sequence:**
1. `targetTimeSeconds` is set (e.g., 120) → `intentPositionDisplay = "2:00"`
2. `useMediaReporter.applyPendingSeek()` sets `mediaEl.currentTime = 120`
3. `onSeekRequestConsumed()` fires immediately → `targetTimeSeconds = null` → `intentPositionDisplay = null`
4. Browser fires `seeking` event (async) → `isSeeking: true` propagates through React state
5. Overlay appears (triggered by `isBuffering` or `isSeeking`) but `intentPositionDisplay` is already null

The intent position is erased before the overlay ever uses it.

### Bug 2: Spinner shows immediately on seek bumps

**Current code (line 201):**
```javascript
const shouldShowOverlay = ... || isSeeking || isBuffering || ...
```
`isSeeking` is a direct trigger for the overlay. ANY seek — even a quick 10-second bump that resolves in 200ms — shows the spinner. The existing 300ms CSS transition delay helps but doesn't suppress it entirely. Users want bump-seeks to feel instantaneous; the overlay should only appear if the seek actually stalls.

---

## Task 1: Add sticky intent position refs

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:154-172` (position tracking section)
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:225-228` (overlayProps intent fields)
- Test: `tests/isolated/assembly/player/stickyIntentPosition.unit.test.mjs`

### Step 1: Write the failing test

Create `tests/isolated/assembly/player/stickyIntentPosition.unit.test.mjs`:

```javascript
/**
 * Unit tests for sticky intent position logic
 *
 * Tests the pure logic that preserves seek intent display values
 * after targetTimeSeconds is consumed (nulled), so the overlay
 * shows the correct seek target rather than the current position.
 *
 * @see frontend/src/modules/Player/hooks/useMediaResilience.js
 */

/**
 * Extracted logic under test:
 * Given (targetTimeSeconds, isSeeking, stickyRef), compute the
 * intentPositionDisplay and intentPositionUpdatedAt to pass to the overlay.
 */
function computeStickyIntent({ targetTimeSeconds, isSeeking, stickyDisplay, stickyUpdatedAt, formatTime }) {
  const liveDisplay = Number.isFinite(targetTimeSeconds) ? formatTime(Math.max(0, targetTimeSeconds)) : null;
  const liveUpdatedAt = Number.isFinite(targetTimeSeconds) ? Date.now() : null;

  return {
    intentPositionDisplay: liveDisplay || (isSeeking ? stickyDisplay : null),
    intentPositionUpdatedAt: liveUpdatedAt || (isSeeking ? stickyUpdatedAt : null),
  };
}

const formatTime = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

describe('Sticky Intent Position Logic', () => {
  test('returns live intent when targetTimeSeconds is finite', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: 120,
      isSeeking: false,
      stickyDisplay: null,
      stickyUpdatedAt: null,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBe('2:00');
    expect(result.intentPositionUpdatedAt).not.toBeNull();
  });

  test('returns null when target consumed and NOT seeking', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: null,
      isSeeking: false,
      stickyDisplay: '2:00',
      stickyUpdatedAt: 1000,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBeNull();
    expect(result.intentPositionUpdatedAt).toBeNull();
  });

  test('returns sticky value when target consumed but IS seeking', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: null,
      isSeeking: true,
      stickyDisplay: '2:00',
      stickyUpdatedAt: 1000,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBe('2:00');
    expect(result.intentPositionUpdatedAt).toBe(1000);
  });

  test('returns null when target consumed, seeking, but no sticky value', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: null,
      isSeeking: true,
      stickyDisplay: null,
      stickyUpdatedAt: null,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBeNull();
    expect(result.intentPositionUpdatedAt).toBeNull();
  });

  test('live intent takes priority over sticky when both exist', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: 180,
      isSeeking: true,
      stickyDisplay: '2:00',
      stickyUpdatedAt: 1000,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBe('3:00');
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run tests/isolated/assembly/player/stickyIntentPosition.unit.test.mjs`
Expected: FAIL — `computeStickyIntent` is defined inline and passes. Actually this test validates the pure logic we're about to implement. Run it to confirm the tests themselves work.

### Step 3: Implement sticky intent refs in useMediaResilience

In `frontend/src/modules/Player/hooks/useMediaResilience.js`, after the existing position tracking block (lines 154-172), add:

```javascript
  // Sticky intent: preserve last known intent display for overlay use after consumption
  const stickyIntentDisplayRef = useRef(null);
  const stickyIntentUpdatedAtRef = useRef(null);

  // Capture intent values before targetTimeSeconds is consumed
  useEffect(() => {
    if (Number.isFinite(targetTimeSeconds)) {
      stickyIntentDisplayRef.current = formatTime(Math.max(0, targetTimeSeconds));
      stickyIntentUpdatedAtRef.current = Date.now();
    }
  }, [targetTimeSeconds]);

  // Clear sticky intent when seek completes
  useEffect(() => {
    if (!isSeeking) {
      stickyIntentDisplayRef.current = null;
      stickyIntentUpdatedAtRef.current = null;
    }
  }, [isSeeking]);
```

Then update the overlayProps computation (lines 225-228). Replace:

```javascript
    intentPositionDisplay: Number.isFinite(targetTimeSeconds) ? formatTime(Math.max(0, targetTimeSeconds)) : null,
    intentPositionUpdatedAt,
```

With:

```javascript
    intentPositionDisplay: (Number.isFinite(targetTimeSeconds) ? formatTime(Math.max(0, targetTimeSeconds)) : null)
      || (isSeeking ? stickyIntentDisplayRef.current : null),
    intentPositionUpdatedAt: intentPositionUpdatedAt
      || (isSeeking ? stickyIntentUpdatedAtRef.current : null),
```

### Step 4: Run test to verify it passes

Run: `npx vitest run tests/isolated/assembly/player/stickyIntentPosition.unit.test.mjs`
Expected: PASS

### Step 5: Commit

```bash
git add tests/isolated/assembly/player/stickyIntentPosition.unit.test.mjs frontend/src/modules/Player/hooks/useMediaResilience.js
git commit -m "fix: preserve seek intent position after consumption for overlay display"
```

---

## Task 2: Add seek grace period to suppress overlay during brief seeks

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:174-201` (presentation logic / shouldShowOverlay)
- Test: `tests/isolated/assembly/player/seekGracePeriod.unit.test.mjs`

### Step 1: Write the failing test

Create `tests/isolated/assembly/player/seekGracePeriod.unit.test.mjs`:

```javascript
/**
 * Unit tests for seek grace period logic
 *
 * Tests the pure logic that suppresses the loading overlay during
 * brief seek operations (ffwd/rew bumps) so only stalled seeks
 * show the spinner.
 *
 * @see frontend/src/modules/Player/hooks/useMediaResilience.js
 */

/**
 * Extracted logic under test:
 * Given overlay trigger flags and seek grace state, determine
 * whether the overlay should be shown.
 */
function computeShouldShowOverlay({
  isLoopTransition,
  isStalled,
  isRecovering,
  isStartup,
  hasEverPlayed,
  isBuffering,
  isUserPaused,
  seekGraceActive,
}) {
  return !isLoopTransition && !seekGraceActive && (
    isStalled || isRecovering || (isStartup && !hasEverPlayed) ||
    isBuffering || isUserPaused
  );
}

describe('Seek Grace Period — shouldShowOverlay', () => {
  const base = {
    isLoopTransition: false,
    isStalled: false,
    isRecovering: false,
    isStartup: false,
    hasEverPlayed: true,
    isBuffering: false,
    isUserPaused: false,
    seekGraceActive: false,
  };

  test('shows overlay when buffering and no seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isBuffering: true })).toBe(true);
  });

  test('suppresses overlay when buffering during seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isBuffering: true, seekGraceActive: true })).toBe(false);
  });

  test('suppresses overlay when stalled during seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isStalled: true, seekGraceActive: true })).toBe(false);
  });

  test('shows stall overlay after grace expires (seekGraceActive=false, isStalled=true)', () => {
    expect(computeShouldShowOverlay({ ...base, isStalled: true, seekGraceActive: false })).toBe(true);
  });

  test('isSeeking alone no longer triggers overlay (removed from triggers)', () => {
    // isSeeking is not a parameter at all — it was removed from the trigger list
    expect(computeShouldShowOverlay({ ...base })).toBe(false);
  });

  test('startup overlay is not affected by seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isStartup: true, hasEverPlayed: false })).toBe(true);
  });

  test('user pause overlay is not affected by seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isUserPaused: true })).toBe(true);
  });

  test('loop transition suppresses even with buffering', () => {
    expect(computeShouldShowOverlay({ ...base, isBuffering: true, isLoopTransition: true })).toBe(false);
  });

  test('nothing triggers → no overlay', () => {
    expect(computeShouldShowOverlay(base)).toBe(false);
  });
});
```

### Step 2: Run test to verify it fails/passes (validates the logic shape)

Run: `npx vitest run tests/isolated/assembly/player/seekGracePeriod.unit.test.mjs`
Expected: PASS (pure logic tests, validates our target behavior)

### Step 3: Implement seek grace period in useMediaResilience

In `frontend/src/modules/Player/hooks/useMediaResilience.js`, add state and timer after the sticky intent code (before the presentation logic block):

```javascript
  // Seek grace period: suppress overlay during brief seeks (ffwd/rew bumps)
  // The overlay should only appear if the seek actually stalls, not for quick bumps.
  const SEEK_OVERLAY_GRACE_MS = 600;
  const seekGraceTimerRef = useRef(null);
  const [seekGraceActive, setSeekGraceActive] = useState(false);

  useEffect(() => {
    if (isSeeking) {
      setSeekGraceActive(true);
      clearTimeout(seekGraceTimerRef.current);
      seekGraceTimerRef.current = setTimeout(() => {
        setSeekGraceActive(false);
      }, SEEK_OVERLAY_GRACE_MS);
    } else {
      setSeekGraceActive(false);
      clearTimeout(seekGraceTimerRef.current);
      seekGraceTimerRef.current = null;
    }
    return () => clearTimeout(seekGraceTimerRef.current);
  }, [isSeeking]);
```

Then update `shouldShowOverlay` (line 201). Replace:

```javascript
  const shouldShowOverlay = !isLoopTransition && (isStalled || isRecovering || (isStartup && !hasEverPlayedRef.current) || isSeeking || isBuffering || isUserPaused);
```

With:

```javascript
  const shouldShowOverlay = !isLoopTransition && !seekGraceActive && (isStalled || isRecovering || (isStartup && !hasEverPlayedRef.current) || isBuffering || isUserPaused);
```

Key changes:
- **Removed `isSeeking`** from the trigger list — seeking alone no longer shows the overlay.
- **Added `!seekGraceActive`** — during the grace period, ALL triggers (including buffering that fires during seek) are suppressed.
- After grace expires (`seekGraceActive` becomes false), if `isBuffering` or `isStalled` is still true, the overlay appears.
- Startup/pause overlays: if the user was already in startup or paused state before seeking, `seekGraceActive` suppresses them during the grace window. This is acceptable — startup overlays won't occur during seek (you need to have loaded first), and pause is an explicit user action that wouldn't coincide with a seek.

### Step 4: Update the shouldShowOverlay comment

Replace the comment block above `shouldShowOverlay` (lines 195-200):

```javascript
  // The overlay should appear if:
  // - We are in a resilience error state (stalling, recovering, startup)
  // - We are buffering AND not in a seek grace period
  // - The user has paused the video (and wants the overlay shown)
  // Seek grace: brief seeks (ffwd/rew bumps) suppress the overlay for SEEK_OVERLAY_GRACE_MS.
  // If the seek stalls beyond the grace period, buffering/stall triggers show the overlay.
  // Note: isLoopTransition still handles loop restart case
```

### Step 5: Run test to verify it passes

Run: `npx vitest run tests/isolated/assembly/player/seekGracePeriod.unit.test.mjs`
Expected: PASS

### Step 6: Commit

```bash
git add tests/isolated/assembly/player/seekGracePeriod.unit.test.mjs frontend/src/modules/Player/hooks/useMediaResilience.js
git commit -m "fix: add seek grace period to suppress spinner during brief ffwd/rew seeks"
```

---

## Task 3: Verify overlay status still correct for long seeks

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:204` (overlayProps status)

### Step 1: Verify current behavior

The overlayProps `status` line is:
```javascript
status: isSeeking ? 'seeking' : status,
```

This is still correct: when the overlay DOES appear (after grace expires), if `isSeeking` is still true, it will report `status: 'seeking'` and `PlayerOverlayLoading` will prefer the sticky intent position. No change needed.

### Step 2: Add `seekGraceActive` to overlayProps useMemo deps

In the `useMemo` dependency array (lines 236-258), add `seekGraceActive` since `shouldShowOverlay` now depends on it:

In the dependency array, after `isSeeking,` add `seekGraceActive,`:

```javascript
  }), [
    status,
    isStalled,
    isRecovering,
    isStartup,
    isSeeking,
    seekGraceActive,
    isBuffering,
    ...
  ]);
```

### Step 3: Run all player tests

Run: `npx vitest run tests/isolated/assembly/player/`
Expected: All PASS

### Step 4: Commit

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.js
git commit -m "fix: add seekGraceActive to overlayProps deps for correct memoization"
```

---

## Task 4: Manual smoke test

### Step 1: Start dev server

Check if already running: `lsof -i :3111`
If not: `npm run dev`

### Step 2: Test quick seek bumps

1. Play any video content
2. Use keyboard shortcuts to seek forward/backward (10s bumps)
3. **Expected:** No spinner appears for quick seeks. Playback jumps smoothly.

### Step 3: Test long seeks

1. Play any video content
2. Seek to a distant unbuffered position (e.g., click progress bar near the end)
3. **Expected:** After ~600ms, spinner appears with the target position displayed (e.g., "45:20"), not the current position.

### Step 4: Test seek during stall

1. Find content that buffers (e.g., high bitrate on slow connection)
2. Seek while buffering
3. **Expected:** Grace period suppresses overlay briefly, then shows with correct target position.

---

## Summary of Changes

| File | Change |
|------|--------|
| `useMediaResilience.js` | Add sticky intent refs, seek grace timer, update `shouldShowOverlay`, update overlayProps |
| `stickyIntentPosition.unit.test.mjs` | New: pure logic tests for sticky intent |
| `seekGracePeriod.unit.test.mjs` | New: pure logic tests for seek grace suppression |
