/**
 * Photo Widget — full-bleed gallery photo + caption placard
 * @module 1_rendering/eink/widgets/PhotoWidget
 *
 * Renders a single preloaded image (data.photo.imageEl, resolved by the
 * DataResolver from data.photo.imageUrl) cover-fit to its box, then overlays an
 * ArtMode-style placard: a headline (who/where) plus the capture date. The image
 * is chosen and held server-side (GET /api/v1/home/photo) so it only changes once
 * per hold window — keeping the e-ink refresh (and battery) cost low.
 *
 * Colour→grey is NOT done here: the whole canvas is luma-reduced once at the end
 * of the render (EinkRenderer → greyscale.canvasToGray8) and shipped SMOOTH; the
 * panel firmware dithers it to its 16 tones. Dithering server-side would only
 * bloat the download (see lib/greyscale).
 */

import { font } from './lib/fonts.mjs';

const PLACARD_H = 100;
const PAD_X = 32;

export function draw(ctx, box, data, theme) {
  const photo = data?.photo || {};
  const img = photo.imageEl;
  const { x, y, w, h } = box;

  if (!img) {
    // No image resolved (Immich unreachable, or snapshot-only path) — draw a
    // calm placeholder rather than leaving the region blank.
    ctx.save();
    ctx.fillStyle = theme.bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = theme.muted;
    ctx.font = font(40, { bold: true });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No photo available', x + w / 2, y + h / 2);
    ctx.restore();
    return;
  }

  // Cover-fit: scale to fill the whole box, centre-crop the overflow.
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  // Caption placard. The final canvas-wide luma reduction (EinkRenderer) turns the
  // whole panel grey; the panel firmware dithers the photo region. Pure black/white
  // chrome here lands on hardware tones, so it stays crisp through that dither.
  const title = photo.title;
  const date = photo.date;
  if (title || date) {
    const barY = y + h - PLACARD_H;
    ctx.save();
    ctx.fillStyle = theme.headerBg || '#000000';
    ctx.fillRect(x, barY, w, PLACARD_H);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.headerFg || '#FFFFFF';
    if (title && date) {
      ctx.font = font(36, { bold: true });
      ctx.fillText(title, x + PAD_X, barY + 36);
      ctx.font = font(24);
      ctx.fillText(date, x + PAD_X, barY + PLACARD_H - 32);
    } else {
      ctx.font = font(36, { bold: true });
      ctx.fillText(title || date, x + PAD_X, barY + PLACARD_H / 2);
    }
    ctx.restore();
  }
}
