# Music Player Auto-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fitness music player recover on its own from transient load failures — automatically retrying a bounded number of times instead of stranding the user at a manual "tap to retry" state — and remove the misleading "Music source unavailable" message.

**Architecture:** The music source (a Plex playlist) is always available; reaching a no-track state is therefore a *client-side* resolution failure (the queue fetch was skipped, timed out, or transiently failed). The fix replaces the passive `useStuckLoadingDetector` (which only flips an `isStuck` flag and waits for a human tap) with an active `useMusicRecovery` hook that auto-retries the load (via the inner `<Player>`'s remount key) up to `maxAutoRetries` times, surfacing a manual affordance only once that budget is spent. Recoverable transient errors (`fetch-failed`, `fetch-timeout`) feed the same retry loop; genuine content errors (`empty-queue`, `invalid-queue`) are shown immediately without retry.

**Tech Stack:** React hooks, Vitest + `@testing-library/react` (`renderHook`, fake timers). Tests run with `npx vitest run <path>`.

**Prerequisite (already landed in this branch — do NOT redo):** The signature-cache bug in `frontend/src/modules/Player/hooks/useQueueController.js` is fixed (the dedup early-return is gated on `playQueueLengthRef.current > 0`). That fix is what makes a remount actually re-fetch; this plan depends on it. Its regression test lives in `useQueueController.test.js` ("re-fetches after remount (signature cache carryover)").

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.js` | Map error kinds → user text; classify recoverable kinds | Modify (remove `no-source`; add `isRecoverableMusicError`) |
| `frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.test.js` | Unit tests for the above | Modify |
| `frontend/src/modules/Player/Player.jsx` | Generic player; no-source backstop | Modify (revert the `no-source` `onError` surfacing) |
| `frontend/src/modules/Fitness/player/panels/useMusicRecovery.js` | Bounded auto-retry recovery policy for the music player | **Create** |
| `frontend/src/modules/Fitness/player/panels/useMusicRecovery.test.js` | Unit tests for the recovery hook | **Create** |
| `frontend/src/modules/Fitness/player/panels/useStuckLoadingDetector.js` | (old, passive detector) | **Delete** |
| `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` | Music player UI; wires recovery + render + logging | Modify |

---

## Task 1: Remove the misleading "Music source unavailable" message and its surfacing

Reverts the stop-gap "Change 2": the generic no-source `onError` surfacing in `Player.jsx` and the `no-source` message. Recovery is the right remedy, and "source unavailable" mislabels a client-side failure.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.js`
- Modify: `frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.test.js`
- Modify: `frontend/src/modules/Player/Player.jsx:195-206`

- [ ] **Step 1: Remove the `no-source` test case**

In `musicPlayerErrorFormat.test.js`, delete this `it` block (it sits just before the "returns generic fallback" test):

```javascript
  it('formats no-source (player backstop timeout)', () => {
    expect(formatMusicErrorMessage({ kind: 'no-source' })).toBe('Music source unavailable');
  });
```

- [ ] **Step 2: Remove the `no-source` case from the formatter**

In `musicPlayerErrorFormat.js`, delete this line from the `switch`:

```javascript
    case 'no-source':          return 'Music source unavailable';
```

The function returns to its prior shape (only `default: return 'Music unavailable';` remains as the catch-all).

- [ ] **Step 3: Revert the `Player.jsx` no-source effect to log-and-dismiss only**

Replace the effect at `Player.jsx:195` with its original form (remove the `onError` call, the `queueLength` hoist, and the `onError` dependency):

```javascript
  useEffect(() => {
    if (activeSource) return;
    const timeout = setTimeout(() => {
      playbackLog('player-no-source-timeout', {
        isQueue,
        queueLength: playQueue?.length ?? 0,
        hasPlay: !!play,
      }, { level: 'error' });
      clear?.();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [activeSource, isQueue, playQueue, play, clear]);
```

- [ ] **Step 4: Run the format test and confirm it still passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.test.js`
Expected: PASS (10 tests; the `no-source` test is gone).

- [ ] **Step 5: Run the Player suite to confirm no regression from the revert**

Run: `npx vitest run frontend/src/modules/Player`
Expected: PASS (all Player test files green).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.js \
        frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.test.js \
        frontend/src/modules/Player/Player.jsx
git commit -m "revert(music-player): drop misleading no-source 'Music source unavailable' surfacing

The no-source state is a client-side resolution failure, not an unavailable
upstream. Replaced by bounded auto-recovery in subsequent commits."
```

---

## Task 2: Add a recoverable-error classifier

A single source of truth for which music error kinds are worth auto-retrying. Used by both the recovery hook driver and the render path.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.js`
- Modify: `frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `musicPlayerErrorFormat.test.js` (after the existing `describe('formatMusicErrorMessage', ...)` block). Add the import update on line 2 first:

```javascript
import { formatMusicErrorMessage, isRecoverableMusicError } from './musicPlayerErrorFormat.js';
```

Then append:

```javascript
describe('isRecoverableMusicError', () => {
  it('treats transient queue-fetch failures as recoverable', () => {
    expect(isRecoverableMusicError('fetch-failed')).toBe(true);
    expect(isRecoverableMusicError('fetch-timeout')).toBe(true);
  });
  it('treats genuine content problems as non-recoverable', () => {
    expect(isRecoverableMusicError('empty-queue')).toBe(false);
    expect(isRecoverableMusicError('invalid-queue')).toBe(false);
  });
  it('returns false for null/unknown kinds', () => {
    expect(isRecoverableMusicError(null)).toBe(false);
    expect(isRecoverableMusicError('something-new')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.test.js -t isRecoverableMusicError`
Expected: FAIL with "isRecoverableMusicError is not a function" (or import error).

- [ ] **Step 3: Implement the classifier**

In `musicPlayerErrorFormat.js`, add above `formatMusicErrorMessage`:

```javascript
// Error kinds that represent transient client-side resolution failures —
// the playlist is fine, the fetch just needs another try. Genuine content
// problems (empty-queue, invalid-queue) are intentionally excluded: retrying
// an empty playlist would loop forever.
const RECOVERABLE_MUSIC_ERROR_KINDS = new Set(['fetch-failed', 'fetch-timeout']);

export function isRecoverableMusicError(kind) {
  return RECOVERABLE_MUSIC_ERROR_KINDS.has(kind);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.test.js`
Expected: PASS (all `formatMusicErrorMessage` + `isRecoverableMusicError` tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.js \
        frontend/src/modules/Fitness/player/panels/musicPlayerErrorFormat.test.js
git commit -m "feat(music-player): classify recoverable vs terminal music errors"
```

---

## Task 3: Create the `useMusicRecovery` hook (bounded auto-retry)

Replaces the passive `useStuckLoadingDetector`. Drives `attempt` (woven into the `<Player>` key so each retry forces a remount → re-fetch), auto-retries on stall or recoverable error up to `maxAutoRetries`, and exposes `isRecovering` / `exhausted` so the UI shows "Loading…" during retries and an error only when the budget is spent.

**Files:**
- Create: `frontend/src/modules/Fitness/player/panels/useMusicRecovery.js`
- Create: `frontend/src/modules/Fitness/player/panels/useMusicRecovery.test.js`

- [ ] **Step 1: Write the failing tests**

Create `useMusicRecovery.test.js`:

```javascript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMusicRecovery } from './useMusicRecovery.js';

const BASE = {
  hasTrack: false,
  playlistId: 672596,
  recoverableError: false,
  thresholdMs: 15_000,
  retryDelayMs: 1_000,
  maxAutoRetries: 2,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('useMusicRecovery', () => {
  it('is idle when no playlist is selected', () => {
    const { result } = renderHook(() => useMusicRecovery({ ...BASE, playlistId: null }));
    expect(result.current.attempt).toBe(0);
    expect(result.current.isRecovering).toBe(false);
    expect(result.current.exhausted).toBe(false);
  });

  it('reports isRecovering while a playlist is loading with no track', () => {
    const { result } = renderHook(() => useMusicRecovery(BASE));
    expect(result.current.isRecovering).toBe(true);
    expect(result.current.exhausted).toBe(false);
  });

  it('auto-retries on silent stall up to maxAutoRetries, then exhausts', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMusicRecovery(BASE));

    // First stall: threshold + retry delay → attempt 1
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(1);
    expect(result.current.exhausted).toBe(false);

    // Second stall → attempt 2 (budget now spent: maxAutoRetries = 2)
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(2);
    expect(result.current.exhausted).toBe(false);

    // Third stall: no budget left → exhausted, attempt unchanged
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current.attempt).toBe(2);
    expect(result.current.exhausted).toBe(true);
    expect(result.current.isRecovering).toBe(false);
  });

  it('retries promptly on a recoverable error without waiting the stall threshold', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMusicRecovery({ ...BASE, recoverableError: true }));

    // Only the retry delay elapses — far less than the 15s stall threshold.
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.attempt).toBe(1);
  });

  it('resets the retry budget once a track is playing', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((props) => useMusicRecovery(props), { initialProps: BASE });

    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(1);

    // Track loads → recovering ends, budget resets.
    rerender({ ...BASE, hasTrack: true });
    expect(result.current.isRecovering).toBe(false);
    expect(result.current.exhausted).toBe(false);

    // Track drops again → a fresh budget is available (attempt keeps climbing).
    rerender({ ...BASE, hasTrack: false });
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(2);
    expect(result.current.exhausted).toBe(false);
  });

  it('manual retry clears exhaustion and restores the budget', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMusicRecovery(BASE));

    // Drive to exhaustion.
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current.exhausted).toBe(true);

    act(() => { result.current.retry(); });
    expect(result.current.exhausted).toBe(false);
    expect(result.current.attempt).toBe(3);

    // Budget restored: it auto-retries again instead of staying exhausted.
    act(() => { vi.advanceTimersByTime(15_000 + 1_000); });
    expect(result.current.attempt).toBe(4);
    expect(result.current.exhausted).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Fitness/player/panels/useMusicRecovery.test.js`
Expected: FAIL — "Failed to resolve import './useMusicRecovery.js'" (file does not exist yet).

- [ ] **Step 3: Implement the hook**

Create `useMusicRecovery.js`:

```javascript
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Drives automatic recovery for the music player. When a playlist is selected
 * but no track is playing — either because the load silently stalled, or
 * because a recoverable error (a transient queue-fetch failure) occurred — this
 * hook automatically retries the load up to `maxAutoRetries` times before
 * giving up.
 *
 * `attempt` is woven into the inner <Player>'s React key so each retry forces a
 * clean remount, which re-fetches the queue. The music source is always
 * available, so a stall is a client-side resolution failure that self-heals on
 * retry; only after the retry budget is spent do we surface a manual affordance.
 *
 * Inputs:
 *   hasTrack          boolean — true when a track is actually playing
 *   playlistId        string|number|null — selected playlist; null => idle
 *   recoverableError  boolean — true when the current error is worth retrying
 *   thresholdMs       number  — silent-stall detection window (default 15 s)
 *   retryDelayMs      number  — pause before an auto-retry (default 1 s)
 *   maxAutoRetries    number  — automatic attempts before exhaustion (default 3)
 *
 * Output:
 *   attempt       number   — increments on each retry (manual or automatic)
 *   isRecovering  boolean  — true while loading/retrying (UI shows "Loading…")
 *   exhausted     boolean  — true once auto-retries are spent and still no track
 *   retry()       function — manual retry: resets the budget and bumps attempt
 */
