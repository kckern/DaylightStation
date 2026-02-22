# HomeLine Video Call UX Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix layout-breaking and usability issues on both phone and TV sides of the HomeLine video call system, as identified in `docs/_wip/audits/2026-02-22-homeline-videocall-ux-audit.md`.

**Architecture:** Pure frontend changes — CSS rewrites for layout, minor JSX restructuring for new elements. No backend changes, no new hooks, no new dependencies. Both components keep their existing always-mounted video element pattern (video elements stay in DOM, CSS toggles layout).

**Tech Stack:** React JSX, SCSS, CSS `dvh` units, `env(safe-area-inset-*)`, CSS transitions, `@media` queries

**Scope:** P0 (layout-breaking) + P1 (usability) issues. P2 polish items included where trivial. Cross-cutting issues (23-25) deferred.

**Note on testing:** These are CSS/layout changes with no unit-testable logic. Verification for each task is: `cd frontend && npx vite build` succeeds, then visual inspection on phone/TV.

---

### Task 1: Phone CSS Foundation (Audit Issues 1, 2, 4)

Fix the three CSS-only issues that cause layout breakage on real mobile devices.

**Files:**
- Modify: `frontend/src/Apps/CallApp.scss:1-8`

**Context:** The root `.call-app` currently uses `100vh` which on iOS Safari includes the URL bar height, pushing bottom content offscreen. There's no safe-area handling for notched phones, and no overscroll prevention.

**Step 1: Fix the root `.call-app` block**

Replace lines 1-8 of `CallApp.scss`:

```scss
.call-app {
  width: 100vw;
  height: 100dvh;   // dynamic viewport — excludes iOS URL bar
  height: 100vh;    // fallback for browsers without dvh support
  @supports (height: 100dvh) {
    height: 100dvh;
  }
  background: #000;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  overflow: hidden;
  position: relative;
  overscroll-behavior: none;
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
```

**What changed:**
- `100dvh` with `100vh` fallback — fixes iOS Safari URL bar overlap
- `overscroll-behavior: none` — prevents pull-to-refresh and rubber-band scroll
- `touch-action: manipulation` — prevents double-tap zoom, allows normal touch
- `user-select: none` — prevents accidental text selection during call

**Step 2: Add safe-area insets to bottom overlay**

Replace the `&__overlay-bottom` block (lines 63-72):

```scss
  &__overlay-bottom {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.85) 30%);
    padding: 3rem 2rem calc(2.5rem + env(safe-area-inset-bottom, 0px));
    text-align: center;
    z-index: 10;
  }
```

**What changed:** Bottom padding now adds `env(safe-area-inset-bottom)` so content stays above the iPhone home indicator.

**Step 3: Add safe-area insets to controls bar**

Replace the `&__controls` block (lines 132-140):

```scss
  &__controls {
    flex: 0 0 auto;
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: center;
    padding: 0.75rem 0 calc(0.75rem + env(safe-area-inset-bottom, 0px));
  }
```

**What changed:** Bottom padding includes safe-area inset. Removed `margin-bottom: 0.5rem` (redundant with padding).

**Step 4: Build to verify**

```bash
cd frontend && npx vite build
```

Expected: Build succeeds with no errors.

**Step 5: Commit**

```bash
git add frontend/src/Apps/CallApp.scss
git commit -m "fix(call): iOS viewport, safe-area insets, overscroll prevention"
```

---

### Task 2: Phone Connected Layout — Real PIP + Remote Video (Audit Issues 3, 5, 6)

Rewrite the connected-mode layout so the local camera is a small floating PIP and the remote TV video fills the screen.

**Files:**
- Modify: `frontend/src/Apps/CallApp.scss:16-60` (connected mode + local + video blocks)
- Modify: `frontend/src/Apps/CallApp.scss:123-129` (remote block)
- Modify: `frontend/src/Apps/CallApp.scss:131-140` (controls block)

**Context:** Currently `&__local--pip` has `flex: 1` (identical to `--full`), so local camera takes half the screen in connected mode. The remote video forces `aspect-ratio: 16/9` which wastes space on portrait phones. Controls have no backdrop.

