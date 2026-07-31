# Karaoke Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the karaoke (singalong) player its own keyboard vocabulary — seek, restart, end, fullscreen, key-change, volume, and an applause sound effect — overriding the shared Player's defaults where they conflict, without editing the shared Player.

**Architecture:** The shared Player installs a window-level bubble-phase `keydown` handler (`frontend/src/lib/keyboard/keyboardManager.js` via `lib/Player/useMediaKeyboardHandler.js`) whose defaults include double-ArrowRight → next/skip and ArrowUp/Down → shader cycling. A new consumer-side hook `useKaraokeKeys` in the Singalong directory registers a **capture-phase** window `keydown` listener; for the keys it owns it calls `preventDefault()` + `stopImmediatePropagation()` so the Player's bubble listener never sees them. Unhandled keys (Space, Enter, Escape…) flow through to the Player untouched. Key-change taps route through `KeyControl` via a new imperative `apiRef` so clamping, logging, and the engine-failed gate stay in one place. Volume steps through the same five-step curve (`volumeCurve.js` + `usePianoMix`) the VolumeSheet UI uses.

**Tech Stack:** React hooks, window KeyboardEvent capture phase, vitest + @testing-library/react (jsdom), existing PianoMix context and volume curve, `DaylightMediaPath` for the SFX URL.

## Global Constraints

- **Never edit** `frontend/src/lib/Player/`, `frontend/src/modules/Player/`, or `frontend/src/lib/keyboard/` — all overrides live in `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/`.
- **Never use raw `console.*`** — all logging via `getLogger().child(...)` (transport floor is `info`; high-frequency seek keys log at `debug` deliberately).
- **Run vitest from `frontend/`** with `./node_modules/.bin/vitest run <paths>`.
- **Working directory:** the git worktree `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3`. HEAD is currently detached at `828d05d62` — Task 1 Step 1 creates branch `feature/karaoke-keys` from it. Before EVERY commit run `git rev-parse --show-toplevel && git branch --show-current` and confirm the worktree path and `feature/karaoke-keys`. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Keyboard contract (the spec, verbatim):** ArrowLeft/ArrowRight = rew/ffw (stays); double-ArrowLeft = restart at 0:00 (stays); **double-ArrowRight must NOT end/skip/next** (override); End = end the song; Home = toggle fullscreen; ArrowUp/ArrowDown = key change up/down; `+`/`-` (top row AND numpad) = volume up/down using the same five-step interface as the UI buttons; Numpad `0` = applause sound effect.
- **Applause assets:** a folder `media/audio/sfx/applause/` holding numbered files `001.mp3`, `002.mp3`, … (user supplies them later; gaps allowed). Numpad0 picks one AT RANDOM for variety. The frontend cannot list directories, so discovery = parallel HEAD probes of `001.mp3`–`030.mp3` via `DaylightMediaPath`, cached per mount. An empty/missing folder must degrade to a `warn` log, never a crash.
- **Deploy gate (Task 3) must HALT as its own step** — never chain the gate check with `docker stop`/`rm`/`deploy-daylight`.

---

### Task 1: KeyControl imperative api (`apiRef`)

The keyboard needs to step the key shift through the SAME path as the stepper buttons (clamping, `keyshift.tap` logging, engine-failed gating). Expose an imperative surface instead of lifting state.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.test.jsx`

**Interfaces:**
- Produces: `<KeyControl apiRef={ref} …>` where after mount `ref.current === { step(delta), reset(), engineFailed }`. `step`/`reset` are the exact functions the buttons call (they log `keyshift.tap` and clamp ±6). `ref.current` is nulled on unmount. Task 2 consumes this: on ArrowUp/Down it calls `ref.current.step(±1)` only when `ref.current.engineFailed` is falsy.

- [ ] **Step 1: Create the branch, then write the failing tests**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3 && git checkout -b feature/karaoke-keys
```

Append to the `describe('KeyControl', ...)` block in `KeyControl.test.jsx` (note: `act` must be added to the existing `@testing-library/react` import line):