export function useMusicRecovery({
  hasTrack,
  playlistId,
  recoverableError = false,
  thresholdMs = 15_000,
  retryDelayMs = 1_000,
  maxAutoRetries = 3,
}) {
  const [attempt, setAttempt] = useState(0);
  const [autoRetryCount, setAutoRetryCount] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const stallTimerRef = useRef(null);
  const retryTimerRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  }, []);

  // A track is playing → fully reset the recovery budget.
  useEffect(() => {
    if (!hasTrack) return;
    clearTimers();
    if (autoRetryCount !== 0) setAutoRetryCount(0);
    if (exhausted) setExhausted(false);
  }, [hasTrack, autoRetryCount, exhausted, clearTimers]);

  // Failure detection + bounded auto-retry.
  useEffect(() => {
    if (!playlistId || hasTrack || exhausted) {
      clearTimers();
      return undefined;
    }

    const scheduleAutoRetry = () => {
      if (autoRetryCount >= maxAutoRetries) {
        setExhausted(true);
        return;
      }
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setAutoRetryCount((n) => n + 1);
        setAttempt((n) => n + 1);
      }, retryDelayMs);
    };

    if (recoverableError) {
      // The error already proves the load failed — retry without the full wait.
      scheduleAutoRetry();
    } else {
      // Silent stall — wait the detection window before retrying.
      stallTimerRef.current = setTimeout(scheduleAutoRetry, thresholdMs);
    }

    return clearTimers;
  }, [playlistId, hasTrack, exhausted, recoverableError, autoRetryCount, maxAutoRetries, thresholdMs, retryDelayMs, clearTimers]);

  const retry = useCallback(() => {
    setExhausted(false);
    setAutoRetryCount(0);
    setAttempt((n) => n + 1);
  }, []);

  const isRecovering = Boolean(playlistId) && !hasTrack && !exhausted;

  return { attempt, isRecovering, exhausted, retry };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/player/panels/useMusicRecovery.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/useMusicRecovery.js \
        frontend/src/modules/Fitness/player/panels/useMusicRecovery.test.js