**Step 1: Rewrite connected mode layout**

Replace the `&--connected` block (lines 17-26):

```scss
  // Connected mode: remote fills screen, local PIP floats, controls at bottom
  &--connected {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
```

**Step 2: Rewrite local camera modes**

Replace the `&__local` block (lines 29-43):

```scss
  &__local {
    overflow: hidden;

    &--full {
      flex: 1;
      min-height: 0;
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    &--pip {
      position: absolute;
      top: calc(0.75rem + env(safe-area-inset-top, 0px));
      right: 0.75rem;
      width: 100px;
      height: 140px;
      border-radius: 12px;
      z-index: 20;
      border: 2px solid rgba(255, 255, 255, 0.3);
      overflow: hidden;
    }
  }
```

**What changed:** `--pip` is now absolutely positioned (top-right corner, safe-area-aware), 100x140 (roughly 9:16 portrait). `--full` keeps the flex layout for preview mode.

**Step 3: Rewrite video element styles**

Replace the `&__video` block (lines 45-60):

```scss
  &__video {
    background: #111;

    &--wide {
      width: 100%;
      max-height: 70dvh;
      max-height: 70vh;
      @supports (height: 1dvh) {
        max-height: 70dvh;
      }
      object-fit: contain;
      border-radius: 0;
    }

    &--tall {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
```

**What changed:**
- `--wide` (remote): fills width, caps height at 70dvh so controls aren't pushed off. Uses `object-fit: contain` — works for both landscape and portrait remote sources. No forced `aspect-ratio`.
- `--tall` (local self-view): uses `object-fit: cover` to fill the PIP/preview without letterboxing. Removed `aspect-ratio: 9/16` since the container constrains it.

**Step 4: Rewrite remote container**

Replace the `&__remote` block (lines 123-129):

```scss
  &__remote {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
```

**What changed:** `flex: 1` lets remote video fill available space between PIP and controls.

**Step 5: Add backdrop to controls**

Replace the `&__controls` block (with changes from Task 1):

```scss
  &__controls {
    flex: 0 0 auto;
    width: 100%;
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: center;
    padding: 0.75rem 0 calc(0.75rem + env(safe-area-inset-bottom, 0px));
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
```

**What changed:** Added translucent background + blur so controls don't vanish against video.

**Step 6: Build to verify**

```bash
cd frontend && npx vite build
```

Expected: Build succeeds.

**Step 7: Commit**

```bash
git add frontend/src/Apps/CallApp.scss
git commit -m "fix(call): real PIP self-view, remote fills screen, controls backdrop"
```

---

### Task 3: Phone Usability Polish (Audit Issues 7, 8, 9, 10, 11)

Landscape media query, readable mute labels, cancel contrast, state transitions, device display names.

**Files:**
- Modify: `frontend/src/Apps/CallApp.scss` (multiple blocks)
- Modify: `frontend/src/Apps/CallApp.jsx:259-268` (device button label)

**Step 1: Increase mute button font size**

In `&__mute-btn` (line 149), change:

```scss
    font-size: 0.65rem;
```

to:

```scss
    font-size: 0.75rem;
```

**Step 2: Increase cancel button contrast**

In `&__cancel` (lines 193-206), change:

```scss
    color: #aaa;
    border: 1px solid rgba(255, 255, 255, 0.2);
```

to:

```scss
    color: #ddd;
    border: 1px solid rgba(255, 255, 255, 0.4);
```

**Step 3: Add state transition**

Add at the end of the `.call-app` block (before closing `}`):

```scss
  // State transition: cross-fade between preview and connected
  &--preview,
  &--connected {
    transition: opacity 0.2s ease;
  }
```

**Step 4: Add landscape media query for connected mode**

Add at the end of the `.call-app` block (before closing `}`):

