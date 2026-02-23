# Zoom Tap-to-Recenter Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix tap-to-recenter in zoom mode so it centers the video content the user actually tapped, not a position relative to the container.

**Architecture:** The `<video>` element is transformed with `translate(TX, TY) scale(S)` from center. The tap handler receives coordinates as fractions of the container bounds. To find what video content is under the tap, we must account for the current pan offset (TX, TY). Currently the code ignores the existing pan, causing the view to jump when tapped while panned.

**Tech Stack:** React (JSX), CSS transforms, pointer events

---

### Task 1: Fix handleZoomTap to account for current pan offset

**File:** `frontend/src/Apps/CallApp.jsx:235-248`

**The bug:**

Current code (line 244-245):
```javascript
const newTx = cW * S * (0.5 - x);
const newTy = cH * S * (0.5 - y);
```

This computes the new pan from scratch using only the tap position and scale. It does NOT read the current pan offset. When panned off-center, the tap coordinates (fractions of the container) no longer correspond to the same video content fraction, so the recenter jumps to the wrong place.

**The math:**

The video has CSS `transform: translate(TX, TY) scale(S)` with transform-origin at center. A screen point at offset `(x - 0.5) * cW` from container center corresponds to video point:

```
vx = ((x - 0.5) * cW - TX) / (cW * S) + 0.5
```

To center that video point (make it appear at screen center):

```
newTX = -(vx - 0.5) * cW * S
      = -(((x - 0.5) * cW - TX) / (cW * S)) * cW * S
      = -((x - 0.5) * cW - TX)
      = TX + (0.5 - x) * cW
```

Similarly: `newTY = TY + (0.5 - y) * cH`

**Verification:** When panned to (50, 0) and you tap exact center (0.5, 0.5):
- Correct: `newTX = 50 + 0 = 50` (no jump, center stays centered)
- Old: `newTX = cW * S * 0 = 0` (jumps back to origin)

**Step 1: Apply the fix**

Replace the `handleZoomTap` callback (lines 235-248) with:

```javascript
const handleZoomTap = useCallback((x, y) => {
    const S = zoomScaleRef.current;
    const container = remoteContainerRef.current;
    if (!container) return;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    // Map screen tap to video content coordinates accounting for current pan,
    // then compute the pan offset that centers that video point on screen.
    // newTX = currentTX + (0.5 - x) * cW
    setPanOffset(prev => clampPan(prev.x + (0.5 - x) * cW, prev.y + (0.5 - y) * cH, S));
    logger.debug('zoom-recenter', { x, y });
  }, [clampPan, logger]);
```

Key changes:
- Uses `setPanOffset(prev => ...)` functional updater to read current pan
- Formula: `prev.x + (0.5 - x) * cW` instead of `cW * S * (0.5 - x)`
- Scale (`S`) is no longer multiplied in — the tap-to-pan conversion is scale-independent because the tap is in container-space, not video-space

**Step 2: Manual verification**

Start dev server and open a call (or use the preview route):

```bash
npm run dev
```

Test cases:
1. Enter zoom mode, pan to one side, tap center of screen -> view should NOT jump
2. Enter zoom mode, pan to one side, tap a different point -> view should smoothly recenter on what you tapped
3. Enter zoom mode at default (no pan), tap a corner -> should pan to show that corner at center
4. Pinch to zoom in further, then tap -> should still recenter correctly at higher scale

**Step 3: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "fix: zoom tap-to-recenter accounts for current pan offset

The tap handler was computing the new pan from scratch using only the
tap position and scale, ignoring the current pan offset. When panned
off-center, tapping a point would jump to the wrong location because
the container-relative tap coordinates don't match video coordinates
without accounting for the existing translate(TX, TY).

Fix: newTX = currentTX + (0.5 - x) * cW (was: cW * S * (0.5 - x))"
```
