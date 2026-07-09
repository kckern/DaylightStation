# Piano Kiosk Video Player — Transport UX + Guaranteed Stop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the piano-kiosk video player pause-first (tap = play/pause), move fullscreen to a button, add a paused loop-cluster (−30/−15/▶/+15/+30), and guarantee the media always stops on unmount so a slept/woken kiosk can never strand audio.

**Architecture:** Piano path only (`modules/Piano/PianoKiosk/modes/Videos/`). The bug is a two-fault chain: `PianoVideoPlayer` binds `playing` listeners to a media element resolved once (`useResolvedMediaEl`), so an engine element-swap latches `playing` stale-false; then `useInactivityReturn` unmounts the Player and the only unmount pause (`cleanupDashElement`) no-ops for a native `<video>`. Fix: (1) re-resolve the element on identity change so `playing` stays accurate; (2) a pause-on-unmount hook that unconditionally stops whatever element is live. Plus the transport UX (tap→toggle, fullscreen button, ±30, paused overlay). No change to the shared Player engine.

**Tech Stack:** React 18, Vitest + @testing-library/react (+ `renderHook`). Styles in `frontend/src/Apps/PianoApp.scss`. Icons are raw SVGs in `modules/Piano/PianoKiosk/icons/svg/` auto-loaded by `Icon.jsx`. Commands from `/opt/Code/DaylightStation/frontend`. Component dir: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/`.

## Global Constraints

- **Piano path only.** Do NOT touch the shared engine (`modules/Player/Player.jsx`, `renderers/VideoPlayer.jsx`, `lib/dashCleanup.js`, `hooks/useCommonMediaController.js`) — the TV/other surfaces depend on it.
- **Tap video = play/pause** (`ctrl.toggle()`); fullscreen leaves the tap and becomes a chrome button.
- **Skip set: −30 / −15 / +15 / +30.** Reuse existing `handleSkip(delta)` (`PianoVideoPlayer.jsx:176`) and existing icons `skip-back-30`, `skip-back-15`, `skip-forward-15`, `skip-forward-30`.
- **Paused = an overlay loop cluster** over the dimmed video, shown only while paused (and not during the engagement gate); tapping the video or ▶ resumes.
- **Guaranteed stop:** on `PianoVideoPlayer` unmount, unconditionally pause the live media element; and `useResolvedMediaEl` must re-resolve when the element identity changes.
- Existing behavior preserved: engagement gate, A-B loop, rate, mix, sequential forward-lock (`forwardDisabled`) also applies to +15/+30.
- Fullscreen icon: add `icons/svg/fullscreen.svg` (the user-supplied line icon, adapted to `stroke="currentColor"`, no fixed px size).
- `PianoVideoPlayer` is too context-heavy to unit-mount; the risky logic is extracted into unit-tested units (Tasks 1, 2, 4) + chrome tests (Task 3). The `PianoVideoPlayer` wiring (Task 5) is verified by the whole Videos suite + `vite build`, with on-device behavior confirmed manually (deploy held).
- Test command: `npx vitest run <path>` from repo root.

---

### Task 1: `useResolvedMediaEl` re-resolves on element identity change

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/useResolvedMediaEl.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/useResolvedMediaEl.test.js`

**Interfaces:**
- Produces (unchanged signature): `useResolvedMediaEl(playerRef, timeoutMs = 8000) -> { el, timedOut }`. NEW behavior: after first resolve, keeps polling and updates `el` whenever `getMediaElement()` returns a different element (so consumers re-bind listeners); `timedOut` only latches while still unresolved.

- [ ] **Step 1: Write the failing test**

Check whether `useResolvedMediaEl.test.js` already exists (`ls`). If it exists, ADD the re-resolve case; if not, create the file:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useResolvedMediaEl from './useResolvedMediaEl.js';