```scss
  // Landscape: PIP moves to top-left, remote video uses more height
  @media (orientation: landscape) {
    &--connected &__local--pip {
      top: 0.5rem;
      right: auto;
      left: 0.5rem;
      width: 120px;
      height: 90px;
    }

    &--connected &__video--wide {
      max-height: 80dvh;
      max-height: 80vh;
      @supports (height: 1dvh) {
        max-height: 80dvh;
      }
    }

    &__controls {
      padding-bottom: 0.5rem;
    }
  }
```

**Step 5: Format device IDs as readable labels in JSX**

In `CallApp.jsx`, replace line 266:

```jsx
                  {device.id}
```

with:

```jsx
                  {device.label || device.id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
```

This converts `"livingroom-tv"` → `"Livingroom Tv"`. Prefers `device.label` if the API provides one.

**Step 6: Build to verify**

```bash
cd frontend && npx vite build
```

Expected: Build succeeds.

**Step 7: Commit**

```bash
git add frontend/src/Apps/CallApp.scss frontend/src/Apps/CallApp.jsx
git commit -m "fix(call): landscape support, readable labels, button contrast, transitions"
```

---

### Task 4: TV Connected Layout — PIP Self-View + Remote Dominant (Audit Issues 14, 15)

Rewrite the TV connected layout from side-by-side split to remote-dominant with small self-view PIP at top center.

**Files:**
- Modify: `frontend/src/modules/Input/VideoCall.scss` (full rewrite of connected-mode rules)

**Context:** Currently connected mode is a flex side-by-side split: remote portrait on left (`flex: 0 0 auto; height: 90%`), local landscape on right (`flex: 1; height: 90%`). The remote video forces `aspect-ratio: 9/16`. Per the audit, the remote caller should dominate the screen and the local self-view should be a small PIP at top center.

**Step 1: Rewrite the full VideoCall.scss**

Replace the entire file:

```scss
.videocall-tv {
  width: 100%;
  height: 100%;
  position: relative;
  background: #000;
  overflow: hidden;

  // ── Solo mode (default): local fullscreen, remote hidden ──

  &__remote-panel {
    display: none;
  }

  &__local-panel {
    width: 100%;
    height: 100%;
  }

  &__local-panel &__video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 0;
    background: #111;
  }

  // ── Connected mode: remote dominant, local PIP top-center ──

  &--connected {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &--connected &__remote-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  &--connected &__remote-panel &__video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #111;
  }

  &--connected &__local-panel {
    position: absolute;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    width: 240px;
    height: 135px;
    z-index: 10;
    border-radius: 8px;
    overflow: hidden;
    border: 2px solid rgba(255, 255, 255, 0.25);
  }

  &--connected &__local-panel &__video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 6px;
    background: #111;
  }

  // ── Overlays ──

  &__status {
    position: absolute;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    padding: 0.4rem 1rem;
    border-radius: 4px;
    font-size: 0.9rem;
    z-index: 10;
    transition: opacity 0.3s ease;
  }

  // When connected, move status below PIP
  &--connected &__status {
    top: calc(135px + 2rem);
  }

  &__meter {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    width: 300px;
    height: 16px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    overflow: hidden;
    z-index: 10;
    transition: opacity 0.3s ease;
  }

  // Hide meter during call
  &--connected &__meter {
    opacity: 0;
    pointer-events: none;
  }

  &__meter-fill {
    height: 100%;
    background: #4caf50;
    border-radius: 8px;
    transition: width 0.1s;
  }

  &__remote-muted {
    position: absolute;
    bottom: 1.5rem;
    left: 1.5rem;
    background: rgba(0, 0, 0, 0.6);
    color: #ccc;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 1rem;
    z-index: 10;
  }

  &__video-off {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #888;
    font-size: 1.2rem;
    z-index: 5;
  }
}
```

**Key changes from old file:**
- Connected remote panel: `width: 100%; height: 100%` with `object-fit: contain` and **no forced aspect-ratio** — adapts to portrait and landscape callers
- Connected local panel: absolutely positioned top-center, 240x135 (16:9), rounded corners, subtle border — small PIP
- Meter hidden during connected mode via `opacity: 0`
- Status repositioned below PIP when connected
- Remote muted badge moved to bottom-left (not relative to container top-right)
- Added `&__video-off` class for Task 5's video-mute placeholder

