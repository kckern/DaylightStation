# Fitness Audio-Cue Playback Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the fitness challenge SFX cues (`challenge-start`, `challenge-hurry`, `challenge-warning`, `challenge-complete`) actually play through instead of being cut off after ~270 ms.

**Architecture:** The bug is entirely in the frontend cue-playback layer (`useGovernanceAudioDuck.js`), not in cue selection (`GovernanceEngine._computeAudioDuck`, which is correct). The hook creates a fresh `new Audio()` per cue and calls `.play()`; in the Shield TV / FKB WebView that `play()` promise is rejected (no user activation), the hook's `.catch(() => lift())` immediately lifts the duck, and the rejection reason is swallowed — so the SFX is never audible and nothing is logged. The fix is two-fold: (1) make the failure observable (log the rejection + add an `error` listener), then (2) play cues through a single shared `<audio>` element that is *unlocked once on a real user gesture* and reused for every cue — the kiosk-standard remedy for autoplay-gated audio, which also eliminates the per-cue create/destroy churn that caused the secondary ~1 ms supersession cutoffs.

**Tech Stack:** React (`.jsx`), Vitest + `@testing-library/react` (`renderHook`), HTMLAudioElement, structured logging framework (`frontend/src/lib/logging/`).

**Evidence base:** Audit of session `20260606141443` (see `media/logs/fitness/2026-06-06T21-14-41.jsonl`). Observed: no cue played longer than ~277 ms vs real file durations of 0.58–2.35 s; the *final* hurry of the session (nothing superseding it for ~60 s) still ended at 277 ms → proves `play()` rejection, not supersession. Served URL `/api/v1/proxy/media/apps/fitness/ux/challenge-hurry.mp3` returns `200 audio/mpeg 103607 B` → not a 404.

---

## Decision Gate (read before Task 2)

Task 1 ships diagnostics. **After Task 1 is deployed and one real session is recorded on the Shield TV**, inspect the new `fitness.audio_duck.play_rejected` / `fitness.audio_duck.error` events in that session's `.jsonl`:

- **`name: "NotAllowedError"`** (or autoplay/user-activation wording) → confirmed autoplay gate. Proceed with Tasks 2–4 as written (shared unlocked element).
- **`name: "NotSupportedError"` / decode / `error.code` set** → the file isn't decodable in the WebView (unlikely — it serves and `ffprobe`s fine), or a concurrent-stream limit. **Pivot to the Web Audio contingency** (see Appendix A) instead of Tasks 2–4.

Do not skip this gate — the whole repair rests on knowing *why* `play()` rejects, and that fact was being swallowed.

---

## Task 1: Make the cue-playback failure observable

**Files:**
- Modify: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js` (`startSession` ~lines 16-45, `stopSession` ~lines 48-57)
- Test: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`

**Step 1: Write the failing tests**

Add to `useGovernanceAudioDuck.test.jsx`. First, replace the noop logger mock with a spy-able one so we can assert on warnings:

```jsx
// Replace the existing logger mock (lines 5-9) with:
const warn = vi.fn();
vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: (...a) => warn(...a), error: noop, sampled: noop };
  return { default: () => logger };
});
```

Then add two tests inside the `describe`:

```jsx
it('logs the rejection reason when play() is rejected', async () => {
  warn.mockClear();
  global.Audio = class extends FakeAudio {
    play() { this.playCalls += 1; return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); }
  };
  render(descriptor());
  await act(async () => { await Promise.resolve(); });
  expect(warn).toHaveBeenCalledWith('fitness.audio_duck.play_rejected',
    expect.objectContaining({ cueId: 'challenge_hurry', name: 'NotAllowedError' }));
});

it('logs + lifts the duck when the audio element fires error', () => {
  warn.mockClear();
  render(descriptor());
  act(() => FakeAudio.instances[0].fire('error'));
  expect(warn).toHaveBeenCalledWith('fitness.audio_duck.error', expect.objectContaining({ cueId: 'challenge_hurry' }));
  expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: FAIL — `play_rejected` not logged (current code does `.catch(() => lift())` with no log); `error` event has no listener.

**Step 3: Implement the minimal change**

In `useGovernanceAudioDuck.js`, update `startSession`'s try-block and return value:

```js
  const onEnded = () => lift();
  const onError = () => {
    const mediaErr = audio?.error;
    logger().warn('fitness.audio_duck.error', {
      cueId: audioDuck.cueId, token: audioDuck.token,
      code: mediaErr?.code ?? null, message: mediaErr?.message ?? null,
    });
    lift();
  };
  let audio = null;
  try {
    audio = new Audio(DaylightMediaPath(`/media/${audioDuck.sound}`));
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch((err) => {
      logger().warn('fitness.audio_duck.play_rejected', {
        cueId: audioDuck.cueId, token: audioDuck.token,
        name: err?.name ?? null, message: err?.message ?? null,
      });
      lift();
    });
  } catch (err) {
    logger().warn('fitness.audio_duck.play_threw', {
      cueId: audioDuck.cueId, token: audioDuck.token, message: err?.message ?? null,
    });
    lift();
  }
  return { token: audioDuck.token, audio, onEnded, onError, lift };