```jsx
  it('exposes step/reset through apiRef, sharing the buttons’ clamp and hook path', () => {
    const apiRef = { current: null };
    render(<KeyControl mediaEl={null} apiRef={apiRef} />);
    expect(typeof apiRef.current.step).toBe('function');
    act(() => apiRef.current.step(1));
    expect(value().textContent).toBe('+1');
    expect(useKeyShiftSpy).toHaveBeenLastCalledWith(null, 1);
    for (let i = 0; i < KEY_SHIFT_MAX + 3; i += 1) act(() => apiRef.current.step(1));
    expect(value().textContent).toBe(`+${KEY_SHIFT_MAX}`);
    act(() => apiRef.current.reset());
    expect(value().textContent).toBe('Key');
  });

  it('apiRef reports engine failure and is nulled on unmount', () => {
    useKeyShiftSpy.mockReturnValue(true);
    const apiRef = { current: null };
    const { unmount } = render(<KeyControl mediaEl={null} apiRef={apiRef} />);
    expect(apiRef.current.engineFailed).toBe(true);
    unmount();
    expect(apiRef.current).toBe(null);
    useKeyShiftSpy.mockReturnValue(undefined);
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.test.jsx`
Expected: the two new tests FAIL (`apiRef.current` is null — prop unknown); the seven existing tests pass.

- [ ] **Step 3: Implement `apiRef` in KeyControl**

In `KeyControl.jsx`: add `useEffect` to the react import (`import { useState, useEffect } from 'react';`), add the `apiRef` prop, and register the surface after the `reset` definition:

```jsx
export default function KeyControl({ mediaEl, className = '', apiRef }) {
```

and below the existing `reset` function:

```jsx
  // Imperative surface for the karaoke keyboard shortcuts (ArrowUp/ArrowDown):
  // the same step/reset the buttons call, so clamping, keyshift.tap logging,
  // and the engine-failed gate behave identically for keys and taps. No dep
  // array on purpose — reassigning every render keeps the closures fresh.
  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = { step, reset, engineFailed };
    return () => { apiRef.current = null; };
  });
```

- [ ] **Step 4: Run to verify all KeyControl tests pass**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.test.jsx`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git rev-parse --show-toplevel && git branch --show-current  # worktree + feature/karaoke-keys
git add frontend/src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.test.jsx
git commit -m "feat(piano): KeyControl apiRef — imperative step/reset for keyboard shortcuts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `useKaraokeKeys` hook + SingalongPlayer wiring

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKaraokeKeys.js`
- Create (test): `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKaraokeKeys.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/SingalongPlayer.jsx`

**Interfaces:**
- Consumes: Task 1's `apiRef` contract (`{ step, reset, engineFailed }` or null); `usePianoMix()` → `{ mediaLevel, setMediaLevel }` (0–1); `stepToLevel/levelToStep/STEPS` from `../../volumeCurve.js`; `DaylightMediaPath` from `../../../../../lib/api.mjs`; SingalongPlayer's existing `handleSkip(deltaSeconds)`, `handleRestart()`, `onBack()`, `toggleFullscreen()`.
- Produces: `useKaraokeKeys({ onSkip, onRestart, onEndSong, onToggleFullscreen, keyControlRef })` — capture-phase window keydown handler active while the host is mounted. Exports `APPLAUSE_SFX_DIR = '/media/audio/sfx/applause'` and `DOUBLE_PRESS_MS = 350`.

- [ ] **Step 1: Write the failing tests**

Create `useKaraokeKeys.test.jsx`:

```jsx
// useKaraokeKeys.test.jsx — the karaoke keyboard vocabulary, and the override
// contract with the shared Player: handled keys are swallowed in the capture
// phase (the Player's window bubble listener must never see them); unhandled
// keys (Space etc.) flow through untouched. Audio and the mix context are
// mocked — jsdom has neither.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useKaraokeKeys, { APPLAUSE_SFX_DIR, DOUBLE_PRESS_MS } from './useKaraokeKeys.js';
import { stepToLevel } from '../../volumeCurve.js';

const h = vi.hoisted(() => ({
  mix: { mediaLevel: stepToLevel(2, 'log'), setMediaLevel: vi.fn() },
  audios: [],
  fetch: vi.fn(() => Promise.resolve({ ok: false })),
}));
vi.mock('../../PianoMixContext.jsx', () => ({ usePianoMix: () => h.mix }));
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightMediaPath: (p) => `http://test${p}` }));

