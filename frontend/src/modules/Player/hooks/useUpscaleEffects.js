// frontend/src/modules/Player/hooks/useUpscaleEffects.js
import { useState, useEffect, useCallback, useRef } from 'react';

// Blur calculation constants
const BLUR_FACTOR = 1.2;      // px of blur per 1x upscale
const MAX_BLUR_PX = 4;        // cap to prevent over-softening
const BLUR_FACTOR_AGGRESSIVE = 2.0;
const MAX_BLUR_PX_AGGRESSIVE = 6;

// CRT threshold
const CRT_MAX_HEIGHT = 480;

// Timing
const DEFAULT_STABILIZE_MS = 1500;
const FADE_DURATION_MS = 400;

// Presets define which effects are enabled
const PRESETS = {
  auto: { blur: true, crt: true, aggressive: false },
  'blur-only': { blur: true, crt: false, aggressive: false },
  'crt-only': { blur: false, crt: true, aggressive: false },
  aggressive: { blur: true, crt: true, aggressive: true },
  none: { blur: false, crt: false, aggressive: false }
};

/**
 * Hook to detect video upscaling and return appropriate visual effect styles.
 *
 * @param {Object} options
 * @param {React.RefObject} options.mediaRef - ref to video element (or dash-video)
 * @param {string} options.preset - 'auto' | 'blur-only' | 'crt-only' | 'aggressive' | 'none'
 * @param {number} options.stabilizeMs - delay before applying effects (default 1500)
 * @returns {Object} { effectStyles, overlayProps, isActive, debug }
 */
