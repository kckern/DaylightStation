// frontend/src/modules/Player/hooks/useUpscaleEffects.js
import { useState, useEffect } from 'react';

// Blur calculation constants
const BLUR_FACTOR = 1.2;      // px of blur per 1x upscale
const MAX_BLUR_PX = 4;        // cap to prevent over-softening
const BLUR_FACTOR_AGGRESSIVE = 2.0;
const MAX_BLUR_PX_AGGRESSIVE = 6;

// CRT threshold: the CRT is for SUB-SD sources — narrower than 640 AND shorter
// than 480. 640 wide is square-pixel SD (what a DVD's 720 becomes), so 640x360
// and a 768x432 widescreen file stay clean; height alone put the CRT on the
// latter (2026-10-09). 480x360 and 320x240 still get it.
const SD_WIDTH = 640;
const SD_HEIGHT = 480;

// Timing
const DEFAULT_STABILIZE_MS = 1500;
const EMPTY_DIMENSIONS = { width: 0, height: 0 };

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
 * @param {HTMLVideoElement|null} options.video - current native video element
 * @param {string} options.preset - 'auto' | 'blur-only' | 'crt-only' | 'aggressive' | 'none'
 * @param {number} options.stabilizeMs - delay before applying effects (default 1500)
 * @returns {Object} { effectStyles, overlayProps, isActive, debug }
 */
export function useUpscaleEffects({
  video,
  preset = 'auto',
  stabilizeMs = DEFAULT_STABILIZE_MS
} = {}) {
  const [measurement, setMeasurement] = useState(null);
  const { srcDimensions = EMPTY_DIMENSIONS, displayDimensions = EMPTY_DIMENSIONS, isStabilized = false } =
    measurement && measurement.video === video ? measurement : {};
  const presetConfig = PRESETS[preset] || PRESETS.auto;

  useEffect(() => {
    if (!video) return;
    const current = { video, srcDimensions: EMPTY_DIMENSIONS, displayDimensions: EMPTY_DIMENSIONS, isStabilized: false };
    let stabilization;
    let retired = false;

    function publish() {
      if (!retired) setMeasurement({ ...current });
    }

    function measureDisplay() {
      if (retired) return;
      const rect = video.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width > 0 && height > 0 && (current.displayDimensions.width !== width || current.displayDimensions.height !== height)) {
        current.displayDimensions = { width, height };
        publish();
      }
    }

    function measureSource() {
      if (retired) return;
      const { videoWidth: width, videoHeight: height } = video;
      if (width > 0 && height > 0) current.srcDimensions = { width, height };
      current.isStabilized = false;
      publish();
      clearTimeout(stabilization);
      stabilization = setTimeout(() => {
        current.isStabilized = true;
        publish();
      }, stabilizeMs);
    }

    video.addEventListener('loadedmetadata', measureSource);
    video.addEventListener('resize', measureSource);
    measureDisplay();
    if (video.videoWidth > 0) measureSource();

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureDisplay);
    observer?.observe(video);
    return () => {
      retired = true;
      observer?.disconnect();
      clearTimeout(stabilization);
      video.removeEventListener('loadedmetadata', measureSource);
      video.removeEventListener('resize', measureSource);
    };
  }, [video, stabilizeMs]);

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

    let effectiveWidth;
    if (srcAspect > displayAspect) {
      // Letterboxed (horizontal black bars) - width fills container
      effectiveWidth = displayDimensions.width;
    } else {
      // Pillarboxed (vertical black bars) - height fills container (portrait videos)
      effectiveWidth = displayDimensions.height * srcAspect;
    }

    // Now calculate actual scale ratio using effective dimensions
    const ratio = effectiveWidth / srcDimensions.width;

    const isUpscaled = ratio > 1.05; // small threshold to avoid floating point issues
    const isLowRes = srcDimensions.width < SD_WIDTH && srcDimensions.height < SD_HEIGHT;

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

  // Check loop state synchronously - looped videos skip upscale effects for performance
  const isLooping = video?.loop === true;

  // Disable effects for looped videos (performance optimization for continuous playback)
  const isActive = isStabilized && !isLooping && (shouldBlur || shouldCRT);

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

  // Calculate effective dimensions for debug (repeat logic for debug output)
  const srcAspect = srcDimensions.width / srcDimensions.height || 1;
  const displayAspect = displayDimensions.width / displayDimensions.height || 1;
  const effectiveDimensions = srcAspect > displayAspect
    ? { width: displayDimensions.width, height: Math.round(displayDimensions.width / srcAspect) }
    : { width: Math.round(displayDimensions.height * srcAspect), height: displayDimensions.height };

  // Debug info for development
  const debug = {
    srcDimensions,
    displayDimensions,
    effectiveDimensions,
    upscaleRatio: upscaleRatio.toFixed(2),
    blurPx: blurPx.toFixed(2),
    shouldBlur,
    shouldCRT,
    isStabilized,
    isLooping,
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