class FakeAudio {
  constructor(src) { this.src = src; this.currentTime = 99; this.play = vi.fn(() => Promise.resolve()); h.audios.push(this); }
}

const press = (key, opts = {}) => {
  const e = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...opts });
  window.dispatchEvent(e);
  return e;
};

const deps = () => ({
  onSkip: vi.fn(),
  onRestart: vi.fn(),
  onEndSong: vi.fn(),
  onToggleFullscreen: vi.fn(),
  keyControlRef: { current: { step: vi.fn(), reset: vi.fn(), engineFailed: false } },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', h.fetch);
  h.audios.length = 0;
  h.fetch.mockClear();
  h.fetch.mockImplementation(() => Promise.resolve({ ok: false }));
  h.mix.setMediaLevel.mockClear();
  h.mix.mediaLevel = stepToLevel(2, 'log');
});
afterEach(() => { vi.useRealTimers(); });

describe('useKaraokeKeys', () => {
  it('ArrowRight seeks forward and NEVER skips, even double-pressed fast', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    // Simulate the shared Player's window bubble listener.
    const playerListener = vi.fn();
    window.addEventListener('keydown', playerListener);
    press('ArrowRight');
    vi.advanceTimersByTime(50); // well inside the double-press window
    press('ArrowRight');
    expect(d.onSkip).toHaveBeenCalledTimes(2);
    expect(d.onSkip).toHaveBeenLastCalledWith(15);
    expect(d.onEndSong).not.toHaveBeenCalled();
    expect(playerListener).not.toHaveBeenCalled(); // swallowed before the Player
    window.removeEventListener('keydown', playerListener);
  });

  it('single ArrowLeft seeks back; a fast second ArrowLeft restarts at 0:00', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('ArrowLeft');
    expect(d.onSkip).toHaveBeenLastCalledWith(-15);
    vi.advanceTimersByTime(DOUBLE_PRESS_MS - 100);
    press('ArrowLeft');
    expect(d.onRestart).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DOUBLE_PRESS_MS + 100);
    press('ArrowLeft');
    expect(d.onSkip).toHaveBeenCalledTimes(2); // slow press seeks again, no restart
    expect(d.onRestart).toHaveBeenCalledTimes(1);
  });

  it('End ends the song; Home toggles fullscreen', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('End');
    expect(d.onEndSong).toHaveBeenCalledTimes(1);
    press('Home');
    expect(d.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('ArrowUp/ArrowDown step the key through the KeyControl api, gated on engine failure', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('ArrowUp');
    expect(d.keyControlRef.current.step).toHaveBeenLastCalledWith(1);
    press('ArrowDown');
    expect(d.keyControlRef.current.step).toHaveBeenLastCalledWith(-1);
    d.keyControlRef.current.engineFailed = true;
    press('ArrowUp');
    expect(d.keyControlRef.current.step).toHaveBeenCalledTimes(2); // no third call
  });

  it('plus/minus (top row and numpad) step media volume on the shared five-step curve', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('+');
    expect(h.mix.setMediaLevel).toHaveBeenLastCalledWith(stepToLevel(3, 'log'));
    press('-', { code: 'NumpadSubtract' });
    expect(h.mix.setMediaLevel).toHaveBeenLastCalledWith(stepToLevel(1, 'log'));
    // clamp at Max: simulate already at top step
    h.mix.mediaLevel = stepToLevel(4, 'log');
    press('=');
    expect(h.mix.setMediaLevel).toHaveBeenLastCalledWith(stepToLevel(4, 'log'));
  });

  it('Numpad 0 plays a random applause file from the discovered folder', async () => {
    // HEAD probes: only 001 and 003 exist (gap at 002 must be tolerated).
    h.fetch.mockImplementation((url) => Promise.resolve({ ok: /001\.mp3$|003\.mp3$/.test(url) }));
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('0', { code: 'Numpad0' });
    await vi.runAllTimersAsync();
    expect(h.audios.length).toBe(1);
    expect(h.audios[0].src).toMatch(new RegExp(`http://test${APPLAUSE_SFX_DIR}/(001|003)\\.mp3$`));
    expect(h.audios[0].play).toHaveBeenCalled();
    // Second press: discovery is cached (no new probe volley), a fresh Audio
    // plays (overlapping applause is fine).
    const probesAfterFirst = h.fetch.mock.calls.length;
    press('0', { code: 'Numpad0' });
    await vi.runAllTimersAsync();
    expect(h.fetch.mock.calls.length).toBe(probesAfterFirst);
    expect(h.audios.length).toBe(2);
  });

  it('an empty applause folder only warns — never throws', async () => {
    h.fetch.mockImplementation(() => Promise.resolve({ ok: false }));
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('0', { code: 'Numpad0' });
    await vi.runAllTimersAsync();
    expect(h.audios.length).toBe(0);
  });

  it('top-row 0 does nothing; unhandled keys reach the Player untouched', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    const playerListener = vi.fn();
    window.addEventListener('keydown', playerListener);
    press('0', { code: 'Digit0' });
    expect(h.audios.length).toBe(0);
    const space = press(' ');
    expect(playerListener).toHaveBeenCalledTimes(2); // Digit0 + Space both flowed through
    expect(space.defaultPrevented).toBe(false);
    window.removeEventListener('keydown', playerListener);
  });

  it('removes its listener on unmount', () => {
    const d = deps();
    const { unmount } = renderHook(() => useKaraokeKeys(d));
    unmount();
    press('End');
    expect(d.onEndSong).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify the suite fails**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/useKaraokeKeys.test.jsx`
Expected: FAIL — `useKaraokeKeys.js` does not exist.

- [ ] **Step 3: Create the hook**

Create `useKaraokeKeys.js`:

```js
// useKaraokeKeys.js — the karaoke keyboard vocabulary for SingalongPlayer.
//
// The shared Player installs a window-level BUBBLE-phase keydown handler
// (lib/keyboard/keyboardManager.js) whose defaults are wrong for karaoke:
// double-ArrowRight skips to the next track (a singer's over-eager seek must
// never kill the song) and ArrowUp/Down cycle shaders. We are forbidden from
// editing the shared Player, so this hook claims its keys in the CAPTURE
// phase and stops propagation — the Player never sees them. Keys we don't
// own (Space, Enter, Escape…) pass through untouched.
import { useEffect, useRef } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightMediaPath } from '../../../../../lib/api.mjs';
import { usePianoMix } from '../../PianoMixContext.jsx';
import { stepToLevel, levelToStep, STEPS } from '../../volumeCurve.js';

// Applause pool: drop numbered mp3s (001.mp3, 002.mp3, … gaps fine) into
// media/audio/sfx/applause/ — Numpad0 picks one at random for variety. The
// frontend can't list directories, so we HEAD-probe the first 30 names once
// per mount and cache the hits. Empty folder → warn, silent, no crash.
export const APPLAUSE_SFX_DIR = '/media/audio/sfx/applause';
const APPLAUSE_MAX_PROBE = 30;
export const DOUBLE_PRESS_MS = 350;
const SEEK_SECONDS = 15; // matches the ±15 transport buttons

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'karaoke-keys' });
  return _logger;
}