export function useUpscaleEffects({
  mediaRef,
  preset = 'auto',
  stabilizeMs = DEFAULT_STABILIZE_MS
} = {}) {
  const [srcDimensions, setSrcDimensions] = useState({ width: 0, height: 0 });
  const [displayDimensions, setDisplayDimensions] = useState({ width: 0, height: 0 });
  const [isStabilized, setIsStabilized] = useState(false);
  const stabilizeTimerRef = useRef(null);
  const resizeObserverRef = useRef(null);

  const presetConfig = PRESETS[preset] || PRESETS.auto;

  // Get the actual video element (handles dash-video shadow DOM)
  const getVideoElement = useCallback(() => {
    const el = mediaRef?.current;
    if (!el) return null;
    // dash-video wraps the video in shadow DOM
    if (el.shadowRoot) {
      return el.shadowRoot.querySelector('video') || el;
    }
    return el;
  }, [mediaRef]);

  // Read source dimensions from video element
  const updateSrcDimensions = useCallback(() => {
    const videoEl = getVideoElement();
    if (!videoEl) return;
    const width = videoEl.videoWidth || 0;
    const height = videoEl.videoHeight || 0;
    if (width > 0 && height > 0) {
      setSrcDimensions(prev => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    }
  }, [getVideoElement]);

  // Read display dimensions from rendered element
  const updateDisplayDimensions = useCallback(() => {
    const videoEl = getVideoElement();
    if (!videoEl) return;
    const rect = videoEl.getBoundingClientRect();
    const width = Math.round(rect.width) || 0;
    const height = Math.round(rect.height) || 0;
    if (width > 0 && height > 0) {
      setDisplayDimensions(prev => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    }
  }, [getVideoElement]);

  // Handle resolution changes (loadedmetadata, resize)
  useEffect(() => {
    const videoEl = getVideoElement();
    if (!videoEl) return;

    const handleMetadata = () => {
      updateSrcDimensions();
      // Reset stabilization on resolution change
      setIsStabilized(false);
      if (stabilizeTimerRef.current) {
        clearTimeout(stabilizeTimerRef.current);
      }
      stabilizeTimerRef.current = setTimeout(() => {
        setIsStabilized(true);
      }, stabilizeMs);
    };

    // Listen for metadata load and resolution changes
    videoEl.addEventListener('loadedmetadata', handleMetadata);
    videoEl.addEventListener('resize', handleMetadata);

    // Initial check
    if (videoEl.videoWidth > 0) {
      handleMetadata();
    }

    return () => {
      videoEl.removeEventListener('loadedmetadata', handleMetadata);
      videoEl.removeEventListener('resize', handleMetadata);
      if (stabilizeTimerRef.current) {
        clearTimeout(stabilizeTimerRef.current);
      }
    };
  }, [getVideoElement, updateSrcDimensions, stabilizeMs]);

  // Track display dimension changes via ResizeObserver
  useEffect(() => {
    const videoEl = getVideoElement();
    if (!videoEl) return;

    updateDisplayDimensions();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(() => {
        updateDisplayDimensions();
      });
      resizeObserverRef.current.observe(videoEl);
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [getVideoElement, updateDisplayDimensions]);

  // Calculate upscale ratio and effects
  const { upscaleRatio, blurPx, shouldBlur, shouldCRT } = (() => {
    if (srcDimensions.width === 0 || srcDimensions.height === 0) {
      return { upscaleRatio: 1, blurPx: 0, shouldBlur: false, shouldCRT: false };
    }
    if (displayDimensions.width === 0 || displayDimensions.height === 0) {
      return { upscaleRatio: 1, blurPx: 0, shouldBlur: false, shouldCRT: false };
    }

    // Calculate effective rendered dimensions accounting for object-fit: contain
    // getBoundingClientRect returns element bounds, not actual video render area
    const srcAspect = srcDimensions.width / srcDimensions.height;
    const displayAspect = displayDimensions.width / displayDimensions.height;

    let effectiveWidth, effectiveHeight;
    if (srcAspect > displayAspect) {
      // Letterboxed (horizontal black bars) - width fills container
      effectiveWidth = displayDimensions.width;
      effectiveHeight = displayDimensions.width / srcAspect;
    } else {
      // Pillarboxed (vertical black bars) - height fills container (portrait videos)
      effectiveHeight = displayDimensions.height;
      effectiveWidth = displayDimensions.height * srcAspect;
    }

    // Now calculate actual scale ratio using effective dimensions
    const ratio = effectiveWidth / srcDimensions.width;

    const isUpscaled = ratio > 1.05; // small threshold to avoid floating point issues
    const isLowRes = srcDimensions.height <= CRT_MAX_HEIGHT;

    const blurFactor = presetConfig.aggressive ? BLUR_FACTOR_AGGRESSIVE : BLUR_FACTOR;
    const maxBlur = presetConfig.aggressive ? MAX_BLUR_PX_AGGRESSIVE : MAX_BLUR_PX;
    const calculatedBlur = isUpscaled
      ? Math.min(maxBlur, (ratio - 1) * blurFactor)
      : 0;

    return {
      upscaleRatio: ratio,
      blurPx: presetConfig.blur ? calculatedBlur : 0,
      shouldBlur: presetConfig.blur && isUpscaled,
      shouldCRT: presetConfig.crt && isLowRes
    };
  })();

  const isActive = isStabilized && (shouldBlur || shouldCRT);

  // Build effect styles for video element
  const effectStyles = {};
  if (isActive && blurPx > 0) {
    effectStyles.filter = `blur(${blurPx.toFixed(2)}px)`;
  }

  // Build overlay props for CRT effect
  const overlayProps = {
    showCRT: isActive && shouldCRT,
    className: `upscale-crt-overlay ${isActive && shouldCRT ? 'active' : ''}`
  };

  // Debug info for development
  const debug = {
    srcDimensions,
    displayDimensions,
    upscaleRatio: upscaleRatio.toFixed(2),
    blurPx: blurPx.toFixed(2),
    shouldBlur,
    shouldCRT,
    isStabilized,
    preset,
    presetConfig
  };

  return {
    effectStyles,
    overlayProps,
    isActive,
    debug
  };
}

export default useUpscaleEffects;