git commit -m "feat(music-player): add useMusicRecovery hook with bounded auto-retry"
```

---

## Task 4: Wire `useMusicRecovery` into `FitnessMusicPlayer`

Swap the passive detector for the recovery hook: derive `recoverableError`, clear the error on each retry so the loop isn't fed a stale error, key the inner `<Player>` off `recovery.attempt`, and update the render so "Loading…" shows during recovery and the error/tap-to-retry shows only on exhaustion or a non-recoverable error.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` (import line 12; hook usage 70-74; handleRetry 214-217; Player key ~713; render block 586-601)
- Delete: `frontend/src/modules/Fitness/player/panels/useStuckLoadingDetector.js`

- [ ] **Step 1: Confirm the old hook has no other importers**

Run: `grep -rn "useStuckLoadingDetector" frontend/src`
Expected: matches only in `FitnessMusicPlayer.jsx` and `useStuckLoadingDetector.js`. (If anything else imports it, stop and reassess.)

- [ ] **Step 2: Update imports**

In `FitnessMusicPlayer.jsx`, replace line 12:

```javascript
import { useStuckLoadingDetector } from './useStuckLoadingDetector.js';
```

with:

```javascript
import { useMusicRecovery } from './useMusicRecovery.js';
import { formatMusicErrorMessage, isRecoverableMusicError } from './musicPlayerErrorFormat.js';
```

