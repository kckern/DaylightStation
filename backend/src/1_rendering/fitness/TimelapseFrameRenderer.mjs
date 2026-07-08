import canvasPkg from 'canvas';
import { fileURLToPath } from 'node:url';
import { ZONE_COLORS } from '#domains/fitness/entities/Zone.mjs';
import { timelapseFrameTheme } from './timelapseFrameTheme.mjs';

const { createCanvas, loadImage, registerFont } = canvasPkg;

/**
 * Pure presentation: composite one time-lapse frame from plain image buffers +
 * a FrameDescriptor. No I/O beyond bundled-font registration; buffers in, buffer out.
 *
 * Full-bleed cinematic layout:
 *   - The camera fills the WHOLE frame (cover-crop, un-mirrored) — it is the hero,
 *     so there is no dead letterbox or empty rail.
 *   - A top gradient scrim carries the title (left), coin counter (centre) and
 *     elapsed time (right); a bottom scrim carries the per-participant HR readouts
 *     (left) and the session zone + cadence (right).
 *   - The player PiP and show poster float as rounded cards over the camera.
 *
 * Icons (heart, coin) are drawn as native canvas vector paths, NOT font glyphs —
 * Roboto Condensed has no ♥/coin glyph, so a font-drawn symbol renders as a
 * `.notdef` tofu box (the literal "2665" codepoint box seen in the wild). Vector
 * paths always render and stay crisp at any scale.
 *
 * Everything is drawn at `supersample`× then downscaled once, so text and 1px
 * strokes are antialiased rather than jagged.
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
    registerFont(`${base}/RobotoCondensed-Bold.ttf`, { family: FONT_FAMILY, weight: '700' });
    _fontsRegistered = true;
  } catch {
    // fall back to system fonts if the bundled faces are unavailable
  }
}

const COL = timelapseFrameTheme.colors;
const LAYOUT = timelapseFrameTheme.layout;

export function createTimelapseFrameRenderer(config = {}) {
  const [OUT_W, OUT_H] = config.resolution || [1920, 1080];
  const SS = Math.max(1, config.supersample ?? 2);
  const W = OUT_W * SS;
  const H = OUT_H * SS;

  const pip = config.pip || { enabled: true, size: [480, 270] };
  // Recap camera frames are now captured RAW + un-mirrored at the source
  // (SessionCameraCapture uses filterId="none"), so no flip is needed here.
  // `config.camera.flip = true` re-mirrors, for older sessions captured with the
  // legacy mirrorAdaptive filter.
  const flipCamera = config.camera?.flip ?? false;
  const showScrims = config.title_bar !== false;
  const showStats = config.stat_strip !== false;
  ensureFonts(config.fontDir);

  const margin = Math.round(W * LAYOUT.marginRatio);
  const headerH = showScrims ? Math.round(H * LAYOUT.headerHRatio) : 0;
  const footerH = showStats ? Math.round(H * LAYOUT.footerHRatio) : 0;
  const titleFpx = Math.round(H * LAYOUT.titleFontRatio);

  async function renderFrame({ cameraBuffer, playerBuffer, posterBuffer = null, avatarBuffers = {}, equipmentBuffers = {}, descriptor }) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'middle';

    // Bands span the full width; the content fills the band-to-band space edge to
    // edge — no gutters, no card borders.
    ctx.fillStyle = COL.bgFallback;
    ctx.fillRect(0, 0, W, H);
    const contentTop = headerH;
    const contentBottom = H - footerH;
    const contentH = contentBottom - contentTop;
    const seam = Math.round(W * LAYOUT.seamRatio);

    // ---- Camera: RIGHT side, fills the full vertical space, flush to the right /
    // top / bottom edges, no border — the hero panel (shown whole at ~4:3).
    let colRight = W;
    if (cameraBuffer) {
      const img = await loadImage(cameraBuffer);
      const camW = Math.round(contentH * (img.width / img.height));
      const camX = W - camW;
      drawPanel(ctx, img, camX, contentTop, camW, contentH, { flip: flipCamera });
      colRight = camX - seam;
    }

    // ---- Left column: live game (dominant) over the session race-chart, filling
    // the remaining width flush to the left edge.
    const colW = colRight;
    if (colW > Math.round(W * 0.05)) {
      const hasPip = pip.enabled && playerBuffer;
      const lowerH = Math.round(contentH * 0.3);
      const gameH = hasPip ? contentH - lowerH - seam : 0;
      if (hasPip) drawPanel(ctx, await loadImage(playerBuffer), 0, contentTop, colW, gameH, {});
      const lowerY = hasPip ? contentTop + gameH + seam : contentTop;
      const lowerHh = hasPip ? lowerH : contentH;
      if (descriptor.chart) {
        drawChart(ctx, descriptor.chart, 0, lowerY, colW, lowerHh);
      } else if (posterBuffer) {
        drawPanel(ctx, await loadImage(posterBuffer), 0, lowerY, colW, lowerHh, {});
      }
    }

    // ---- Header band: title (left) · coin counter (centre) · elapsed (right).
    if (showScrims) {
      drawBand(ctx, 0, 0, W, headerH, 'bottom');
      const cy = Math.round(headerH * 0.5);

      ctx.fillStyle = COL.text;
      ctx.textAlign = 'left';
      ctx.font = `700 ${titleFpx}px "${FONT_FAMILY}"`;
      const timeStr = formatElapsed(descriptor.elapsedRealMs);
      ctx.font = `600 ${titleFpx}px "${FONT_FAMILY}"`;
      const timeW = ctx.measureText(timeStr).width;

      // Coin cluster (centre): vector coin + value. Measured so it stays centred.
      let coinClusterW = 0;
      const coinR = Math.round(titleFpx * 0.42);
      const coinGap = Math.round(titleFpx * 0.32);
      const coinVal = descriptor.coins != null ? formatCoins(descriptor.coins) : null;
      ctx.font = `700 ${titleFpx}px "${FONT_FAMILY}"`;
      const coinValW = coinVal != null ? ctx.measureText(coinVal).width : 0;
      if (coinVal != null) coinClusterW = coinR * 2 + coinGap + coinValW;

      // Title (left) — truncate with ellipsis so it never collides with coins/time.
      const titleMax = W / 2 - coinClusterW / 2 - margin * 2;
      ctx.fillStyle = COL.text;
      ctx.textAlign = 'left';
      ctx.font = `700 ${titleFpx}px "${FONT_FAMILY}"`;
      ctx.fillText(ellipsize(ctx, buildTitle(descriptor), titleMax), margin, cy);

      // Right cluster: the session count-up (top, prominent) over the wall-clock
      // date + time-of-day (bottom, dim) — both elapsed and real time are readable.
      const wall = formatWallClock(descriptor.wallClockMs, descriptor.timezone);
      ctx.textAlign = 'right';
      ctx.font = `700 ${titleFpx}px "${FONT_FAMILY}"`;
      ctx.fillStyle = COL.text;
      ctx.fillText(timeStr, W - margin, wall ? cy - Math.round(headerH * 0.16) : cy);
      if (wall) {
        ctx.font = `600 ${Math.round(titleFpx * 0.5)}px "${FONT_FAMILY}"`;
        ctx.fillStyle = COL.textDim;
        ctx.fillText(wall, W - margin, cy + Math.round(headerH * 0.26));
      }

      // Coins (centre).
      if (coinVal != null) {
        const startX = Math.round(W / 2 - coinClusterW / 2);
        drawCoin(ctx, startX + coinR, cy, coinR);
        ctx.textAlign = 'left';
        ctx.font = `700 ${titleFpx}px "${FONT_FAMILY}"`;
        ctx.fillStyle = COL.coin;
        ctx.fillText(coinVal, startX + coinR * 2 + coinGap, cy);
      }
    }

    // ---- Footer band: participant chips (left grid) + zone pill & cadence (right).
    if (showStats) {
      drawBand(ctx, 0, H - footerH, W, footerH, 'top');
      const centerY = H - Math.round(footerH * 0.5);
      const participants = descriptor.participants || [];

      // Circular meters (rider avatars AND bike RPM icons) share ONE diameter so
      // the two families read as the same gauge — a user's ring is exactly the size
      // of an RPM device's ring, and they scale together off the band height.
      const meterD = Math.round(footerH * 0.46);

      // Active bikes (equipment icon + RPM, in each bike's cadence colour),
      // right-anchored. The icon identifies WHICH device each cadence belongs to —
      // cadence isn't rider-attributed, so it stays device-labelled, not a bare number.
      let rightLimit = W - margin;
      if (descriptor.cadence?.length) {
        rightLimit = await drawCadenceCluster(ctx, descriptor.cadence, equipmentBuffers, W - margin, centerY, footerH, meterD);
      }

      // Per-participant chips. Each chip is snug to its natural content width, and
      // the whole block is centred in the region left of any cadence cluster — so a
      // solo rider sits mid-bar instead of stranded at the left edge. When the riders
      // would overflow, slots shrink to share the space (drawParticipant scales text).
      if (participants.length) {
        const region = Math.max(0, (rightLimit - Math.round(footerH * 0.25)) - margin);
        const natural = naturalChipWidth(ctx, footerH, meterD);
        const slotW = Math.min(natural, Math.floor(region / participants.length));
        const blockW = slotW * participants.length;
        const startX = margin + Math.max(0, Math.round((region - blockW) / 2));
        for (let i = 0; i < participants.length; i++) {
          await drawParticipant(ctx, participants[i], startX + i * slotW, centerY, slotW, footerH, avatarBuffers, meterD);
        }
      }
    }

    // ---- Downscale once to the output resolution (crisp text / edges).
    if (SS === 1) return canvas.toBuffer('image/jpeg', { quality: 0.92 });
    const out = createCanvas(OUT_W, OUT_H);
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(canvas, 0, 0, OUT_W, OUT_H);
    return out.toBuffer('image/jpeg', { quality: 0.92 });
  }

  return { renderFrame };
}

// ---------------------------------------------------------------- participants

// Two-line stat chip: avatar ring carries IDENTITY (participant color), the heart
// carries that person's HR ZONE (cool→blue … hot→red), over a big white HR number
// (the hero stat). The HR sits in a fixed 3-digit cell so the heart never jitters
// as digits change frame to frame.
// Snug width of one chip: avatar + gap + 3-digit HR cell + heart + trailing pad,
// plus an inter-chip breathing gap. Used to size/centre the chip block.
function naturalChipWidth(ctx, scrimH, meterD) {
  const hrFpx = Math.round(scrimH * 0.34);
  const D = meterD ?? Math.round(scrimH * 0.46);
  const gap = Math.round(scrimH * 0.1);
  ctx.font = `700 ${hrFpx}px "${FONT_FAMILY}"`;
  const hrCellW = ctx.measureText('000').width;
  const heart = Math.round(hrFpx * 0.72) + Math.round(hrFpx * 0.22);
  return D + gap + hrCellW + heart + Math.round(scrimH * 0.06) + Math.round(scrimH * 0.35);
}

async function drawParticipant(ctx, p, slotX, centerY, slotW, scrimH, avatarBuffers, meterD) {
  const color = p.color || COL.text;
  const heartColor = p.zone ? zoneMeta(p.zone).color : COL.heart;
  // The avatar ring is a shared-size meter (matches the RPM device rings) and is
  // NOT shrunk — only the text scales to fit, so every gauge circle stays equal.
  const D = meterD ?? Math.round(scrimH * 0.46);
  let hrFpx = Math.round(scrimH * 0.34);
  let nameFpx = Math.round(scrimH * 0.17);
  let gap = Math.round(scrimH * 0.1);

  // Scale only the text cluster down (never up) so the big HR + heart fit beside
  // the fixed-size avatar within the slot.
  ctx.font = `700 ${hrFpx}px "${FONT_FAMILY}"`;
  const textNaturalW = ctx.measureText('000').width + Math.round(hrFpx * 0.94) + Math.round(scrimH * 0.06);
  const textAvail = slotW - D - gap;
  const scale = Math.min(1, textAvail / textNaturalW);
  if (scale < 1) {
    hrFpx = Math.round(hrFpx * scale);
    nameFpx = Math.round(nameFpx * scale); gap = Math.round(gap * scale);
  }

  let x = slotX;
  const avatar = avatarBuffers[p.id];
  if (avatar) {
    drawCircleImage(ctx, await loadImage(avatar), x, centerY - D / 2, D, color);
    x += D + gap;
  } else {
    const r = Math.round(D * 0.2);
    ctx.beginPath(); ctx.arc(x + r, centerY, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    x += r * 2 + gap;
  }

  ctx.font = `700 ${hrFpx}px "${FONT_FAMILY}"`;
  const hrCellW = ctx.measureText('000').width;
  const heartSize = Math.round(hrFpx * 0.72);
  const textW = slotX + slotW - x - Math.round(scrimH * 0.06);

  // Name (top, muted, ellipsized to the chip width).
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${nameFpx}px "${FONT_FAMILY}"`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(ellipsize(ctx, participantName(p), textW), x, centerY - Math.round(hrFpx * 0.2));

  // HR (bottom, the hero number) + fixed-cell zone-coloured heart.
  ctx.font = `700 ${hrFpx}px "${FONT_FAMILY}"`;
  ctx.fillStyle = COL.text;
  const hr = p.hr != null ? String(p.hr) : '--';
  const hrBaseY = centerY + Math.round(hrFpx * 0.8);
  ctx.fillText(hr, x, hrBaseY);
  drawHeart(ctx, x + hrCellW + Math.round(hrFpx * 0.22), hrBaseY - Math.round(hrFpx * 0.34), heartSize, heartColor);
  ctx.textBaseline = 'middle';
}

// A participant chip never shows the poisoned literal "Unknown" — fall through to
// any id we have rather than render a dead label. (Real fix is upstream resolution.)
function participantName(p) {
  let n = (p.displayName ?? '').trim();
  if (!n || n.toLowerCase() === 'unknown') n = (p.id != null && String(p.id).trim()) || 'Guest';
  // Title-case bare lowercase slugs (felix → Felix) but leave mixed-case names
  // alone (KC Kern stays KC Kern).
  if (n === n.toLowerCase()) n = n.replace(/\b\w/g, c => c.toUpperCase());
  return n;
}

// Active-bike cadence cluster: [equipment icon][rpm RPM] per bike, laid out
// right-to-left from rightX, each in its bike's cadence colour. The icon names the
// device. Returns the left edge reached (so chips don't overrun it).
async function drawCadenceCluster(ctx, cadence, equipmentBuffers, rightX, centerY, bandH, meterD) {
  const iconD = meterD ?? Math.round(bandH * 0.46); // shared meter size (== rider avatar ring)
  const numFpx = Math.round(bandH * 0.32);
  const unitFpx = Math.round(numFpx * 0.45);
  const baseY = centerY + Math.round(numFpx * 0.36);
  const gap = Math.round(bandH * 0.1);
  const entryGap = Math.round(bandH * 0.32);
  let x = rightX;
  for (let i = cadence.length - 1; i >= 0; i--) {
    const c = cadence[i];
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right';
    ctx.font = `600 ${unitFpx}px "${FONT_FAMILY}"`;
    ctx.fillStyle = COL.textDim;
    ctx.fillText('RPM', x, baseY);
    x -= ctx.measureText('RPM').width + Math.round(numFpx * 0.14);
    ctx.font = `700 ${numFpx}px "${FONT_FAMILY}"`;
    ctx.fillStyle = c.color || COL.text;
    const rpmStr = String(c.rpm);
    ctx.fillText(rpmStr, x, baseY);
    x -= ctx.measureText(rpmStr).width + gap;
    const iconX = x - iconD;
    const buf = equipmentBuffers?.[c.equipment];
    if (buf) {
      drawCircleImage(ctx, await loadImage(buf), iconX, centerY - iconD / 2, iconD, c.color || COL.cardBorder);
    } else {
      ctx.beginPath(); ctx.arc(iconX + iconD / 2, centerY, iconD / 2, 0, Math.PI * 2);
      ctx.fillStyle = c.color || COL.textDim; ctx.fill();
    }
    x = iconX - entryGap;
  }
  ctx.textBaseline = 'middle';
  return x;
}

// ----------------------------------------------------------------- primitives

// Solid header/footer band with a hairline accent on its content-facing edge.
function drawBand(ctx, x, y, w, h, accent) {
  ctx.fillStyle = 'rgba(16,18,22,0.94)';
  ctx.fillRect(x, y, w, h);
  const t = Math.max(2, Math.round(h * 0.018));
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x, accent === 'bottom' ? y + h - t : y, w, t);
}

// Zone series persist single-letter codes (h/m/w/a/c); also accept full words.
// Color values are sourced from the domain canonical palette (ZONE_COLORS) so the
// recap stays in sync with the live/UI zone colors; only labels are renderer-local.
// The recap taxonomy's top code is 'm'/'max' (== the domain's 'fire' zone).
function zoneMeta(zone) {
  switch (String(zone).toLowerCase()) {
    case 'h': case 'hot': return { label: 'HOT', color: ZONE_COLORS.hot };
    case 'm': case 'max': return { label: 'MAX', color: ZONE_COLORS.fire };
    case 'w': case 'warm': return { label: 'WARM', color: ZONE_COLORS.warm };
    case 'a': case 'active': return { label: 'ACTIVE', color: ZONE_COLORS.active };
    case 'c': case 'cool': case 'cold': return { label: 'COOL', color: ZONE_COLORS.cool };
    default: return { label: String(zone).toUpperCase(), color: '#d9d9d9' };
  }
}

// Heart as two bezier lobes meeting at a bottom tip. x = left edge, cy = vertical
// centre, size = box width≈height; the shape fills [x, x+size].
function drawHeart(ctx, x, cy, size, color) {
  const cx = x + size / 2;
  const top = cy - size / 2;
  const w = size, h = size;
  const notch = h * 0.3;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, top + notch);
  ctx.bezierCurveTo(cx, top, cx - w / 2, top, cx - w / 2, top + notch);
  ctx.bezierCurveTo(cx - w / 2, top + (h + notch) / 2, cx, top + (h + notch) / 2, cx, top + h);
  ctx.bezierCurveTo(cx, top + (h + notch) / 2, cx + w / 2, top + (h + notch) / 2, cx + w / 2, top + notch);
  ctx.bezierCurveTo(cx + w / 2, top, cx, top, cx, top + notch);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawCoin(ctx, cx, cy, r) {
  ctx.save();
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.2, cx, cy, r);
  g.addColorStop(0, '#ffe79a');
  g.addColorStop(1, COL.coin);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.strokeStyle = COL.coinRim; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(200,150,31,0.6)'; ctx.lineWidth = Math.max(1, r * 0.08); ctx.stroke();
  ctx.restore();
}

// Flat image panel: cover-fills its rect edge-to-edge, no border/shadow/rounding.
function drawPanel(ctx, img, x, y, w, h, { flip = false }) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (flip) { ctx.translate(2 * x + w, 0); ctx.scale(-1, 1); }  // un-mirror legacy captures
  drawCover(ctx, img, x, y, w, h);
  ctx.restore();
}

// Simplified FitnessChart: per-participant cumulative-coins "race" lines (in each
// person's identity colour) up to the current tick, with a zone-coloured endpoint
// dot, over faint gridlines. Sits under the game feed.
function drawChart(ctx, chart, x, y, w, h) {
  ctx.fillStyle = 'rgba(8,10,13,0.8)';
  ctx.fillRect(x, y, w, h);
  const padX = Math.round(w * 0.02);
  const padTop = Math.round(h * 0.22);
  const padBot = Math.round(h * 0.1);
  const maxC = Math.max(1, chart.maxCoins);
  const maxT = Math.max(1, chart.totalTicks - 1);

  // Scale labels: a left coin-axis (max at top … 0 at bottom) and per-rider
  // endpoint totals on the right. Reserve a gutter for each so they never sit on
  // the race lines; both gutters size to the widest number actually shown.
  const scaleFpx = Math.max(10, Math.round(h * 0.085));
  ctx.font = `600 ${scaleFpx}px "${FONT_FAMILY}"`;
  const maxLabelW = ctx.measureText(formatCoins(maxC)).width;
  const axisGap = Math.round(w * 0.012);
  const leftAxisW = maxLabelW + axisGap;          // left coin scale
  const dotR = Math.max(3, Math.round(h * 0.03));
  const rightGutter = maxLabelW + dotR + axisGap; // right endpoint values

  const ix = x + padX + leftAxisW;
  const iw = Math.max(1, w - padX * 2 - leftAxisW - rightGutter);
  const iy = y + padTop, ih = h - padTop - padBot;
  const sx = (t) => ix + (t / maxT) * iw;
  const sy = (c) => iy + ih - (Math.max(0, c) / maxC) * ih;

  // Gridlines + left coin-scale numbers. With only ~4 lines, drop the inner two
  // (keep min/max) when they'd crowd; also dedupe equal rounded values.
  const GRID = 3;
  const rowGap = ih / GRID;
  const showInner = rowGap >= scaleFpx * 1.4;
  ctx.lineWidth = Math.max(1, Math.round(h * 0.005));
  ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  ctx.font = `600 ${scaleFpx}px "${FONT_FAMILY}"`;
  let lastVal = null;
  for (let g = 0; g <= GRID; g++) {
    const gy = iy + (g / GRID) * ih;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(ix, gy); ctx.lineTo(ix + iw, gy); ctx.stroke();
    const isEdge = g === 0 || g === GRID;
    if (!isEdge && !showInner) continue;
    const val = Math.round(maxC * (1 - g / GRID));
    if (val === lastVal) continue;                 // dedupe (small ranges)
    lastVal = val;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(formatCoins(val), ix - axisGap, gy);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${Math.round(h * 0.12)}px "${FONT_FAMILY}"`;
  ctx.fillText('COIN RACE', x + padX, y + Math.round(h * 0.155));

  const tick = Math.min(chart.tick, maxT);
  const endpoints = [];
  for (const s of chart.series) {
    const coins = s.coins || [];
    if (!coins.length) continue;
    ctx.strokeStyle = s.color || COL.text;
    ctx.lineWidth = Math.max(2, Math.round(h * 0.018));
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false, lx = ix, ly = sy(0), lc = 0;
    for (let t = 0; t <= tick; t++) {
      const c = coins[t]; if (c == null) continue;
      const px = sx(t), py = sy(c);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      lx = px; ly = py; lc = c;
    }
    if (!started) continue;
    ctx.stroke();
    ctx.beginPath(); ctx.arc(lx, ly, dotR, 0, Math.PI * 2);
    ctx.fillStyle = s.zone ? zoneMeta(s.zone).color : (s.color || COL.text);
    ctx.fill();
    ctx.lineWidth = Math.max(1, Math.round(dotR * 0.35));
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
    endpoints.push({ y: ly, value: lc, color: s.color || COL.text });
  }

  // Per-rider endpoint totals (in each rider's colour) right of the dots. Hide a
  // label when it would overlap a higher-valued one already placed — declutter
  // tight finishes rather than stack unreadable numbers.
  endpoints.sort((a, b) => b.value - a.value); // leader first wins the space
  const placed = [];
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${scaleFpx}px "${FONT_FAMILY}"`;
  const labelX = ix + iw + dotR + axisGap;
  for (const e of endpoints) {
    if (placed.some(py => Math.abs(py - e.y) < scaleFpx * 1.05)) continue;
    placed.push(e.y);
    ctx.fillStyle = e.color;
    ctx.fillText(formatCoins(e.value), labelX, e.y);
  }
  ctx.textBaseline = 'middle';
}

function drawCover(ctx, img, dx, dy, dw, dh) {
  const scale = Math.max(dw / img.width, dh / img.height);
  const sw = dw / scale, sh = dh / scale;
  const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawCircleImage(ctx, img, x, y, d, ringColor) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  ctx.clip();
  drawCover(ctx, img, x, y, d, d);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + d / 2, y + d / 2, d / 2 - 1, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, d * 0.06);
  ctx.strokeStyle = ringColor || COL.cardBorder;
  ctx.stroke();
}

function ellipsize(ctx, text, maxW) {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

function buildTitle(descriptor) {
  const show = descriptor.showTitle;
  const ep = descriptor.title;
  if (show && ep && show !== ep) return `${show} — ${ep}`;
  return ep || show || 'Workout';
}

function formatCoins(n) { return Number(n).toLocaleString('en-US'); }

// Wall-clock date + time-of-day in the session's timezone, e.g. "Jun 19 · 3:45 PM".
function formatWallClock(ms, timezone) {
  if (!Number.isFinite(ms)) return null;
  const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const fmt = (o) => new Intl.DateTimeFormat('en-US', o).format(new Date(ms)).replace(',', ' ·');
  try { return fmt(timezone ? { ...opts, timeZone: timezone } : opts); }
  catch { try { return fmt(opts); } catch { return null; } }
}

function formatElapsed(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}
