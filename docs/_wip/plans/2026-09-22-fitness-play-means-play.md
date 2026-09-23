# Fitness "Play Means Play" Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** A play press in the Fitness player always plays unless governance is locked *right now*; nothing replays a stale "locked" verdict.

**Architecture:** Two defects combined on 2026-09-22 (see incident below). (1) `useCommonMediaController`'s element-setup effect registers a `playing` listener it never removes, and since `18d032ae5` that listener calls `onProgress` — so a dead `onProgress` closure survives every effect re-run. (2) `FitnessPlayer.handlePlayerProgress` enforces governance from a **closure-captured** `governancePaused`, so a dead copy captured during the startup lock keeps pausing forever. Fix both: remove the leak and route every `onProgress` call through a ref; make the Fitness enforcer read governance from a live ref via a small, unit-testable module. Plus: log every governance-enforced pause (so telemetry names the pauser), stop the throwaway `FitnessSession` built on every provider render, and repair a botched rename in `ProgressBar.jsx`.

**Tech Stack:** React 18 hooks, Vitest + @testing-library/react (jsdom). Run tests from the **repo root**: `npx vitest run <path>`.

---

## Incident (why this plan exists)

2026-09-22 19:35–19:44 PDT, garage kiosk: 47 play presses, 41 re-paused within 1 s (most 5–26 ms) while the governance engine had logged `phase_change → unlocked, videoLocked=false`. Every failing press is the log triple:

```
playback.resumed  source=controller-toggle     (user press)
playback.seek     phase=seeked  (+1 ms)        (leaked `playing`→clearSeeking — no real seek)
playback.paused   source=controller (+5–26 ms) (stale handlePlayerProgress → pausePlayback)
```

The stale closure also called `setVideoPlayerPaused(true)`, which makes `FitnessContext` freeze the governance engine (`governance.timers_paused` at 19:36:41.327, 0.3 s after unlock) — so governance never re-evaluated. Armed by `18d032ae5` (2026-09-20), first in the prod image built 9/20 21:01 PDT. The leak dates to `1b2569d67` (2025-11-24) but was harmless until `clearSeeking` began calling `onProgress`.

**Why it first bit on 9/22:** the garage kiosk browser stays open and only picks up a new frontend on page reload. Its page loaded 9/20 16:09 PDT (before the bad build) and did not reload until 9/22 15:21 PDT, so the 9/21 workout ran pre-`18d032ae5` code. The 9/22 workout page loaded at 19:02 PDT from the 18:29 build, making it the first governed garage session on the broken code. Corollary: a kiosk can run a stale bundle for days, so "passed yesterday" says nothing about the currently deployed build.

**The invariant these tasks enforce:** governance may pause only while the live governance state says locked. When it is clear, a play press plays and no code path re-pauses it.

## Ground rules for every task

- **Never start a backend or dev server** (`node backend/index.js`, `npm run dev`). It is a live household controller. Unit tests only.
- Work in the worktree `.worktrees/fix-fitness-play-means-play` on branch `fix/fitness-play-means-play`.
- Use the structured logger, never raw `console.*` (repo rule).
- Commit after each task with the message given. End every commit message with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Remove the leaked `playing` listener and stop dead `onProgress` callbacks

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` (element-setup effect: `onTimeUpdate` ~L963–990, `clearSeeking` ~L1305–1348, listener registration ~L1350–1357, cleanup ~L1436–1447, deps L1451)
- Create test: `frontend/src/modules/Player/hooks/useCommonMediaController.listenerLifetime.test.jsx`

**Step 1: Write the failing test**

Create `frontend/src/modules/Player/hooks/useCommonMediaController.listenerLifetime.test.jsx`:

```jsx
// Regression: 2026-09-22 garage fitness session. A `playing` listener was added
// on every element-setup effect run and never removed; since 18d032ae5 it called
// onProgress, so a DEAD onProgress closure (FitnessPlayer's, captured while
// governance was locked) re-paused the video on every play press.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';
import * as Logger from '../../../lib/logging/Logger.js';
import { _setSharedLedgerForTests, createRecoveryLedger } from '../lib/recoveryLedger.js';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({}))
}));