describe('useResolvedMediaEl', () => {
  it('resolves the element once it appears', async () => {
    let el = null;
    const playerRef = { current: { getMediaElement: () => el } };
    const { result } = renderHook(() => useResolvedMediaEl(playerRef));
    expect(result.current.el).toBe(null);
    el = { id: 'A' };
    await waitFor(() => expect(result.current.el).toBe(el));
    expect(result.current.timedOut).toBe(false);
  });

  it('re-resolves when the element identity changes (engine swap)', async () => {
    const a = { id: 'A' }; const b = { id: 'B' };
    let el = a;
    const playerRef = { current: { getMediaElement: () => el } };
    const { result } = renderHook(() => useResolvedMediaEl(playerRef));
    await waitFor(() => expect(result.current.el).toBe(a));
    el = b;
    await waitFor(() => expect(result.current.el).toBe(b));
  });

  it('times out to {el:null, timedOut:true} when nothing ever mounts', async () => {
    const playerRef = { current: { getMediaElement: () => null } };
    const { result } = renderHook(() => useResolvedMediaEl(playerRef, 300));
    await waitFor(() => expect(result.current.timedOut).toBe(true), { timeout: 2000 });
    expect(result.current.el).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/useResolvedMediaEl.test.js`
Expected: FAIL on the re-resolve case (current code stops polling after the first resolve, so `el` never becomes `b`).

- [ ] **Step 3: Implement — keep polling + re-emit on identity change**

Replace the body of `useResolvedMediaEl.js` with:

```js
// useResolvedMediaEl.js
import { useState, useEffect } from 'react';

/**
 * Polls the Player imperative ref for its <video>/<audio> element and keeps it
 * fresh. The shared Player creates the element asynchronously AND may swap it
 * (resilience soft-reinit / remount); if we resolved only once, a consumer's
 * listeners would stay bound to a dead element (stale `playing`). So we keep a
 * lightweight poll running and re-emit whenever the element identity changes.
 *
 * Returns { el, timedOut }. `timedOut` latches true only if no element appears
 * within timeoutMs while still unresolved.
 */
export default function useResolvedMediaEl(playerRef, timeoutMs = 8000) {
  const [state, setState] = useState({ el: null, timedOut: false });
  useEffect(() => {
    let elapsed = 0;
    const STEP = 100;
    let current = null;
    const id = setInterval(() => {
      const m = playerRef?.current?.getMediaElement?.() || null;
      if (m !== current) {
        current = m;
        setState({ el: m, timedOut: false });
        return;
      }
      if (!current) {
        elapsed += STEP;
        if (elapsed >= timeoutMs) setState((s) => (s.timedOut ? s : { el: null, timedOut: true }));
      }
    }, STEP);
    return () => clearInterval(id);
  }, [playerRef, timeoutMs]);
  return state;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/useResolvedMediaEl.test.js`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/useResolvedMediaEl.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/useResolvedMediaEl.test.js
git commit -m "fix(piano): re-resolve the media element on identity change so playing stays accurate"
```

---

### Task 2: `usePauseMediaOnUnmount` — guaranteed stop

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePauseMediaOnUnmount.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePauseMediaOnUnmount.test.jsx`

**Interfaces:**
- Produces: `usePauseMediaOnUnmount(mediaEl) -> void` — tracks the latest `mediaEl` and calls `.pause()` on it when the component unmounts (guarded try/catch). Pauses whatever element is live at unmount, so a route-away always silences audio even for a detached native `<video>`.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import usePauseMediaOnUnmount from './usePauseMediaOnUnmount.js';

function Probe({ el }) { usePauseMediaOnUnmount(el); return null; }

describe('usePauseMediaOnUnmount', () => {
  it('pauses the media element on unmount', () => {
    const el = { pause: vi.fn() };
    const { unmount } = render(<Probe el={el} />);
    expect(el.pause).not.toHaveBeenCalled();
    unmount();
    expect(el.pause).toHaveBeenCalledTimes(1);
  });

  it('pauses the LATEST element after it changed (not the stale one)', () => {
    const a = { pause: vi.fn() }; const b = { pause: vi.fn() };
    const { rerender, unmount } = render(<Probe el={a} />);
    rerender(<Probe el={b} />);
    unmount();
    expect(b.pause).toHaveBeenCalledTimes(1);
    expect(a.pause).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no element', () => {
    const { unmount } = render(<Probe el={null} />);
    expect(() => unmount()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/usePauseMediaOnUnmount.test.jsx`
Expected: FAIL — cannot resolve `./usePauseMediaOnUnmount.js`.

- [ ] **Step 3: Implement**

```js
// usePauseMediaOnUnmount.js
import { useEffect, useRef } from 'react';

/**
 * Guarantees the media stops when the piano video player leaves the screen.
 * The shared engine's unmount cleanup only pauses shadow-DOM <dash-video>; a
 * native <video> (file-served lecture) is never paused, and a DOM-detached
 * HTMLMediaElement keeps emitting audio. We hold the latest resolved element and
 * pause it on unmount — belt-and-suspenders, element-type agnostic.
 */
export default function usePauseMediaOnUnmount(mediaEl) {
  const ref = useRef(mediaEl);
  useEffect(() => { ref.current = mediaEl; }, [mediaEl]);
  useEffect(() => () => { try { ref.current?.pause?.(); } catch { /* detached/gone */ } }, []);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/usePauseMediaOnUnmount.test.jsx`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePauseMediaOnUnmount.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePauseMediaOnUnmount.test.jsx
git commit -m "fix(piano): usePauseMediaOnUnmount — always stop media when the player unmounts"
```

---

### Task 3: `PianoVideoChrome` — Fullscreen button + ±30 skips

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/icons/svg/fullscreen.svg`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx` (extend)

**Interfaces:**
- Consumes: existing `onSkip(delta)`, `onToggle`, `gateOpen`, `forwardDisabled` logic; NEW prop `onToggleFullscreen` (function). Uses icons `skip-back-30`/`skip-forward-30` (exist) and new `fullscreen`.
- Produces: chrome renders Back-30 and Forward-30 buttons flanking the existing ±15, and a Fullscreen button; forward skips respect `forwardDisabled`.

- [ ] **Step 1: Write the failing test (extend `PianoVideoChrome.test.jsx`)**

Add these cases inside the existing describe block (they follow the file's existing render pattern — reuse its helper/props). If the file renders via a local `renderChrome(props)` helper, use it; otherwise render `<PianoVideoChrome {...baseProps} onSkip={onSkip} onToggleFullscreen={onFs} />` with the same base props the existing tests use:

```jsx
  it('skips −30 and +30 via the new buttons', () => {
    const onSkip = vi.fn();
    render(<PianoVideoChrome {...base} onSkip={onSkip} />);
    fireEvent.click(screen.getByLabelText('Back 30 seconds'));
    expect(onSkip).toHaveBeenCalledWith(-30);
    fireEvent.click(screen.getByLabelText('Forward 30 seconds'));
    expect(onSkip).toHaveBeenCalledWith(30);
  });

  it('fires onToggleFullscreen from the fullscreen button', () => {
    const onFs = vi.fn();
    render(<PianoVideoChrome {...base} onToggleFullscreen={onFs} />);
    fireEvent.click(screen.getByLabelText('Toggle fullscreen'));
    expect(onFs).toHaveBeenCalled();
  });

  it('disables forward skips (both +15 and +30) when forwardDisabled applies (sequential at furthest)', () => {
    render(<PianoVideoChrome {...base} isSequential currentTime={100} furthestWatched={100} />);
    expect(screen.getByLabelText('Forward 15 seconds').disabled).toBe(true);
    expect(screen.getByLabelText('Forward 30 seconds').disabled).toBe(true);
  });
```

> First read the top of `PianoVideoChrome.test.jsx` to reuse its existing base-props object / render helper (it already has 21 tests). Name the base props object exactly as that file does (e.g. `base`), or inline the props the other tests use. Do not invent a helper that doesn't exist.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`
Expected: FAIL — no Back/Forward-30 or fullscreen buttons yet.

- [ ] **Step 3a: Add the fullscreen icon**

Create `frontend/src/modules/Piano/PianoKiosk/icons/svg/fullscreen.svg` with exactly:

```svg
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2 7V2H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M22 7V2H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M7 22L2 22L2 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17 22L22 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

- [ ] **Step 3b: Add the props + buttons in `PianoVideoChrome.jsx`**

Add `onToggleFullscreen` to the destructured props (after `onSeek,`):

```js
  onToggle, onSkip, onRestart, onCycleRate, onMarkA, onMarkB, onToggleLoop, onClearLoop, onSeek, onToggleFullscreen,
```

Replace the existing skip/play cluster (the three buttons at `PianoVideoChrome.jsx:52-54`) with the ±30/±15 set:

```jsx
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-30)} disabled={gateOpen} aria-label="Back 30 seconds"><Icon name="skip-back-30" /></button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-15)} disabled={gateOpen} aria-label="Back 15 seconds"><Icon name="skip-back-15" /></button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--play" onClick={onToggle} disabled={gateOpen} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Icon name="pause" /> : <Icon name="play" />}</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(15)} disabled={gateOpen || forwardDisabled} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /></button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(30)} disabled={gateOpen || forwardDisabled} aria-label="Forward 30 seconds"><Icon name="skip-forward-30" /></button>
```

Add a Fullscreen button at the end of the row, immediately before the closing `</div>` of `piano-video-chrome__row` (after the mix-wrap block at `:78`):

```jsx
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--fullscreen" onClick={onToggleFullscreen} disabled={gateOpen} aria-label="Toggle fullscreen"><Icon name="fullscreen" /></button>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`
Expected: PASS — the 21 existing tests plus the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/icons/svg/fullscreen.svg frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
git commit -m "feat(piano): chrome gains a fullscreen button and ±30s skips"
```

---

### Task 4: `PausedLoopOverlay` — the on-video loop cluster

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PausedLoopOverlay.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (append)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PausedLoopOverlay.test.jsx`

**Interfaces:**
- Consumes: `Icon` (`../../icons/Icon.jsx`).
- Produces: `default PausedLoopOverlay({ onSkip, onResume, forwardDisabled = false })` — a dimmed backdrop (clicking it calls `onResume`) holding a centered cluster `−30 · −15 · ▶ · +15 · +30`; the skip buttons call `onSkip(delta)` and stop propagation (so they don't also resume); forward buttons respect `forwardDisabled`.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PausedLoopOverlay from './PausedLoopOverlay.jsx';

describe('PausedLoopOverlay', () => {
  it('renders the loop cluster and fires skips without resuming', () => {
    const onSkip = vi.fn(); const onResume = vi.fn();
    render(<PausedLoopOverlay onSkip={onSkip} onResume={onResume} />);
    fireEvent.click(screen.getByLabelText('Back 30 seconds'));
    fireEvent.click(screen.getByLabelText('Back 15 seconds'));
    fireEvent.click(screen.getByLabelText('Forward 15 seconds'));
    fireEvent.click(screen.getByLabelText('Forward 30 seconds'));
    expect(onSkip.mock.calls.map((c) => c[0])).toEqual([-30, -15, 15, 30]);
    expect(onResume).not.toHaveBeenCalled();
  });

  it('resumes on the play button and on a backdrop tap', () => {
    const onResume = vi.fn();
    const { container } = render(<PausedLoopOverlay onSkip={vi.fn()} onResume={onResume} />);
    fireEvent.click(screen.getByLabelText('Resume'));
    fireEvent.click(container.querySelector('.piano-loop-overlay'));
    expect(onResume).toHaveBeenCalledTimes(2);
  });

  it('disables forward skips when forwardDisabled', () => {
    render(<PausedLoopOverlay onSkip={vi.fn()} onResume={vi.fn()} forwardDisabled />);
    expect(screen.getByLabelText('Forward 15 seconds').disabled).toBe(true);
    expect(screen.getByLabelText('Forward 30 seconds').disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/PausedLoopOverlay.test.jsx`
Expected: FAIL — cannot resolve `./PausedLoopOverlay.jsx`.

- [ ] **Step 3a: Implement `PausedLoopOverlay.jsx`**

```jsx
import Icon from '../../icons/Icon.jsx';

/**
 * Shown over the dimmed video while paused. Loop-first: big −30/−15/▶/+15/+30
 * targets for re-hearing a passage. Tapping the backdrop (or ▶) resumes; the
 * skip buttons stop propagation so they don't also resume.
 */
export default function PausedLoopOverlay({ onSkip, onResume, forwardDisabled = false }) {
  const skip = (delta) => (e) => { e.stopPropagation(); onSkip(delta); };
  const resume = (e) => { e.stopPropagation(); onResume(); };
  return (
    <div className="piano-loop-overlay" onClick={onResume}>
      <div className="piano-loop-overlay__cluster" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="piano-loop-overlay__btn" onClick={skip(-30)} aria-label="Back 30 seconds"><Icon name="skip-back-30" /></button>
        <button type="button" className="piano-loop-overlay__btn" onClick={skip(-15)} aria-label="Back 15 seconds"><Icon name="skip-back-15" /></button>
        <button type="button" className="piano-loop-overlay__btn piano-loop-overlay__btn--resume" onClick={resume} aria-label="Resume"><Icon name="play" /></button>
        <button type="button" className="piano-loop-overlay__btn" onClick={skip(15)} disabled={forwardDisabled} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /></button>
        <button type="button" className="piano-loop-overlay__btn" onClick={skip(30)} disabled={forwardDisabled} aria-label="Forward 30 seconds"><Icon name="skip-forward-30" /></button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3b: Append CSS to `PianoApp.scss`**

```scss
/* ── Piano video: paused loop overlay ─────────────────────────────────────── */
.piano-loop-overlay{
  position:absolute; inset:0; z-index:40; display:flex; align-items:center; justify-content:center;
  background:rgba(10,8,6,.55); cursor:pointer;
}
.piano-loop-overlay__cluster{
  display:flex; align-items:center; gap:1rem; cursor:default;
  padding:1rem 1.25rem; border-radius:2rem; background:rgba(20,18,16,.72);
  box-shadow:0 12px 40px -12px rgba(0,0,0,.7);
}
.piano-loop-overlay__btn{
  display:grid; place-items:center; width:3.4rem; height:3.4rem; border-radius:50%;
  border:1px solid var(--piano-border); background:var(--piano-surface-2); color:var(--piano-fg);
  font-size:1.2rem; cursor:pointer;
}
.piano-loop-overlay__btn:hover:not(:disabled),.piano-loop-overlay__btn:focus-visible{border-color:var(--piano-muted);}
.piano-loop-overlay__btn:disabled{opacity:.4; cursor:default;}
.piano-loop-overlay__btn--resume{
  width:4.4rem; height:4.4rem; background:var(--piano-accent); color:var(--piano-accent-ink); border-color:transparent; font-size:1.6rem;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/PausedLoopOverlay.test.jsx`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PausedLoopOverlay.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/PausedLoopOverlay.test.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): PausedLoopOverlay — on-video −30/−15/▶/+15/+30 loop cluster"
```

---

### Task 5: Wire it into `PianoVideoPlayer` (tap=pause, fullscreen button, overlay, guaranteed stop)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`

**Interfaces:**
- Consumes: `usePauseMediaOnUnmount` (Task 2), `PausedLoopOverlay` (Task 4), existing `ctrl.toggle`/`handleSkip`/`toggleFullscreen`, `PianoVideoChrome` `onToggleFullscreen` (Task 3), `useResolvedMediaEl` (Task 1, already imported).
- Produces: the wired player — video tap toggles play/pause; fullscreen is a chrome button; the paused overlay shows when paused; media is guaranteed to stop on unmount.

- [ ] **Step 1: Add the imports**

In `PianoVideoPlayer.jsx`, after the existing `import PianoVideoChrome ...` and `import useResolvedMediaEl ...` lines (around lines 12-13), add:

```js
import PausedLoopOverlay from './PausedLoopOverlay.jsx';
import usePauseMediaOnUnmount from './usePauseMediaOnUnmount.js';
```

- [ ] **Step 2: Guarantee stop on unmount**

Immediately after the `const { el: mediaEl, timedOut } = useResolvedMediaEl(playerRef);` line (line 32), add:

```js
  usePauseMediaOnUnmount(mediaEl);
```

- [ ] **Step 3: Tap the video toggles play/pause (not fullscreen)**

Change the video wrapper's `onClick` at `PianoVideoPlayer.jsx:212` from `onClick={toggleFullscreen}` to `onClick={ctrl.toggle}`:

```jsx
          <div className="piano-video-player__video" ref={videoWrapRef} onClick={ctrl.toggle} style={{ position: 'relative' }}>
            {playerEl}
            {gateOpen && <EngagementGate open={gateOpen} onDismiss={dismissGate} />}
            {!isPlaying && !gateOpen && mediaEl && (
              <PausedLoopOverlay onSkip={handleSkip} onResume={ctrl.toggle} forwardDisabled={false} />
            )}
          </div>
```

(`toggleFullscreen` stays defined — it moves to the chrome button in the next step.)

- [ ] **Step 4: Pass fullscreen to the chrome**

In the `<PianoVideoChrome ... />` block (starts `PianoVideoPlayer.jsx:217`), add the prop alongside the others (e.g. after `onSeek={ctrl.seek}`):

```jsx
            onSeek={ctrl.seek}
            onToggleFullscreen={toggleFullscreen}
```

- [ ] **Step 5: Verify — whole Videos suite + build**

Run: `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos --exclude '**/.claire/**'`
Expected: PASS (all existing Videos tests + the new Task 1-4 tests; no regressions).

Run: `npx vite build`
Expected: build succeeds.

Manual (on-device, DEPLOY HELD for KC's word): play a lecture → tap video pauses and shows the loop cluster → −15/−30 loop a passage → fullscreen via the chrome button → sleep/wake the kiosk screen and return to menu → confirm audio stops and never strands.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx
git commit -m "feat(piano): tap=play/pause, fullscreen button, paused loop overlay, guaranteed stop on unmount"
```

---

## Self-Review

**Spec coverage:**
- Tap = play/pause → Task 5 (Step 3). Fullscreen demoted to a button → Task 3 (button) + Task 5 (Step 4 wiring). ✓
- Paused overlay cluster −30/−15/▶/+15/+30 → Task 4 + Task 5 (Step 3 render-when-paused). ✓
- Skip set −30/−15/+15/+30 in chrome → Task 3. ✓
- Guaranteed stop: unmount pause → Task 2 + Task 5 (Step 2); accurate `playing` via element re-resolve → Task 1. ✓
- Piano-path only, no shared-engine change → confirmed (no `modules/Player/*` edits). ✓
- Sequential forward-lock applies to +15/+30 → Task 3 (`forwardDisabled`). (Overlay passes `forwardDisabled={false}` — the overlay is a paused-only loop aid; if sequential forward-lock should also gate the overlay's forward buttons, thread `forwardDisabled` from the chrome's computation; the chrome already enforces it on the bar.) ✓ (documented choice)

**Placeholder scan:** no TBD/TODO; every code step shows complete code. Task 3 Step 1 references the existing test's base-props (an explicit read-first instruction, not invented). Task 5 integration is verified by suite + build + explicit manual steps (PianoVideoPlayer is too context-heavy to unit-mount; the risky logic is unit-tested in Tasks 1/2/4).

**Type consistency:** `useResolvedMediaEl(playerRef, timeoutMs) -> {el,timedOut}` unchanged; `usePauseMediaOnUnmount(mediaEl)`; `PausedLoopOverlay({onSkip,onResume,forwardDisabled})`; `PianoVideoChrome` new prop `onToggleFullscreen`; all match Task 5's usage. `onSkip(delta)`/`handleSkip(delta)` and the icon names (`skip-back-30`/`skip-back-15`/`play`/`pause`/`skip-forward-15`/`skip-forward-30`/`fullscreen`) are consistent and confirmed to exist (fullscreen added in Task 3).
