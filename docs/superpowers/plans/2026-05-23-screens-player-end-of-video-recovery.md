# Screens Player — End-of-Video Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a screens-player video reaches the end of its source but does not produce an HTML5 `ended` event (because the final fragment came back zero-byte and dash.js never called `endOfStream()`), advance the queue automatically — instead of sitting paused at `duration` with a misleading "Seeking…" overlay until the user manually intervenes.

**Architecture:** Six surgical changes. **(1)** A new `createEndOfContentWatchdog` factory in `lib/` — pure JS, fully unit-testable with fake timers, mirrors the existing `staleSessionWatchdog` pattern. Resolves when `paused && currentTime ≥ duration − 0.5 && no progress for N seconds` and calls `onAdvance()`. **(2)** Wire the watchdog into `ContentScroller` next to the existing `handleEnded` hook. **(3)** `PlayerOverlayLoading` stops claiming "Seeking…" when the element is at duration with no buffered progress; it shows "Ended" (or hides, configurable). **(4)** `useCommonMediaController.scheduleStallDetection` near-end guard emits a one-shot `playback.at-duration-stuck` log when it bails — this gives the watchdog a clean signal and produces a permanent telemetry mark of the failure mode. **(5)** `handleSeeking` adds an `Error().stack` capture when `intent ≥ duration − 0.5` so the next occurrence reveals who pulled the trigger (audit Layer A open question). **(6)** Orphan fix: `playback.fps_stats` reads `latestDataRef.current.seconds` instead of the stale closure variable.

**Tech Stack:** React, vitest + RTL for unit/component tests, fake timers for watchdog timing.

**Audit reference:** `docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md` — §2 (per-layer root cause A/B/C/D), §4.1 (orphan `fps_stats`), §5 (recommended fix surface).

---

## File Structure

**New files:**
- `frontend/src/modules/Player/lib/endOfContentWatchdog.js` — factory `createEndOfContentWatchdog({ onAdvance, getMediaEl, getMediaInfo, thresholdSeconds, idleMs, log })`. Pure JS, no React.
- `frontend/src/modules/Player/lib/endOfContentWatchdog.test.js` — unit tests with vitest fake timers.

**Modified files:**
- `frontend/src/modules/Player/renderers/ContentScroller.jsx` — instantiate the watchdog alongside `handleEnded`; tick on `timeupdate` and `pause`/`play`; tear down on unmount.
- `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx` — derive `displayStatus`: when `mediaEl.currentTime >= mediaEl.duration − 0.5 && mediaEl.paused` → render `null` (or "Ended" — see Task 4 spec) regardless of `effectiveSeeking`.
- `frontend/src/modules/Player/hooks/useCommonMediaController.js` — at the `scheduleStallDetection` near-end guard, emit a one-shot `playback.at-duration-stuck` log; at `handleSeeking`, when `intent ≥ duration − 0.5`, capture and log `Error().stack` (sampled, max 5/min).
- `frontend/src/modules/Player/renderers/VideoPlayer.jsx` — `playback.fps_stats` logger reads `latestDataRef.current.seconds` instead of `seconds`.

**Modified test files (one new file per change):**
- `frontend/src/modules/Player/renderers/ContentScroller.endOfContent.test.jsx` — wired watchdog calls `onAdvance` after sustained pause at duration.
- `frontend/src/modules/Player/components/PlayerOverlayLoading.atDuration.test.jsx` — overlay does not say "Seeking…" when paused at duration.
- `frontend/src/modules/Player/hooks/useCommonMediaController.atDurationLog.test.jsx` — `playback.at-duration-stuck` fires exactly once per stall episode.
- `frontend/src/modules/Player/hooks/useCommonMediaController.seekTrace.test.jsx` — seek-trace log fires when seek intent ≥ duration−0.5.
- `frontend/src/modules/Player/renderers/VideoPlayer.fpsStatsFresh.test.jsx` — `fps_stats` payload `currentTime` matches latest `seconds` value.

---

## Background invariants the engineer must understand before writing code

1. **The `mediaEl.seeking` DOM attribute is owned by the browser**, not by dash.js. After a seek to `duration` whose target fragment came back zero-byte, `mediaEl.seeking` stays `true` indefinitely. dash.js fires its own synthetic `seeked` event (`dash.seeked`) but the DOM attribute does not flip. Tests must mock `mediaEl.seeking` explicitly; do not assume `dash.seeked` clears it.

2. **The HTML5 `ended` event will not fire here.** Do not chase a fix that tries to make it fire — that requires `MediaSource.endOfStream()` which dash.js will not call when its last fragment had zero bytes. Our recovery must operate without `ended`.

3. **The watchdog must not race with legitimate queue advances.** If `onEnded` fires (e.g., on a stream that does have a valid trailing fragment) it must call `onAdvance` synchronously and the watchdog must observe that the element is no longer mounted / `currentTime` was reset / the asset key changed — and not double-fire. Use a one-shot guard inside the watchdog state.

