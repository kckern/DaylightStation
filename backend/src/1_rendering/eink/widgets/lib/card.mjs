/**
 * Card chrome — shared layout primitives for canned eink widgets
 * @module 1_rendering/eink/widgets/lib/card
 *
 * The stub widgets (calendar, schedule, todos, …) all render the same shape: a
 * section title with an accent rule, then a list of rows. These helpers keep
 * that chrome DRY so the widget files stay focused on their data. Colors come
 * from the theme's Spectra-6 palette — no grays (they dither on e-ink).
 */

import { font } from './fonts.mjs';

const PAD_X = 28;

/**
 * Draw a titled card header and return the inner content box for the body.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x:number, y:number, w:number, h:number }} box
 * @param {Object} theme
 * @param {{ title?: string, accent?: string, note?: string }} [opts]
 *   note — small tag drawn top-right (e.g. 'stub' to mark placeholder content)
 * @returns {{ x:number, y:number, w:number, h:number }} content box below the title
 */
export function drawCard(ctx, box, theme, { title, accent, note } = {}) {
  const { x, y, w, h } = box;
  const titleY = y + 24;

  ctx.save();
  ctx.textBaseline = 'top';

  // Accent tab
  let titleX = x + PAD_X;
  if (accent) {
    ctx.fillStyle = accent;
    ctx.fillRect(x + PAD_X, titleY + 4, 10, 36);
    titleX += 26;
  }

  // Title
  ctx.fillStyle = theme.fg;
  ctx.font = font(34, { bold: true });
  ctx.fillText(String(title || '').toUpperCase(), titleX, titleY);

  // Optional stub/marker tag, right-aligned
  if (note) {
    ctx.font = font(22, { bold: true });
    ctx.fillStyle = accent || theme.fg;
    const tag = String(note).toUpperCase();
    const tw = ctx.measureText(tag).width;
    ctx.fillText(tag, x + w - PAD_X - tw, titleY + 8);
  }

  // Divider
  const divY = titleY + 54;
  ctx.strokeStyle = theme.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + PAD_X, divY);
  ctx.lineTo(x + w - PAD_X, divY);
  ctx.stroke();
  ctx.restore();

  const contentY = divY + 18;
  return { x: x + PAD_X, y: contentY, w: w - PAD_X * 2, h: y + h - contentY - 16 };
}

/**
 * Render a vertical list of rows inside a content box.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x:number, y:number, w:number, h:number }} content
 * @param {Object} theme
 * @param {Array<{ lead?:string, text:string, trail?:string, color?:string }>} rows
 * @param {{ rowH?: number, leadW?: number }} [opts]
 */
export function drawRows(ctx, content, theme, rows, { rowH = 58, leadW = 120 } = {}) {
  ctx.save();
  ctx.textBaseline = 'middle';
  const bottom = content.y + content.h;
  let ry = content.y + rowH / 2;

  for (const row of rows) {
    if (ry > bottom) break;

    if (row.lead) {
      ctx.fillStyle = row.color || theme.fg;
      ctx.font = font(28, { bold: true });
      ctx.fillText(row.lead, content.x, ry);
    }

    const textX = content.x + (row.lead ? leadW : 0);
    ctx.fillStyle = theme.fg;
    ctx.font = font(30);
    ctx.fillText(row.text, textX, ry);

    if (row.trail) {
      ctx.fillStyle = row.color || theme.fg;
      ctx.font = font(26);
      const tw = ctx.measureText(row.trail).width;
      ctx.fillText(row.trail, content.x + content.w - tw, ry);
    }

    ry += rowH;
  }
  ctx.restore();
}
