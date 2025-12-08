const MIN_SHARP_DIMENSION = 480;
const MAX_BLUR_PX = 14;
export const DEFAULT_FILTER_ID = 'mirrorAdaptive';

const computeAdaptiveBlur = (width, height) => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
  const minDimension = Math.min(width, height);
  if (minDimension <= MIN_SHARP_DIMENSION) return 0;
  const excess = minDimension - MIN_SHARP_DIMENSION;
  return Math.min(MAX_BLUR_PX, excess / 120);
};

const applyAdaptiveMirrorFilter = (ctx, video, width, height) => {
  const blurPx = computeAdaptiveBlur(width, height);
  const filterParts = ['saturate(2)', 'contrast(1.2)', 'brightness(1.2)'];
  if (blurPx > 0) {
    filterParts.push(`blur(${blurPx.toFixed(2)}px)`);
  }

  ctx.save();
  ctx.filter = filterParts.join(' ');
  ctx.translate(width, 0);
  ctx.scale(-1, 1); // mirror horizontally so subject faces themselves
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();
  ctx.filter = 'none';
};

export const webcamFilters = {
  none: {
    id: 'none',
    label: 'None',
    css: 'none',
    apply: (ctx, video, width, height) => {
      ctx.drawImage(video, 0, 0, width, height);
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
};

export function getWebcamFilter(id) {
  return webcamFilters[resolveFilterId(id)];
}

export function resolveFilterId(id) {
  if (id && webcamFilters[id]) return id;
  return DEFAULT_FILTER_ID;
}
