// frontend/src/modules/Player/hooks/useImageUpscaleBlur.js
import { useState, useEffect, useCallback, useRef } from 'react';

// Blur calculation constants (same as video for consistency)
const BLUR_FACTOR = 1.2;
const MAX_BLUR_PX = 4;

/**
 * Hook to detect image upscaling and return blur filter style.
 * Compares naturalWidth/naturalHeight to display dimensions.
 * Only applies blur when image is stretched beyond its source resolution.
 *
 * @param {React.RefObject} imageRef - ref to the img element
 * @returns {Object} { blurStyle, isUpscaled, debug }
 */
export function useImageUpscaleBlur(imageRef) {
  const [srcDimensions, setSrcDimensions] = useState({ width: 0, height: 0 });
  const [displayDimensions, setDisplayDimensions] = useState({ width: 0, height: 0 });
  const resizeObserverRef = useRef(null);

  // Read natural dimensions from image
  const updateSrcDimensions = useCallback(() => {
    const img = imageRef?.current;
    if (!img) return;
    const width = img.naturalWidth || 0;
    const height = img.naturalHeight || 0;
    if (width > 0 && height > 0) {
      setSrcDimensions(prev => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    }
  }, [imageRef]);

  // Read display dimensions
  const updateDisplayDimensions = useCallback(() => {
    const img = imageRef?.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const width = Math.round(rect.width) || 0;
    const height = Math.round(rect.height) || 0;
    if (width > 0 && height > 0) {
      setDisplayDimensions(prev => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    }
  }, [imageRef]);

  // Listen for image load
  useEffect(() => {
    const img = imageRef?.current;
    if (!img) return;

    const handleLoad = () => {
      updateSrcDimensions();
      updateDisplayDimensions();
    };

    img.addEventListener('load', handleLoad);

    // Initial check if already loaded
    if (img.complete && img.naturalWidth > 0) {
      handleLoad();
    }

    return () => {
      img.removeEventListener('load', handleLoad);
    };
  }, [imageRef, updateSrcDimensions, updateDisplayDimensions]);

  // Track display dimension changes via ResizeObserver
  useEffect(() => {
    const img = imageRef?.current;
    if (!img) return;

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(() => {
        updateDisplayDimensions();
      });
      resizeObserverRef.current.observe(img);
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [imageRef, updateDisplayDimensions]);

  // Calculate upscale ratio and blur
  const { upscaleRatio, blurPx, isUpscaled } = (() => {
    if (srcDimensions.width === 0 || srcDimensions.height === 0) {
      return { upscaleRatio: 1, blurPx: 0, isUpscaled: false };
    }
    if (displayDimensions.width === 0 || displayDimensions.height === 0) {
      return { upscaleRatio: 1, blurPx: 0, isUpscaled: false };
    }

    const scaleX = displayDimensions.width / srcDimensions.width;
    const scaleY = displayDimensions.height / srcDimensions.height;
    const ratio = Math.max(scaleX, scaleY);

    const upscaled = ratio > 1.05;
    const calculatedBlur = upscaled
      ? Math.min(MAX_BLUR_PX, (ratio - 1) * BLUR_FACTOR)
      : 0;

    return {
      upscaleRatio: ratio,
      blurPx: calculatedBlur,
      isUpscaled: upscaled
    };
  })();

  // Build blur style
  const blurStyle = blurPx > 0 ? { filter: `blur(${blurPx.toFixed(2)}px)` } : {};

  // Debug info
  const debug = {
    srcDimensions,
    displayDimensions,
    upscaleRatio: upscaleRatio.toFixed(2),
    blurPx: blurPx.toFixed(2),
    isUpscaled
  };

  return { blurStyle, isUpscaled, debug };
}

export default useImageUpscaleBlur;
