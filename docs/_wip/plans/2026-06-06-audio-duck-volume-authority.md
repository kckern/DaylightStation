# Audio-Duck Volume Authority — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the governance audio-duck the single, authoritative way the fitness video's volume is lowered, so no other volume event can silently override an active duck.

**Architecture:** Today two uncoordinated writers touch the video element's `.volume`: the persistent-volume system (`usePersistentVolume` → `applyToPlayer`, fired on canplay / resilience-recovery / mount / user-change / mute) and the duck hook (`useGovernanceAudioDuck`, which writes `mediaElement.volume` directly). Whenever the volume system re-applies, it clobbers the duck. The fix folds the duck into the volume system as a **multiplier** (`duckRef ∈ [0,1]`): every volume application multiplies the stored level by the duck multiplier. The duck hook stops writing `mediaElement.volume` and instead calls `videoVolume.setDuck(multiplier)`. This makes the volume system the single authority, makes the duck monotonic by construction (multiplier ≤ 1 can only lower), and makes every re-apply path automatically respect the duck.

**Tech Stack:** React hooks, Vitest + `@testing-library/react` (`renderHook`), jsdom environment (config: `vitest.config.mjs`).

**Background reading (read before starting):**
- `docs/reference/fitness/audio-duck-cues.md` — the duck mechanism (will be updated in Task 5)
- `frontend/src/modules/Fitness/nav/usePersistentVolume.js` — the volume system being extended
- `frontend/src/modules/Fitness/hooks/useVolumeSync.js` — the event-driven re-apply that currently overrides the duck
- `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js` — the duck hook being refactored

**Conventions for this repo:**
- Run a single test file: `npx vitest run <path>` (do NOT pass `--reporter=basic`; that reporter name is invalid here — use the default or `--reporter=dot`).
- Do NOT auto-commit beyond the steps in this plan; each task ends with an explicit commit step.
- Logging: use the structured logger (`getLogger().child(...)`), never raw `console.*`.

---

## Task 0: Commit the already-completed primary fix (token-keying)

The working tree already contains the root-cause fix (the duck effect now keys on
`token` instead of the per-tick `audioDuck` object) plus its new test and the
reference doc. Commit it as its own change before layering the hardening on top.

**Files (already modified, uncommitted):**
- Modify: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js`
- Create: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
- Create: `docs/reference/fitness/audio-duck-cues.md`
- Modify: `docs/reference/fitness/governance-engine.md`

**Step 1: Verify the existing tests pass**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: PASS (all green — 7 hook tests + the engine audio-cue suite).

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js \
        frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx \
        docs/reference/fitness/audio-duck-cues.md \
        docs/reference/fitness/governance-engine.md
git commit -m "fix(fitness): audio-duck keys on cue token, not per-tick descriptor object

The governance engine rebuilds audioDuck as a fresh object every tick. The hook
depended on that object, so the effect tore down each tick: audio.pause() cut the
SFX and restore() snapped volume up in the same callback. Key on the stable token
so each cue plays through; add hook-level tests."
```

---

## Task 1: Add a duck multiplier to the persistent-volume system

Teach `usePersistentVolume` to hold a duck multiplier and fold it into every
volume application, so the volume system becomes the single authority for the
ducked level.

**Files:**
- Modify: `frontend/src/modules/Fitness/nav/usePersistentVolume.js`
- Test: `frontend/src/modules/Fitness/nav/usePersistentVolume.test.jsx` (create)

**Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/nav/usePersistentVolume.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Capture what the store's applyToPlayer is asked to apply.
let applied = [];
const store = {
  getVolume: () => ({ level: 0.8, muted: false, source: 'global' }),
  setVolume: (_ids, patch) => ({ level: patch.level ?? 0.8, muted: patch.muted ?? false, source: 'exact' }),
  applyToPlayer: (_playerRef, state) => { applied.push(state); },
  version: 0,
};

vi.mock('./VolumeProvider.jsx', () => ({
  useVolumeStore: () => store,
}));

import { usePersistentVolume } from './usePersistentVolume.js';

