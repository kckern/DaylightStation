import { useState, useEffect } from 'react';

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
 * @param {string|null} source - rendered src of the img element
 * @param {Object} options - { maxBlurPx, enabled }
 * @returns {Object} { imageRef, blurStyle, ratio, debug }
 */
export function useImageUpscaleBlur(source, options = {}) {
  const { maxBlurPx = MAX_BLUR_PX, enabled = true } = options;
  const [img, imageRef] = useState(null);
  const [measurement, setMeasurement] = useState(null);

  useEffect(() => {
    if (!img || !source || !enabled) {
      setMeasurement(null);
      return;
    }

    let retired = false;
    const recalculate = () => {
      if (retired) return;
      // The previous resource can still supply intrinsic dimensions during a source change.
      if (!img.complete || (img.currentSrc && img.currentSrc !== img.src)) {
        setMeasurement(null);
        return;
      }

      const rendered = getRenderedImageSize(img);
      if (!rendered) {
        setMeasurement(null);
        return;
      }

      // Use physical pixels and the dominant axis to measure upscaling.
      const { naturalWidth: naturalW, naturalHeight: naturalH } = img;
      const dpr = window.devicePixelRatio || 1;
      const physicalW = rendered.width * dpr;
      const physicalH = rendered.height * dpr;
      const ratio = Math.max(physicalW / naturalW, physicalH / naturalH);
      const blurPx = ratio <= 1 ? 0 : Math.min(maxBlurPx, (ratio - 1) / 2);

      setMeasurement({
        img,
        source,
        blurPx,
        debug: {
          natural: { w: naturalW, h: naturalH },
          rendered: { w: Math.round(rendered.width), h: Math.round(rendered.height) },
          physical: { w: Math.round(physicalW), h: Math.round(physicalH) },
          dpr,
          ratio: ratio.toFixed(2),
          blur: blurPx.toFixed(2)
        }
      });
    };

    img.addEventListener('load', recalculate);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(recalculate);
    observer?.observe(img);
    recalculate();

    return () => {
      retired = true;
      img.removeEventListener('load', recalculate);
      observer?.disconnect();
    };
  }, [img, source, enabled, maxBlurPx]);

  const current = enabled && measurement?.img === img && measurement.source === source
    ? measurement
    : null;
  const blurStyle = current?.blurPx > 0 ? { filter: `blur(${current.debug.blur}px)` } : {};

  return { imageRef, blurStyle, ratio: current?.debug.ratio, debug: current?.debug ?? null };
}

export default useImageUpscaleBlur;
