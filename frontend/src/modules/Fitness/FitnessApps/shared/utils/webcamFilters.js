/**
 * Webcam Filter Utilities
 * 
 * Migrated from components/webcamFilters.js
 * Provides canvas filter functions for webcam effects.
 */

const MIN_SHARP_DIMENSION = 480;
const MAX_BLUR_PX = 14;

export const DEFAULT_FILTER_ID = 'mirrorAdaptive';

/**
 * Compute adaptive blur amount based on resolution
 * Higher resolution = more blur to smooth out details
 */
const computeAdaptiveBlur = (width, height) => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
  const minDimension = Math.min(width, height);
  if (minDimension <= MIN_SHARP_DIMENSION) return 0;
  const excess = minDimension - MIN_SHARP_DIMENSION;
  return Math.min(MAX_BLUR_PX, excess / 120);
};

/**
 * Apply adaptive mirror filter (default filter)
 */
const applyAdaptiveMirrorFilter = (ctx, video, width, height) => {
  const blurPx = computeAdaptiveBlur(width, height);
  const filterParts = ['saturate(2)', 'contrast(1.2)', 'brightness(1.2)'];
  if (blurPx > 0) {
    filterParts.push(`blur(${blurPx.toFixed(2)}px)`);
  }

  ctx.save();
  ctx.filter = filterParts.join(' ');
  ctx.translate(width, 0);
  ctx.scale(-1, 1); // mirror horizontally
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();
  ctx.filter = 'none';
};

/**
 * Available webcam filters
 */
export const webcamFilters = {
  none: {
    id: 'none',
    label: 'None',
    css: 'none',
    apply: (ctx, video, width, height) => {
      ctx.drawImage(video, 0, 0, width, height);
    },
  },
  
  mirror: {
    id: 'mirror',
    label: 'Mirror',
    css: 'none',
    transform: 'scaleX(-1)',
    apply: (ctx, video, width, height) => {
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, width, height);
      ctx.restore();
    },
  },
  
  grayscale: {
    id: 'grayscale',
    label: 'Grayscale',
    css: 'grayscale(1)',
    apply: (ctx, video, width, height) => {
      ctx.filter = 'grayscale(1)';
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';
    },
  },
  
  softBlur: {
    id: 'softBlur',
    label: 'Soft Blur',
    css: 'blur(2px) saturate(1.05)',
    apply: (ctx, video, width, height) => {
      ctx.filter = 'blur(2px) saturate(1.05)';
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';
    },
  },
  
  punchy: {
    id: 'punchy',
    label: 'Punchy',
    css: 'contrast(1.1) saturate(1.15) brightness(1.02)',
    apply: (ctx, video, width, height) => {
      ctx.filter = 'contrast(1.1) saturate(1.15) brightness(1.02)';
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';
    },
  },
  
  mirrorAdaptive: {
    id: 'mirrorAdaptive',
    label: 'Adaptive Mirror',
    css: 'saturate(2) contrast(1.2) brightness(1.2)',
    transform: 'scaleX(-1)',
    apply: (ctx, video, width, height) => {
      if (!width || !height) return;
      applyAdaptiveMirrorFilter(ctx, video, width, height);
    },
  },
  
  vignette: {
    id: 'vignette',
    label: 'Vignette',
    css: 'none',
    apply: (ctx, video, width, height) => {
      ctx.drawImage(video, 0, 0, width, height);
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) / 3,
        width / 2,
        height / 2,
        Math.max(width, height) / 1.2,
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    },
  },
  
  warm: {
    id: 'warm',
    label: 'Warm',
    css: 'sepia(0.2) saturate(1.2) brightness(1.05)',
    apply: (ctx, video, width, height) => {
      ctx.filter = 'sepia(0.2) saturate(1.2) brightness(1.05)';
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';
    },
  },
  
  cool: {
    id: 'cool',
    label: 'Cool',
    css: 'hue-rotate(180deg) saturate(0.8) brightness(1.1)',
    apply: (ctx, video, width, height) => {
      ctx.filter = 'saturate(0.9) brightness(1.05) contrast(1.05)';
      ctx.drawImage(video, 0, 0, width, height);
      // Add blue tint overlay
      ctx.fillStyle = 'rgba(100, 150, 255, 0.1)';
      ctx.fillRect(0, 0, width, height);
      ctx.filter = 'none';
    },
  },
};

/**
 * Get filter by ID
 * @param {string} id - Filter ID
 * @returns {Object} Filter object
 */
export const getWebcamFilter = (id) => {
  return webcamFilters[resolveFilterId(id)];
};

/**
 * Resolve filter ID (with fallback to default)
 * @param {string} id - Filter ID
 * @returns {string} Resolved filter ID
 */
export const resolveFilterId = (id) => {
  if (id && webcamFilters[id]) return id;
  return DEFAULT_FILTER_ID;
};

/**
 * Get all available filter IDs
 * @returns {string[]} Array of filter IDs
 */
export const getFilterIds = () => Object.keys(webcamFilters);

/**
 * Get filter options for select/dropdown
 * @returns {Array<{id: string, label: string}>}
 */
export const getFilterOptions = () => {
  return Object.values(webcamFilters).map(f => ({
    id: f.id,
    label: f.label
  }));
};

export default {
  webcamFilters,
  getWebcamFilter,
  resolveFilterId,
  getFilterIds,
  getFilterOptions,
  DEFAULT_FILTER_ID
};