function makeFakeVideo({ currentTime = 100, duration = 1000 } = {}) {
  const listeners = {};
  const el = {
    _ct: currentTime,
    duration,
    paused: true,
    seeking: false,
    ended: false,
    readyState: 4,
    networkState: 2,
    shadowRoot: null,
    buffered: { length: 1, start: () => 0, end: () => duration },
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => { el.paused = true; }),
    load: vi.fn(),
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: (t, cb) => { (listeners[t] ||= []).push(cb); },
    removeEventListener: (t, cb) => { listeners[t] = (listeners[t] || []).filter(f => f !== cb); },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 }),
    fire: (t) => { (listeners[t] || []).forEach(cb => cb({ type: t })); },
    count: (t) => (listeners[t] || []).length
  };
  Object.defineProperty(el, 'currentTime', { get: () => el._ct, set: (v) => { el._ct = v; } });
  return el;
}

function Harness({ video, onProgress, volume = 100 }) {
  const api = useCommonMediaController({
    meta: { assetId: 'plex:1', title: 'T' },
    isVideo: true,
    onProgress,
    volume,
    onController: () => {}
  });
  useEffect(() => { api.containerRef.current = video; }, [api, video]);
  return null;
}

describe('useCommonMediaController listener lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const child = { info() {}, warn() {}, error() {}, debug() {}, sampled() {} };
    vi.spyOn(Logger, 'getLogger').mockReturnValue({ ...child, child: () => child });
    _setSharedLedgerForTests(createRecoveryLedger({ cooldownMs: 60000 }));
  });

  afterEach(() => {
    _setSharedLedgerForTests(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps a constant number of playing/seeked listeners across effect re-runs', () => {
    const video = makeFakeVideo();
    const onProgress = vi.fn();
    const { rerender } = render(<Harness video={video} onProgress={onProgress} volume={100} />);
    const playing = video.count('playing');
    const seeked = video.count('seeked');

    // `volume` is an element-setup effect dependency: each change re-runs it.
    for (let v = 90; v >= 50; v -= 10) {
      rerender(<Harness video={video} onProgress={onProgress} volume={v} />);
    }

    expect(video.count('playing')).toBe(playing);
    expect(video.count('seeked')).toBe(seeked);
  });

  it('never calls a superseded onProgress on play, seeked, or timeupdate', () => {
    const video = makeFakeVideo();
    const stale = vi.fn();
    const live = vi.fn();
    const { rerender } = render(<Harness video={video} onProgress={stale} volume={100} />);
    rerender(<Harness video={video} onProgress={live} volume={90} />);
    stale.mockClear();

    act(() => {
      video.paused = false;
      video.fire('play');
      video.fire('playing');
      video.fire('seeked');
      video._ct = 100.5;
      video.fire('timeupdate');
    });

    expect(stale).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalled();
  });

  it('does not publish progress from the playing event (only seeked/timeupdate do)', () => {
    const video = makeFakeVideo();
    const onProgress = vi.fn();
    render(<Harness video={video} onProgress={onProgress} />);
    onProgress.mockClear();

    act(() => { video.paused = false; video.fire('playing'); });

    expect(onProgress).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/hooks/useCommonMediaController.listenerLifetime.test.jsx`
Expected: FAIL. Test 1 fails because `playing` listener count grows by one per re-run. Test 2 fails because `stale` is called (from the leaked `playing` listener). Test 3 fails because `playing`→`clearSeeking` calls `onProgress`.

If test 1 does not fail (the `volume` change did not re-run the effect), confirm `volume` is still in the deps array at L1451 and adjust the harness to change another listed dep (for example `meta` with a new object). Do not weaken the assertion.

**Step 3: Write minimal implementation**

In `useCommonMediaController.js`:

(a) Near the other refs at the top of the hook body (after the destructured props, before the element-setup effect), add:

```js
  // Every onProgress call reads the CURRENT callback. The element-setup effect
  // below re-runs on ~20 deps; a listener that outlives one run must never be
  // able to call the onProgress it was created with. That is exactly how a dead
  // FitnessPlayer closure (governance "locked") kept re-pausing the video on
  // 2026-09-22 — see docs/_wip/plans/2026-09-22-fitness-play-means-play.md.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
```

(b) In `onTimeUpdate` (~L972), replace `if (onProgress) {` … `onProgress({` with:

```js
      const publishProgress = onProgressRef.current;
      if (publishProgress) {
        const stallSnapshot = readStallState();
        publishProgress({
```

(keep the object literal body unchanged).

(c) Split `clearSeeking` into a `seeked` handler (keeps the 18d032ae5 publish) and a `playing` handler (only clears the seeking flag). Replace the whole `const clearSeeking = () => { … };` block with:

```js
    const finishSeekOperation = (el) => {
      const operationState = mountedPlaybackOperationRef.current;
      if (el && operationState?.awaitingSeek && operationState.sawSeeking
        && Math.abs(el.currentTime - operationState.targetSeconds) <= 0.75) {
        finishMountedPlaybackOperation(operationState);
      }
    };
    const onSeeked = () => {
      const el = getMediaEl();
      finishSeekOperation(el);
      const now = Date.now();
      if (el && now - lastSeekedLogTsRef.current > 200) {
        lastSeekedLogTsRef.current = now;
        mcLog().sampled('playback.seek', {
          mediaKey: assetId,
          phase: 'seeked',
          actual: el.currentTime,
          intent: lastSeekIntentRef.current,
          drift: lastSeekIntentRef.current != null ? Math.abs(el.currentTime - lastSeekIntentRef.current) : null,
          duration: el.duration
        }, { maxPerMinute: 30 });
      }
      // A paused decoder is allowed not to emit another `timeupdate` after a
      // completed seek. Do not leave Player's resilience metrics reporting the
      // earlier seeking state until playback happens to resume: that stale
      // state is interpreted as an in-flight user seek and can arm recovery.
      const publishProgress = onProgressRef.current;
      if (el && publishProgress) {
        const currentTime = segDuration
          ? Math.max(0, el.currentTime - segStart)
          : (el.currentTime || 0);
        const duration = segDuration || (el.duration || 0);
        const stallSnapshot = readStallState();
        publishProgress({
          currentTime,
          duration,
          paused: el.paused,
          media: meta,
          percent: getProgressPercent(currentTime, duration),
          stalled: isStalled,
          isSeeking: false,
          playing: false,
          seekIntent: lastSeekIntentRef.current,
          lastStrategy: stallSnapshot.strategy,
          stallState: stallSnapshot,
        });
      }
      requestAnimationFrame(() => setIsSeeking(false));
    };
    // `playing` only ends a seek. It does NOT publish progress and does NOT log
    // `playback.seek phase=seeked` — it is not a seek (timeupdate follows within
    // one tick with the real state). Publishing here is what turned the leaked
    // listener into a pauser.
    const onPlayingClearsSeek = () => {
      finishSeekOperation(getMediaEl());
      requestAnimationFrame(() => setIsSeeking(false));
    };
```

(d) Replace the two registrations

```js
    mediaEl.addEventListener('seeked', clearSeeking);
    mediaEl.addEventListener('playing', clearSeeking);
```

with

```js
    mediaEl.addEventListener('seeked', onSeeked);
    mediaEl.addEventListener('playing', onPlayingClearsSeek);
```

(e) In the cleanup, replace `mediaEl.removeEventListener('seeked', clearSeeking);` with:

```js
      mediaEl.removeEventListener('seeked', onSeeked);
      mediaEl.removeEventListener('playing', onPlayingClearsSeek);
```

(f) In the deps array (L1451) remove `onProgress` — it is read through `onProgressRef` now, and dropping it stops the effect re-registering every listener whenever a parent re-creates its callback. Leave every other dep as is.

Then grep the whole file for any remaining direct `onProgress(` call or `clearSeeking` reference:

Run: `grep -n "onProgress(\|clearSeeking" frontend/src/modules/Player/hooks/useCommonMediaController.js`
Expected: no `clearSeeking` hits; the only `onProgress` hits are the prop destructure and `onProgressRef` lines. Convert any other direct call to `onProgressRef.current?.(...)`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Player/hooks/useCommonMediaController.listenerLifetime.test.jsx frontend/src/modules/Player/hooks/useCommonMediaController.stallEscalation.test.jsx frontend/src/modules/Player/hooks/useCommonMediaController.shortMedia.test.jsx frontend/src/modules/Player/hooks/useCommonMediaController.rendererBoundary.test.jsx frontend/src/modules/Player/hooks/useCommonMediaController.rekeyLog.test.jsx`
Expected: all PASS (the existing `publishes the native paused, non-seeking state on seeked` test must still pass: the seeked publish is kept).

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js frontend/src/modules/Player/hooks/useCommonMediaController.listenerLifetime.test.jsx
git commit -m "fix(player): remove leaked playing listener; onProgress always reads the live callback

The element-setup effect added a 'playing' listener it never removed, and since
18d032ae5 that listener called onProgress. A dead FitnessPlayer progress closure
captured during the governance startup lock therefore re-paused the video on
every play press (2026-09-22 garage session, 41 re-pauses while unlocked).

- split clearSeeking: seeked keeps the 18d032ae5 publish; playing only clears seeking
- remove the playing listener on cleanup
- route every onProgress call through a ref; drop onProgress from effect deps"
```

---

### Task 2: Governance enforcement reads live state, and says so in the logs

**Files:**
- Create: `frontend/src/modules/Fitness/player/governanceProgressEnforcer.js`
- Create test: `frontend/src/modules/Fitness/player/governanceProgressEnforcer.test.js`
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` (after `governancePaused` ~L438; `handlePlayerProgress` ~L1662–1715)

**Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/governanceProgressEnforcer.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { enforceGovernanceOnProgress } from './governanceProgressEnforcer.js';

const make = (locked) => {
  const state = { locked };
  return {
    state,
    deps: {
      isGovernanceLocked: () => state.locked,
      pausePlayback: vi.fn(),
      setVideoPlayerPaused: vi.fn(),
      onEnforced: vi.fn(),
    },
  };
};

describe('enforceGovernanceOnProgress', () => {
  it('pauses a playing video while governance is locked', () => {
    const { deps } = make(true);
    enforceGovernanceOnProgress({ paused: false }, deps);
    expect(deps.pausePlayback).toHaveBeenCalledTimes(1);
    expect(deps.onEnforced).toHaveBeenCalledTimes(1);
    expect(deps.setVideoPlayerPaused).toHaveBeenCalledWith(true);
  });

  it('never pauses when governance is clear — play means play', () => {
    const { deps } = make(false);
    enforceGovernanceOnProgress({ paused: false }, deps);
    expect(deps.pausePlayback).not.toHaveBeenCalled();
    expect(deps.onEnforced).not.toHaveBeenCalled();
    expect(deps.setVideoPlayerPaused).toHaveBeenCalledWith(false);
  });

  it('reads governance at call time, not when the handler was created', () => {
    // The 2026-09-22 failure: a handler created while locked kept pausing after unlock.
    const { state, deps } = make(true);
    const handler = (progress) => enforceGovernanceOnProgress(progress, deps);
    state.locked = false; // governance unlocks AFTER the handler exists
    handler({ paused: false });
    expect(deps.pausePlayback).not.toHaveBeenCalled();
  });

  it('does not re-pause an already paused video, and reports the real paused state', () => {
    const { deps } = make(true);
    enforceGovernanceOnProgress({ paused: true }, deps);
    expect(deps.pausePlayback).not.toHaveBeenCalled();
    expect(deps.setVideoPlayerPaused).toHaveBeenCalledWith(true);
  });

  it('tolerates missing optional deps', () => {
    expect(() => enforceGovernanceOnProgress({ paused: false }, { isGovernanceLocked: () => true })).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/governanceProgressEnforcer.test.js`
Expected: FAIL with "Failed to resolve import ./governanceProgressEnforcer.js".

**Step 3: Write minimal implementation**

Create `frontend/src/modules/Fitness/player/governanceProgressEnforcer.js`:

```js
/**
 * Governance enforcement on a progress tick.
 *
 * THE RULE: governance may pause only while it is locked RIGHT NOW. When it is
 * clear, a play press plays and nothing here pauses it.
 *
 * `isGovernanceLocked` is a function, read at call time, never a captured
 * boolean. On 2026-09-22 a progress handler that had captured `locked=true`
 * during the startup lock survived (via a leaked media listener) and kept
 * pausing the video after governance unlocked — 41 play presses overruled.
 * See docs/_wip/plans/2026-09-22-fitness-play-means-play.md.
 *
 * @param {{paused: boolean}} progress  native element state from onProgress
 * @param {object} deps
 * @param {() => boolean} deps.isGovernanceLocked  live governance verdict
 * @param {() => void} [deps.pausePlayback]
 * @param {(paused: boolean) => void} [deps.setVideoPlayerPaused]
 * @param {() => void} [deps.onEnforced]  telemetry hook, called once per enforced pause
 */
export function enforceGovernanceOnProgress(progress, deps) {
  const paused = Boolean(progress?.paused);
  const locked = Boolean(deps?.isGovernanceLocked?.());
  if (locked && !paused && deps?.pausePlayback) {
    deps.onEnforced?.();
    deps.pausePlayback();
  }
  deps?.setVideoPlayerPaused?.(paused || locked);
}

export default enforceGovernanceOnProgress;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/governanceProgressEnforcer.test.js`
Expected: PASS (5 tests).

**Step 5: Wire it into FitnessPlayer**

In `FitnessPlayer.jsx`:

(a) Add the import next to the other `./` imports (after `import { makeCloseGuard } from './closeGuard.js';`):

```js
import { enforceGovernanceOnProgress } from './governanceProgressEnforcer.js';
```

(b) Directly after the line `const governancePaused = pauseDecision.reason === PAUSE_REASON.GATE && … ;` (~L438) add:

```js
  // Live governance verdict for callbacks. Handlers handed to <Player> can
  // outlive the render that created them; they must read this ref, never the
  // captured `governancePaused` (2026-09-22: a dead closure kept pausing).
  const governancePausedRef = useRef(governancePaused);
  governancePausedRef.current = governancePaused;
  const governanceVideoLockedRef = useRef(Boolean(effectiveGovernanceState?.videoLocked));
  governanceVideoLockedRef.current = Boolean(effectiveGovernanceState?.videoLocked);
```

(c) In `handlePlayerProgress` there are two enforcement blocks. Replace the first one (inside the seek-intent early-return branch):

```js
        setIsPaused(paused);
        if (governancePaused && !paused && pausePlayback) {
          pausePlayback();
        }
        if (setVideoPlayerPaused) {
          setVideoPlayerPaused(paused || governancePaused);
        }
        return;
```

with:

```js
        setIsPaused(paused);
        enforceGovernanceOnProgress({ paused }, governanceEnforcerDeps);
        return;
```

and replace the second one (end of the handler):

```js
    // Immediately pause if governed and locked
    if (governancePaused && !paused && pausePlayback) {
      pausePlayback();
    }

    // Update context so music player can sync (includes governance state)
    if (setVideoPlayerPaused) {
      setVideoPlayerPaused(paused || governancePaused);
    }
  }, [setVideoPlayerPaused, governancePaused, pausePlayback]);
```

with:

```js
    // Pause only if governance is locked NOW (live ref), and keep the context's
    // paused flag in sync for the music player / governance freeze.
    enforceGovernanceOnProgress({ paused }, governanceEnforcerDeps);
  }, [governanceEnforcerDeps]);
```

(d) Immediately BEFORE `const handlePlayerProgress = useCallback(`, add the deps object:

```js
  const governanceEnforcerDeps = useMemo(() => ({
    isGovernanceLocked: () => governancePausedRef.current,
    pausePlayback,
    setVideoPlayerPaused,
    onEnforced: () => {
      logger.sampled('fitness.governance.pause-enforced', {
        videoLocked: governanceVideoLockedRef.current,
        governancePaused: governancePausedRef.current,
      }, { maxPerMinute: 10, aggregate: true });
    },
  }), [pausePlayback, setVideoPlayerPaused, logger]);
```

(e) Confirm there is no other read of `governancePaused` inside a callback handed to `<Player>`:

Run: `grep -n "governancePaused" frontend/src/modules/Fitness/player/FitnessPlayer.jsx`
Expected: remaining hits are the definition, the ref assignment, the `useEffect(... [governancePaused])` governance effect (~L545, an effect body that re-runs on change, so it reads a fresh value), the voice-memo effect guard, and `pauseDecision`-related lines. No `useCallback` passed to `<Player>` may close over it.

**Step 6: Run the Fitness player tests**

Run: `npx vitest run frontend/src/modules/Fitness/player/`
Expected: all PASS.

**Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/player/governanceProgressEnforcer.js frontend/src/modules/Fitness/player/governanceProgressEnforcer.test.js frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "fix(fitness): governance pauses only while live-locked; play means play

handlePlayerProgress enforced governance from a captured governancePaused. A
copy created during the startup lock outlived its render and kept pausing the
video after governance unlocked. Enforcement now goes through
enforceGovernanceOnProgress, which reads the verdict from a ref at call time,
and every enforced pause is logged as fitness.governance.pause-enforced."
```

---

### Task 3: Build the FitnessSession once per provider, not once per render

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:324`

**Why:** `useRef(new FitnessSession())` constructs a throwaway `FitnessSession` (and a `GovernanceEngine`, whose constructor sets `phase='pending'` and writes `window.__fitnessGovernance`) on every provider render. `fitness-profile` and `fitness.render_thrashing` read that global, so during the incident they reported `governancePhase=pending` while the live engine was unlocked, which made the telemetry lie.

**Step 1: Implement**

Replace:

```js
  const fitnessSessionRef = useRef(new FitnessSession());
```

with:

```js
  // Lazy: `useRef(new FitnessSession())` built a throwaway session (+ a
  // GovernanceEngine that writes phase:'pending' into window.__fitnessGovernance)
  // on EVERY render, so profiling logs reported a phase the live engine was not in.
  const fitnessSessionRef = useRef(null);
  if (fitnessSessionRef.current === null) {
    fitnessSessionRef.current = new FitnessSession();
  }
```

**Step 2: Check nothing reassigns the ref to null and expects a rebuild**

Run: `grep -n "fitnessSessionRef.current =" frontend/src/context/FitnessContext.jsx`
Expected: only the new lazy-init line. If another assignment exists, read it and make sure the lazy init does not change its behavior.

**Step 3: Run the context and fitness hook tests**

Run: `npx vitest run frontend/src/context/ frontend/src/hooks/fitness/`
Expected: PASS (same pass/fail set as on `main` before this task — if a test already fails on `main`, record it and do not "fix" it here).

**Step 4: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "fix(fitness): construct FitnessSession once per provider, not per render

The eager useRef(new FitnessSession()) built a throwaway session and governance
engine on every render; each engine wrote phase:'pending' into
window.__fitnessGovernance, so fitness-profile/render_thrashing logs reported a
governance phase the live engine was not in."
```

---

### Task 4: Repair the botched rename in ProgressBar

**Files:**
- Modify: `frontend/src/modules/Player/components/ProgressBar.jsx:52`

**Why:** `b20273b9a` ("rename PlaySession vocabulary to ArcadeGameSession") rewrote the CSS property `animationPlayState` to `animationArcadeGameSessionState`, which is not a CSS property. The progress-bar animation can no longer be paused.

**Step 1: Check for other collateral damage from that rename**

Run: `git grep -n "ArcadeGameSessionState" -- frontend/src | grep -v -i "arcade\|gaming"`
Expected: only `ProgressBar.jsx`. Fix every hit that is clearly a mangled `PlayState` (CSS `animationPlayState`, DOM `playState`); leave real arcade-session code alone.

**Step 2: Implement**

Change `animationArcadeGameSessionState: seed.running ? 'running' : 'paused',` back to:

```js
        animationPlayState: seed.running ? 'running' : 'paused',
```

**Step 3: Run Player component tests**

Run: `npx vitest run frontend/src/modules/Player/components/`
Expected: PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/components/ProgressBar.jsx
git commit -m "fix(player): restore animationPlayState mangled by the ArcadeGameSession rename"
```

---

### Task 5: Record the incident and the rule in the docs

**Files:**
- Create: `docs/_wip/bugs/2026-09-22-fitness-play-repaused-by-stale-governance-closure.md`
- Modify: the Fitness governance reference doc if one covers pause enforcement (find it: `git grep -ln "videoLocked" -- docs/reference`). Add the invariant under its enforcement section.

**Step 1: Write the bug doc**

Include: the symptom (47 presses, 41 re-paused while unlocked), the log triple, the caller chain (leaked `playing` → dead `handlePlayerProgress` → `pausePlayback` → `controller` pause; `setVideoPlayerPaused(true)` → governance freeze), the introducing commits (`1b2569d67` leak, `18d032ae5` arming, prod since the 9/20 21:08 PDT deploy), the fix commits from Tasks 1–4, and the new telemetry: `fitness.governance.pause-enforced` means governance paused the video; a `playback.paused source=controller` with no `pause-enforced` beside it and governance unlocked is a regression. No hostnames, IPs or ports (repo rule: use `{env.log_store_url}`).

**Step 2: Add the invariant to the reference doc**

One short paragraph: "Governance may pause only while the live governance state says locked. Callbacks handed to `<Player>` read governance through a ref (`enforceGovernanceOnProgress`), never a captured value. When governance is clear, a play press plays."

**Step 3: Commit**

```bash
git add docs/_wip/bugs/2026-09-22-fitness-play-repaused-by-stale-governance-closure.md docs/reference
git commit -m "docs(fitness): record the 2026-09-22 play re-pause incident and the play-means-play rule"
```

---

### Task 6: Full verification

**Step 1: Run every frontend suite this change touches, plus the Player and Fitness trees**

Run: `npx vitest run frontend/src/modules/Player frontend/src/lib/Player frontend/src/modules/Fitness frontend/src/context frontend/src/hooks/fitness`
Expected: PASS, or exactly the same failures as `main` (verify by running the same command in the main checkout and diffing the failing test names). Any new failure blocks the merge.

**Step 2: Parse check**

Run: `npm run check:parse`
Expected: exit 0.

**Step 3: Build check (frontend bundles)**

Run: `npx vite build --config vite.config.js --outDir "$(mktemp -d)" 2>&1 | tail -5`
Expected: "built in" with no errors. (Build only. Do not start any server.)

**Step 4: Report**

List commits, test counts, and anything that differs from `main`. Deployment is NOT part of this plan. The owner rebuilds the image and swaps the container.
