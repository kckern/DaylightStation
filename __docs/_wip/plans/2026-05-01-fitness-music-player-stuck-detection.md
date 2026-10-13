# Fitness Music Player Stuck-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the fitness music player gets stuck on "Loading…" indefinitely, surface a tap-to-retry control to the user, force a clean Player remount on retry, and emit a structured warning so the next occurrence is debuggable from logs alone.

**Architecture:** *This is not a root-cause fix.* The root cause of the underlying "Starting…" hang has not been confirmed (see bug doc `2026-05-01-fitness-music-player-loading-forever.md`). What this plan delivers is a **defensive recovery layer** in `FitnessMusicPlayer.jsx`: detect when no `currentTrack` has arrived for ≥15 s while a playlist is selected, replace the bare "Loading…" string with a "Music unavailable — tap to retry" affordance, and on retry bump a `loadAttempt` counter that is woven into the inner `<Player>`'s `key` to force a fresh mount. A structured `logger.warn('fitness.music.stuck_loading', …)` event fires once per stuck cycle so production logs surface the failure for future debugging. Scope is intentionally narrow — no Player.jsx or useQueueController.js changes.

**Tech Stack:** React (`FitnessMusicPlayer.jsx`), existing `getLogger()` framework, vitest + @testing-library/react, vitest fake timers for time-based assertions.

---