**Step 2: Build to verify**

```bash
cd frontend && npx vite build
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/modules/Input/VideoCall.scss
git commit -m "fix(tv): PIP self-view top-center, remote dominant, adaptive aspect ratio"
```

---

### Task 5: TV Usability — Status Auto-Hide, Video-Off Placeholder (Audit Issues 16, 17, 18, 19)

Make the status bar auto-fade after connection, add a "Camera off" placeholder when the remote peer mutes video.

**Files:**
- Modify: `frontend/src/modules/Input/VideoCall.jsx:21-22,78-126`

**Context:** The status text currently stays visible permanently. The volume meter stays visible during calls (already fixed via CSS in Task 4). When the phone disables video, the remote panel is just a black rectangle with no explanation.

**Step 1: Add status auto-hide state + remote video mute detection**

In `VideoCall.jsx`, after line 22 (`const [iceError, setIceError] = useState(null);`), add:

```jsx
  const [statusVisible, setStatusVisible] = useState(true);
```

**Step 2: Add auto-hide effect**

After the ICE error effect (after line 47), add:

```jsx
  // Auto-hide status overlay 3s after connecting
  useEffect(() => {
    if (peerConnected) {
      const timer = setTimeout(() => setStatusVisible(false), 3000);
      return () => clearTimeout(timer);
    }
    setStatusVisible(true);
  }, [peerConnected]);
```

**Step 3: Update status JSX to use visibility**

Replace the status `<div>` (lines 110-118):

```jsx
      {/* Status indicator — auto-hides when connected */}
      <div className="videocall-tv__status" style={!statusVisible ? { opacity: 0 } : undefined}>
        {iceError || (
          <>
            {status === 'waiting' && 'Home Line \u2014 Waiting'}
            {status === 'connecting' && 'Connecting...'}
            {status === 'connected' && 'Connected'}
          </>
        )}
      </div>
```

**Step 4: Add remote video-off placeholder**

Replace the remote panel JSX (lines 82-90):

```jsx
      {/* Remote: phone video — always mounted, hidden until connected via CSS */}
      <div className="videocall-tv__remote-panel">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="videocall-tv__video videocall-tv__video--portrait"
        />
        {peerConnected && remoteMuteState.videoMuted && (
          <div className="videocall-tv__video-off">Camera off</div>
        )}
      </div>
```

This adds the "Camera off" text overlay inside the remote panel when the phone disables video. The CSS class `videocall-tv__video-off` was already added in Task 4.

**Step 5: Build to verify**

```bash
cd frontend && npx vite build
```

Expected: Build succeeds.

**Step 6: Commit**

```bash
git add frontend/src/modules/Input/VideoCall.jsx
git commit -m "fix(tv): auto-hide status, video-off placeholder for remote mute"
```

---

## Verification Checklist

After all tasks, verify the build one final time:

```bash
cd frontend && npx vite build
```

Then visual inspection on actual devices:

**Phone (`/call`):**
- [ ] No scroll/overscroll on iOS Safari
- [ ] Bottom controls visible above home indicator (notched iPhone)
- [ ] Self-camera fills screen in idle/connecting (preview mode)
- [ ] Connected: remote video fills most of screen, local is small PIP top-right
- [ ] Landscape: PIP moves to top-left, remote video uses more height
- [ ] Controls have translucent backdrop
- [ ] Device buttons show readable names (not raw IDs)
- [ ] Cancel button is clearly visible

**TV (`/tv?open=videocall/{id}`):**
- [ ] Waiting: fullscreen self-camera with status + volume meter
- [ ] Connected: remote caller dominates screen (portrait or landscape)
- [ ] Self-view is small PIP at top-center (240x135)
- [ ] "Connected" status fades after 3s
- [ ] Volume meter hidden during call
- [ ] "Camera off" shown when phone disables video
- [ ] Phone audio muted badge visible at bottom-left
