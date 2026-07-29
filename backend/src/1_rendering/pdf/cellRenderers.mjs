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
     * Icon on the left, QR on the right — a WIDE cell.
     *
     * Two reasons this exists rather than stacking them:
     *
     * 1. **Separation.** On a dense sheet, adjacent QR codes with only a thin gap
     *    read as one field to the eye and to an over-eager scanner. Putting a
     *    solid icon between neighbouring codes is horizontal whitespace that also
     *    carries meaning.
     * 2. **Packing.** A stacked QR cell is tall (~0.83 w/h), which is the worst
     *    shape for a letter page: three rows of them nearly fills it. A wide cell
     *    fits more rows, which is what lets a 3x3 block share a page with three
     *    others.
     *
     * The icon is nested as a child `<svg>`. That is safe — svg-to-pdfkit renders
     * nested `<svg>` correctly (verified: a nested element draws at exactly its
     * viewBox-derived scale). The thing it genuinely cannot do is an `<image>`
     * referencing SVG data, which is a different problem and is why the content
     * catalog rasterises cover art.
     *
     * A missing icon degrades to the plain `qr` mark rather than failing: a cell
     * with no picture still scans, and losing the whole sheet over a missing file
     * would be the wrong trade.
     */
    'qr-icon': function qrIcon(item, rect, opts = {}) {
      const qrSvg = qrRenderer.renderSvg(item.code, {
        size: opts.sizePt ?? 300,
        label: item.label,
        sublabel: item.sublabel,
      });
      if (!item.iconSvg) return qrSvg;

      const box = readViewBox(qrSvg) || { w: 404, h: 484 };
      const iconW = Math.round(box.h * (opts.iconScale ?? 0.62));
      const gap = Math.round(box.w * (opts.iconGap ?? 0.08));
      const totalW = iconW + gap + box.w;

      // The source icons carry their own width/height on the root tag. Those must be
      // REMOVED, not merely overridden: appending a second width= produces duplicate
      // attributes, and the original wins — which renders the icon at its intrinsic
      // size, overflowing the cell and swallowing the QR beside it. Seen on the first
      // attempt; the viewBox is what the nested element should scale from.
      // NOT anchored to the start of the string. These files begin with an XML
      // declaration and a generator comment, so `^<svg` matched nothing and the
      // icon kept its own width="800px" — rendering at intrinsic size, overflowing
      // the cell and swallowing the QR beside it. Match the first <svg> wherever
      // it is, and strip the sizing attributes rather than trying to override
      // them: a duplicate attribute resolves to the original, not the addition.
      const iconEl = stripXmlDecl(item.iconSvg)
        .replace(/<svg\b[^>]*>/, (tag) => tag
          .replace(/\s(width|height|x|y)\s*=\s*"[^"]*"/g, '')
          .replace(/^<svg/, `<svg x="0" y="${(box.h - iconW) / 2}" width="${iconW}" height="${iconW}" preserveAspectRatio="xMidYMid meet"`));

      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${box.h}" width="${totalW}" height="${box.h}">`
        + iconEl
        + `<g transform="translate(${iconW + gap},0)">${stripXmlDecl(qrSvg)}</g>`
        + '</svg>';
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