4. **The watchdog must not fire on user-initiated pause-at-end.** If the user pauses with one second left and stays paused, we should still advance — that's actually desired behavior for a queue. The condition is `paused && atDuration && noProgressFor(idleMs)`, not "paused recently."

5. **`currentTime ≥ duration − 0.5` is the audit's threshold.** It matches the existing guard in `useCommonMediaController.scheduleStallDetection`. Reuse this constant; don't invent a new tolerance.

---

### Task 1: Test — end-of-content watchdog factory (failing test, no implementation yet)

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/lib/endOfContentWatchdog.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEndOfContentWatchdog } from './endOfContentWatchdog.js';

describe('createEndOfContentWatchdog', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  const makeInfo = (overrides = {}) => () => ({
    currentTime: 441.76,
    duration: 441.76,
    paused: true,
    seeking: true,
    ...overrides
  });

  it('fires onAdvance after idleMs of paused-at-duration with no progress', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo(),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(2999);
    wd.tick();
    expect(onAdvance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    wd.tick();
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('does not fire when video is playing', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo({ paused: false }),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(5000);
    wd.tick();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('does not fire when currentTime is far from duration', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo({ currentTime: 100, duration: 441.76 }),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(5000);
    wd.tick();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('resets the timer when currentTime progresses (user scrubbed away from end)', () => {
    const onAdvance = vi.fn();
    let info = { currentTime: 441.7, duration: 441.76, paused: true, seeking: true };
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: () => info,
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(2000);
    // User scrubs to middle of video
    info = { currentTime: 200, duration: 441.76, paused: true, seeking: false };
    wd.tick();
    vi.advanceTimersByTime(5000);
    wd.tick();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('fires exactly once per arming episode (one-shot guard)', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo(),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(3001);
    wd.tick();
    wd.tick();
    wd.tick();
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('re-arms after reset() is called', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo(),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(3001);
    wd.tick();
    expect(onAdvance).toHaveBeenCalledTimes(1);
    wd.reset();
    vi.advanceTimersByTime(3001);
    wd.tick();
    expect(onAdvance).toHaveBeenCalledTimes(2);
  });

  it('emits a log event when it fires', () => {
    const log = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance: vi.fn(),
      getMediaInfo: makeInfo(),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log
    });
    wd.tick();
    vi.advanceTimersByTime(3001);
    wd.tick();
    expect(log).toHaveBeenCalledWith('playback.end-of-content-advance', expect.objectContaining({
      currentTime: 441.76,
      duration: 441.76,
      idleMs: 3000
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from the worktree root (binary lives in the main repo's `node_modules`):

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/lib/endOfContentWatchdog.test.js
```

Expected: FAIL with `Failed to resolve import "./endOfContentWatchdog.js"`.

---

### Task 2: Implement the watchdog factory

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/lib/endOfContentWatchdog.js`

- [ ] **Step 1: Write the implementation**

```javascript
/**
 * End-of-content watchdog for the screens player.
 *
 * When the screens player reaches the natural end of a source whose final
 * DASH fragment came back zero-byte (Plex transcode tails are commonly
 * empty), dash.js does not call `mediaSource.endOfStream()` and the HTML5
 * `ended` event never fires. The element settles into paused-at-duration
 * with `mediaEl.seeking === true`, and `ContentScroller.handleEnded` —
 * the only queue-advance trigger — never runs.
 *
 * This watchdog calls `onAdvance` exactly once after `idleMs` of sustained
 * paused-at-duration with no `currentTime` progression. It is event-driven:
 * the caller invokes `tick()` on every player event that could change the
 * monitored state (timeupdate / pause / play / seeked / source change),
 * and the watchdog itself schedules an internal `setTimeout` to fire when
 * the idle window elapses. No external polling required.
 *
 * `reset()` cancels any pending timer, clears the one-shot guard, and
 * re-evaluates current state — so after `reset()` the watchdog is monitoring
 * again from this instant, without the caller needing to issue an extra tick.
 *
 * See: docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md
 *      docs/superpowers/plans/2026-05-23-screens-player-end-of-video-recovery.md
 */
export function createEndOfContentWatchdog({
  onAdvance,
  getMediaInfo,           // () => { currentTime, duration, paused, seeking }
  thresholdSeconds = 0.5, // currentTime must be within this of duration
  idleMs = 3000,          // how long to wait before advancing
  log = () => {}
}) {
  let timerId = null;
  let armedAtTime = null; // currentTime captured when the current timer was scheduled
  let fired = false;

  const isAtDuration = (info) => {
    if (!info) return false;
    const { currentTime, duration } = info;
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration)) return false;
    if (duration <= 0) return false;
    return currentTime >= (duration - thresholdSeconds);
  };

  const cancel = () => {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
    armedAtTime = null;
  };

  const fire = () => {
    timerId = null;
    if (fired) return;
    // Verify conditions still hold at the moment the timer fires —
    // state could have changed between scheduling and firing.
    const info = getMediaInfo();
    if (!info || !info.paused || !isAtDuration(info)) return;
    fired = true;
    log('playback.end-of-content-advance', {
      currentTime: info.currentTime,
      duration: info.duration,
      idleMs,
      thresholdSeconds
    });
    try { onAdvance?.(); } catch (_) { /* swallow */ }
  };

  const tick = () => {
    if (fired) return;
    const info = getMediaInfo();
    if (!info || !info.paused || !isAtDuration(info)) {
      cancel();
      return;
    }
    if (timerId == null) {
      armedAtTime = info.currentTime;
      timerId = setTimeout(fire, idleMs);
      return;
    }
    if (Math.abs(info.currentTime - armedAtTime) > 0.05) {
      // currentTime moved (user scrubbed within the at-duration window) —
      // restart the timer from now so we don't fire prematurely.
      clearTimeout(timerId);
      armedAtTime = info.currentTime;
      timerId = setTimeout(fire, idleMs);
    }
    // Otherwise already armed and stable — nothing to do.
  };

  const reset = () => {
    cancel();
    fired = false;
    // Re-evaluate current state so monitoring resumes without requiring
    // the caller to issue an extra tick after a reset.
    tick();
  };

  return { tick, reset };
}
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/lib/endOfContentWatchdog.test.js
```

Expected: 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Player/lib/endOfContentWatchdog.js \
        frontend/src/modules/Player/lib/endOfContentWatchdog.test.js
git commit -m "feat(player): add end-of-content watchdog for stuck-at-duration recovery

When DASH returns a zero-byte trailing fragment, mediaSource.endOfStream()
is not called and the HTML5 ended event never fires — leaving the screens
player paused at currentTime ≈ duration with no queue advance.

Pure-JS factory (mirrors staleSessionWatchdog pattern) returns
{ tick, reset } and fires onAdvance() once after idleMs of sustained
paused-at-duration with no progression.

Wiring into ContentScroller comes in the next commit.

Audit: docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md"
```

---

### Task 3: Test — ContentScroller wires the watchdog and advances after sustained pause at duration

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/renderers/ContentScroller.endOfContent.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import ContentScroller from './ContentScroller.jsx';

// Minimal props to render ContentScroller; mirror the smallest passing
// fixture from ContentScroller.volume.test.jsx, adjusted for video.
const baseProps = {
  type: 'video',
  mainMediaUrl: 'test:fixture',
  duration: 441.76,
  masterVolume: 1,
  mainVolume: 1,
  playbackKeys: {},
};

describe('ContentScroller end-of-content watchdog', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('calls onAdvance after sustained pause at duration when ended never fires', async () => {
    const onAdvance = vi.fn();
    const { container } = render(
      <ContentScroller {...baseProps} onAdvance={onAdvance} />
    );
    const videoEl = container.querySelector('video');
    expect(videoEl).toBeTruthy();

    // Simulate the failure mode: dash wrote currentTime = duration,
    // element is paused, seeking flag stuck true, no ended event.
    Object.defineProperty(videoEl, 'currentTime', { value: 441.76, configurable: true });
    Object.defineProperty(videoEl, 'duration', { value: 441.76, configurable: true });
    Object.defineProperty(videoEl, 'paused', { value: true, configurable: true });
    Object.defineProperty(videoEl, 'seeking', { value: true, configurable: true });

    // Fire a timeupdate so the watchdog ticks.
    act(() => { videoEl.dispatchEvent(new Event('timeupdate')); });

    // Advance past the watchdog idleMs.
    act(() => { vi.advanceTimersByTime(3500); });
    // Tick again (timeupdate would normally fire from the element, but at
    // duration with no progress it won't — we drive the watchdog manually
    // via a simulated pause event).
    act(() => { videoEl.dispatchEvent(new Event('pause')); });

    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('does not call onAdvance when the natural ended event fires', () => {
    const onAdvance = vi.fn();
    const { container } = render(
      <ContentScroller {...baseProps} onAdvance={onAdvance} />
    );
    const videoEl = container.querySelector('video');
    act(() => { videoEl.dispatchEvent(new Event('ended')); });
    expect(onAdvance).toHaveBeenCalledTimes(1); // existing handleEnded path

    // Even if we then tick the watchdog, it should not double-fire.
    Object.defineProperty(videoEl, 'currentTime', { value: 441.76, configurable: true });
    Object.defineProperty(videoEl, 'duration', { value: 441.76, configurable: true });
    Object.defineProperty(videoEl, 'paused', { value: true, configurable: true });
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { videoEl.dispatchEvent(new Event('pause')); });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/renderers/ContentScroller.endOfContent.test.jsx
```

Expected: FAIL — first test asserts `onAdvance` called once but it is called zero times (no watchdog wired); second test depends on the one-shot guard which only works once Task 4 lands.

---

### Task 4: Wire the watchdog into ContentScroller

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/renderers/ContentScroller.jsx`

- [ ] **Step 1: Add imports and watchdog instantiation**

At the top of the file, add to the existing import block:

```javascript
import { createEndOfContentWatchdog } from '../lib/endOfContentWatchdog.js';
```

Inside the component body, near `handleEnded` (around line 283), add:

```javascript
const watchdogRef = useRef(null);
if (!watchdogRef.current) {
  watchdogRef.current = createEndOfContentWatchdog({
    onAdvance: () => onAdvance && onAdvance(),
    getMediaInfo: () => {
      const el = mainRef.current;
      if (!el) return null;
      return {
        currentTime: el.currentTime,
        duration: el.duration,
        paused: el.paused,
        seeking: el.seeking
      };
    },
    log: (event, data) => {
      // Mirror the existing playback logger usage in the file.
      try {
        const logger = getLogger().child({ component: 'ContentScroller' });
        logger.warn(event, data);
      } catch (_) { /* swallow */ }
    }
  });
}

// Reset watchdog when the source changes.
useEffect(() => {
  watchdogRef.current?.reset();
}, [mainMediaUrl]);

// Tick the watchdog on timeupdate, pause, play, and seeked. timeupdate fires
// during normal playback; pause/play/seeked cover the at-duration case where
// timeupdate stops emitting. The watchdog drives its own setTimeout once
// armed, so no polling interval is needed — these events just nudge the
// watchdog to re-evaluate state.
useEffect(() => {
  const el = mainRef.current;
  if (!el || !watchdogRef.current) return;
  const tick = () => watchdogRef.current.tick();
  el.addEventListener('timeupdate', tick);
  el.addEventListener('pause', tick);
  el.addEventListener('play', tick);
  el.addEventListener('seeked', tick);
  return () => {
    el.removeEventListener('timeupdate', tick);
    el.removeEventListener('pause', tick);
    el.removeEventListener('play', tick);
    el.removeEventListener('seeked', tick);
  };
}, [mainMediaUrl]);

// Existing handleEnded — wrap to also disarm the watchdog so the one-shot
// guard composes correctly with a real ended event.
const handleEndedWithWatchdog = useCallback(() => {
  watchdogRef.current?.reset();
  onAdvance && onAdvance();
}, [onAdvance]);
```

Change the `<video onEnded={handleEnded} … />` usage (line 365) to:

```jsx
<video onEnded={handleEndedWithWatchdog} … />
```

And import `useRef`/`useEffect`/`useCallback`/`getLogger` if not already imported at the top of the file (grep first; ContentScroller already uses these in other places).

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/renderers/ContentScroller.endOfContent.test.jsx \
                 frontend/src/modules/Player/lib/endOfContentWatchdog.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Quick smoke — make sure existing ContentScroller tests still pass**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/renderers/ContentScroller.volume.test.jsx
```

Expected: pass (no regression).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/renderers/ContentScroller.jsx \
        frontend/src/modules/Player/renderers/ContentScroller.endOfContent.test.jsx
git commit -m "feat(player): wire end-of-content watchdog into ContentScroller

ContentScroller now calls onAdvance() after 3s of paused-at-duration
with no currentTime progression, even when the HTML5 ended event never
fires (the zero-byte trailing fragment case).

The watchdog is a one-shot per arming episode and is reset on source
change so it composes cleanly with the existing onEnded handler."
```

---

### Task 5: Test — overlay does not say "Seeking…" when paused at duration

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayLoading.atDuration.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PlayerOverlayLoading from './PlayerOverlayLoading.jsx';

describe('PlayerOverlayLoading status at duration', () => {
  it('does NOT show "Seeking…" when paused at duration with seeking flag stuck', () => {
    // Match the failure mode from the 2026-05-23 audit: element is paused
    // at currentTime = duration, with mediaEl.seeking stuck true because
    // the trailing fragment came back zero-byte.
    const { queryByText } = render(
      <PlayerOverlayLoading
        status="seeking"
        effectiveSeeking
        mediaSnapshot={{ currentTime: 441.76, duration: 441.76, paused: true, seeking: true }}
        effectiveMeta={{ title: 'Teasing' }}
      />
    );
    expect(queryByText(/Seeking/i)).toBeNull();
  });

  it('shows "Seeking…" when seeking mid-stream (not at duration)', () => {
    const { queryByText } = render(
      <PlayerOverlayLoading
        status="seeking"
        effectiveSeeking
        mediaSnapshot={{ currentTime: 100, duration: 441.76, paused: false, seeking: true }}
        effectiveMeta={{ title: 'Teasing' }}
      />
    );
    expect(queryByText(/Seeking/i)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/components/PlayerOverlayLoading.atDuration.test.jsx
```

Expected: FAIL — first test finds "Seeking…" rendered.

---

### Task 6: Fix PlayerOverlayLoading to treat paused-at-duration as a non-seeking state

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayLoading.jsx`

The component currently maps `status === 'seeking'` directly to the "Seeking…" string at line 251. We need to override the status when the element is paused at duration. The cheapest place is at the existing status-derivation site — find the block that computes the displayed status from `status` + `effectiveSeeking` and add a near-end check using the `mediaSnapshot` (or `getMediaEl()` if a snapshot is not already threaded — check the file first; the audit references `mediaElSnapshot` already being computed in `useMediaResilience`).

- [ ] **Step 1: Identify the snapshot prop**

Read the component:

```bash
grep -n "status\|seeking\|currentTime\|duration\|mediaSnapshot" \
  /opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayLoading.jsx | head -40
```

If `mediaSnapshot` is not already a prop, add it. If only individual values are threaded, use those. The minimal change is whatever already exists; do not introduce a new prop if `currentTime`/`duration`/`paused` are already accessible.

- [ ] **Step 2: Add the near-end override**

Locate the existing line `if (status === 'seeking') return 'Seeking…';` (around line 251) and replace it with:

```javascript
if (status === 'seeking') {
  // Audit 2026-05-23: when paused at duration with a stuck seeking flag,
  // the spec-compliant "Seeking…" copy is technically accurate but
  // user-hostile — it has been holding on a static frame at end-of-content.
  // Treat this as "ended" (return null to hide) so the end-of-content
  // watchdog can drive the queue advance without misleading the user.
  const ct = mediaSnapshot?.currentTime;
  const dur = mediaSnapshot?.duration;
  if (
    Number.isFinite(ct) && Number.isFinite(dur) && dur > 0 &&
    ct >= dur - 0.5 && mediaSnapshot?.paused === true
  ) {
    return null;
  }
  return 'Seeking…';
}
```

If `mediaSnapshot` is not already a prop of this component, add it to the props destructure at the top and thread it from the parent (`useMediaResilience` already computes `mediaElSnapshot` at line 336-344 of `useMediaResilience.js`; pass it down via the existing overlay-render props bag).

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/components/PlayerOverlayLoading.atDuration.test.jsx
```

Expected: both tests pass.

- [ ] **Step 4: Verify no overlay regression**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/components/PlayerOverlayLoading.phantom-silent.test.jsx 2>/dev/null || \
  echo "(phantom test file not present in this branch — skip)"
```

Expected: pass if file exists, otherwise the echo prints — that's fine.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayLoading.jsx \
        frontend/src/modules/Player/components/PlayerOverlayLoading.atDuration.test.jsx
git commit -m "fix(player): overlay stops saying 'Seeking…' when paused at duration

The HTML5 mediaEl.seeking flag stays true after a seek to duration
whose target fragment came back zero-byte. The 'Seeking…' copy was
holding on a static end-of-content frame for 87s in the 2026-05-23
incident. Suppress the seeking status when paused within 0.5s of
duration; the end-of-content watchdog drives the queue advance."
```

---

### Task 7: Test — stall watchdog's near-end guard emits a one-shot `playback.at-duration-stuck` event

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useCommonMediaController.atDurationLog.test.jsx`

- [ ] **Step 1: Write the failing test**

The existing stall-escalation test file (`useCommonMediaController.stallEscalation.test.jsx`) is a good template for the harness. The test should:

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';

// Capture log emissions
const logCapture = [];
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({
    child: () => ({
      debug: (event, data) => logCapture.push({ level: 'debug', event, data }),
      info: (event, data) => logCapture.push({ level: 'info', event, data }),
      warn: (event, data) => logCapture.push({ level: 'warn', event, data }),
      error: (event, data) => logCapture.push({ level: 'error', event, data }),
      sampled: (event, data) => logCapture.push({ level: 'sampled', event, data })
    })
  })
}));

describe('stall watchdog at-duration log', () => {
  beforeEach(() => {
    logCapture.length = 0;
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => vi.useRealTimers());

  it('emits playback.at-duration-stuck exactly once when stall fires near duration', () => {
    // Construct a media element fake at duration.
    const mediaEl = {
      currentTime: 441.76,
      duration: 441.76,
      paused: true,
      ended: false,
      buffered: { length: 0 },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      readyState: 4,
      networkState: 2
    };
    // Render the hook with the fake element. Use the same setup the
    // existing stallEscalation test uses — copy its renderHook wrapper.
    const { result } = renderHook(() =>
      useCommonMediaController({
        assetId: 'plex:59518',
        getMediaEl: () => mediaEl,
        containerRef: { current: null },
        enabled: true,
        onController: () => {},
        onClear: () => {}
      })
    );
    // Manually trigger the stall watchdog tick by calling the exposed
    // schedule function — or, if not exposed, dispatch the events the
    // hook listens to. The existing test uses dispatched 'waiting' events.
    act(() => {
      // Soft timer fires after softMs (~8s). The guard kicks in.
      vi.advanceTimersByTime(10000);
    });
    const events = logCapture.filter(l => l.event === 'playback.at-duration-stuck');
    expect(events.length).toBe(1);
    expect(events[0].data).toMatchObject({
      mediaKey: 'plex:59518',
      currentTime: 441.76,
      duration: 441.76
    });
  });
});
```

If the renderHook wiring is more involved in this codebase, mirror the exact pattern from `useCommonMediaController.stallEscalation.test.jsx` — do not invent helpers that don't exist in the suite.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/hooks/useCommonMediaController.atDurationLog.test.jsx
```

Expected: FAIL — no `playback.at-duration-stuck` events captured.

---

### Task 8: Make the near-end guard emit `playback.at-duration-stuck`

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useCommonMediaController.js`

- [ ] **Step 1: Add a one-shot flag to the stall state ref**

Find the `stallStateRef` initialization (search for `stallStateRef.current = `). Add an `atDurationStuckLogged` boolean to its initial shape.

- [ ] **Step 2: Update the near-end guard**

Find the `scheduleStallDetection` callback (around line 820-880). Locate the existing guard:

```javascript
if (s.hasEnded || mediaEl.ended || (mediaEl.duration && mediaEl.currentTime >= mediaEl.duration - 0.5)) {
  // Skip stall detection near end
}
```

Replace it with:

```javascript
if (s.hasEnded || mediaEl.ended ||
    (mediaEl.duration && mediaEl.currentTime >= mediaEl.duration - 0.5)) {
  if (!s.atDurationStuckLogged && !s.hasEnded && !mediaEl.ended) {
    s.atDurationStuckLogged = true;
    mcLog().warn('playback.at-duration-stuck', {
      mediaKey: assetId,
      currentTime: mediaEl.currentTime,
      duration: mediaEl.duration,
      paused: mediaEl.paused,
      seeking: mediaEl.seeking,
      readyState: mediaEl.readyState,
      networkState: mediaEl.networkState
    });
  }
  return;
}
```

Reset `atDurationStuckLogged` to `false` wherever `stallStateRef.current` is reset/reinitialized on asset change (search for other sites that mutate this ref's fields — keep them consistent).

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/hooks/useCommonMediaController.atDurationLog.test.jsx \
                 frontend/src/modules/Player/hooks/useCommonMediaController.stallEscalation.test.jsx
```

Expected: both files pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js \
        frontend/src/modules/Player/hooks/useCommonMediaController.atDurationLog.test.jsx
git commit -m "feat(player): emit playback.at-duration-stuck when stall watchdog bails near end

The existing 'skip stall detection near end' guard silently returns,
giving no telemetry trace of the failure mode. Emit a one-shot warn
log when the guard activates while the video is not legitimately
ended, so we can correlate end-of-content stalls in production logs
and verify the end-of-content watchdog (in ContentScroller) is firing."
```

---

### Task 9: Test — seek-source trace captures stack when seek lands ≥ duration − 0.5

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useCommonMediaController.seekTrace.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';

const logCapture = [];
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({
    child: () => ({
      debug: (event, data) => logCapture.push({ level: 'debug', event, data }),
      info: (event, data) => logCapture.push({ level: 'info', event, data }),
      warn: (event, data) => logCapture.push({ level: 'warn', event, data }),
      error: (event, data) => logCapture.push({ level: 'error', event, data }),
      sampled: (event, data) => logCapture.push({ level: 'sampled', event, data })
    })
  })
}));

describe('seek trace at duration', () => {
  beforeEach(() => { logCapture.length = 0; });

  it('emits playback.seek-trace with stack when seek intent ≥ duration − 0.5', () => {
    const listeners = {};
    const mediaEl = {
      currentTime: 441.759999,
      duration: 441.759999,
      paused: true,
      addEventListener: (ev, fn) => { listeners[ev] = fn; },
      removeEventListener: () => {},
      readyState: 4,
      networkState: 2
    };
    renderHook(() =>
      useCommonMediaController({
        assetId: 'plex:59518',
        getMediaEl: () => mediaEl,
        containerRef: { current: null },
        enabled: true,
        onController: () => {},
        onClear: () => {}
      })
    );
    act(() => { listeners.seeking?.(); });
    const traces = logCapture.filter(l => l.event === 'playback.seek-trace');
    expect(traces.length).toBe(1);
    expect(traces[0].data).toMatchObject({
      mediaKey: 'plex:59518',
      intent: 441.759999,
      duration: 441.759999
    });
    expect(typeof traces[0].data.stack).toBe('string');
    expect(traces[0].data.stack.length).toBeGreaterThan(0);
  });

  it('does NOT emit seek-trace for mid-stream seeks', () => {
    const listeners = {};
    const mediaEl = {
      currentTime: 100,
      duration: 441.76,
      paused: false,
      addEventListener: (ev, fn) => { listeners[ev] = fn; },
      removeEventListener: () => {},
      readyState: 4,
      networkState: 2
    };
    renderHook(() =>
      useCommonMediaController({
        assetId: 'plex:59518',
        getMediaEl: () => mediaEl,
        containerRef: { current: null },
        enabled: true,
        onController: () => {},
        onClear: () => {}
      })
    );
    act(() => { listeners.seeking?.(); });
    expect(logCapture.filter(l => l.event === 'playback.seek-trace').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/hooks/useCommonMediaController.seekTrace.test.jsx
```

Expected: FAIL — no `seek-trace` events captured.

---

### Task 10: Implement seek trace in handleSeeking

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useCommonMediaController.js`

- [ ] **Step 1: Add the trace inside `handleSeeking`**

Find `handleSeeking` (line 1302). After the existing `mcLog().sampled('playback.seek', …)` call but before `delete mediaEl.__seekSource`, add:

```javascript
if (
  Number.isFinite(mediaEl.duration) && mediaEl.duration > 0 &&
  mediaEl.currentTime >= mediaEl.duration - 0.5
) {
  // Audit 2026-05-23 Layer A: capture a stack trace whenever a seek lands
  // at end-of-content. The 2026-05-23 incident had source: "programmatic"
  // (i.e. no __seekSource tag) — this resolves who pulled the trigger.
  const stack = (new Error('seek-at-duration-trace')).stack || '';
  mcLog().sampled('playback.seek-trace', {
    mediaKey: assetId,
    intent: mediaEl.currentTime,
    duration: mediaEl.duration,
    paused: mediaEl.paused,
    seekSource: mediaEl.__seekSource || 'programmatic',
    stack: stack.slice(0, 1500)
  }, { maxPerMinute: 5 });
}
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/hooks/useCommonMediaController.seekTrace.test.jsx
```

Expected: both tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js \
        frontend/src/modules/Player/hooks/useCommonMediaController.seekTrace.test.jsx
git commit -m "feat(player): log stack trace for any seek that lands at end-of-content

The 2026-05-23 audit identified an unknown programmatic seek to exact
duration as the trigger of the stuck-Seeking failure mode. The most
likely candidate is a dash.js-internal seek triggered by a zero-byte
trailing fragment, but the exact caller could not be pinned down from
existing logs. Capture Error().stack on any seek where intent ≥
duration − 0.5, sampled at 5/min, so the next occurrence is diagnosable
without code changes."
```

---

### Task 11: Test — fps_stats reports fresh currentTime, not stale closure

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/renderers/VideoPlayer.fpsStatsFresh.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, rerender } from '@testing-library/react';
import VideoPlayer from './VideoPlayer.jsx';

const logCapture = [];
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({
    child: () => ({
      debug: (event, data) => logCapture.push({ event, data }),
      info: (event, data) => logCapture.push({ event, data }),
      warn: (event, data) => logCapture.push({ event, data })
    })
  })
}));

describe('VideoPlayer fps_stats currentTime freshness', () => {
  beforeEach(() => {
    logCapture.length = 0;
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => vi.useRealTimers());

  it('reports the latest seconds value, not the value captured when the effect ran', () => {
    const baseProps = {
      isPaused: false,
      isStalled: false,
      displayReady: true,
      quality: { supported: true, totalVideoFrames: 1000, droppedVideoFrames: 0, droppedPct: 0 },
      seconds: 10,
      duration: 441.76,
      media: { title: 'Teasing', assetId: 'plex:59518' },
      isDash: true,
      shader: 'default',
      droppedFramePct: 0,
      currentMaxKbps: null
    };
    const { rerender: doRerender } = render(<VideoPlayer {...baseProps} />);
    // Advance time enough that the interval ticks at least twice.
    vi.advanceTimersByTime(10_500);
    // Update seconds (and only seconds) — deps array deliberately excludes it
    // so the interval does not re-create, but latestDataRef should update.
    doRerender(<VideoPlayer {...baseProps} seconds={200} />);
    vi.advanceTimersByTime(10_500);

    const fpsLogs = logCapture.filter(l => l.event === 'playback.fps_stats');
    expect(fpsLogs.length).toBeGreaterThanOrEqual(2);
    // Last log must reflect the updated seconds value.
    const last = fpsLogs[fpsLogs.length - 1];
    expect(last.data.currentTime).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/renderers/VideoPlayer.fpsStatsFresh.test.jsx
```

Expected: FAIL — `currentTime` reported as 10, not 200.

---

### Task 12: Fix `fps_stats` to read from `latestDataRef`

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/renderers/VideoPlayer.jsx`

- [ ] **Step 1: Move the `latestDataRef` ref above the logging effect**

The current code declares `latestDataRef` at line 596, *after* the logging effect at 533-593. Move the declaration and the second effect that updates it to *before* the logging effect so the ref is in scope.

- [ ] **Step 2: Change the logger to read from the ref**

In the interval callback at line 567-583, replace `seconds`, `quality`, `droppedFramePct`, `currentMaxKbps`, `duration`, `media`, `isDash`, `shader` with reads from `latestDataRef.current.*`. Specifically the `currentTime: Math.round(seconds * 10) / 10` line becomes:

```javascript
currentTime: Math.round(latestDataRef.current.seconds * 10) / 10,
duration: Math.round(latestDataRef.current.duration * 10) / 10,
droppedFrames: latestDataRef.current.quality.droppedVideoFrames,
totalFrames: latestDataRef.current.quality.totalVideoFrames,
droppedPct: latestDataRef.current.quality.droppedPct?.toFixed(2),
avgDroppedPct: latestDataRef.current.droppedFramePct
  ? (latestDataRef.current.droppedFramePct * 100).toFixed(2) : null,
bitrateCapKbps: latestDataRef.current.currentMaxKbps,
// estimatedFps already reads quality.totalVideoFrames — update to ref too
playbackRate: latestDataRef.current.media.playbackRate || 1,
isDash: latestDataRef.current.isDash,
shader: latestDataRef.current.shader
```

Also update the `estimatedFps` calculation block above it to read from `latestDataRef.current.quality.totalVideoFrames` and `latestDataRef.current.duration`.

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/renderers/VideoPlayer.fpsStatsFresh.test.jsx
```

Expected: pass.

- [ ] **Step 4: Verify no regression in other VideoPlayer tests**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run frontend/src/modules/Player/renderers/VideoPlayer.hardReset.test.jsx
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/renderers/VideoPlayer.jsx \
        frontend/src/modules/Player/renderers/VideoPlayer.fpsStatsFresh.test.jsx
git commit -m "fix(player): playback.fps_stats reports fresh currentTime, not stale closure

The fps_stats interval's outer useEffect deliberately excludes 'seconds'
from its deps array so the interval is not re-created on every
timeupdate. A latestDataRef was added to track current values — but the
logger inside the interval still read 'seconds' from the closure,
producing a frozen value for the lifetime of the effect.

In the 2026-05-23 incident, fps_stats reported currentTime: 107 for the
entire 5.5-minute Bluey session despite real playback to 441s, which
actively misled the audit investigation. Read all logged values from
latestDataRef.current.* instead."
```

---

### Task 13: Live verification on dev server

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server if not running**

Per CLAUDE.md, on `kckern-server` the dev server listens on app port `3112`. Check first:

```bash
lsof -i :3112 || (cd /opt/Code/DaylightStation && nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &)
sleep 5
curl -s http://localhost:3112/api/v1/system/health | head -20
```

Expected: health endpoint returns OK.

- [ ] **Step 2: Reproduce the failure mode**

This part is manual; the engineer needs Plex content. On the Living Room TV (or in a desktop browser pointed at the dev server's `/screen/livingroom-tv`):

1. Queue a short Plex video (any with a known partial-tail fragment — Bluey episodes work reliably).
2. Seek to within ~10s of the end.
3. Let it play to natural end.
4. Observe:
   - The overlay should NOT hold at "Seeking…" for more than ~3s.
   - Within `idleMs` (default 3000ms) after the player settles at duration, the queue should advance to the next item (or, if no next item, the player should clear).

- [ ] **Step 3: Check logs for the new events**

```bash
sudo docker logs daylight-station --since 5m 2>&1 | \
  grep -E 'playback\.(at-duration-stuck|end-of-content-advance|seek-trace)' | head
```

Expected: at least one `playback.at-duration-stuck` (if the stall watchdog was scheduled before the watchdog fired) and one `playback.end-of-content-advance` per end-of-video event. If `playback.seek-trace` fires, it confirms the seek-to-duration trigger is reproducible — capture the stack for the audit follow-up.

- [ ] **Step 4: If verification passes, update the audit status footer**

Append to `docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md`:

```markdown
---

## Status

- 2026-05-23: filed.
- [date]: D (queue-advance watchdog) landed and verified live — `playback.end-of-content-advance` fires within 3s of end-of-content. Plan: `docs/superpowers/plans/2026-05-23-screens-player-end-of-video-recovery.md`.
- [date]: C (overlay status) landed — overlay no longer says "Seeking…" at duration.
- [date]: B (stall watchdog telemetry) landed — `playback.at-duration-stuck` observable in prod.
- [date]: A (seek trace) landed — pending next occurrence to identify trigger.
- [date]: Orphan fps_stats stale-closure landed.
```

- [ ] **Step 5: Commit doc update**

```bash
git add docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md
git commit -m "docs(audit): mark end-of-video recovery remediations as landed"
```

---

## Self-review

- **Spec coverage:** Audit §5 lists 5 fix items (D, C, B, A, orphan). Plan covers all five: D in Tasks 1-4, C in Tasks 5-6, B in Tasks 7-8, A in Tasks 9-10, orphan in Tasks 11-12. Verification in Task 13.
- **Placeholder scan:** No TBDs. Every code step shows the actual code. Test stubs match existing vitest patterns in the same directory.
- **Type consistency:** `createEndOfContentWatchdog` returns `{ tick, reset }` consistently across Tasks 1-4. `mediaSnapshot` shape `{ currentTime, duration, paused, seeking }` is consistent across Tasks 1, 3, 5. `playback.at-duration-stuck` and `playback.end-of-content-advance` event names match between emitter and test assertions.
- **Test infrastructure assumption:** This plan invokes `npx vitest` from the repo root. Confirmed in the codebase: existing test files like `staleSessionWatchdog.test.js` import from `vitest` and the repo's main `node_modules` has it installed. If executing in a worktree, see `memory/reference_vitest_in_worktree.md` for the worktree invocation pattern.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-23-screens-player-end-of-video-recovery.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