/**
 * Karaoke keyboard shortcuts, active while the host player is mounted:
 * ←/→ seek ∓15s (double-→ is just another seek — never a skip) · double-←
 * restart · End end song · Home fullscreen · ↑/↓ key change · +/− volume
 * (top row or numpad, same five-step curve as the sheet) · Numpad0 applause.
 */
export default function useKaraokeKeys({
  onSkip,
  onRestart,
  onEndSong,
  onToggleFullscreen,
  keyControlRef,
}) {
  const { mediaLevel, setMediaLevel } = usePianoMix();
  // Refs so the one listener registration survives re-renders with fresh state.
  const cbRef = useRef({});
  cbRef.current = { onSkip, onRestart, onEndSong, onToggleFullscreen, keyControlRef, mediaLevel, setMediaLevel };
  const lastLeftRef = useRef(0);
  const applauseListRef = useRef(null); // Promise<string[]> — probe once per mount

  useEffect(() => {
    const stepVolume = (dir) => {
      const { mediaLevel: level, setMediaLevel: setLevel } = cbRef.current;
      const cur = levelToStep(level, 'log');
      const next = Math.max(0, Math.min(STEPS.length - 1, cur + dir));
      setLevel(stepToLevel(next, 'log'));
      logger().info('karaoke.volume-key', { fromStep: cur, toStep: next });
    };

    const discoverApplause = () => {
      if (!applauseListRef.current) {
        applauseListRef.current = Promise.all(
          Array.from({ length: APPLAUSE_MAX_PROBE }, (_, i) => {
            const name = `${String(i + 1).padStart(3, '0')}.mp3`;
            const url = DaylightMediaPath(`${APPLAUSE_SFX_DIR}/${name}`);
            return fetch(url, { method: 'HEAD' })
              .then((r) => (r.ok ? url : null))
              .catch(() => null);
          }),
        ).then((urls) => urls.filter(Boolean));
      }
      return applauseListRef.current;
    };

    const playApplause = () => {
      discoverApplause().then((urls) => {
        if (!urls.length) {
          logger().warn('karaoke.applause-missing', { dir: APPLAUSE_SFX_DIR });
          return;
        }
        const url = urls[Math.floor(Math.random() * urls.length)];
        const sfx = new Audio(url); // fresh element — overlapping applause is fine
        Promise.resolve(sfx.play()).then(
          () => logger().info('karaoke.applause', { file: url.split('/').pop(), poolSize: urls.length }),
          (e) => logger().warn('karaoke.applause-failed', { message: e?.message, file: url.split('/').pop() }),
        );
      });
    };

    const onKeyDown = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const cb = cbRef.current;
      let handled = true;
      if (e.key === 'ArrowRight') {
        // Deliberately no double-press branch: a fast second press is just
        // another seek. The Player's "double-right = next track" is the exact
        // behavior this hook exists to bury.
        cb.onSkip?.(SEEK_SECONDS);
        logger().debug('karaoke.seek-key', { direction: 'forward' });
      } else if (e.key === 'ArrowLeft') {
        const now = Date.now();
        if (now - lastLeftRef.current < DOUBLE_PRESS_MS) {
          lastLeftRef.current = 0;
          cb.onRestart?.();
          logger().info('karaoke.restart-key', {});
        } else {
          lastLeftRef.current = now;
          cb.onSkip?.(-SEEK_SECONDS);
          logger().debug('karaoke.seek-key', { direction: 'backward' });
        }
      } else if (e.key === 'End') {
        logger().info('karaoke.end-key', {});
        cb.onEndSong?.();
      } else if (e.key === 'Home') {
        logger().info('karaoke.fullscreen-key', {});
        cb.onToggleFullscreen?.();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const api = cb.keyControlRef?.current;
        if (api && !api.engineFailed) api.step(e.key === 'ArrowUp' ? 1 : -1);
        // Swallow even when gated — shader cycling mid-song is never wanted.
      } else if (e.key === '+' || e.key === '=') {
        stepVolume(1);
      } else if (e.key === '-' || e.key === '_') {
        stepVolume(-1);
      } else if (e.code === 'Numpad0') {
        playApplause();
      } else {
        handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    // Capture phase: fire before (and suppress) the Player's bubble listener.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
```

- [ ] **Step 4: Run to verify the hook suite passes**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/useKaraokeKeys.test.jsx`
Expected: PASS (9 tests)

- [ ] **Step 5: Wire into SingalongPlayer**

In `SingalongPlayer.jsx`:

Add the import (beside the KeyControl import):

```jsx
import useKaraokeKeys from './useKaraokeKeys.js';
```

Add the ref + hook call AFTER the `handleRestart`/`handleSkip` definitions (they must exist first — place the block immediately below the `handleSkip` `useCallback`):

```jsx
  // Karaoke keyboard vocabulary (capture-phase overrides of the shared
  // Player's defaults — see useKaraokeKeys). keyCtlRef reaches the KeyControl
  // stepper so ArrowUp/Down share the buttons' clamp/log/engine-gate path.
  const keyCtlRef = useRef(null);
  useKaraokeKeys({
    onSkip: handleSkip,
    onRestart: handleRestart,
    onEndSong: onBack,
    onToggleFullscreen: toggleFullscreen,
    keyControlRef: keyCtlRef,
  });
```

And pass the ref to KeyControl (the existing line):

```jsx
          <KeyControl key={contentId} mediaEl={mediaEl} apiRef={keyCtlRef} className="piano-singalong-chrome__keyctl" />
```

- [ ] **Step 6: Run the full Singalong + Karaoke test set**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/ src/modules/Piano/PianoKiosk/modes/Karaoke/`
Expected: ALL PASS (existing suites — `SingalongPlayer.keycontrol.test.jsx`, resume tests, keyshift suites — plus the two new files).

- [ ] **Step 7: Commit**

```bash
git rev-parse --show-toplevel && git branch --show-current  # worktree + feature/karaoke-keys
git add frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKaraokeKeys.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKaraokeKeys.test.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Singalong/SingalongPlayer.jsx
git commit -m "feat(piano): karaoke keyboard shortcuts — capture-phase overrides of Player keys

←/→ seek ±15s with double-→ defused (never skips); double-← restarts; End
ends the song; Home toggles fullscreen; ↑/↓ change key through KeyControl's
apiRef (same clamp/log/engine-gate as the buttons); +/− (top row + numpad)
step media volume on the shared five-step curve; Numpad0 plays the applause
SFX — random pick from media/audio/sfx/applause/NNN.mp3 (HEAD-probe discovery, warn-only while the folder is empty).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Merge, deploy, verify

**Files:**
- Modify (main checkout): merge `feature/karaoke-keys` into `main` at `/opt/Code/DaylightStation`; record + delete the branch.

**Interfaces:**
- Consumes: everything above; the existing telemetry (`karaoke.*`, `keyshift.tap`).

- [ ] **Step 1: Merge into main**

```bash
git -C /opt/Code/DaylightStation pull --ff-only
git -C /opt/Code/DaylightStation merge --no-edit feature/karaoke-keys
git -C /opt/Code/DaylightStation log --oneline -3
```

- [ ] **Step 2: Build the Docker image**

Run: `cd /opt/Code/DaylightStation && ./scripts/build-daylight.sh` (NOT under `sudo` — the script invokes `sudo docker` itself). Several minutes.
Expected: ends with `naming to docker.io/kckern/daylight-station:latest done`.

- [ ] **Step 3: Deploy gate — its own halting step**

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Clear ONLY IF: count 0, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If active, WAIT and re-check — never chain with the deploy.

- [ ] **Step 4: Deploy (only after Step 3 is clear), confirm commit live**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

then poll until healthy:

```bash
until curl -s -m 3 http://localhost:3111/build.txt | grep -q Commit; do sleep 2; done; curl -s http://localhost:3111/build.txt
```

Expected: `Commit:` ends with the merge SHA from Step 1.

- [ ] **Step 5: Headless keyboard verification on the deployed origin**

Write to the session scratchpad `karaoke-keys-verify.mjs` (adapted from the existing keyshift verify script — same launch flags, gate click, song-tile click):

```js
// karaoke-keys-verify.mjs — open a karaoke song, exercise the keyboard, read telemetry.
import pkg from '/opt/Code/DaylightStation/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ args: ['--no-sandbox', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const p = await ctx.newPage();
const hits = [];
p.on('console', (m) => {
  const t = m.text();
  if (/karaoke\.|keyshift\.tap|player\.user-action|queue-skip/.test(t)) { hits.push(t.slice(0, 200)); console.log('[console]', t.slice(0, 200)); }
});
await p.goto('https://daylightlocal.kckern.net/piano/singalong', { waitUntil: 'networkidle', timeout: 30000 });
await p.waitForTimeout(2000);
const gate = p.getByText(/continue without piano/i);
if (await gate.isVisible().catch(() => false)) { await gate.click(); await p.waitForTimeout(5000); }
await p.locator('[class*="tile"], [class*="card"], [class*="song"]').first().click({ timeout: 10000 });
await p.waitForTimeout(6000);
// Double-ArrowRight fast: must NOT skip (no queue-skip line may appear after this).
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(60); await p.keyboard.press('ArrowRight');
await p.waitForTimeout(500);
await p.keyboard.press('ArrowUp');   // key change +1 → keyshift.tap
await p.waitForTimeout(500);
await p.keyboard.press('Equal');     // volume up → karaoke.volume-key
await p.waitForTimeout(500);
const stillOpen = await p.getByLabel('Raise key').isVisible().catch(() => false);
await p.keyboard.press('End');       // end song → back to browser
await p.waitForTimeout(2500);
const backInBrowser = !(await p.getByLabel('Raise key').isVisible().catch(() => false));
const joined = hits.join('\n');
const result = {
  noSkip: !/queue-skip/.test(joined),
  keyTap: /keyshift\.tap/.test(joined),
  volume: /karaoke\.volume-key/.test(joined),
  endKey: /karaoke\.end-key/.test(joined),
  stillOpen, backInBrowser,
};
console.log(JSON.stringify(result));
const pass = result.noSkip && result.keyTap && result.volume && result.endKey && result.stillOpen && result.backInBrowser;
console.log(pass ? 'VERIFY: PASS' : 'VERIFY: FAIL');
await b.close();
```

Run: `cd /opt/Code/DaylightStation && node <scratchpad>/karaoke-keys-verify.mjs 2>&1 | grep -vE 'bridge\.|ERR_CONNECTION_REFUSED' | tail -14`
Expected: `VERIFY: PASS`. Judge by the printed verdict, not the pipeline exit code. (Numpad0/applause is verified only as far as the warn path until the mp3 exists — a `karaoke.applause-failed` line after pressing Numpad0 is acceptable evidence and may be checked manually later.)

- [ ] **Step 6: Branch cleanup**

Append to `/opt/Code/DaylightStation/docs/_archive/deleted-branches.md`:

```markdown
| 2026-07-31 | feature/karaoke-keys | <task-2 commit sha> | karaoke keyboard shortcut overrides (seek/restart/end/fullscreen/key/volume/applause) |
```

```bash
git -C /opt/Code/DaylightStation add docs/_archive/deleted-branches.md
git -C /opt/Code/DaylightStation commit -m "docs: record merged karaoke-keys branch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git -C /opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3 checkout --detach
git -C /opt/Code/DaylightStation branch -d feature/karaoke-keys
git -C /opt/Code/DaylightStation push
```

- [ ] **Step 7: Report**

State: deployed SHA, VERIFY verdict, and remind the user: **drop numbered mp3s (`001.mp3`, `002.mp3`, …, up to `030.mp3`, gaps fine) into `media/audio/sfx/applause/`** on the media volume (host: `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/audio/sfx/applause/`) — no redeploy needed; discovery re-probes on each song open. Note the piano tablet needs a reload to get the new bundle.

---

## Self-Review

- **Spec coverage:** every shortcut in the user's message has a task step and a test: ←/→ seek (T2 tests 1–2), double-← restart (T2 test 2), double-→ defused (T2 test 1 — the core override), End (T2 test 3 + headless Step 5), Home (T2 test 3), ↑/↓ key change with engine gate (T1 + T2 test 4), +/− incl. numpad on the five-step UI curve (T2 test 5), Numpad0 applause with declared path and graceful-missing behavior (T2 test 6). Player and keyboard lib untouched (constraint).
- **Placeholder scan:** all code verbatim; the one deferred item (the mp3 itself) is explicitly the user's, with the exact path stated twice.
- **Type consistency:** `apiRef.current = { step, reset, engineFailed }` (T1) matches T2's `api.step(±1)` / `api.engineFailed` reads; `onSkip(±15)` matches `handleSkip(delta)`'s existing signature; `stepToLevel/levelToStep(…, 'log')` matches `volumeCurve.js` exports.
