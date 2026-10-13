import { useState, useEffect, useCallback, useRef } from 'react';

const MAX_BLUR_PX = 4;

/**
 * Calculate actual rendered image size based on object-fit mode.
 * The bounding rect gives us the container, but the image may be
 * letterboxed/pillarboxed inside it.
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
        // Width-constrained (pillarboxed)
        w = rect.width;
        h = rect.width / imageAspect;
      } else {
        // Height-constrained (letterboxed)
        h = rect.height;
        w = rect.height * imageAspect;
      }
      // scale-down: never larger than natural size
      if (objectFit === 'scale-down') {
        w = Math.min(w, naturalW);
        h = Math.min(h, naturalH);
      }
      return { width: w, height: h };
    }
    case 'cover': {
      // Image covers container, may be cropped
      if (imageAspect > containerAspect) {
        return { width: rect.height * imageAspect, height: rect.height };
      } else {
        return { width: rect.width, height: rect.width / imageAspect };
      }
    }
    case 'none':
      // Natural size, may overflow
      return { width: naturalW, height: naturalH };
    case 'fill':
    default:
      // Stretched to fill container
      return { width: rect.width, height: rect.height };
  }
}

/**
 * Hook to detect image upscaling and return appropriate blur filter.
 * Only blurs when image is displayed larger than source resolution.
 * Blur amount: (ratio - 1) / 2 — smooths pixelation without losing detail.
 *
 * @param {React.RefObject} imageRef - ref to the img element
 * @param {Object} options - { maxBlurPx, enabled }
 * @returns {Object} { blurStyle, ratio, debug }
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

    // Factor in device pixel ratio for true pixel density
    const dpr = window.devicePixelRatio || 1;
    const physicalW = rendered.width * dpr;
    const physicalH = rendered.height * dpr;

    // Use the dominant axis (max ratio)
    const ratioW = physicalW / naturalW;
    const ratioH = physicalH / naturalH;
    const ratio = Math.max(ratioW, ratioH);

    // Calculate blur: (ratio - 1) / 2, capped at max
    // ratio <= 1 means downscaling or 1:1, no blur needed
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

  // Recalculate on load
  useEffect(() => {
    const img = imageRef?.current;
    if (!img) return;

    const handleLoad = () => recalculate();
    img.addEventListener('load', handleLoad);

    // Initial check if already loaded
    if (img.complete && img.naturalWidth > 0) {
      recalculate();
    }

    return () => img.removeEventListener('load', handleLoad);
  }, [imageRef, recalculate]);

  // Recalculate on resize
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