## File Structure

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` — add stuck-state effect, retry handler, replace placeholder copy, weave attempt key, emit warn log
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.scss` (file likely doesn't exist standalone — confirm; if not, add styles in `FitnessSidebar.scss` near existing music-player rules) — style the retry/error variant
- Create: `tests/isolated/modules/Fitness/FitnessMusicPlayerStuckDetection.test.jsx` — unit tests for the stuck-detection effect and retry handler

**Constant:** `STUCK_THRESHOLD_MS = 15_000`. Justification: the production log evidence shows the Player held `vis:Xms/0ms` `Starting…` for 600+ seconds — 15 s is a safe threshold that won't false-positive on normal Plex playlist resolves (which typically complete in 1-3 s) but recovers reasonably fast when stuck. Live-tunable via the constant if needed.

---

## Task 1: Failing test — stuck state activates after threshold elapses

**Files:**
- Create: `tests/isolated/modules/Fitness/FitnessMusicPlayerStuckDetection.test.jsx`

The existing `FitnessSidebarMenuTimeout.test.jsx` provides the mocking pattern. Extract the stuck-detection effect into a tiny pure helper hook so we can test it without mounting the entire `FitnessMusicPlayer` (which pulls in `Player.jsx` and significant dependencies).

- [ ] **Step 1: Write failing test for the stuck-detection hook**

Create `tests/isolated/modules/Fitness/FitnessMusicPlayerStuckDetection.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useStuckLoadingDetector } from '@/modules/Fitness/player/panels/useStuckLoadingDetector.js';

describe('useStuckLoadingDetector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns isStuck=false initially', () => {
    const { result } = renderHook(() => useStuckLoadingDetector({
      hasTrack: false, playlistId: 'pl-1', thresholdMs: 15_000
    }));
    expect(result.current.isStuck).toBe(false);
  });

  it('flips isStuck=true after thresholdMs elapses with no track and a playlist set', () => {
    const { result, rerender } = renderHook(
      ({ hasTrack, playlistId }) => useStuckLoadingDetector({ hasTrack, playlistId, thresholdMs: 15_000 }),
      { initialProps: { hasTrack: false, playlistId: 'pl-1' } }
    );

    expect(result.current.isStuck).toBe(false);

    act(() => { vi.advanceTimersByTime(14_999); });
    expect(result.current.isStuck).toBe(false);

    act(() => { vi.advanceTimersByTime(2); });
    expect(result.current.isStuck).toBe(true);
  });

  it('clears isStuck once a track arrives', () => {
    const { result, rerender } = renderHook(
      ({ hasTrack, playlistId }) => useStuckLoadingDetector({ hasTrack, playlistId, thresholdMs: 15_000 }),
      { initialProps: { hasTrack: false, playlistId: 'pl-1' } }
    );
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.isStuck).toBe(true);

    rerender({ hasTrack: true, playlistId: 'pl-1' });
    expect(result.current.isStuck).toBe(false);
  });

  it('does NOT flip isStuck when no playlist is selected (player intentionally idle)', () => {
    const { result } = renderHook(() => useStuckLoadingDetector({
      hasTrack: false, playlistId: null, thresholdMs: 15_000
    }));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.isStuck).toBe(false);
  });

  it('exposes a retry() function that resets the timer and increments attempt', () => {
    const { result } = renderHook(() => useStuckLoadingDetector({
      hasTrack: false, playlistId: 'pl-1', thresholdMs: 15_000
    }));

    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.isStuck).toBe(true);
    expect(result.current.attempt).toBe(0);

    act(() => { result.current.retry(); });
    expect(result.current.isStuck).toBe(false);
    expect(result.current.attempt).toBe(1);

    // After retry, threshold timer restarts.
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.isStuck).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails (helper doesn't exist)**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Fitness/FitnessMusicPlayerStuckDetection.test.jsx`

Expected: FAIL with module-not-found for `useStuckLoadingDetector.js`.

- [ ] **Step 3: Commit failing test**

```bash
git add tests/isolated/modules/Fitness/FitnessMusicPlayerStuckDetection.test.jsx
git commit -m "test(fitness): failing tests for music player stuck-loading detector"
```

---

## Task 2: Implement the stuck-loading detector hook

**Files:**
- Create: `frontend/src/modules/Fitness/player/panels/useStuckLoadingDetector.js`

- [ ] **Step 1: Implement the hook**

Create `frontend/src/modules/Fitness/player/panels/useStuckLoadingDetector.js`:

```javascript
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Tracks how long the music player has been "loading" (no currentTrack while a
 * playlist is selected) and flips isStuck=true once thresholdMs elapses.
 *
 * Inputs:
 *   hasTrack    boolean — true when currentTrack is non-null
 *   playlistId  string|null — the selected playlist; when null, detector idles
 *   thresholdMs number — how long to wait before declaring stuck (default 15 s)
 *
 * Output:
 *   isStuck  boolean — true once the threshold has elapsed without a track
 *   attempt  number  — increments on each retry()
 *   retry()  function — resets isStuck, restarts the threshold timer, bumps attempt
 *
 * The attempt counter is intended to be woven into the inner <Player>'s React
 * `key` so a retry forces a clean remount.
 */
export function useStuckLoadingDetector({ hasTrack, playlistId, thresholdMs = 15_000 }) {
  const [isStuck, setIsStuck] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    // Idle conditions: no playlist selected OR a track is already playing.
    if (!playlistId || hasTrack) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (isStuck) setIsStuck(false);
      return undefined;
    }

    // Already stuck — don't restart timer (only retry() does that).
    if (isStuck) return undefined;

    // Arm threshold timer.
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setIsStuck(true);
    }, thresholdMs);

    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [playlistId, hasTrack, thresholdMs, isStuck, attempt]);

  const retry = useCallback(() => {
    setIsStuck(false);
    setAttempt((n) => n + 1);
  }, []);

  return { isStuck, attempt, retry };
}
```

- [ ] **Step 2: Run tests to verify all pass**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Fitness/FitnessMusicPlayerStuckDetection.test.jsx`

Expected: all 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/useStuckLoadingDetector.js
git commit -m "feat(fitness): add stuck-loading detector hook for music player"
```

---

## Task 3: Wire the hook into FitnessMusicPlayer + emit diagnostic warn log

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx`

The wiring touches three spots:
1. Compute `hasTrack`, call the hook, get `{ isStuck, attempt, retry }`.
2. Replace the bare `'Loading...'` placeholder string with conditional copy + retry tap.
3. Pass `attempt` into the inner `<Player>`'s `key` so retry forces a remount.
4. Emit a structured warn the moment `isStuck` flips true.

- [ ] **Step 1: Add the import + hook call near the top of the component**

Edit `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx`. Find the existing imports near the top (lines 1-12) and add:

```javascript
import { useStuckLoadingDetector } from './useStuckLoadingDetector.js';
```

Then inside the component body, **after** the `currentTrack` state declaration (currently at L39) and **before** any `useEffect` that depends on these values, add:

```javascript
  const hasTrack = Boolean(currentTrack);
  const stuck = useStuckLoadingDetector({
    hasTrack,
    playlistId: selectedPlaylistId,
    thresholdMs: 15_000,
  });
```

- [ ] **Step 2: Emit `fitness.music.stuck_loading` warn when `isStuck` flips true**

Add a new `useEffect` directly below the hook call:

```javascript
  // Diagnostic: emit a structured warning the first time the music player is
  // detected stuck on this attempt. Production logs already capture the
  // 'playback.overlay-summary' loop from PlayerOverlayLoading; this event lets
  // us correlate the stuck UI state with that loop without scraping log shape.
  const stuckLoggedRef = useRef(false);
  useEffect(() => {
    if (!stuck.isStuck) {
      stuckLoggedRef.current = false;
      return;
    }
    if (stuckLoggedRef.current) return;
    stuckLoggedRef.current = true;
    getLogger().warn('fitness.music.stuck_loading', {
      playlistId: selectedPlaylistId || null,
      attempt: stuck.attempt,
      thresholdMs: 15_000,
      musicEnabled: Boolean(musicEnabled),
    });
  }, [stuck.isStuck, stuck.attempt, selectedPlaylistId, musicEnabled]);
```

`getLogger` is already imported (line 12 of the existing file). `useRef` is already imported. Verify before committing:

```bash
grep -n "import getLogger\|import.*useRef" frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx | head -5
```

- [ ] **Step 3: Replace the "Loading..." copy with conditional retry affordance**

Edit `FitnessMusicPlayer.jsx:535`. Replace:

```jsx
                {currentTrack?.title || currentTrack?.label || 'Loading...'}
```

with:

```jsx
                {currentTrack?.title || currentTrack?.label || (
                  stuck.isStuck ? (
                    <span
                      className="music-player-retry"
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => { e.stopPropagation(); stuck.retry(); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stuck.retry(); }
                      }}
                    >
                      Music unavailable — tap to retry
                    </span>
                  ) : 'Loading…'
                )}
