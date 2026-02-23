# CallApp Zoom Cover-Ratio Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the zoom-on-tap feature so it enters at cover scale (video fills screen) instead of contain scale (letterboxed with black bars).

**Architecture:** `enterZoom` calculates `coverRatio` from the container's current dimensions, but it runs BEFORE `setZoomMode(true)` takes effect. In non-zoomed mode the container auto-sizes to the video (same aspect ratio), so `coverRatio` is always 1. Fix: defer the scale calculation to after the zoom layout renders using a `useEffect` that fires when `zoomMode` becomes true.

**Tech Stack:** React (JSX, hooks), CSS (SCSS)

---

### Task 1: Fix coverRatio calculation timing

**File:** `frontend/src/Apps/CallApp.jsx`

**Root cause:** `enterZoom()` calls `getVideoMetrics()` synchronously. At that moment, the container is the non-zoomed flex item (`flex: 0 0 auto; width: 100%`, height = video intrinsic height). The container has the same aspect ratio as the video, so `coverRatio = 1`. After React renders with `zoomMode: true`, the container becomes `position: fixed; inset: 0` (full viewport), where `coverRatio ≈ 3.85` for a 16:9 video on a portrait phone. But by then the scale is already set to 1.

**Step 1: Simplify `enterZoom` to only set `zoomMode: true`**

Replace `enterZoom` (lines 198-207):

```jsx
const enterZoom = useCallback(() => {
  setZoomMode(true);
  logger.info('zoom-enter');
}, [logger]);
```

It no longer calculates coverRatio or sets scale. That moves to Step 2.

**Step 2: Add a `useEffect` that calculates cover ratio after zoom layout renders**

Insert after the `exitZoom` definition (after line 215):

```jsx
// After zoom layout renders, calculate cover ratio from the now-fullscreen container
// and set the initial scale to fill the viewport.
useEffect(() => {
  if (!zoomMode) return;

  // Use rAF to ensure the browser has applied the fullscreen layout
  const raf = requestAnimationFrame(() => {
    const m = getVideoMetrics();
    if (m) {
      coverRatioRef.current = m.coverRatio;
      setZoomScale(m.coverRatio);
      zoomScaleRef.current = m.coverRatio;
      logger.info('zoom-cover-applied', { coverRatio: m.coverRatio, cW: m.cW, cH: m.cH });
    } else {
      logger.warn('zoom-cover-no-metrics');
    }
  });

  return () => cancelAnimationFrame(raf);
}, [zoomMode, getVideoMetrics, logger]);
```

**Step 3: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build 2>&1 | tail -5
```

Expected: Build succeeds (or pre-existing LaunchCard.scss error only).

**Step 4: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "fix: zoom enters at cover scale instead of contain (1x)

enterZoom was calculating coverRatio from the non-zoomed container,
where the container auto-sizes to the video (ratio always 1). Moved
the calculation to a useEffect that fires after the fullscreen zoom
layout renders, so container dimensions reflect the actual viewport."
```

---

### Task 2: Verify via deploy and test

**Step 1:** Deploy (user runs manually).

**Step 2:** Start a call from phone to Shield TV.

**Step 3:** Tap the remote video to enter zoom.

**Step 4:** Check logs:

```bash
ssh homeserver.local 'docker logs --since 2m daylight-station 2>&1' | grep -E 'zoom-(enter|cover)'
```

Expected:
- `zoom-enter` (no coverRatio — just mode toggle)
- `zoom-cover-applied` with `coverRatio` ≈ 3-4 (not 1)

**Step 5:** Visually confirm: video should fill the phone screen edge-to-edge (no black bars) when zoom is first entered. Pinch out to see contain view. Pinch in to zoom further.