describe('usePersistentVolume — duck multiplier', () => {
  let playerRef;
  beforeEach(() => {
    applied = [];
    playerRef = { current: { getMediaElement: () => ({ volume: 1 }) } };
  });

  const render = () =>
    renderHook(() => usePersistentVolume({ grandparentId: 'fitness', parentId: 'global', trackId: 'video', playerRef }));

  it('defaults the duck multiplier to 1 (no change to applied level)', () => {
    const { result } = render();
    act(() => result.current.applyToPlayer());
    expect(applied.at(-1).level).toBeCloseTo(0.8, 5);
  });

  it('folds the duck multiplier into applied level and never raises it', () => {
    const { result } = render();
    act(() => result.current.setDuck(0.1));
    expect(applied.at(-1).level).toBeCloseTo(0.08, 5); // 0.8 * 0.1, applied immediately
    act(() => result.current.applyToPlayer());
    expect(applied.at(-1).level).toBeCloseTo(0.08, 5); // re-apply still ducked
  });

  it('keeps the duck applied across a setVolume (user change) mid-duck', () => {
    const { result } = render();
    act(() => result.current.setDuck(0.1));
    act(() => result.current.setVolume(0.5));
    expect(applied.at(-1).level).toBeCloseTo(0.05, 5); // 0.5 * 0.1
  });

  it('restores full level when the duck is released', () => {
    const { result } = render();
    act(() => result.current.setDuck(0.1));
    act(() => result.current.setDuck(1));
    expect(applied.at(-1).level).toBeCloseTo(0.8, 5);
  });

  it('clamps the multiplier to [0,1] (cannot amplify)', () => {
    const { result } = render();
    act(() => result.current.setDuck(5));
    expect(applied.at(-1).level).toBeLessThanOrEqual(0.8);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/nav/usePersistentVolume.test.jsx`
Expected: FAIL — `result.current.setDuck is not a function`.

**Step 3: Implement the duck multiplier**

In `frontend/src/modules/Fitness/nav/usePersistentVolume.js`:

3a. Add a clamp helper near the top (after `defaultState`):

```js
const clamp01 = (v) => {
  if (!Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
};
```

3b. Add a duck ref alongside `volumeRef` (after line ~31):

```js
  // Duck multiplier owned by the volume system: every applied level is multiplied
  // by this (≤ 1), so a duck can only lower the video and no other volume event
  // can clobber it. Default 1 = no duck.
  const duckRef = useRef(1);
```

3c. Add a single helper that all apply paths funnel through (place it before
`useLayoutEffect`, after `duckRef`):

```js
  const applyDucked = useCallback((resolved) => {
    if (!playerRef?.current) return resolved;
    const level = clamp01((resolved.level ?? 0) * duckRef.current);
    applyToPlayer(playerRef, { ...resolved, level });
    return resolved;
  }, [applyToPlayer, playerRef]);
```

3d. Replace the three internal `applyToPlayer(playerRef, resolved)` calls (in the
`useLayoutEffect` hydration, in `persistVolume`, and in `toggleMute`) with
`applyDucked(resolved)`. For example, in `persistVolume`:

```js
      if (playerRef?.current) {
        applyDucked(resolved);
      }
```

(Do the same in the `useLayoutEffect` body and in `toggleMute`. Add `applyDucked`
to each of their dependency arrays.)

3e. Change the returned `apply` (exposed as `applyToPlayer`) to funnel through
`applyDucked`:

```js
  const apply = useCallback(
    (level = volume, muteState = muted) => {
      const resolved = { level, muted: muteState };
      if (playerRef?.current) {
        applyDucked(resolved);
      }
      return resolved;
    },
    [applyDucked, playerRef, volume, muted]
  );
```

3f. Add the `setDuck` action (after `apply`):

```js
  const setDuck = useCallback((multiplier) => {
    duckRef.current = clamp01(multiplier);
    // Re-apply the current level immediately so the duck takes effect (or lifts)
    // without waiting for the next volume event.
    if (playerRef?.current) {
      applyDucked({ level: volumeRef.current, muted });
    }
  }, [applyDucked, playerRef, muted]);
```

3g. Export `setDuck` from the returned object (and add it to the `useMemo` deps):

```js
  return useMemo(() => ({
    volume,
    volumeRef,
    muted,
    source,
    setVolume: persistVolume,
    toggleMute,
    applyToPlayer: apply,
    setDuck,
  }), [volume, muted, source, persistVolume, toggleMute, apply, setDuck]);
```

**Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/nav/usePersistentVolume.test.jsx`
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/nav/usePersistentVolume.js \
        frontend/src/modules/Fitness/nav/usePersistentVolume.test.jsx
git commit -m "feat(fitness): duck multiplier in usePersistentVolume (single volume authority)

Fold a clamped duck multiplier into every volume-apply path so a duck can only
lower the video and no volume event (canplay/recovery/mount/user/mute) can
override it. Expose setDuck()."
```

---

## Task 2: Refactor the duck hook to drive the volume system

Stop writing `mediaElement.volume` directly. The hook now plays the SFX and calls
`videoVolume.setDuck()` to lower/restore through the single authority.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js`
- Modify: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`

**Step 1: Rewrite the test to assert on `setDuck` (write the failing test)**

Replace the body of `useGovernanceAudioDuck.test.jsx` with a version that injects a
fake `videoVolume` exposing a `setDuck` spy and asserts on it instead of on a media
element. The hook no longer takes `mediaElement`.

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/api.mjs', () => ({ DaylightMediaPath: (p) => p }));
vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { useGovernanceAudioDuck } from './useGovernanceAudioDuck.js';

class FakeAudio {
  static instances = [];
  constructor(src) {
    this.src = src; this.paused = true; this.playCalls = 0; this.pauseCalls = 0; this._l = {};
    FakeAudio.instances.push(this);
  }
  addEventListener(e, cb) { (this._l[e] ||= []).push(cb); }
  removeEventListener(e, cb) { this._l[e] = (this._l[e] || []).filter((f) => f !== cb); }
  play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); }
  pause() { this.pauseCalls += 1; this.paused = true; }
  fire(e) { (this._l[e] || []).forEach((cb) => cb()); }
}

const descriptor = (o = {}) => ({
  cueId: 'challenge_hurry', sound: 'apps/fitness/ux/challenge-hurry.mp3',
  duckTo: 0.1, token: 'ch1:challenge_hurry', ...o,
});

describe('useGovernanceAudioDuck', () => {
  let videoVolume;
  beforeEach(() => {
    FakeAudio.instances = [];
    global.Audio = FakeAudio;
    videoVolume = { setDuck: vi.fn(), volumeRef: { current: 1 } };
  });
  afterEach(() => vi.restoreAllMocks());

  const render = (audioDuck) =>
    renderHook(({ audioDuck }) => useGovernanceAudioDuck({ videoVolume, audioDuck }), {
      initialProps: { audioDuck },
    });

  it('ducks (via setDuck) and plays the SFX on a new token', () => {
    render(descriptor());
    expect(videoVolume.setDuck).toHaveBeenCalledWith(0.1);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].playCalls).toBe(1);
  });

  it('does NOT re-duck or cut the SFX when the descriptor object changes but the token is unchanged', () => {
    const { rerender } = render(descriptor());
    const sfx = FakeAudio.instances[0];
    for (let i = 0; i < 3; i++) rerender({ audioDuck: descriptor() });
    expect(videoVolume.setDuck).toHaveBeenCalledTimes(1);
    expect(sfx.pauseCalls).toBe(0);
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('lifts the duck (setDuck(1)) when the SFX ends', () => {
    render(descriptor());
    act(() => FakeAudio.instances[0].fire('ended'));
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('lifts the duck if autoplay rejects', async () => {
    global.Audio = class extends FakeAudio { play() { this.playCalls += 1; return Promise.reject(new Error('blocked')); } };
    render(descriptor());
    await act(async () => { await Promise.resolve(); });
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('stops the previous SFX and re-ducks on a new token', () => {
    const { rerender } = render(descriptor({ token: 'ch1:challenge_start', cueId: 'challenge_start', duckTo: 0.2 }));
    const first = FakeAudio.instances[0];
    rerender({ audioDuck: descriptor({ token: 'ch1:challenge_hurry', duckTo: 0.1 }) });
    expect(first.pauseCalls).toBeGreaterThanOrEqual(1);
    expect(FakeAudio.instances).toHaveLength(2);
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(0.1);
  });

  it('lifts the duck on unmount mid-cue', () => {
    const { unmount } = render(descriptor());
    unmount();
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: FAIL — current hook writes `mediaElement.volume` and never calls `setDuck`.

**Step 3: Rewrite the hook**

Replace `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js` with:

```js
import { useEffect, useRef } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'governance-audio-duck' });
  return _logger;
}

/**
 * Start a duck+SFX session: lower the video via the volume system's setDuck()
 * (the single authority for the ducked level), play the cue's SFX on its own
 * independent audio element, and lift the duck when the SFX ends.
 */
function startSession({ videoVolume, audioDuck }) {
  if (!audioDuck || typeof videoVolume?.setDuck !== 'function') return null;

  videoVolume.setDuck(audioDuck.duckTo);
  logger().info('fitness.audio_duck.start', {
    cueId: audioDuck.cueId, token: audioDuck.token, duckTo: audioDuck.duckTo,
  });

  let lifted = false;
  const lift = () => {
    if (lifted) return;
    lifted = true;
    videoVolume.setDuck(1);
    logger().info('fitness.audio_duck.end', { cueId: audioDuck.cueId, token: audioDuck.token });
  };

  const onEnded = () => lift();
  let audio = null;
  try {
    audio = new Audio(DaylightMediaPath(`/media/${audioDuck.sound}`));
    audio.addEventListener('ended', onEnded);
    const p = audio.play();
    // Autoplay rejection is async; lift so the duck can't get stuck if the SFX
    // never produces an 'ended' event.
    if (p && typeof p.catch === 'function') p.catch(() => lift());
  } catch {
    lift();
  }
  return { token: audioDuck.token, audio, onEnded, lift };
}

/** Stop a session: detach + release the SFX, and lift the duck. Idempotent. */
function stopSession(session) {
  if (!session) return;
  const { audio, onEnded, lift } = session;
  if (audio) {
    audio.removeEventListener('ended', onEnded);
    try { audio.pause(); } catch { /* already released */ }
    audio.src = '';
  }
  lift?.();
}

/**
 * Plays a one-shot SFX and ducks the video (via the volume system) when the
 * GovernanceEngine emits an `audioDuck` descriptor, lifting the duck when the SFX
 * ends. Reacts to `audioDuck.token` ONLY — the engine rebuilds the descriptor
 * object every tick, so keying on the object would tear the session down each
 * tick (cutting the SFX and bouncing the volume).
 *
 * @param {object} params
 * @param {{ setDuck:(m:number)=>void, volumeRef?:{current:number} }|null} params.videoVolume
 * @param {{ cueId:string, sound:string, duckTo:number, token:string }|null} params.audioDuck
 */
export function useGovernanceAudioDuck({ videoVolume, audioDuck }) {
  const latestRef = useRef({ videoVolume, audioDuck });
  useEffect(() => { latestRef.current = { videoVolume, audioDuck }; });

  const sessionRef = useRef(null);
  const token = audioDuck?.token || null;

  useEffect(() => {
    if (!token) return;
    stopSession(sessionRef.current);
    sessionRef.current = startSession(latestRef.current);
  }, [token]);

  useEffect(() => () => {
    stopSession(sessionRef.current);
    sessionRef.current = null;
  }, []);
}

export default useGovernanceAudioDuck;
```

**Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js \
        frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx
git commit -m "refactor(fitness): duck via videoVolume.setDuck, not direct element.volume

The hook no longer writes mediaElement.volume (which the volume system could
clobber). It drives the single volume authority via setDuck(duckTo)/setDuck(1)."
```

---

## Task 3: Update the FitnessPlayer call site

The hook no longer needs `mediaElement`.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx:624-628`

**Step 1: Edit the call site**

Change:

```js
  useGovernanceAudioDuck({
    mediaElement,
    videoVolume,
    audioDuck: effectiveGovernanceState?.audioDuck
  });
```

to:

```js
  useGovernanceAudioDuck({
    videoVolume,
    audioDuck: effectiveGovernanceState?.audioDuck
  });
```

**Step 2: Verify nothing else references the removed param**

Run: `grep -rn "useGovernanceAudioDuck" frontend/src`
Expected: only the import, the call site above, and the hook's own file/test.

**Step 3: Run the focused test suites**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/ frontend/src/modules/Fitness/nav/usePersistentVolume.test.jsx frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: PASS (all).

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "refactor(fitness): drop unused mediaElement arg from useGovernanceAudioDuck call"
```

---

## Task 4: Manual / runtime verification

Automated tests cover the logic; this confirms real playback behavior on a running
app. Use the `verify` skill (@verify) or do it manually.

**Step 1: Start (or reuse) the dev server**

Check first: `lsof -i :3111`. If not running: `npm run dev` (tees to `dev.log`).

**Step 2: Reproduce a cue with the SFX audible**

- Open `/fitness/play/<governed-episode-id>` (a zone-challenge episode), or use the
  HR sim panel to drive a challenge toward its `challenge_remaining` threshold.
- Confirm by ear + by log:
  - The SFX plays **all the way through** (no cutoff).
  - The video audio **dips and stays dipped** for the SFX duration, then returns to
    the prior level — no jump-up mid-SFX.
- In the browser console, set `window.DAYLIGHT_LOG_LEVEL = 'debug'` and watch for
  `fitness.audio_duck.start` followed by a single `fitness.audio_duck.end` per cue
  (not a rapid start/end flicker).

**Step 3: Confirm the override edge is fixed**

While a duck is active, trigger a `canplay`/recovery (e.g., seek, or let a brief
stall recover). The video volume must **stay ducked** through the event, then
restore on SFX end. (Previously the re-apply would jump it back to full.)

**Step 4: No commit** (verification only). Record the result in the PR/notes.

---

## Task 5: Update documentation

**Files:**
- Modify: `docs/reference/fitness/audio-duck-cues.md`

**Step 1: Update the mechanism doc**

In `audio-duck-cues.md`:
- In the architecture diagram and "The hook" section, replace the
  `mediaElement.volume = …` description with: the hook calls
  `videoVolume.setDuck(duckTo)` on a new token and `videoVolume.setDuck(1)` on SFX
  end / reject / retoken / unmount.
- Add a short **"Single volume authority"** subsection explaining that the duck is
  a multiplier owned by `usePersistentVolume`, folded into every apply path, so the
  duck can only lower the video and no volume event (canplay / resilience-recovery /
  mount / user change / mute) can override it. Monotonicity is by construction
  (multiplier ∈ [0,1]).
- Update the "Related code" list to add
  `frontend/src/modules/Fitness/nav/usePersistentVolume.js` (duck multiplier) and
  its test.
- In "Edge cases", replace the old direct-write notes with: override-by-re-apply is
  fixed structurally (the volume system folds the duck); user volume change mid-duck
  stays proportionally ducked and restores to the new level.

**Step 2: Verify no stale references remain**

Run: `grep -n "mediaElement.volume\|firedTokenRef\|duckedMediaRef" docs/reference/fitness/audio-duck-cues.md`
Expected: no matches.

**Step 3: Commit**

```bash
git add docs/reference/fitness/audio-duck-cues.md
git commit -m "docs(fitness): audio-duck is a volume-system multiplier (single authority)"
```

---

## Task 6: Final full-suite check

**Step 1: Run the broader fitness unit suites**

Run: `npx vitest run frontend/src/modules/Fitness frontend/src/hooks/fitness`
Expected: PASS (no regressions). Investigate any failure before finishing.

**Step 2: Done** — use superpowers:finishing-a-development-branch to decide on merge.

---

## Out of scope (intentional — YAGNI)

- **SFX respecting master mute.** If the viewer has muted the video, the cue SFX
  still plays at full (it's an independent element). Honoring mute for the SFX is a
  separate UX decision; not addressed here.
- **Web Audio duck gain node.** Routing the duck through the existing
  `useMediaAmplifier` Web Audio graph as a parallel gain stage was considered and
  rejected: the multiplier approach already gives single-authority + monotonic
  behavior without Web Audio's cross-origin/tainting risk on the kiosk.
```