```

Note: the surrounding `.music-player-info` element already has `onPointerDown={handleInfoTap}` (L519), so `stopPropagation` is required so the retry tap doesn't also toggle controls open. We deliberately use `'Loading…'` (single-character ellipsis) — matches existing style elsewhere in the file.

- [ ] **Step 4: Weave `stuck.attempt` into the inner Player's key so retry remounts it**

Edit `FitnessMusicPlayer.jsx:644-654`. Replace:

```jsx
      {/* Hidden Player Component - Player handles queue fetching and flattening */}
      <div style={{ position: 'absolute', left: '-9999px' }}>
        <Player
          ref={audioPlayerRef}
          key={selectedPlaylistId}
          queue={playerQueueProp}
          play={playerPlayProp}
          onProgress={handleProgress}
          playerType="audio"
          plexClientSession={musicPlexSession}
        />
      </div>
```

with:

```jsx
      {/* Hidden Player Component - Player handles queue fetching and flattening */}
      <div style={{ position: 'absolute', left: '-9999px' }}>
        <Player
          ref={audioPlayerRef}
          key={`${selectedPlaylistId}-${stuck.attempt}`}
          queue={playerQueueProp}
          play={playerPlayProp}
          onProgress={handleProgress}
          playerType="audio"
          plexClientSession={musicPlexSession}
        />
      </div>
```

This change has zero behavioral effect when `stuck.attempt === 0` (the initial render uses `pl-1-0` instead of `pl-1`, but it's a stable string — Player mounts once). Each retry bumps `attempt`, generating a new key like `pl-1-1`, `pl-1-2`, which forces React to unmount and remount the Player — fresh internal state, fresh queue resolve, fresh `plexClientSession`-derived requests.

- [ ] **Step 5: Spot-check syntax + lint**

```bash
npx eslint frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx
```

If lint flags anything, fix in place. Don't reformat unrelated lines.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx
git commit -m "feat(fitness): surface music player stuck-loading state with retry"
```

---

