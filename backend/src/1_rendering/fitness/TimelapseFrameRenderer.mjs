import { createCanvas, loadImage, registerFont } from 'canvas';
import { fileURLToPath } from 'node:url';

/**
 * Pure presentation: composite one time-lapse frame from plain image buffers +
 * a FrameDescriptor. No I/O beyond bundled-font registration; buffers in, buffer out.
 *
 * Structure (NOT overlays — the camera is inset between solid bands):
 *   ┌───────────── title band (solid) ─────────────┐
 *   │  Daytona USA 2001                     14:32   │
 *   ├───────────────────────────────────────────────┤
 *   │   ┌─ camera (inset, margin around) ─┐ ┌ PiP ┐ │
 *   │   │              CAMERA             │ └─────┘ │
 *   │   └────────────────────────────────┘         │
 *   ├───────────── stat band (solid) ──────────────┤
 *   │  KC  142♥   Guest 128♥        HOT     86 rpm  │
 *   └───────────────────────────────────────────────┘
 *
 * Heart-rate readouts use fixed-width slots so the numbers don't jitter as they
 * animate frame to frame (the ♥ and following participant stay put).
 */

const FONT_FAMILY = 'Roboto Condensed';
let _fontsRegistered = false;

function ensureFonts(fontDir) {
  if (_fontsRegistered) return;
  const base = fontDir
    ? `${fontDir}/roboto-condensed`
    : fileURLToPath(new URL('../../../assets/fonts/roboto-condensed', import.meta.url));
  try {
    registerFont(`${base}/RobotoCondensed-Regular.ttf`, { family: FONT_FAMILY, weight: 'normal' });
    registerFont(`${base}/RobotoCondensed-SemiBold.ttf`, { family: FONT_FAMILY, weight: '600' });
    _fontsRegistered = true;
  } catch {
    // fall back to system fonts if the bundled faces are unavailable
  }
}