Then delete the now-duplicate `formatMusicErrorMessage` import (line 13):

```javascript
import { formatMusicErrorMessage } from './musicPlayerErrorFormat.js';
```

- [ ] **Step 3: Replace the detector call with the recovery hook**

Replace the block at lines 69-74:

```javascript
  const hasTrack = Boolean(currentTrack);
  const stuck = useStuckLoadingDetector({
    hasTrack,
    playlistId: selectedPlaylistId,
    thresholdMs: 15_000,
  });
```

with:

```javascript
  const hasTrack = Boolean(currentTrack);
  const recoverableError = isRecoverableMusicError(playerError?.kind);
  const recovery = useMusicRecovery({
    hasTrack,
    playlistId: selectedPlaylistId,
    recoverableError,
    thresholdMs: 15_000,
    retryDelayMs: 1_000,
    maxAutoRetries: 3,
  });

  // Each retry (auto or manual) bumps recovery.attempt → the inner <Player>
  // remounts and re-fetches. Clear the previous error so the recovery loop
  // isn't immediately re-triggered by a stale error on the fresh attempt.
  const recoveryAttemptRef = useRef(recovery.attempt);
  useEffect(() => {
    if (recoveryAttemptRef.current !== recovery.attempt) {
      recoveryAttemptRef.current = recovery.attempt;
      setPlayerError(null);
    }
  }, [recovery.attempt]);
```