```

In `stopSession`, also detach the error listener:

```js
  const { audio, onEnded, onError, lift } = session;
  if (audio) {
    audio.removeEventListener('ended', onEnded);
    if (onError) audio.removeEventListener('error', onError);
    try { audio.pause(); } catch { /* already released */ }
    audio.src = '';
  }
  lift?.();
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: PASS (all original tests + 2 new).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js \
        frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx
git commit -m "fix(fitness): surface audio-cue play() rejection + media errors in logs"
```

**Step 6: Deploy & observe → see Decision Gate above before continuing.**

---

## Task 2: Create the shared, unlock-on-gesture cue audio player

**Files:**
- Create: `frontend/src/modules/Fitness/player/hooks/audioCuePlayer.js`
- Test: `frontend/src/modules/Fitness/player/hooks/audioCuePlayer.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeAudio {
  static instances = [];
  constructor() { this.src = ''; this.muted = false; this.currentTime = 0; this.paused = true; this.playCalls = 0; FakeAudio.instances.push(this); }
  play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { getCueAudioElement, primeCueAudio, isCueAudioUnlocked, installCueAudioUnlock, __resetCueAudioForTest } from './audioCuePlayer.js';

describe('audioCuePlayer', () => {
  beforeEach(() => { FakeAudio.instances = []; global.Audio = FakeAudio; __resetCueAudioForTest(); });

  it('returns a single shared element across calls', () => {
    expect(getCueAudioElement()).toBe(getCueAudioElement());
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('primeCueAudio plays-muted-then-pauses and marks unlocked', async () => {
    expect(isCueAudioUnlocked()).toBe(false);
    primeCueAudio();
    await Promise.resolve();
    const el = getCueAudioElement();
    expect(el.playCalls).toBe(1);
    expect(el.paused).toBe(true);
    expect(isCueAudioUnlocked()).toBe(true);
  });

  it('installCueAudioUnlock primes on the first gesture then removes its listeners', async () => {
    const handlers = {};
    const target = {
      addEventListener: (e, cb) => { handlers[e] = cb; },
      removeEventListener: (e) => { delete handlers[e]; },
    };
    installCueAudioUnlock(target);
    expect(Object.keys(handlers).length).toBeGreaterThan(0);
    handlers.pointerdown();
    await Promise.resolve();
    expect(isCueAudioUnlocked()).toBe(true);
    expect(Object.keys(handlers).length).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/audioCuePlayer.test.js`
Expected: FAIL — module does not exist.

**Step 3: Write the implementation**

```js
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'audio-cue-player' }));

let _el = null;
let _unlocked = false;

/** The single shared HTMLAudioElement used for all cue SFX (created lazily). */
export function getCueAudioElement() {
  if (!_el && typeof Audio !== 'undefined') _el = new Audio();
  return _el;
}

export function isCueAudioUnlocked() { return _unlocked; }

/**
 * Grant the shared element user-activation by playing it muted then pausing —
 * the standard trick to defeat WebView/mobile autoplay gating. Idempotent;
 * must be called from within a real user-gesture handler to take effect.
 */
export function primeCueAudio() {
  if (_unlocked) return true;
  const el = getCueAudioElement();
  if (!el) return false;
  try {
    el.muted = true;
    const p = el.play();
    const finish = () => { try { el.pause(); } catch { /* noop */ } el.currentTime = 0; el.muted = false; _unlocked = true; logger().info('audio_cue.unlocked', {}); };
    if (p && typeof p.then === 'function') {
      p.then(finish).catch((err) => { el.muted = false; logger().warn('audio_cue.unlock_failed', { name: err?.name ?? null }); });
    } else {
      finish();
    }
  } catch (err) {
    logger().warn('audio_cue.unlock_threw', { message: err?.message ?? null });
  }
  return _unlocked;
}

/**
 * Attach one-time gesture listeners to `target` (defaults to window) that prime
 * the cue element on the first interaction, then self-remove once unlocked.
 * Returns a manual remover. Safe to call repeatedly.
 */
export function installCueAudioUnlock(target = (typeof window !== 'undefined' ? window : null)) {
  if (!target || _unlocked) return () => {};
  const events = ['pointerdown', 'touchstart', 'keydown', 'click'];
  const remove = () => events.forEach((e) => target.removeEventListener(e, handler));
  function handler() { primeCueAudio(); if (_unlocked) remove(); }
  events.forEach((e) => target.addEventListener(e, handler, { passive: true }));
  return remove;
}

/** Test-only: reset module singleton state. */
export function __resetCueAudioForTest() { _el = null; _unlocked = false; }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/audioCuePlayer.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/hooks/audioCuePlayer.js \
        frontend/src/modules/Fitness/player/hooks/audioCuePlayer.test.js
git commit -m "feat(fitness): add shared unlock-on-gesture cue audio player"
```

---

## Task 3: Route the duck hook through the shared element

**Files:**
- Modify: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js` (`startSession`, `stopSession`)
- Test: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`

**Step 1: Update the tests for element reuse**

The hook now reuses ONE element instead of `new Audio()` per cue. Update the test so `Audio` flows through the singleton, and fix the supersession expectation (one element retargeted, not two):

```jsx
// add import at top of the test file:
import { __resetCueAudioForTest } from './audioCuePlayer.js';

// in beforeEach, after setting global.Audio:
__resetCueAudioForTest();
```

Change the "stops the previous SFX and re-ducks on a new token" test to assert reuse:

```jsx
it('reuses one shared element and re-ducks on a new token', () => {
  const { rerender } = render(descriptor({ token: 'ch1:challenge_start', cueId: 'challenge_start', duckTo: 0.2 }));
  rerender({ audioDuck: descriptor({ token: 'ch1:challenge_hurry', duckTo: 0.1 }) });
  expect(FakeAudio.instances).toHaveLength(1);          // shared, not recreated
  expect(FakeAudio.instances[0].playCalls).toBe(2);     // played again for the new cue
  expect(videoVolume.setDuck).toHaveBeenLastCalledWith(0.1);
});
```

The existing "ducks and plays the SFX on a new token" test should still assert `FakeAudio.instances` has length 1 and `playCalls` 1 — verify it still holds.

**Step 2: Run tests to verify the reuse test fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: FAIL — current code still does `new Audio()` (two instances).

**Step 3: Implement — obtain the element from the singleton**

In `useGovernanceAudioDuck.js`, add the import and swap element acquisition (keep the Task 1 diagnostics):

```js
import { getCueAudioElement } from './audioCuePlayer.js';
```

In `startSession`, replace `audio = new Audio(DaylightMediaPath(...))` with:

```js
    audio = getCueAudioElement();
    if (!audio) { lift(); return null; }
    audio.src = DaylightMediaPath(`/media/${audioDuck.sound}`);
    audio.currentTime = 0;
    audio.muted = false;
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    const p = audio.play();
    // ...(same play_rejected catch as Task 1)
```

In `stopSession`, do NOT clear `audio.src` to empty on the shared element only when a successor will immediately set it — but since the next `startSession` always re-sets `src` and `currentTime`, clearing is harmless. Keep the listener removal + `pause()`; you MAY drop the `audio.src = ''` line to avoid a spurious `error` event on the shared element (empty-src can fire `error`). Prefer:

```js
  if (audio) {
    audio.removeEventListener('ended', onEnded);
    if (onError) audio.removeEventListener('error', onError);
    try { audio.pause(); } catch { /* already released */ }
  }
  lift?.();
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js \
        frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx
git commit -m "fix(fitness): play cues through the shared unlocked element"
```

---

## Task 4: Install the gesture-unlock at the player

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` (near the `useGovernanceAudioDuck` call, ~line 624)

**Step 1: Write the failing test**

This is a one-line mount effect; cover it with a focused render test if a FitnessPlayer test harness exists, otherwise verify via the audioCuePlayer test already proving `installCueAudioUnlock` wiring. If no player-level test exists, add a minimal assertion test:

- Test: `frontend/src/modules/Fitness/player/hooks/audioCuePlayer.test.js` — already covers `installCueAudioUnlock`. Add one guard test:

```js
it('installCueAudioUnlock is a no-op once already unlocked', () => {
  primeCueAudio();                       // sync-resolve path marks unlocked
  const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  installCueAudioUnlock(target);
  expect(target.addEventListener).not.toHaveBeenCalled();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/audioCuePlayer.test.js`
Expected: FAIL if the no-op guard isn't covered (the guard `if (_unlocked) return () => {}` already exists from Task 2 — confirm it passes; if it passes, this step just locks the behavior in).

**Step 3: Wire it into FitnessPlayer**

Add the import and a mount effect alongside the duck hook:

```jsx
import { installCueAudioUnlock } from '@/modules/Fitness/player/hooks/audioCuePlayer.js';

// ...inside the component, near line 624:
useEffect(() => installCueAudioUnlock(), []);

useGovernanceAudioDuck({
  videoVolume,
  audioDuck: effectiveGovernanceState?.audioDuck
});
```

(If `useEffect` isn't already imported in `FitnessPlayer.jsx`, add it to the React import.)

**Step 4: Verify the suite passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx \
        frontend/src/modules/Fitness/player/hooks/audioCuePlayer.test.js
git commit -m "feat(fitness): unlock cue audio on first user gesture in the player"
```

---

## Task 5 (OPTIONAL polish): Stop a 1 ms successor from clipping a completion cue

Only do this if, after Tasks 1–4 verify on-device, the rapid `challenge_complete` → `challenge_start` chain (observed ~1 ms apart) is still audibly clipping the completion sound. Once `play()` works, the user's primary complaint (isolated hurry/warning) is already resolved, so treat this as low priority.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`_computeAudioDuck`)
- Test: `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`

**Approach (engine-side suppression):** when a `challenge_start` cue would fire but a `challenge_complete` cue for the *previous* challenge fired within the last ~1.2 s, suppress the `start` cue so the completion sound finishes. Write the failing test first (a `challenge_start` snapshot evaluated within the window returns `null`), then implement a small timestamp guard keyed on the last-complete time. Keep it minimal; do not redesign the priority ladder.

Defer detailed spec until Task 1 telemetry + on-device check confirm it's still needed.

---

## Task 6: Verify the fix on real hardware

**Not a code task — required before claiming done (superpowers:verification-before-completion).**

1. Build/deploy the frontend to the Shield TV (per project deploy flow — user runs `deploy.sh`; do not auto-run).
2. Run a fitness session that triggers at least one `challenge_warning` and one `challenge_hurry`.
3. Pull that session's log and confirm:

```bash
# Find the session log (filename is UTC; convert your local session time +7h for PDT)
ls -t "$MEDIA/logs/fitness/" | head
# Confirm no rejections remain and cues now play their full duration:
python3 - "$MEDIA/logs/fitness/<session>.jsonl" <<'PY'
import json,sys
from datetime import datetime
starts={}
def t(ts): return datetime.strptime(ts[:23],"%Y-%m-%dT%H:%M:%S.%f")
for line in open(sys.argv[1]):
    try: e=json.loads(line)
    except: continue
    ev=e.get('event','')
    if ev=='fitness.audio_duck.play_rejected': print("STILL REJECTING:", e['data'])
    if ev=='fitness.audio_duck.start': starts[e['data']['token']]=t(e['ts'])
    if ev=='fitness.audio_duck.end' and e['data']['token'] in starts:
        ms=(t(e['ts'])-starts[e['data']['token']]).total_seconds()*1000
        print(f"{e['data'].get('cueId')}: {ms:.0f}ms")
PY
```

**Success criteria:** zero `play_rejected` events; `challenge_warning` gaps ≈ 1390 ms; `challenge_hurry` gaps ≈ 2350 ms (or at least far above the old ~270 ms ceiling).

If `play_rejected` still appears → return to the Decision Gate and pursue Appendix A.

---

## Appendix A — Contingency: Web Audio buffer playback

If the Decision Gate shows the rejection is NOT user-activation (e.g. decode failure, or a concurrent-stream limit where a second `<audio>` is blocked while the video plays), switch the cue player to Web Audio:

- One shared `AudioContext` (the app already builds one in `useMediaAmplifier.js` — mirror that `window.AudioContext || window.webkitAudioContext` pattern), `resume()`'d on the same gesture hook from Task 2.
- `fetch(url) → arrayBuffer → ctx.decodeAudioData` once per cue file, cache the `AudioBuffer` by sound path.
- Play via a fresh `AudioBufferSourceNode → ctx.destination` per cue; lift the duck on the node's `ended` event.

This bypasses HTMLAudioElement autoplay/stream limits entirely. It's more code and async decode, so only adopt it if Task 1 telemetry rules out the simpler element-unlock fix.

---

## Notes for the executor

- **Worktree:** This work is unrelated to the current `feat/garage-fan-trigger` branch (which has uncommitted garage-fan changes). Create a dedicated worktree/branch (e.g. `fix/fitness-audio-cue-playback`) before starting — see superpowers:using-git-worktrees.
- **Logging:** All new diagnostics use the structured logger (`getLogger().child(...)`), per CLAUDE.md — no raw `console.*`.
- **No PII in tests:** keep `test-user`/`ch1` style identifiers; never the real head-of-household id.
- **Do not commit/deploy without the user** (CLAUDE.md rule).
- The cue *selection* logic in `GovernanceEngine.audioDuck.test.js` is correct and out of scope except for optional Task 5 — don't touch the priority ladder.
