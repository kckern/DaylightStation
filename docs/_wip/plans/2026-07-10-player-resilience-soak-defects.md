# Player Resilience Soak Defects — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the three defects the 2026-07-10 production soak found in the merged Player resilience refactor: the recovery ledger's attempt cap is defeated by phantom progress, an end-of-file stall drives an unbounded jolt loop, and the cheap nudge never fires because the expensive jolt preempts it.

**Architecture:** All three defects share one root: the system cannot tell "the playhead moved forward" from "an event fired." We fix that at each of the three places it matters. (1) `recordSuccess` is gated on genuine forward motion using the existing `evaluatePlayheadProgress` helper, restoring the ledger's attempt cap and cooldown. (2) A shared `isNearEnd` predicate suppresses the jolt ladder at duration, and the existing end-of-content watchdog — currently wired only into `ContentScroller` and requiring `paused` — is generalized to fire on any frozen-at-duration element and wired into the dash `VideoPlayer` path so the queue advances instead. (3) `STALL_JOLT_GRACE_MS` is raised above `HARD_STALL_MS` so the nudge rung gets its turn, with a unit-test invariant to keep the ordering from silently inverting again.

**Tech Stack:** React hooks, Vitest + `@testing-library/react`, `vi.useFakeTimers()`. Tests run from the repo root: `npx vitest run <path>`.

**Background reading (do this first):**
- `docs/_wip/audits/2026-07-09-player-module-sedimentary-fixes-audit.md` — the refactor these defects came from
- `docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md` — the *same* stuck-at-duration bug, fixed once before for `ContentScroller` only
- `frontend/src/modules/Player/README.media-resilience.md`

**Soak evidence (2026-07-10, 9h of `docker logs daylight-station`):** 6 `playback.stalled`, 5 `resilience-stall-jolt`, **0** `recovery-nudge`, 0 remounts, 0 exhausted, 0 cooldown-denied. All five jolts were one incident (`plex:674553`, 13:22:16Z) and every one logged `rung=1 attempt=1`.

---

## Critical context for the implementer

**You must live-verify.** Unit suites plus seven review passes previously missed a runtime throw on the dash custom-element path (an orphaned `setIsAdapting` in the `ready` handler) — every dash `ready` event threw for an entire branch. No component harness covers `<dash-video>` events. Task 8 is not optional.

**Two `recordSuccess` call sites exist, and only one is broken.**
- `useCommonMediaController.js:759` — already correct. It sits inside `markProgress`, downstream of `evaluatePlayheadProgress`, so it only runs on genuine forward motion. **Do not touch it.**
- `useMediaResilience.js:312` — the bug. It runs whenever `playbackHealth.progressToken > 0`, and `recordProgress` (`usePlaybackHealth.js:169`) bumps that token on *any* source without comparing seconds.

**A test already documents the bug as if it were a feature.** `useMediaResilience.ledger.test.jsx:99` has the comment *"New waitKey resets playback-health progress, then freeze + stall"* — the test had to change `waitKey` specifically to stop the progress effect from clearing the ledger. After Task 1 that workaround is no longer needed, but leave it: it still exercises a real path.

---

### Task 1: Gate `recordSuccess` on genuine forward playhead motion

This is the root cause. Do it first — it is why Tasks 3 and 5 are unbounded rather than merely mistuned.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js` (imports; session-key effect ~line 98-105; progress effect lines 302-314)
- Test: `frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx`

**Step 1: Write the failing test**

Append this block to `useMediaResilience.ledger.test.jsx`:

```jsx
// ---------------------------------------------------------------------------
// (f) recordSuccess requires genuine forward motion (2026-07-10 soak defect #2)
//
// Prod evidence: five consecutive jolts all logged `rung=1 attempt=1` because
// each jolt's own remount fired a progress event, which reset the ledger's
// count AND lastAt — defeating both the attempt cap and the cooldown.
// ---------------------------------------------------------------------------

