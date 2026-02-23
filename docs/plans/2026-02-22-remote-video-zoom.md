# Remote Video Zoom Mode — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add tap-to-zoom on the remote video during a call, with pan (tap/drag), pinch-to-zoom, and a back button to exit — taking over fullscreen while zoomed.

**Architecture:** A new `useZoomGestures` hook handles all pointer events (tap, drag, pinch) and exposes zoom state. CallApp adds zoom state and wires the hook to the remote video container. When zoomed, the remote container goes `position: fixed; inset: 0` hiding PIP and controls. CSS transforms (`scale` + `transform-origin`) on the video element handle zoom/pan — no `object-fit` switching needed.

**Tech Stack:** React hooks, raw Pointer Events API, CSS transforms, SCSS.

---

### Task 1: Create `useZoomGestures` hook

**Files:**
- Create: `frontend/src/modules/Input/hooks/useZoomGestures.js`

**Step 1: Create the hook file with full implementation**

```js
import { useEffect, useRef, useCallback } from 'react';

/**
 * useZoomGestures — pointer-event-based gesture handler for zoom/pan.
 *
 * @param {React.RefObject} ref - element to attach listeners to
 * @param {object} opts
 * @param {boolean} opts.enabled - only listen when true
 * @param {(x: number, y: number) => void} opts.onTap - single tap at (x%, y%)
 * @param {(dx: number, dy: number) => void} opts.onPan - drag delta in % of element
 * @param {(scaleDelta: number, cx: number, cy: number) => void} opts.onPinch - scale multiplier + center
 */
export default function useZoomGestures(ref, { enabled, onTap, onPan, onPinch }) {
  const pointersRef = useRef(new Map());
  const dragStartRef = useRef(null);
  const pinchStartDistRef = useRef(null);
  const movedRef = useRef(false);

  const getRelative = useCallback((e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const pointers = pointersRef.current;

    function onPointerDown(e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      movedRef.current = false;

      if (pointers.size === 1) {
        dragStartRef.current = { x: e.clientX, y: e.clientY };
      }
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinchStartDistRef.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        dragStartRef.current = null; // cancel drag when pinching
      }
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const rect = el.getBoundingClientRect();

      if (pointers.size === 1 && dragStartRef.current) {
        const dx = (e.clientX - dragStartRef.current.x) / rect.width;
        const dy = (e.clientY - dragStartRef.current.y) / rect.height;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          movedRef.current = true;
          onPan(-dx, -dy);
          dragStartRef.current = { x: e.clientX, y: e.clientY };
        }
      }

      if (pointers.size === 2 && pinchStartDistRef.current) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const scaleDelta = dist / pinchStartDistRef.current;
        const cx = ((pts[0].x + pts[1].x) / 2 - rect.left) / rect.width;
        const cy = ((pts[0].y + pts[1].y) / 2 - rect.top) / rect.height;
        movedRef.current = true;
        onPinch(scaleDelta, cx, cy);
        pinchStartDistRef.current = dist;
      }
    }

    function onPointerUp(e) {
      pointers.delete(e.pointerId);

      if (pointers.size === 0) {
        if (!movedRef.current) {
          const { x, y } = getRelative(e);
          onTap(x, y);
        }
        dragStartRef.current = null;
        pinchStartDistRef.current = null;
      }

      if (pointers.size === 1) {
        // Went from 2 fingers to 1 — restart drag from remaining pointer
        const remaining = [...pointers.values()][0];
        dragStartRef.current = { x: remaining.x, y: remaining.y };
        pinchStartDistRef.current = null;
      }
    }

    function onPointerCancel(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        dragStartRef.current = null;
        pinchStartDistRef.current = null;
      }
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      pointers.clear();
    };
  }, [ref, enabled, onTap, onPan, onPinch, getRelative]);
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/hooks/useZoomGestures.js
git commit -m "feat: add useZoomGestures hook for remote video zoom"
```

---

### Task 2: Add zoom state and wiring to CallApp.jsx

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx`

**Step 1: Add import for the new hook (after line 8)**

Add after the `useMediaControls` import:

```js
import useZoomGestures from '../modules/Input/hooks/useZoomGestures.js';
```

**Step 2: Add zoom state (after line 35, the `remoteVideoRef` line)**

Add after `const remoteVideoRef = useRef(null);`:

```js
  const remoteContainerRef = useRef(null);
  const [zoomMode, setZoomMode] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 0.5, y: 0.5 });
  const [zoomScale, setZoomScale] = useState(1);
  const coverRatioRef = useRef(1);
```

**Step 3: Add helper to compute the cover ratio**

Add after the zoom state block:

```js
  // Compute the scale needed to go from contain → cover for the remote video.
  const computeCoverRatio = useCallback(() => {
    const video = remoteVideoRef.current;
    const container = remoteContainerRef.current;
    if (!video || !container || !video.videoWidth || !video.videoHeight) return 1;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    // contain scale
    const containScale = Math.min(cW / vW, cH / vH);
    // cover scale
    const coverScale = Math.max(cW / vW, cH / vH);
    return coverScale / containScale;
  }, []);