## Task 4: Style the retry affordance

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessSidebar.scss` (the music player styles live here — confirmed by `import '../FitnessSidebar.scss';` at the top of `FitnessMusicPlayer.jsx`)

- [ ] **Step 1: Locate the music player styling block**

Run: `grep -n "music-player-info\|track-title\|marquee-text" frontend/src/modules/Fitness/player/FitnessSidebar.scss | head -10`

Note the line range of the existing track-title styling — we will add the new selector at the same nesting level.

- [ ] **Step 2: Add styles for `.music-player-retry`**

Add the following block to `FitnessSidebar.scss`, near (and at the same nesting level as) the existing `.track-title` / `.marquee-text` rules:

```scss
.music-player-retry {
  display: inline-block;
  padding: 0 0.25rem;
  color: rgba(255, 165, 100, 0.95);   // warm-but-readable warning hue
  font-weight: 500;
  text-decoration: underline;
  cursor: pointer;
  user-select: none;

  &:hover { color: rgba(255, 200, 150, 1); }
  &:active { transform: scale(0.97); }
  &:focus-visible {
    outline: 2px solid rgba(255, 200, 150, 0.9);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessSidebar.scss
git commit -m "style(fitness): style music player stuck-loading retry affordance"
```

---

## Task 5: Manual UI verification

**Files:** none (in-browser check)

Per CLAUDE.md, UI changes require browser verification before completion.

- [ ] **Step 1: Confirm dev server is running**

`ss -tlnp | grep 3112` (or 3111 — see `.claude/settings.local.json`). Start `npm run dev` if missing.

- [ ] **Step 2: Verify normal-path behavior unchanged**

Open the fitness app. With Plex healthy and a music playlist selected, music plays after 1-3 s. The "Loading…" placeholder appears briefly then disappears as `currentTrack` populates. Confirm no regression — no false retry button appears, no warn fires in `dev.log`.

Tail `dev.log`:

```bash
tail -f dev.log | grep -E 'fitness.music.stuck_loading|stuck_loading' || true
```

- [ ] **Step 3: Force the stuck path to verify the retry UI**

Easiest forcing approach: in the browser dev console, hold the music player from acquiring a track. The cleanest way is to break the queue resolve temporarily. Edit `frontend/src/modules/Player/hooks/useQueueController.js` locally (do NOT commit this) and add a temporary `await new Promise(() => {})` near the playlist-resolve fetch path so the queue never returns. Reload the fitness app — within 15 s the music player should display "Music unavailable — tap to retry".

Tap the affordance. Confirm:
- Text reverts to "Loading…"
- A `fitness.music.stuck_loading` log line was emitted to `dev.log` (one line per stuck cycle)
- After ~15 s, the stuck text returns (because we left the queue path broken)

Once confirmed, **revert** the temporary edit to `useQueueController.js`. Re-confirm normal music playback works again.

- [ ] **Step 4: Commit only if Steps 2-3 passed**

If something failed in Step 3 — e.g. retry tap also toggled the music expansion panel (stopPropagation issue), or the warn log fired more than once per stuck cycle — pause and fix. Do not declare the plan complete until both observations are clean.

---

## Self-review

- [x] **Spec coverage:** Bug write-up `2026-05-01-fitness-music-player-loading-forever.md` lists three "repro / mitigation candidates": stuck-state detection (Tasks 1-3), surfaced retry affordance (Tasks 3-4), and structured warn for log-driven debugging (Task 3). All three covered. The bug doc explicitly says root cause is **not yet confirmed**, so this plan is scoped to defensive recovery + observability only — no Player.jsx / useQueueController.js changes that could mask the underlying issue.
- [x] **Placeholder scan:** No TBDs. Every step has executable code or commands.
- [x] **Type consistency:** Hook returns `{ isStuck, attempt, retry }` consistently across the test file (Task 1) and the implementation (Task 2). Caller destructures into `stuck.isStuck`, `stuck.attempt`, `stuck.retry()` consistently (Task 3 step 3 and step 4).
- [x] **DRY/YAGNI:** No new logger, no shared retry-button component, no abstraction over what is currently a single use site. The hook is small enough to inline, but extracting it is the only way to test the behavior cleanly without mounting the full music player — that is the only abstraction created.
- [x] **TDD:** Task 1 writes the failing test before Task 2 implements the hook.
- [x] **Frequent commits:** Five commits across the plan (failing test → hook impl → caller wiring → styles → optional manual-fix CSS).
- [x] **Honesty about scope:** The plan opens with "*This is not a root-cause fix.*" — the engineer needs to know they are shipping defense-in-depth, not closing the bug. After this lands and the warn-log emits in production, a follow-up investigation can use the new event + correlated `playback.overlay-summary` payloads to find the actual hang.
- [x] **No fix for the underlying hang:** Deliberate. The systematic-debugging discipline applies — fixing what we don't understand creates new bugs and masks the real failure mode. This plan is explicit about that boundary.