- [ ] **Step 4: Update `handleRetry` to drive the recovery hook**

Replace lines 214-217:

```javascript
  const handleRetry = useCallback(() => {
    setPlayerError(null);
    stuck.retry();
  }, [stuck]);
```

with:

```javascript
  const handleRetry = useCallback(() => {
    setPlayerError(null);
    recovery.retry();
  }, [recovery]);
```

- [ ] **Step 5: Key the inner `<Player>` off `recovery.attempt`**

Replace the `key` prop on the hidden audio `<Player>` (~line 713):

```javascript
          key={`${selectedPlaylistId}-${stuck.attempt}`}
```

with:

```javascript
          key={`${selectedPlaylistId}-${recovery.attempt}`}
```

- [ ] **Step 6: Update the title render block (Loading vs error)**

Replace the IIFE at lines 586-601:

```javascript
                {currentTrack?.title || currentTrack?.label || (() => {
                  const errToShow = playerError || (stuck.isStuck ? { kind: 'unknown' } : null);
                  if (!errToShow) return 'Loading…';
                  const text = formatMusicErrorMessage(errToShow);
                  return (
                    <span
                      className="music-player-retry"
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => { e.stopPropagation(); handleRetry(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRetry(); } }}
                    >
                      {text} — tap to retry
                    </span>
                  );
                })()}
```

with:

```javascript
                {currentTrack?.title || currentTrack?.label || (() => {
                  // A non-recoverable error (e.g. an empty playlist) is shown at
                  // once; recoverable failures are retried silently and only
                  // surface once the recovery budget is exhausted.
                  const terminalError = playerError && !isRecoverableMusicError(playerError.kind)
                    ? playerError
                    : (recovery.exhausted ? { kind: 'unknown' } : null);
                  if (!terminalError) return 'Loading…';
                  const text = formatMusicErrorMessage(terminalError);
                  return (
                    <span
                      className="music-player-retry"
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => { e.stopPropagation(); handleRetry(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRetry(); } }}
                    >
                      {text} — tap to retry
                    </span>
                  );
                })()}
```

- [ ] **Step 7: Delete the obsolete detector**

```bash
git rm frontend/src/modules/Fitness/player/panels/useStuckLoadingDetector.js
```

- [ ] **Step 8: Verify the file compiles and references are clean**

Run: `grep -n "stuck" frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx`
Expected: only the `stuckLoggedRef` / `fitness.music.stuck_loading` references in the logging effect remain (rewritten in Task 5). No bare `stuck.` member access.

Run: `npx vitest run frontend/src/modules/Fitness/player/panels`
Expected: PASS (existing panel tests still green; no import errors).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx
git rm frontend/src/modules/Fitness/player/panels/useStuckLoadingDetector.js
git commit -m "feat(music-player): drive auto-recovery from useMusicRecovery; remove passive detector"
```

---

## Task 5: Make the diagnostic log fire on exhaustion (not first stall)

The `fitness.music.stuck_loading` warning should mark the meaningful event — recovery genuinely failed after retries — rather than the first transient stall. Include how many auto-retries were spent.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx:80-97`

- [ ] **Step 1: Rewrite the logging effect to trigger on `recovery.exhausted`**

Replace the effect at lines 80-97:

```javascript
  const stuckLoggedRef = useRef(false);
  useEffect(() => {
    if (!stuck.isStuck) {
      stuckLoggedRef.current = false;
      return;
    }
    if (stuckLoggedRef.current) return;
    stuckLoggedRef.current = true;
    const hasExplicitError = Boolean(playerError);
    getLogger().warn('fitness.music.stuck_loading', {
      playlistId: selectedPlaylistId || null,
      attempt: stuck.attempt,
      thresholdMs: 15_000,
      musicEnabled: Boolean(musicEnabled),
      hasExplicitError,
      silentFailure: !hasExplicitError,
    });
  }, [stuck.isStuck, stuck.attempt, selectedPlaylistId, musicEnabled, playerError]);
```