export function createTimelapseFrameRenderer(config = {}) {
  const [W, H] = config.resolution || [1920, 1080];
  const pip = config.pip || { enabled: true, size: [480, 270] };
  ensureFonts(config.fontDir);

  const BG = '#0d0d0d';
  const BAND = '#161616';
  const BORDER = 'rgba(255,255,255,0.14)';
  const titleH = config.title_bar === false ? 0 : Math.round(H * 0.075);
  const footerH = config.stat_strip === false ? 0 : Math.round(H * 0.14);
  const marginX = Math.round(W * 0.03);
  const marginY = Math.round(H * 0.04);

  async function renderFrame({ cameraBuffer, playerBuffer, posterBuffer = null, avatarBuffers = {}, descriptor }) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Solid background fills the whole canvas (content is inset on top)
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const contentTop = titleH + marginY;
    const contentBottom = H - footerH - marginY;
    const contentH = contentBottom - contentTop;

    // Right rail (PiP -> poster -> coin counter), reserved on the right side.
    const railW = pip.enabled ? pip.size[0] : Math.round(W * 0.25);
    const railX = W - marginX - railW;
    const railGap = Math.round(W * 0.02);

    // Camera: native aspect ratio preserved (contain, NOT cropped), left-aligned,
    // vertically centered. It only spans the space left of the rail.
    const camRegionX = marginX;
    const camRegionW = railX - railGap - marginX;
    if (cameraBuffer && camRegionW > 0 && contentH > 0) {
      const img = await loadImage(cameraBuffer);
      const { x, y, w, h } = containRect(img.width, img.height, camRegionX, contentTop, camRegionW, contentH, 'left');
      ctx.drawImage(img, x, y, w, h);
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }

    let railY = contentTop;
    // Player PiP at the top of the rail
    if (pip.enabled && playerBuffer) {
      const pw = railW;
      const ph = Math.round(pw * 9 / 16);
      ctx.fillStyle = '#000';
      ctx.fillRect(railX - 4, railY - 4, pw + 8, ph + 8);
      drawCover(ctx, await loadImage(playerBuffer), railX, railY, pw, ph);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(railX, railY, pw, ph);
      railY += ph + railGap;
    }

    // Poster fills the remaining rail height below the PiP.
    const posterAreaH = contentBottom - railY;
    if (posterBuffer && posterAreaH > Math.round(H * 0.08)) {
      const img = await loadImage(posterBuffer);
      const { x, y, w, h } = containRect(img.width, img.height, railX, railY, railW, posterAreaH, 'center');
      ctx.drawImage(img, x, y, w, h);
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }

    // Title band (solid border band, not an overlay):
    // left = show — episode, center = animated coin counter, right = elapsed.
    if (titleH > 0) {
      ctx.fillStyle = BAND;
      ctx.fillRect(0, 0, W, titleH);
      ctx.fillStyle = BORDER;
      ctx.fillRect(0, titleH - 2, W, 2);
      const fpx = Math.round(titleH * 0.5);
      const cy = titleH / 2;
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `600 ${fpx}px "${FONT_FAMILY}"`;
      ctx.fillText(buildTitle(descriptor), marginX, cy, W * 0.42);
      ctx.textAlign = 'right';
      ctx.font = `normal ${fpx}px "${FONT_FAMILY}"`;
      ctx.fillText(formatElapsed(descriptor.elapsedRealMs), W - marginX, cy);

      // Coins centered between title and time
      if (descriptor.coins != null) {
        const labelPx = Math.round(fpx * 0.6);
        const valPx = fpx;
        const label = 'COINS ';
        const val = formatCoins(descriptor.coins);
        ctx.font = `600 ${labelPx}px "${FONT_FAMILY}"`;
        const lw = ctx.measureText(label).width;
        ctx.font = `600 ${valPx}px "${FONT_FAMILY}"`;
        const vw = ctx.measureText(val).width;
        const startX = Math.round(W / 2 - (lw + vw) / 2);
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `600 ${labelPx}px "${FONT_FAMILY}"`;
        ctx.fillText(label, startX, cy + 1);
        ctx.fillStyle = '#ffd54a';
        ctx.font = `600 ${valPx}px "${FONT_FAMILY}"`;
        ctx.fillText(val, startX + lw, cy);
      }
      ctx.textAlign = 'left';
    }

    // Stat band (solid border band)
    if (footerH > 0) {
      const top = H - footerH;
      ctx.fillStyle = BAND;
      ctx.fillRect(0, top, W, footerH);
      ctx.fillStyle = BORDER;
      ctx.fillRect(0, top, W, 2);

      const cy = top + footerH / 2;
      const fpx = Math.round(footerH * 0.3);
      const avatarD = Math.round(footerH * 0.56);
      const participants = descriptor.participants || [];

      // Layout rule for no time-jitter: names are static, so advance past them
      // by their measured width; only the *changing* HR number gets a fixed-width,
      // right-aligned cell (sized for 3 digits) so the ♥ and the next participant
      // never shift as the number animates.
      const hrCellW = Math.round(fpx * 1.7);  // fixed cell: up to 3 digits
      const numGap = Math.round(fpx * 0.28);  // name → number
      const heartGap = Math.round(fpx * 0.22); // number → heart
      const groupGap = Math.round(fpx * 0.9);  // participant → participant
      ctx.font = `600 ${fpx}px "${FONT_FAMILY}"`;

      ctx.textBaseline = 'middle';
      let x = marginX;
      for (const p of participants) {
        const avatar = avatarBuffers[p.id];
        if (avatar) {
          drawCircleImage(ctx, await loadImage(avatar), x, cy - avatarD / 2, avatarD);
          x += avatarD + Math.round(fpx * 0.3);
        }
        ctx.fillStyle = p.color || '#fff';
        ctx.font = `600 ${fpx}px "${FONT_FAMILY}"`;
        ctx.textAlign = 'left';
        const name = p.displayName ?? '';
        ctx.fillText(name, x, cy);
        x += ctx.measureText(name).width + numGap;
        // HR number right-aligned within its fixed cell
        ctx.textAlign = 'right';
        ctx.fillText(p.hr != null ? String(p.hr) : '--', x + hrCellW, cy);
        x += hrCellW + heartGap;
        // Heart at a fixed position after the cell
        ctx.textAlign = 'left';
        ctx.fillStyle = p.color || '#ff5252';
        ctx.fillText('♥', x, cy);
        x += Math.round(fpx * 1.1) + groupGap;
      }

      // Right region: zone label at a fixed x + rpm right-aligned (fixed right edge),
      // so neither jitters as values change.
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${fpx}px "${FONT_FAMILY}"`;
      const rpmFieldW = Math.round(W * 0.11);
      if (descriptor.zone) {
        ctx.textAlign = 'left';
        ctx.fillText(String(descriptor.zone).toUpperCase(), W - marginX - rpmFieldW - Math.round(W * 0.1), cy);
      }
      if (descriptor.rpm != null) {
        ctx.textAlign = 'right';
        ctx.fillText(`${descriptor.rpm} rpm`, W - marginX, cy);
      }
      ctx.textAlign = 'left';
    }

    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
  }

  return { renderFrame };
}

// Contain-fit: preserve aspect ratio, no cropping. align = 'left' | 'center'.
function containRect(iw, ih, rx, ry, rw, rh, align = 'center') {
  const scale = Math.min(rw / iw, rh / ih);
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  const x = align === 'left' ? rx : rx + Math.round((rw - w) / 2);
  const y = ry + Math.round((rh - h) / 2);
  return { x, y, w, h };
}

function buildTitle(descriptor) {
  const show = descriptor.showTitle;
  const ep = descriptor.title;
  if (show && ep && show !== ep) return `${show} — ${ep}`;
  return ep || show || 'Workout';
}

function formatCoins(n) {
  return Number(n).toLocaleString('en-US');
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
