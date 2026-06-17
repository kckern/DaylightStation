import { createCanvas, loadImage, registerFont } from 'canvas';

/**
 * Pure presentation: composite one 1080p time-lapse frame from plain image
 * buffers + a FrameDescriptor. No I/O, no adapter imports — buffers in, buffer out.
 *
 * Layout: camera hero (cover-fit) + player PiP (top-right) + title bar (top) +
 * bottom-third stat strip (avatar + name + HR, zone + rpm on the right).
 */
export function createTimelapseFrameRenderer(config = {}) {
  const [W, H] = config.resolution || [1920, 1080];
  const pip = config.pip || { enabled: true, size: [480, 270] };
  const fontFamily = 'Roboto Condensed';
  if (config.fontDir) {
    try {
      registerFont(`${config.fontDir}/roboto-condensed/RobotoCondensed-Regular.ttf`, { family: fontFamily });
    } catch { /* fall back to system fonts */ }
  }
  // node-canvas resolves an unknown family to a default face, so it is safe to
  // reference `fontFamily` even when registration was skipped.

  async function renderFrame({ cameraBuffer, playerBuffer, avatarBuffers = {}, descriptor }) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Camera hero — cover-fit
    if (cameraBuffer) drawCover(ctx, await loadImage(cameraBuffer), 0, 0, W, H);

    const titleBarH = config.title_bar === false ? 0 : Math.round(H * 0.052);

    // Player PiP — top-right with border
    if (pip.enabled && playerBuffer) {
      const [pw, ph] = pip.size;
      const pad = Math.round(W * 0.0125);
      const px = W - pw - pad;
      const py = titleBarH + pad;
      ctx.fillStyle = '#000';
      ctx.fillRect(px - 4, py - 4, pw + 8, ph + 8);
      drawCover(ctx, await loadImage(playerBuffer), px, py, pw, ph);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(px, py, pw, ph);
    }

    // Title bar (top)
    if (titleBarH > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, titleBarH);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `600 ${Math.round(titleBarH * 0.55)}px "${fontFamily}"`;
      ctx.fillText(descriptor.title || 'Workout', Math.round(W * 0.0125), titleBarH / 2);
      ctx.textAlign = 'right';
      ctx.fillText(formatElapsed(descriptor.elapsedRealMs), W - Math.round(W * 0.0125), titleBarH / 2);
      ctx.textAlign = 'left';
    }

    // Bottom-third stat strip
    if (config.stat_strip !== false) {
      const stripH = Math.round(H / 6);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, H - stripH, W, stripH);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const cy = H - stripH / 2;
      const fontPx = Math.round(stripH * 0.32);
      const avatarD = Math.round(stripH * 0.6);
      let x = Math.round(W * 0.0125);
      for (const p of descriptor.participants || []) {
        const avatar = avatarBuffers[p.id];
        if (avatar) {
          drawCircleImage(ctx, await loadImage(avatar), x, cy - avatarD / 2, avatarD);
          x += avatarD + 12;
        }
        ctx.fillStyle = p.color || '#fff';
        ctx.font = `600 ${fontPx}px "${fontFamily}"`;
        const label = `${p.displayName} ${p.hr ?? '--'}♥`;
        ctx.fillText(label, x, cy);
        x += ctx.measureText(label).width + 40;
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${fontPx}px "${fontFamily}"`;
      const right = [
        descriptor.zone ? String(descriptor.zone).toUpperCase() : null,
        descriptor.rpm != null ? `${descriptor.rpm} rpm` : null
      ].filter(Boolean).join('    ');
      if (right) ctx.fillText(right, W - Math.round(W * 0.0125), cy);
      ctx.textAlign = 'left';
    }

    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
  }

  return { renderFrame };
}

function drawCover(ctx, img, dx, dy, dw, dh) {
  const scale = Math.max(dw / img.width, dh / img.height);
  const sw = dw / scale, sh = dh / scale;
  const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawCircleImage(ctx, img, x, y, d) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  ctx.clip();
  drawCover(ctx, img, x, y, d, d);
  ctx.restore();
}

function formatElapsed(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
