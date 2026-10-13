# Image Upscale Blur Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the image blur logic to correctly calculate pixel density, accounting for object-fit and devicePixelRatio.

**Architecture:** Replace the existing `useImageUpscaleBlur` hook with a more accurate implementation that calculates actual rendered image size based on CSS object-fit mode, then factors in device pixel ratio.

**Tech Stack:** React hooks, CSS computed styles, ResizeObserver

---

## Problem

The current blur logic compares `getBoundingClientRect()` dimensions to natural image dimensions. This is incorrect when:

1. `object-fit: contain` is used (image letterboxed within container)
2. `aspect-ratio` CSS forces a different shape than the image
3. High-DPI displays where CSS pixels ≠ physical pixels

**Result:** Vertical or square content gets blurred unnecessarily because the container width is used instead of actual rendered width.

## Solution

### Principle

> Blur exists only to smooth pixelation artifacts from upscaling. Never blur in a way that loses available detail.

- `ratio ≤ 1.0` → No blur (downscaling or 1:1)
- `ratio > 1.0` → Blur to smooth pixelation, proportional to upscale amount

### Blur Formula

```
blur = (ratio - 1) / 2
```

| Ratio | Source pixel displayed as | Blur | Result |
|-------|---------------------------|------|--------|
| 1.0 | 1px | 0px | Perfect 1:1 |
| 2.0 | 2×2 block | 0.5px | Softens edges |
| 4.0 | 4×4 block | 1.5px | Softens edges |
| 8.0 | 8×8 block | 3.5px | Softens edges |

### Calculation Steps

1. **Get actual rendered size** based on `object-fit`:
   - `contain`: fit within container, maintain aspect ratio
   - `cover`: fill container, may crop
   - `fill`: stretch to container
   - `scale-down`: like contain, never upscale

2. **Factor in devicePixelRatio**:
   ```
   physicalPixels = renderedCSSPixels × devicePixelRatio
   ratio = physicalPixels / naturalPixels
   ```

3. **Calculate blur**:
   ```
   blur = ratio <= 1 ? 0 : min(maxBlur, (ratio - 1) / 2)
   ```

---

## Tasks

### Task 1: Replace useImageUpscaleBlur implementation

**Files:**
- Replace: `frontend/src/modules/Player/hooks/useImageUpscaleBlur.js`

**Step 1: Write the new implementation**

Replace entire file with:

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';

const MAX_BLUR_PX = 4;

/**
 * Calculate actual rendered image size based on object-fit mode.
 */
function getRenderedImageSize(img) {
  const style = window.getComputedStyle(img);
  const objectFit = style.objectFit || 'fill';
  const rect = img.getBoundingClientRect();
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;

  if (!naturalW || !naturalH || !rect.width || !rect.height) {
    return null;
  }

  const imageAspect = naturalW / naturalH;
  const containerAspect = rect.width / rect.height;

  switch (objectFit) {
    case 'contain':
    case 'scale-down': {
      let w, h;
      if (imageAspect > containerAspect) {
        w = rect.width;
        h = rect.width / imageAspect;
      } else {
        h = rect.height;
        w = rect.height * imageAspect;
      }
      if (objectFit === 'scale-down') {
        w = Math.min(w, naturalW);
        h = Math.min(h, naturalH);
      }
      return { width: w, height: h };
    }
    case 'cover': {
      if (imageAspect > containerAspect) {
        return { width: rect.height * imageAspect, height: rect.height };
      } else {
        return { width: rect.width, height: rect.width / imageAspect };
      }
    }
    case 'none':
      return { width: naturalW, height: naturalH };
    case 'fill':
    default:
      return { width: rect.width, height: rect.height };
  }
}

/**
 * Hook to detect image upscaling and return appropriate blur filter.
 * Only blurs when image is displayed larger than source resolution.
 * Blur amount: (ratio - 1) / 2 — smooths pixelation without losing detail.
 */
export function useImageUpscaleBlur(imageRef, options = {}) {
  const { maxBlurPx = MAX_BLUR_PX, enabled = true } = options;
  const [blurPx, setBlurPx] = useState(0);
  const [debug, setDebug] = useState(null);
  const resizeObserverRef = useRef(null);

  const recalculate = useCallback(() => {
    const img = imageRef?.current;
    if (!img || !enabled) {
      setBlurPx(0);
      return;
    }

    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    if (!naturalW || !naturalH) {
      setBlurPx(0);
      return;
    }

    const rendered = getRenderedImageSize(img);
    if (!rendered) {
      setBlurPx(0);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const physicalW = rendered.width * dpr;
    const physicalH = rendered.height * dpr;

    const ratioW = physicalW / naturalW;
    const ratioH = physicalH / naturalH;
    const ratio = Math.max(ratioW, ratioH);

    const calculatedBlur = ratio <= 1
      ? 0
      : Math.min(maxBlurPx, (ratio - 1) / 2);

    setBlurPx(calculatedBlur);
    setDebug({
      natural: { w: naturalW, h: naturalH },
      rendered: { w: Math.round(rendered.width), h: Math.round(rendered.height) },
      physical: { w: Math.round(physicalW), h: Math.round(physicalH) },
      dpr,
      ratio: ratio.toFixed(2),
      blur: calculatedBlur.toFixed(2)
    });
  }, [imageRef, enabled, maxBlurPx]);

  useEffect(() => {
    const img = imageRef?.current;
    if (!img) return;

    const handleLoad = () => recalculate();
    img.addEventListener('load', handleLoad);

    if (img.complete && img.naturalWidth > 0) {
      recalculate();
    }

    return () => img.removeEventListener('load', handleLoad);
  }, [imageRef, recalculate]);

  useEffect(() => {
    const img = imageRef?.current;
    if (!img || typeof ResizeObserver === 'undefined') return;

    resizeObserverRef.current = new ResizeObserver(recalculate);
    resizeObserverRef.current.observe(img);

    return () => resizeObserverRef.current?.disconnect();
  }, [imageRef, recalculate]);

  const blurStyle = blurPx > 0 ? { filter: `blur(${blurPx.toFixed(2)}px)` } : {};

  return { blurStyle, ratio: debug?.ratio, debug };
}

export default useImageUpscaleBlur;
```

**Step 2: Verify build passes**

```bash
cd frontend && npm run build
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/hooks/useImageUpscaleBlur.js
git commit -m "fix(player): correct image blur calculation for object-fit and DPR

- Calculate actual rendered size based on object-fit mode
- Factor in devicePixelRatio for accurate pixel density
- Use formula: blur = (ratio - 1) / 2 for precise smoothing
- No blur when ratio <= 1 (downscaling or 1:1)"
```

---

### Task 2: Test in browser

**Manual verification:**

1. Play audio with square album art in default mode
2. Play audio in focused mode (object-fit: contain)
3. Check browser console for `debug` output if needed
4. Verify no unnecessary blur on properly-sized images

---

## Summary

| Before | After |
|--------|-------|
| Uses container bounding rect | Uses actual rendered size based on object-fit |
| Ignores devicePixelRatio | Factors in DPR for true pixel density |
| Arbitrary blur factor (1.2) | Mathematical formula: (ratio-1)/2 |
| Blurs square/vertical content incorrectly | Correct blur only when truly upscaled |