```

**Step 4: Add zoom enter handler**

```js
  const enterZoom = useCallback((tapX, tapY) => {
    const ratio = computeCoverRatio();
    coverRatioRef.current = ratio;
    setZoomScale(ratio);
    setZoomOrigin({ x: tapX, y: tapY });
    setZoomMode(true);
    logger.info('zoom-enter', { tapX, tapY, coverRatio: ratio });
  }, [computeCoverRatio, logger]);

  const exitZoom = useCallback(() => {
    setZoomMode(false);
    setZoomScale(1);
    setZoomOrigin({ x: 0.5, y: 0.5 });
    logger.info('zoom-exit');
  }, [logger]);
```

**Step 5: Wire gesture callbacks**

```js
  const handleZoomTap = useCallback((x, y) => {
    // Recenter the transform-origin to the tap point
    setZoomOrigin({ x, y });
    logger.debug('zoom-recenter', { x, y });
  }, [logger]);

  const handleZoomPan = useCallback((dx, dy) => {
    setZoomOrigin(prev => ({
      x: Math.max(0, Math.min(1, prev.x + dx)),
      y: Math.max(0, Math.min(1, prev.y + dy)),
    }));
  }, []);

  const handleZoomPinch = useCallback((scaleDelta) => {
    setZoomScale(prev => {
      const minScale = coverRatioRef.current;
      const maxScale = coverRatioRef.current * 4;
      return Math.max(minScale, Math.min(maxScale, prev * scaleDelta));
    });
  }, []);

  useZoomGestures(remoteContainerRef, {
    enabled: zoomMode,
    onTap: handleZoomTap,
    onPan: handleZoomPan,
    onPinch: handleZoomPinch,
  });
```

**Step 6: Update the remote video container JSX (line 317–324)**

Replace:

```jsx
      <div className="call-app__remote">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="call-app__video call-app__video--wide"
        />
      </div>
```

With:

```jsx
      <div
        ref={remoteContainerRef}
        className={`call-app__remote${zoomMode ? ' call-app__remote--zoomed' : ''}`}
        onClick={!zoomMode && isConnected ? (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          enterZoom(x, y);
        } : undefined}
      >
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="call-app__video call-app__video--wide"
          style={zoomMode ? {
            transform: `scale(${zoomScale})`,
            transformOrigin: `${zoomOrigin.x * 100}% ${zoomOrigin.y * 100}%`,
          } : undefined}
        />
        {zoomMode && (
          <button
            className="call-app__zoom-back"
            onClick={(e) => { e.stopPropagation(); exitZoom(); }}
            aria-label="Exit zoom"
          >
            &#x2190;
          </button>
        )}
      </div>
```

**Step 7: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "feat: wire zoom mode state and gestures to remote video"
```

---

### Task 3: Add zoom CSS styles to CallApp.scss

**Files:**
- Modify: `frontend/src/Apps/CallApp.scss`

**Step 1: Add zoomed remote container styles**

After the existing `&--connected &__remote { ... }` block (after line 178), add:

```scss
  // Zoomed remote video — fullscreen takeover
  &__remote--zoomed {
    position: fixed;
    inset: 0;
    z-index: 100;
    border-radius: 0;
    background: #000;
    overflow: hidden;
    touch-action: none;

    .call-app__video--wide {
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 0;
      transition: transform-origin 0.15s ease-out;
      will-change: transform, transform-origin;
    }
  }
```

**Step 2: Add zoom back button styles**

After the zoomed block, add:

```scss
  // Back button overlay in zoom mode
  &__zoom-back {
    position: absolute;
    top: calc(0.5rem + env(safe-area-inset-top, 0px));
    left: 0.5rem;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    font-size: 1.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 101;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);

    &:active {
      background: rgba(0, 0, 0, 0.7);
    }
  }
```

**Step 3: Commit**

```bash
git add frontend/src/Apps/CallApp.scss
git commit -m "feat: add zoom mode fullscreen and back button styles"
```

---

### Task 4: Manual integration test

**Files:** (none — testing only)

**Step 1: Verify dev server is running**

```bash
lsof -i :3111
```

If not running, start with `npm run dev`.

**Step 2: Open the CallApp in a browser, connect to a device**

Navigate to the call app URL. Establish a call so the remote video is visible.

**Step 3: Test zoom entry**

- Tap/click the remote video
- Expected: video goes fullscreen, zooms to fill-to-cover level, back button appears top-left

**Step 4: Test tap-to-recenter**

- Tap different spots on the zoomed video
- Expected: view smoothly recenters to the tap point (150ms transition on transform-origin)

**Step 5: Test drag panning**

- Press and drag on the zoomed video
- Expected: view pans following the finger/mouse, clamped to video bounds

**Step 6: Test pinch zoom (mobile or trackpad)**

- Pinch in/out on the video
- Expected: zoom level adjusts between cover ratio and 4x cover ratio, doesn't go below cover or above 4x

**Step 7: Test exit via back button**

- Tap the back arrow (top-left)
- Expected: returns to normal connected layout with remote video, local PIP, and controls visible

**Step 8: Verify PIP and controls are hidden during zoom**

- While zoomed, confirm only the remote video and back button are visible — no local video pip, no mute/hangup controls

**Step 9: Commit (if any fixes were needed)**

```bash
git add -A && git commit -m "fix: zoom mode adjustments from integration test"
```