with:

```javascript
  // Log once when auto-recovery is exhausted — i.e. the player retried and
  // still could not load a track. This is the actionable signal; transient
  // stalls that self-heal on retry are intentionally not logged as failures.
  const exhaustionLoggedRef = useRef(false);
  useEffect(() => {
    if (!recovery.exhausted) {
      exhaustionLoggedRef.current = false;
      return;
    }
    if (exhaustionLoggedRef.current) return;
    exhaustionLoggedRef.current = true;
    const hasExplicitError = Boolean(playerError);
    getLogger().warn('fitness.music.stuck_loading', {
      playlistId: selectedPlaylistId || null,
      attempt: recovery.attempt,
      thresholdMs: 15_000,
      musicEnabled: Boolean(musicEnabled),
      hasExplicitError,
      silentFailure: !hasExplicitError,
    });
  }, [recovery.exhausted, recovery.attempt, selectedPlaylistId, musicEnabled, playerError]);
```

- [ ] **Step 2: Verify no `stuck.` references remain**

Run: `grep -n "stuck\." frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx`
Expected: no output (all `stuck.` member access removed; only `stuck_loading` the string and `exhaustionLoggedRef` remain, which won't match `stuck\.`).

- [ ] **Step 3: Run the panel suite**

Run: `npx vitest run frontend/src/modules/Fitness/player/panels`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx
git commit -m "feat(music-player): log fitness.music.stuck_loading on recovery exhaustion"
```

---

## Task 6: Full regression sweep

**Files:** none (verification only)

- [ ] **Step 1: Run all Player + fitness panel tests**

Run:
```bash
npx vitest run \
  frontend/src/modules/Player \
  tests/isolated/assembly/player \
  frontend/src/modules/Fitness/player/panels
```
Expected: PASS — every file green, output free of unexpected errors. (A `POST .../play/log 401` line from the logging transport in the test env is benign.)

- [ ] **Step 2: Confirm the prerequisite cache-fix test is still present and green**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js -t "remounted with the same contentRef"`
Expected: PASS (the remount re-fetch test from the prerequisite fix).

---

## Self-Review

**1. Spec coverage**
- "Auto-retry instead of terminal state" → Task 3 (hook) + Task 4 (wiring). ✓
- "Bounded retries, then surface to user" → `maxAutoRetries` + `exhausted` (Task 3), render gate (Task 4 Step 6). ✓
- "Remove misleading 'Music source unavailable'" → Task 1. ✓
- "Recoverable vs terminal errors" → Task 2 classifier; render shows terminal errors immediately (Task 4 Step 6). ✓
- "Don't feed the loop a stale error" → clear-on-attempt effect (Task 4 Step 3). ✓
- "Honest diagnostics" → log on exhaustion (Task 5). ✓

**2. Placeholder scan** — every code step contains complete code; commands have expected output. No TBD/"handle edge cases"/"similar to". ✓

**3. Type/name consistency**
- Hook export `useMusicRecovery` and file `useMusicRecovery.js` match across Task 3 and Task 4. ✓
- Output fields `{ attempt, isRecovering, exhausted, retry }` are exactly the fields consumed in Task 4 (`recovery.attempt`, `recovery.exhausted`, `recovery.retry`) and Task 5 (`recovery.exhausted`, `recovery.attempt`). ✓
- `isRecoverableMusicError` signature `(kind) => boolean` matches its uses: `isRecoverableMusicError(playerError?.kind)` and `isRecoverableMusicError(playerError.kind)`. ✓
- `recoverableError` is derived in Task 4 Step 3 and consumed by the hook input of the same name (Task 3). ✓

**Behavioral note (intentional, not a gap):** when a recoverable error persists, `recoverableError` stays true across the brief window after an attempt bump until the clear-on-attempt effect runs; the recovery effect's `clearTimers` cleanup cancels any racy retry timer, so the budget is not double-spent. Worst case for a hard, never-resolving failure is ~3 stall windows (~45s of "Loading…") before exhaustion — acceptable for a backstop, and most hard failures surface a non-recoverable `playerError` (shown immediately) well before then.