describe('useMediaResilience × ledger — phantom progress must not clear the ledger', () => {
  it('a progressToken bump with a FROZEN playhead does not reset the attempt count', () => {
    installLedger({ cooldownMs: 0 }); // isolate the cap from the cooldown
    const initial = baseArgs({ seconds: 100 });
    const hook = renderHook((props) => useMediaResilience(props), { initialProps: initial });

    // Record one real attempt.
    act(() => hook.result.current._testTriggerRecovery?.('playback-stalled'));
    expect(ledger.snapshot(initial.playbackSessionKey).count).toBe(1);

    // Re-render at the SAME position. usePlaybackHealth would bump progressToken
    // here (a `playing` event after a remount), but the clock has not moved.
    act(() => { hook.rerender({ ...initial, seconds: 100 }); });
    expect(ledger.snapshot(initial.playbackSessionKey).count).toBe(1);

    // Second attempt must be attempt 2, not attempt 1 again.
    act(() => hook.result.current._testTriggerRecovery?.('playback-stalled'));
    expect(ledger.snapshot(initial.playbackSessionKey).count).toBe(2);
  });

  it('genuine forward motion DOES reset the attempt count', () => {
    installLedger({ cooldownMs: 0 });
    const initial = baseArgs({ seconds: 100 });
    const hook = renderHook((props) => useMediaResilience(props), { initialProps: initial });

    act(() => hook.result.current._testTriggerRecovery?.('playback-stalled'));
    expect(ledger.snapshot(initial.playbackSessionKey).count).toBe(1);

    // Clock advances well past PROGRESS_EPSILON → real recovery.
    act(() => { hook.rerender({ ...initial, seconds: 105 }); });
    expect(ledger.snapshot(initial.playbackSessionKey).count).toBe(0);
  });

  it('a frozen playhead lets the session cap engage, so the jolt ladder terminates', () => {
    installLedger({ cooldownMs: 0 });
    const args = baseArgs({ seconds: 100 });
    const { result } = renderHook(() => useMediaResilience(args));

    // Five capped attempts, all at the same position.
    act(() => {
      for (let i = 0; i < 6; i += 1) result.current._testTriggerRecovery?.('playback-stalled');
    });
    expect(args.onReload).toHaveBeenCalledTimes(5);
    expect(args.onExhausted).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx
```

Expected: the first test FAILS with `expected 1 to be 2` (the ledger was reset by the phantom progress bump). The third test may pass already for the wrong reason — that's fine, it is a regression guard.

**Step 3: Import the progress helper**

In `useMediaResilience.js`, add to the imports at the top:

```js
import { evaluatePlayheadProgress } from '../lib/playheadProgress.js';
```

**Step 4: Add the position ref and reset it per session**

Next to the other refs (near `recoverySeekTrackerRef`, ~line 178):

```js
  // Last playhead position that counted as a genuine recovery success. The
  // ledger must only be cleared when the clock actually moved forward — a
  // remount at a frozen position fires progress events but is not recovery.
  const lastSuccessPosRef = useRef(null);
```

In the existing session-key change effect (~lines 98-105), add the reset alongside the other per-session cleanup:

```js
    lastSuccessPosRef.current = null;
```

**Step 5: Gate the `recordSuccess` call**

Replace lines 302-314 of `useMediaResilience.js`. The current code:

```js
    if (playbackHealth.progressToken > 0) {
      if (status !== STATUS.playing) actions.setStatus(STATUS.playing);
      hasEverPlayedRef.current = true;
      recoverySeekTrackerRef.current = { lastSeekMs: null, sameCount: 0 };
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;
      // Playback is genuinely progressing — clear attempts/cooldown so the
      // next stall episode starts with a fresh budget.
      getRecoveryLedger().recordSuccess(playbackSessionKey);
      exhaustedNotifiedRef.current = false;
      return;
    }
```

becomes:

```js
    if (playbackHealth.progressToken > 0) {
      if (status !== STATUS.playing) actions.setStatus(STATUS.playing);
      hasEverPlayedRef.current = true;
      recoverySeekTrackerRef.current = { lastSeekMs: null, sameCount: 0 };
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;

      // A progressToken bump means "some progress event fired", NOT "the clock
      // moved". A jolt's own remount fires `playing` at the frozen position; if
      // that cleared the ledger, the attempt cap and cooldown would never engage
      // and the ladder would loop at rung 1 forever (2026-07-10 soak, plex:674553).
      // Only strictly-forward motion counts as recovery.
      const observed = Number.isFinite(playbackHealth.lastProgressSeconds)
        ? playbackHealth.lastProgressSeconds
        : null;
      const { advanced, nextPos } = evaluatePlayheadProgress(observed, lastSuccessPosRef.current);
      lastSuccessPosRef.current = nextPos;
      if (advanced) {
        getRecoveryLedger().recordSuccess(playbackSessionKey);
        exhaustedNotifiedRef.current = false;
      }
      return;
    }
```

Add `playbackHealth.lastProgressSeconds` to that effect's dependency array (line ~335).

**Step 6: Run the tests**

```bash
npx vitest run frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx
```

Expected: PASS (all tests, old and new). If the pre-existing cooldown tests now fail, that is a real signal — the cooldown was previously being wiped mid-test by phantom progress. Read the failure before "fixing" the test.

**Step 7: Run the full Player suite for collateral damage**

```bash
npx vitest run frontend/src/modules/Player/
```

Expected: PASS. `useCommonMediaController.stallEscalation.test.jsx` is the one most likely to shift, since the shared ledger now actually retains state across a stall episode.

**Step 8: Commit**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx \
        frontend/src/modules/Player/hooks/useMediaResilience.js
git commit -m "fix(player): recordSuccess requires forward playhead motion, not a progress event

A jolt's own remount fires `playing` at the frozen position. Treating that as
recovery reset the ledger's count and lastAt, defeating both the attempt cap
and the cooldown — five consecutive prod jolts all logged rung=1 attempt=1."
```

---

### Task 2: Extract a shared `isNearEnd` predicate

Three places need "is the playhead at the end of this media": the watchdog, the at-duration telemetry, and (Task 3) the jolt guard. Two of them already have their own copy of `currentTime >= duration - 0.5`. Extract before adding a third.

**Files:**
- Create: `frontend/src/modules/Player/lib/nearEnd.js`
- Create: `frontend/src/modules/Player/lib/nearEnd.test.js`
- Modify: `frontend/src/modules/Player/lib/endOfContentWatchdog.js` (the private `isAtDuration`)
- Modify: `frontend/src/modules/Player/lib/atDurationStuck.js` (`shouldLogAtDurationStuck`)

**Step 1: Write the failing test**

Create `frontend/src/modules/Player/lib/nearEnd.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isNearEnd, NEAR_END_THRESHOLD_SECONDS } from './nearEnd.js';

describe('isNearEnd', () => {
  it('is true at exactly duration', () => {
    expect(isNearEnd(677.418, 677.418)).toBe(true);
  });

  it('is true inside the default threshold', () => {
    expect(isNearEnd(677.0, 677.418)).toBe(true);
  });

  it('is false outside the threshold', () => {
    // The 2026-07-10 stall began at 659.5s of a 677.4s asset — mid-stream,
    // not end-of-content. It must NOT be treated as near-end.
    expect(isNearEnd(659.5, 677.418)).toBe(false);
  });

  it('is true past duration (dash can clamp currentTime above duration)', () => {
    expect(isNearEnd(678, 677.418)).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(isNearEnd(675, 677.418, 3)).toBe(true);
    expect(isNearEnd(675, 677.418, 1)).toBe(false);
  });

  it('is false for non-finite or zero-length media', () => {
    expect(isNearEnd(NaN, 100)).toBe(false);
    expect(isNearEnd(10, NaN)).toBe(false);
    expect(isNearEnd(null, 100)).toBe(false);
    expect(isNearEnd(0, 0)).toBe(false);
    expect(isNearEnd(5, -1)).toBe(false);
  });

  it('exports the threshold the prior audits standardised on', () => {
    expect(NEAR_END_THRESHOLD_SECONDS).toBe(0.5);
  });
});
```

**Step 2: Run it to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/lib/nearEnd.test.js
```

Expected: FAIL — `Failed to resolve import "./nearEnd.js"`.

**Step 3: Write the implementation**

Create `frontend/src/modules/Player/lib/nearEnd.js`:

```js
/**
 * `isNearEnd` — the single "the playhead is at the end of this media" predicate.
 *
 * Three subsystems need this and two used to carry their own copy:
 *   - endOfContentWatchdog  — advance the queue when `ended` never fires
 *   - atDurationStuck       — telemetry for the near-end stall-detection guard
 *   - useMediaResilience    — suppress the jolt ladder at EOF (2026-07-10)
 *
 * The 0.5s threshold is inherited from the 2026-05-23 stuck-at-duration audit.
 * `>=` (not `>`) matters: dash.js clamps `currentTime` to exactly `duration`
 * when the trailing fragment is zero-byte, which is the dominant EOF case here.
 */
export const NEAR_END_THRESHOLD_SECONDS = 0.5;

/**
 * @param {number|null} currentTime
 * @param {number|null} duration
 * @param {number} [thresholdSeconds=0.5]
 * @returns {boolean}
 */
export function isNearEnd(currentTime, duration, thresholdSeconds = NEAR_END_THRESHOLD_SECONDS) {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration)) return false;
  if (duration <= 0) return false;
  return currentTime >= (duration - thresholdSeconds);
}
```

**Step 4: Run it to verify it passes**

```bash
npx vitest run frontend/src/modules/Player/lib/nearEnd.test.js
```

Expected: PASS (7 tests).

**Step 5: Replace the two existing copies**

In `endOfContentWatchdog.js`, add the import and delete the private helper:

```js
import { isNearEnd } from './nearEnd.js';
```

Replace the `isAtDuration` function body with a thin adapter (it takes an `info` object, so keep the name and shape — call sites are unchanged):

```js
  const isAtDuration = (info) => !!info && isNearEnd(info.currentTime, info.duration, thresholdSeconds);
```

In `atDurationStuck.js`, add the import and replace the final line of `shouldLogAtDurationStuck`:

```js
import { isNearEnd } from './nearEnd.js';
```

The trailing checks

```js
  if (!Number.isFinite(mediaEl.duration) || mediaEl.duration <= 0) return false;
  if (!Number.isFinite(mediaEl.currentTime)) return false;
  return mediaEl.currentTime >= (mediaEl.duration - 0.5);
```

become

```js
  return isNearEnd(mediaEl.currentTime, mediaEl.duration);
```

**Step 6: Run the affected suites**

```bash
npx vitest run frontend/src/modules/Player/lib/nearEnd.test.js \
               frontend/src/modules/Player/lib/atDurationStuck.test.js \
               frontend/src/modules/Player/lib/endOfContentWatchdog.test.js
```

Expected: PASS, no test edits required. If `atDurationStuck.test.js` fails, you changed behavior — `isNearEnd` must return `false` for non-finite input, matching the guards you deleted.

**Step 7: Commit**

```bash
git add frontend/src/modules/Player/lib/nearEnd.js \
        frontend/src/modules/Player/lib/nearEnd.test.js \
        frontend/src/modules/Player/lib/endOfContentWatchdog.js \
        frontend/src/modules/Player/lib/atDurationStuck.js
git commit -m "refactor(player): extract shared isNearEnd predicate (DRY, 3rd consumer incoming)"
```

---

### Task 3: Suppress the jolt ladder at end-of-content

`useCommonMediaController` already declines to run stall detection near the end (see the guard quoted in `atDurationStuck.js`). `useMediaResilience` has no such guard, so its jolt ladder fires at EOF, re-seeks to `duration`, "resumes" at EOF, and re-stalls.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js` (imports; `isStuck` at lines 540-541; stale comment at 550-556)
- Test: `frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx`

**Step 1: Write the failing test**

Append to `useMediaResilience.ledger.test.jsx`:

```jsx
// ---------------------------------------------------------------------------
// (g) EOF is not a stall (2026-07-10 soak defect #3)
//
// plex:674553 reached EOF without firing `ended`. joltIntentRef captured
// currentTime == duration, so every jolt re-seeked to the end and re-stalled.
// ---------------------------------------------------------------------------

describe('useMediaResilience — end-of-content is never jolted', () => {
  const fakeEl = ({ currentTime, duration, ended = false }) => ({
    currentTime, duration, ended, paused: false, seeking: false
  });

  const renderStalledAt = (el) => {
    const initial = baseArgs({ waitKey: 'wk-1', externalStalled: false, getMediaEl: () => el });
    const hook = renderHook((props) => useMediaResilience(props), { initialProps: initial });
    act(() => { hook.rerender({ ...initial, seconds: 5 }); });
    act(() => { hook.rerender({ ...initial, seconds: 5, waitKey: 'wk-2', externalStalled: true }); });
    return initial;
  };

  it('does NOT fire a jolt when frozen at duration', () => {
    installLedger({ cooldownMs: 0 });
    const args = renderStalledAt(fakeEl({ currentTime: 677.418, duration: 677.418 }));
    args.onReload.mockClear();

    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS * 3);
    expect(args.onReload).not.toHaveBeenCalled();
    expect(ledger.snapshot(args.playbackSessionKey)?.count ?? 0).toBe(0);
  });

  it('does NOT fire a jolt when the element reports ended', () => {
    installLedger({ cooldownMs: 0 });
    const args = renderStalledAt(fakeEl({ currentTime: 12, duration: 677.418, ended: true }));
    args.onReload.mockClear();

    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS);
    expect(args.onReload).not.toHaveBeenCalled();
  });

  it('DOES fire a jolt for a genuine mid-stream stall', () => {
    installLedger({ cooldownMs: 0 });
    // The real incident's stall position: 659.5s of 677.4s — 17.9s of content left.
    const args = renderStalledAt(fakeEl({ currentTime: 659.5, duration: 677.418 }));
    args.onReload.mockClear();

    advance(STALL_JOLT_GRACE_MS);
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'stall-jolt-refresh-url' })
    );
  });
});
```

Add the constants import at the top of the test file:

```js
import { STALL_JOLT_GRACE_MS, STALL_JOLT_STEP_MS } from '../lib/stallJolt.js';
```

**Step 2: Run it to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx
```

Expected: the first two tests FAIL (`onReload` was called — the ladder jolted at EOF). The third PASSES already.

**Step 3: Implement the guard**

Add the import to `useMediaResilience.js`:

```js
import { isNearEnd } from '../lib/nearEnd.js';
```

Replace lines 535-541. Current:

```js
  const clockAdvancing = playbackHealth.isAdvancing === true;
  const isStuck = hasEverPlayedRef.current && !isUserPaused && !clockAdvancing
    && (isStalled || isBuffering || effectiveSeeking);
```

becomes:

```js
  const clockAdvancing = playbackHealth.isAdvancing === true;

  // End-of-content is not a stall. When dash's trailing fragment is zero-byte
  // the element parks at duration with `ended === false`; jolting it re-seeks
  // to the end, "resumes" at the end, and re-stalls forever. `useCommonMedia-
  // Controller` has disengaged stall detection near the end since the
  // 2026-05-23 audit; the jolt ladder must do the same. The queue-advance for
  // this state belongs to useEndOfContentWatchdog, not to recovery.
  const atEndEl = getMediaEl?.();
  const atEnd = playbackHealth.elementSignals?.ended === true
    || (!!atEndEl && (atEndEl.ended === true || isNearEnd(atEndEl.currentTime, atEndEl.duration)));

  const isStuck = hasEverPlayedRef.current && !isUserPaused && !clockAdvancing && !atEnd
    && (isStalled || isBuffering || effectiveSeeking);
```

**Step 4: Correct the now-false comment above the jolt effect**

Lines 550-556 currently claim the session cap bounds the ladder through `isStuck` flaps. After Task 1 that is true; before Task 1 it was not. Replace the parenthetical so it does not read as a guarantee that was never delivered:

```js
  // Jolt ladder: while stuck, escalate refresh-url → remount, each re-seeking to
  // the captured intent (the frozen seek target), until the clock advances again
  // or the ladder + attempt cap are exhausted. The shared recoveryLedger's
  // session cap bounds total jolts even if `isStuck` flaps (a jolt that plays one
  // frame then re-stalls) — this holds only because recordSuccess requires
  // strictly-forward playhead motion (2026-07-10); a bare progress event at a
  // frozen position must never clear the session. End-of-content is excluded
  // upstream by `atEnd`, so the ladder never chases a playhead parked at duration.
```

**Step 5: Run the tests**

```bash
npx vitest run frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx
```

Expected: PASS (all groups).

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.js \
        frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx
git commit -m "fix(player): end-of-content is not a stall — jolt ladder no longer chases a playhead parked at duration"
```

---

### Task 4: Make the end-of-content watchdog fire on a frozen (not merely paused) element

The watchdog only advances when `info.paused` is true. A dash element stalled at duration with `paused === false` — precisely the 2026-07-10 incident — never triggers it. The correct condition is "at duration and the clock has not moved for `idleMs`", which the watchdog already tracks via `armedAtTime`.

**Files:**
- Modify: `frontend/src/modules/Player/lib/endOfContentWatchdog.js` (`fire`, `tick`)
- Test: `frontend/src/modules/Player/lib/endOfContentWatchdog.test.js`

**Step 1: Write the failing test**

Append to `endOfContentWatchdog.test.js` (match the existing file's fake-timer setup — read it first):

```js
describe('endOfContentWatchdog — frozen-but-not-paused at duration (2026-07-10)', () => {
  it('advances when the element is stalled at duration with paused === false', () => {
    const onAdvance = vi.fn();
    let info = { currentTime: 677.418, duration: 677.418, paused: false, seeking: false };
    const wd = createEndOfContentWatchdog({ onAdvance, getMediaInfo: () => info, idleMs: 3000 });

    wd.tick();
    vi.advanceTimersByTime(3001);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('does NOT advance while the clock is still moving near duration', () => {
    const onAdvance = vi.fn();
    let info = { currentTime: 677.0, duration: 677.418, paused: false, seeking: false };
    const wd = createEndOfContentWatchdog({ onAdvance, getMediaInfo: () => info, idleMs: 3000 });

    wd.tick();
    vi.advanceTimersByTime(1500);
    info = { ...info, currentTime: 677.3 }; // clock advanced → re-arm
    wd.tick();
    vi.advanceTimersByTime(1500);
    expect(onAdvance).not.toHaveBeenCalled();

    // Now it freezes for a full idle window.
    vi.advanceTimersByTime(1501);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('still advances for the original paused-at-duration case', () => {
    const onAdvance = vi.fn();
    const info = { currentTime: 100, duration: 100, paused: true, seeking: true };
    const wd = createEndOfContentWatchdog({ onAdvance, getMediaInfo: () => info, idleMs: 3000 });

    wd.tick();
    vi.advanceTimersByTime(3001);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('does not advance when the playhead is nowhere near duration', () => {
    const onAdvance = vi.fn();
    const info = { currentTime: 10, duration: 677.418, paused: false, seeking: false };
    const wd = createEndOfContentWatchdog({ onAdvance, getMediaInfo: () => info, idleMs: 3000 });

    wd.tick();
    vi.advanceTimersByTime(10000);
    expect(onAdvance).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run it to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/lib/endOfContentWatchdog.test.js
```

Expected: the first two tests FAIL (`onAdvance` never called — `info.paused` was false).

**Step 3: Implement**

In `endOfContentWatchdog.js`, `fire()` currently reads:

```js
    const info = getMediaInfo();
    if (!info || !info.paused || !isAtDuration(info)) return;
```

Replace with a freeze check. Capture `armedAtTime` before it is cleared:

```js
  const fire = () => {
    const armedAt = armedAtTime;
    timerId = null;
    if (fired) return;
    // Verify conditions still hold at the moment the timer fires — state could
    // have changed between scheduling and firing.
    //
    // The condition is "parked at duration", NOT "paused at duration": a dash
    // element whose trailing fragment came back zero-byte sits at duration with
    // `paused === false` and `ended === false` (2026-07-10, plex:674553). What
    // actually distinguishes end-of-content from playback is that the clock has
    // not moved for the whole idle window.
    const info = getMediaInfo();
    if (!info || !isAtDuration(info)) return;
    if (!Number.isFinite(armedAt) || Math.abs(info.currentTime - armedAt) > 0.05) return;
    fired = true;
```

and `tick()`'s cancel branch:

```js
    const info = getMediaInfo();
    if (!info || !isAtDuration(info)) {
      cancel();
      return;
    }
```

Note `cancel()` sets `armedAtTime = null`, so the `Number.isFinite(armedAt)` check also protects against a fire scheduled by a cancelled arm.

**Step 4: Run the tests**

```bash
npx vitest run frontend/src/modules/Player/lib/endOfContentWatchdog.test.js
```

Expected: PASS, including the pre-existing paused-at-duration tests. If an existing test asserted "does not fire when not paused", read it carefully: if its media is at duration and frozen, that assertion encoded the bug and should be updated with a comment pointing at this plan. If its media is *not* at duration, it must still pass unchanged — do not weaken `isAtDuration`.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/lib/endOfContentWatchdog.js \
        frontend/src/modules/Player/lib/endOfContentWatchdog.test.js
git commit -m "fix(player): end-of-content watchdog fires on a frozen element, not only a paused one"
```

---

### Task 5: Wire the end-of-content watchdog into the dash `VideoPlayer` path

The watchdog is only mounted in `ContentScroller` (`ContentScroller.jsx:333`). `VideoPlayer` — the dash/HLS renderer that hit the incident — has none. Without this, Task 3 turns an infinite jolt loop into an infinite spinner.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useEndOfContentWatchdog.js` (accept `getMediaEl`)
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx`
- Test: `frontend/src/modules/Player/hooks/useEndOfContentWatchdog.test.jsx`

**Why `getMediaEl` and not `mediaRef`:** for `dash-video` the real `<video>` lives inside a shadow root. `VideoPlayer` already owns a `getMediaEl()` that traverses it (`VideoPlayer.jsx:173`); `containerRef.current` is the custom element, which has no `currentTime`.

**Step 1: Write the failing test**

Read the existing `useEndOfContentWatchdog.test.jsx` for its harness, then add:

```jsx
it('resolves the media element via getMediaEl when no mediaRef is given', () => {
  const onAdvance = vi.fn();
  const el = document.createElement('video');
  Object.defineProperty(el, 'duration', { value: 100, configurable: true });
  Object.defineProperty(el, 'currentTime', { value: 100, writable: true, configurable: true });
  Object.defineProperty(el, 'paused', { value: false, configurable: true });

  renderHook(() => useEndOfContentWatchdog({
    getMediaEl: () => el, sourceKey: 'plex:674553', onAdvance, idleMs: 3000
  }));

  act(() => { el.dispatchEvent(new Event('timeupdate')); });
  act(() => { vi.advanceTimersByTime(3001); });
  expect(onAdvance).toHaveBeenCalledTimes(1);
});
```

**Step 2: Run it to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/hooks/useEndOfContentWatchdog.test.jsx
```

Expected: FAIL — the hook reads `mediaRef?.current` and gets `undefined`, so it returns early and `onAdvance` is never called.

**Step 3: Implement `getMediaEl` support in the hook**

Add `getMediaEl` to the destructured params, and resolve the element through a single helper used everywhere the hook currently reads `mediaRef.current`:

```js
export function useEndOfContentWatchdog({
  mediaRef,
  getMediaEl,            // preferred for shadow-DOM players (dash-video)
  sourceKey,
  onAdvance,
  thresholdSeconds,
  idleMs,
  enabled = true
}) {
```

Inside, before the effect:

```js
  // dash-video hides the real <video> in a shadow root, so callers pass
  // getMediaEl(); plain <video> callers pass a ref. Exactly one is required.
  const getMediaElRef = useRef(null);
  getMediaElRef.current = typeof getMediaEl === 'function'
    ? getMediaEl
    : () => mediaRef?.current ?? null;
```

Replace every `mediaRef?.current` read inside the effect with `getMediaElRef.current()`. Keep `enabled` and `sourceKey` in the effect's dependency array; do **not** add `getMediaEl` (its identity changes per render — that is why it goes through a ref).

**Step 4: Run the hook test**

```bash
npx vitest run frontend/src/modules/Player/hooks/useEndOfContentWatchdog.test.jsx
```

Expected: PASS, including the existing `mediaRef` tests.

**Step 5: Mount the watchdog in `VideoPlayer`**

Add the import:

```js
import { useEndOfContentWatchdog } from '../hooks/useEndOfContentWatchdog.js';
```

Then, after `getMediaEl` is defined (~line 175) and near the existing `useMediaKeyboardHandler` call, add:

```js
  // Fallback queue-advance when HTML5 `ended` never fires. Plex transcode tails
  // are commonly zero-byte, so dash.js never calls endOfStream() and the element
  // parks at duration. The resilience jolt ladder deliberately ignores this state
  // (see useMediaResilience `atEnd`), which makes this watchdog the ONLY thing
  // that advances the queue. See docs/_wip/plans/2026-07-10-player-resilience-soak-defects.md
  useEndOfContentWatchdog({
    getMediaEl,
    sourceKey: media?.mediaKey || media?.src,
    onAdvance: advance,
    enabled: !!advance
  });
```

**Step 6: Run the Player suite**

```bash
npx vitest run frontend/src/modules/Player/
```

Expected: PASS.

**Step 7: Commit**

```bash
git add frontend/src/modules/Player/hooks/useEndOfContentWatchdog.js \
        frontend/src/modules/Player/hooks/useEndOfContentWatchdog.test.jsx \
        frontend/src/modules/Player/renderers/VideoPlayer.jsx
git commit -m "feat(player): end-of-content watchdog now covers the dash VideoPlayer path

Without this, suppressing the EOF jolt (previous commit) would trade an
infinite jolt loop for an infinite spinner."
```

---

### Task 6: Restore the escalation order — cheap nudge before expensive jolt

`STALL_JOLT_GRACE_MS` (4500) fires before `HARD_STALL_MS` (8000), so the jolt always preempts the nudge. Nine hours of production produced **zero** `recovery-nudge` events.

Both timers start from roughly the same instant (the controller's soft stall at 1200ms arms the nudge for `HARD_STALL_MS`; `isStuck` flips around the same soft-stall boundary and arms the jolt for `STALL_JOLT_GRACE_MS`). Raising the grace above `HARD_STALL_MS` gives the nudge its turn. Do **not** instead give the nudge `bypassCooldown` — the nudge never fires at all, so cooldown is not what is blocking it.

**Files:**
- Modify: `frontend/src/modules/Player/lib/stallJolt.js:22`
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:34` (export the constant)
- Test: `frontend/src/modules/Player/lib/stallJolt.test.js`
- Update: `frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx` (timings)

**Step 1: Write the failing invariant test**

Append to `stallJolt.test.js`:

```js
import { HARD_STALL_MS } from '../hooks/useCommonMediaController.js';

describe('stall escalation ordering (2026-07-10 soak defect #1)', () => {
  it('the cheap controller nudge fires before the expensive jolt', () => {
    // Both ladders arm off the same soft-stall boundary. If the jolt grace is
    // shorter than the nudge deadline, the jolt preempts the nudge and the cheap
    // rung is dead code — which is exactly what 9h of production showed (0 nudges).
    expect(STALL_JOLT_GRACE_MS).toBeGreaterThan(HARD_STALL_MS);
  });
});
```

**Step 2: Run it to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/lib/stallJolt.test.js
```

Expected: FAIL — either on the import (`HARD_STALL_MS` is not exported) or on `expected 4500 to be greater than 8000`. Fix the export first, then watch the assertion fail for the right reason.

**Step 3: Export `HARD_STALL_MS`**

In `useCommonMediaController.js:34`:

```js
export const HARD_STALL_MS = 8000;   // stalled for this long → attempt recovery (the nudge)
```

**Step 4: Raise the jolt grace**

In `stallJolt.js`, replace the `STALL_JOLT_GRACE_MS` declaration and its comment:

```js
// How long the player must be continuously stuck before the first jolt.
//
// MUST stay above useCommonMediaController's HARD_STALL_MS (8000): both ladders
// arm off the same soft-stall boundary, and the jolt is far more disruptive than
// the controller's nudge (it mints a fresh Plex transcode session). When this was
// 4500 the jolt preempted the nudge on every stall and the cheap rung never ran
// once in production. `stallJolt.test.js` pins the ordering.
export const STALL_JOLT_GRACE_MS = 9500;
```

**Step 5: Run the test**

```bash
npx vitest run frontend/src/modules/Player/lib/stallJolt.test.js
```

Expected: PASS.

**Step 6: Fix the timings in the ledger test**

`useMediaResilience.ledger.test.jsx` hardcodes `advance(4500)` for "grace → rung 1" in two places, with the comment `// Grace (4500ms) → rung 1 fires`. Replace the literals with the imported constant so this can never silently drift again:

```jsx
    advance(STALL_JOLT_GRACE_MS); // grace → rung 1 fires, attempt 1 recorded
```

and `advance(6000)` with `advance(STALL_JOLT_STEP_MS)`. (`STALL_JOLT_GRACE_MS`/`STALL_JOLT_STEP_MS` are already imported from Task 3.) Update the stale `(4500ms)` comment.

**Step 7: Run the whole Player suite**

```bash
npx vitest run frontend/src/modules/Player/
```

Expected: PASS.

**Step 8: Commit**

```bash
git add frontend/src/modules/Player/lib/stallJolt.js \
        frontend/src/modules/Player/lib/stallJolt.test.js \
        frontend/src/modules/Player/hooks/useCommonMediaController.js \
        frontend/src/modules/Player/hooks/useMediaResilience.ledger.test.jsx
git commit -m "fix(player): jolt grace must exceed HARD_STALL_MS so the cheap nudge runs first

9h of production logged zero recovery-nudge events: the 4500ms jolt grace
always beat the 8000ms nudge deadline. Pinned with an invariant test."
```

---

### Task 7: Static sweep

The dash `ready`-handler throw that survived seven review passes was an ordinary undefined identifier. This is the cheap gate that would have caught it.

**Step 1: Lint every touched file**

```bash
npx eslint frontend/src/modules/Player/hooks/useMediaResilience.js \
           frontend/src/modules/Player/hooks/useCommonMediaController.js \
           frontend/src/modules/Player/hooks/useEndOfContentWatchdog.js \
           frontend/src/modules/Player/renderers/VideoPlayer.jsx \
           frontend/src/modules/Player/lib/nearEnd.js \
           frontend/src/modules/Player/lib/stallJolt.js \
           frontend/src/modules/Player/lib/endOfContentWatchdog.js \
           frontend/src/modules/Player/lib/atDurationStuck.js
```

Expected: no `no-undef`, no `react-hooks/exhaustive-deps` errors. The one intentional suppression is the existing `eslint-disable-next-line react-hooks/exhaustive-deps` on the jolt effect — leave it.

**Step 2: Full Player suite one more time**

```bash
npx vitest run frontend/src/modules/Player/
```

Expected: PASS.

**Step 3: Commit only if the sweep changed something**

```bash
git commit -am "chore(player): lint fixes from the resilience-defect sweep"
```

---

### Task 8: Live verification (MANDATORY — do not skip)

Unit tests cannot see `<dash-video>`. Every prior Player regression escaped this way.

**Step 1: Check whether a dev server is already up**

```bash
lsof -i :3111
```

If it is running, use it. Otherwise `npm run dev` and tail `dev.log`.

**Step 2: Verify a normal video plays end-to-end and advances the queue**

Load a short Plex video in the Player and let it run to its natural end. In the browser console, set `window.DAYLIGHT_LOG_LEVEL = 'debug'` first.

Expected: the queue advances. Either an `ended` event fires, or `playback.end-of-content-advance` appears in the log. **No `resilience-stall-jolt` at the end of the asset.** This is the regression the whole plan exists to fix — confirm it with your eyes.

**Step 3: Verify a mid-stream stall still recovers**

With the video playing, use Chrome DevTools Protocol offline injection (this worked well last time) to kill the network mid-asset, then restore it.

Expected log order:
1. `playback.stalled`
2. `playback.recovery-strategy` with `strategy: 'nudge'` — **the nudge must appear now; its absence was defect #1**
3. only if the nudge fails, `playback.resilience-stall-jolt` with `rung=1 attempt=1`
4. on a second failed jolt, `attempt=2` — **the attempt counter must climb; it was pinned at 1 in production**
5. `playback.resumed` once the network returns

**Step 4: Verify the ladder now terminates**

Keep the network offline past five recovery attempts.

Expected: attempts climb 1→5, then `resilience-stall-jolt-exhausted` and the retry overlay. In production this never happened — the ladder looped at `attempt=1` indefinitely.

**Step 5: Record what you actually observed**

Paste the real log lines into the PR/commit message. Do not write "verified" without them.

---

### Task 9: Documentation

**Files:**
- Modify: `frontend/src/modules/Player/README.media-resilience.md`
- Create: `docs/_wip/bugs/2026-07-10-player-resilience-soak-findings.md`
- Modify: `docs/_wip/audits/2026-07-09-player-module-sedimentary-fixes-audit.md` (mark the soak-watch items resolved)

**Step 1: Write the soak findings doc**

Record, for each defect: the prod evidence (event counts, the `plex:674553` incident timeline), the root cause with file:line, and the fix. Cross-reference the 2026-05-23 audit — the stuck-at-duration bug was fixed once for `ContentScroller` and regressed into the dash path because the fix was never generalized. That is the lesson worth writing down.

**Step 2: Update the media-resilience README**

Document the two invariants a future editor must not break:
- `recordSuccess` requires strictly-forward playhead motion. A progress event at a frozen position is not recovery.
- `STALL_JOLT_GRACE_MS > HARD_STALL_MS`. The cheap rung runs first.

And the ownership boundary: the jolt ladder does not handle end-of-content; `useEndOfContentWatchdog` does.

**Step 3: Commit**

```bash
git add docs/ frontend/src/modules/Player/README.media-resilience.md
git commit -m "docs(player): record the 2026-07-10 soak findings + pin the two resilience invariants"
```

**Step 4: Update the docs freshness marker**

```bash
git rev-parse HEAD > docs/docs-last-updated.txt
git commit -am "docs: update freshness marker"
```

---

### Task 10: Integrate

Per `CLAUDE.md`: merge directly into `main`, no PR, delete the branch after, and record the deletion.

**Step 1: Confirm the whole suite is green**

```bash
npx vitest run frontend/src/modules/Player/
```

**Step 2: Sync with the deployed source before merging**

`CLAUDE.local.md` is explicit: the homeserver deploy tree frequently carries commits that were never pushed to `origin`. Check before you merge, not after.

```bash
git fetch origin
ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline origin/main..HEAD | head'
```

If the homeserver is ahead, integrate its commits first.

**Step 3: Merge, record, delete**

```bash
git checkout main
git merge --no-ff <branch>
```

Append the branch to `docs/_archive/deleted-branches.md`:

```markdown
| 2026-07-10 | fix/player-resilience-soak-defects | <commit-hash> | Ledger phantom-success, EOF jolt loop, nudge/jolt inversion |
```

Then `git branch -d <branch>` and push.

**Step 4: Watch prod after deploy**

The soak window that surfaced these defects was nine hours. Re-run the same queries once the rebuilt container has a comparable window:

```bash
ssh homeserver.local 'docker logs daylight-station 2>&1 | grep -c "\"event\":\"playback.resilience-stall-jolt\""'
ssh homeserver.local 'docker logs daylight-station 2>&1 | grep -c "recovery-nudge"'
ssh homeserver.local 'docker logs daylight-station 2>&1 | grep -c "end-of-content-advance"'
```

Success looks like: `recovery-nudge` > 0 (the cheap rung is alive), jolt `attempt` values that climb rather than pinning at 1, and `end-of-content-advance` appearing instead of a jolt at the end of an asset.

**Note on counting:** grepping `stall-jolt-refresh-url` double-counts — each jolt emits both a `resilience-stall-jolt` event and a `playback.player-remount` carrying the same `reason` string. Count `"event":"playback.resilience-stall-jolt"`.
