/**
 * cellRenderers — what a single cell on a printable sheet looks like.
 *
 * This is one of the framework's two extension seams. `SheetLayout` decides WHERE every
 * cell goes and never sees an item's contents; a renderer here decides WHAT goes in one,
 * and never sees the page. Keeping that line intact is what lets new mark types land
 * without touching the geometry, and lets the geometry stay a pure function.
 *
 * A renderer is `(item, rect, opts) => svgString` and may be async, so callers must
 * `await` the result even though today's three are synchronous.
 * - `item`  — `{ code, label, sublabel?, icon?, cover? }`
 * - `rect`  — `{ x, y, w, h }` in PDF points, from the layout
 * - returns — an SVG string the emitter embeds into that rect via svg-to-pdfkit
 *
 * HAZARD — the returned SVG is NOT `rect.w` x `rect.h`. `QRCodeRenderer` sizes its
 * output as frame + margin + QR + margin + frame, plus a label strip below, so the `qr`
 * renderer's intrinsic box is roughly twice the requested QR size in each direction. The
 * SVG carries a `viewBox`, so the emitter MUST scale it into the rect rather than drawing
 * it at its intrinsic size. `rect` is therefore a size *hint*, not a promise.
 *
 * @module rendering/pdf/cellRenderers
 */

import { createQRCodeRenderer } from '#rendering/qrcode/QRCodeRenderer.mjs';

/**
 * Escape text destined for an SVG text node. Single pass over the character class so the
 * ampersands this function introduces are not themselves re-escaped.
 */
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/**
 * Build the renderer registry, keyed by the `cell.kind` string in sheet config.
 *
 * There is deliberately NO default or fallback renderer: an unrecognised `kind` comes
 * back `undefined` so the caller throws. A fallback would print a plausible-looking but
 * wrong mark on a sheet somebody laminates and sticks on a fridge — that failure has to
 * happen at generation time, not on paper.
 *
 * The QR renderer is injected so tests can substitute one.
 *
 * @param {{ qrRenderer?: { renderSvg: (data: string, options?: object) => string } }} [deps]
 * @returns {Record<string, (item: object, rect: {x:number,y:number,w:number,h:number}, opts?: object) => string|Promise<string>>}
 */
export function createCellRenderers({ qrRenderer = createQRCodeRenderer() } = {}) {
  return {
    /** A scannable QR code carrying `item.code`, captioned with the item's label. */
    qr(item, rect, opts = {}) {
      return qrRenderer.renderSvg(item.code, {
        size: opts.sizePt ?? Math.min(rect.w, rect.h),
        label: item.label,
        sublabel: item.sublabel,
        // Off unless the block asks for covers — an unwanted data: URI would bloat the
        // PDF and reshape the mark into the wider cover layout.
        coverData: opts.cover ? item.cover : null,
      });
    },

    /**
     * Text only. Used for cells that name a region of the sheet rather than encode
     * anything, so it must stay free of scannable geometry — the test pins that by
     * asserting no `<rect>` reaches the output.
     */
    label(item, rect) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.w}" height="${rect.h}" viewBox="0 0 ${rect.w} ${rect.h}">`
        + `<text x="${rect.w / 2}" y="${rect.h / 2}" text-anchor="middle" dominant-baseline="middle"`
        + ` font-family="Helvetica" font-size="14">${esc(item.label)}</text></svg>`;
    },

    /**
     * Nothing at all. An explicit spacer, so a config that wants a hole in a grid says so
     * by name instead of relying on a missing item silently collapsing the layout.
     */
    blank() {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
    },
  };
}
