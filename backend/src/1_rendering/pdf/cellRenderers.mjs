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

import QRCode from 'qrcode';
import { createQRCodeRenderer } from '#rendering/qrcode/QRCodeRenderer.mjs';

/**
 * Escape text destined for an SVG text node. Single pass over the character class so the
 * ampersands this function introduces are not themselves re-escaped.
 */
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/** An SVG's intrinsic box, so a composite can lay children out in the same units. */
function readViewBox(svg) {
  const m = /viewBox="\s*([\d.-]+)[ ,]+([\d.-]+)[ ,]+([\d.-]+)[ ,]+([\d.-]+)\s*"/.exec(svg || '');
  return m ? { w: Number(m[3]), h: Number(m[4]) } : null;
}

/**
 * A nested `<svg>` must not carry an XML declaration or a DOCTYPE, and the
 * generator comments these files ship with are noise inside a composite.
 */
const stripXmlDecl = (svg) => String(svg)
  .replace(/<\?xml[^>]*\?>/g, '')
  .replace(/<!DOCTYPE[^>]*>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .trim();

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
     * ONE framed card: icon and its label on the left, code on the right.
     *
     * The QR is drawn HERE from the raw module matrix rather than delegating to
     * `QRCodeRenderer`. That renderer wraps every code in its own frame and label
     * strip, which put a hard rail between the icon and the code and boxed the two
     * as separate objects. This design wants a single rectangle around the whole
     * card, so the code has to be drawable without chrome — and a module matrix is
     * the only way to get that.
     *
     * Squares, not dots, for the data modules: at this size the sheet is already
     * near the limit of what decodes reliably, and dots throw away part of each
     * module's area for decoration.
     *
     * A missing icon still renders — the card simply gives the code the full width
     * rather than losing the sheet over a missing file.
     */
    'qr-icon': function qrIcon(item, rect, opts = {}) {
      // Layout units, not points. The card is emitted with a viewBox and the
      // emitter scales it into the cell, so these only fix the PROPORTIONS.
      const PAD = 9;
      const QR = 100;
      const GAP = 9;
      const LEFT = 84;
      const LABEL_H = 22;
      // Clear space between the icon box and the label's cap height. Icons vary in
      // how much internal padding their artwork carries: the outlined ones leave a
      // margin, but a filled mark like the salad bowl runs edge to edge, and with
      // the label baseline sitting a hair under the box its ascenders collided with
      // the bowl. Reserving the gap explicitly makes the card safe for any icon
      // rather than only for the well-padded ones.
      const ICON_GAP = 5;
      const H = QR + PAD * 2;
      const hasIcon = Boolean(item.iconSvg);
      // Without an icon the label has nowhere to sit beside the code, so it goes
      // UNDER it and the card becomes taller than wide. Dropping the label instead
      // would leave a wall of anonymous codes — which is what happened first time,
      // and made the containers block unusable.
      const W = hasIcon ? PAD + LEFT + GAP + QR + PAD : PAD + QR + PAD;
      const H2 = hasIcon ? H : QR + PAD * 2 + LABEL_H;

      const modules = QRCode.create(item.code, { errorCorrectionLevel: 'H' }).modules;
      const n = modules.size;
      const m = QR / n;
      let cells = '';
      for (let r = 0; r < n; r += 1) {
        for (let c = 0; c < n; c += 1) {
          if (!modules.data[r * n + c]) continue;
          // +0.02 overlap closes hairline seams between adjacent modules that some
          // rasterisers leave, which read as breaks in a finder pattern.
          cells += `<rect x="${(c * m).toFixed(3)}" y="${(r * m).toFixed(3)}" width="${(m + 0.02).toFixed(3)}" height="${(m + 0.02).toFixed(3)}"/>`;
        }
      }
      const qrX = hasIcon ? PAD + LEFT + GAP : PAD;
      const qrG = `<g transform="translate(${qrX},${PAD})" fill="#000">${cells}</g>`;

      const labelText = String(item.label ?? '');
      const fit = (text, boxW, maxSize) => (text.length
        ? Math.max(5, Math.min(maxSize, (boxW * 0.98) / (text.length * 0.55)))
        : maxSize);

      let left = '';
      if (hasIcon) {
        const iconBox = Math.min(LEFT, H - PAD * 2 - LABEL_H - ICON_GAP);
        const iconX = PAD + (LEFT - iconBox) / 2;
        const iconY = PAD + (H - PAD * 2 - LABEL_H - ICON_GAP - iconBox) / 2;
        const iconEl = stripXmlDecl(item.iconSvg)
          .replace(/<svg\b[^>]*>/, (tag) => tag
            .replace(/\s(width|height|x|y)\s*=\s*"[^"]*"/g, '')
            .replace(/^<svg/, `<svg x="${iconX}" y="${iconY}" width="${iconBox}" height="${iconBox}" preserveAspectRatio="xMidYMid meet"`));
        const text = labelText;
        const size = fit(text, LEFT, LABEL_H * 0.72);
        left = iconEl
          + `<text x="${PAD + LEFT / 2}" y="${iconY + iconBox + ICON_GAP + LABEL_H * 0.66}" text-anchor="middle"`
          + ` font-family="Helvetica" font-weight="bold" font-size="${size.toFixed(2)}" fill="#000">${esc(text)}</text>`;
      }

      const under = hasIcon ? '' : `<text x="${W / 2}" y="${PAD + QR + LABEL_H * 0.66}" text-anchor="middle"`
        + ` font-family="Helvetica" font-weight="bold" font-size="${fit(labelText, QR, LABEL_H * 0.8).toFixed(2)}"`
        + ` fill="#000">${esc(labelText)}</text>`;

      // One rounded rectangle around the whole card — icon, label and code together.
      const frame = `<rect x="0.6" y="0.6" width="${W - 1.2}" height="${H2 - 1.2}" rx="7" ry="7"`
        + ` fill="#fff" stroke="#000" stroke-width="1.2"/>`;

      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H2}" width="${W}" height="${H2}">`
        + frame + left + qrG + under + '</svg>';
    },

    /**
     * Text only. Used for cells that name a region of the sheet rather than encode
     * anything, so it must stay free of scannable geometry — the test pins that by
     * asserting no `<rect>` reaches the output.
     */
    label(item, rect, opts = {}) {
      const text = String(item.label ?? '');
      // Font size is DERIVED, not fixed. The viewBox is the cell, and cells shrink
      // as a sheet is compacted — a hardcoded 14 overflowed a 10pt-tall cell and
      // spilled text across its neighbours. Constrained by height AND by width, so
      // a long word narrows rather than running past the cell edge.
      // 0.55 is the em-width Helvetica averages across mixed-case text.
      const byHeight = rect.h * (opts.textScale ?? 0.6);
      const byWidth = text.length ? (rect.w * 0.92) / (text.length * 0.55) : byHeight;
      const size = Math.max(4, Math.min(byHeight, byWidth));
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.w}" height="${rect.h}" viewBox="0 0 ${rect.w} ${rect.h}">`
        + `<text x="${rect.w / 2}" y="${rect.h / 2}" text-anchor="middle" dominant-baseline="middle"`
        + ` font-family="Helvetica" font-size="${size.toFixed(2)}">${esc(text)}</text></svg>`;
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
