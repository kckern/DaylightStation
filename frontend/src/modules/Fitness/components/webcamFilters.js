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
  crt: {
    id: 'crt',
    label: 'CRT',
    css: 'contrast(1.05) saturate(1.1) brightness(0.98)',
    apply: (ctx, video, width, height) => {
      // Base draw
      ctx.filter = 'contrast(1.05) saturate(1.1) brightness(0.98)';
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';

      // Subtle scanlines
      const lineHeight = 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      for (let y = 0; y < height; y += lineHeight * 2) {
        ctx.fillRect(0, y, width, lineHeight);
      }

      // Color separation vignette
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) / 3,
        width / 2,
        height / 2,
        Math.max(width, height) / 1.05,
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Chromatic aberration fringe
      const offset = Math.max(1, Math.floor(Math.min(width, height) * 0.0025));
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(video, offset, 0, width, height);
      ctx.fillStyle = 'rgba(218, 49, 49, 0.08)';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(video, 0, offset, width, height);
      ctx.fillStyle = 'rgba(40, 129, 206, 0.08)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
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
  if (!id) return webcamFilters.crt;
  return webcamFilters[id] || webcamFilters.crt;
}
