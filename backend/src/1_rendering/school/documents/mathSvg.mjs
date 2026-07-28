/**
 * TeX → SVG for school documents, normalized for svg-to-pdfkit.
 *
 * svg-to-pdfkit misreads MathJax's SVG as emitted; every normalization here
 * exists because of a specific silent failure verified in the rendering spike
 * (docs/_wip/plans/2026-07-27-school-math-rendering-spike-results.md).
 */

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

/** MathJax emits SVG coordinates at 1000 viewBox units per em. */
const VIEWBOX_UNITS_PER_EM = 1000;

const DEFAULT_FONT_SIZE_PT = 12;
const DEFAULT_INK = '#000000';

/**
 * `noundefined` renders an unknown control sequence as red literal text rather
 * than an error node, so a typo would print on a learner's worksheet instead of
 * failing validation. Excluded so undefined macros surface as <merror>.
 */
const TEX_PACKAGES = AllPackages.filter((pkg) => pkg !== 'noundefined');

/** MathJax error markup: an error node, or (if noundefined ever returns) red substitute text. */
const ERROR_MARKUP = /data-mjx-error=|data-mml-node="merror"|data-mml-node="mtext"[^>]*fill="red"/;
const ERROR_MESSAGE = /data-mjx-error="([^"]*)"/;

export class MathRenderError extends Error {
  constructor(message, { tex } = {}) {
    super(message);
    this.name = 'MathRenderError';
    this.tex = tex;
  }
}

let cachedDocument = null;
let cachedAdaptor = null;

/** Built on first use; constructing the MathJax document is expensive. */
function getConverter() {
  if (!cachedDocument) {
    cachedAdaptor = liteAdaptor();
    RegisterHTMLHandler(cachedAdaptor);
    cachedDocument = mathjax.document('', {
      InputJax: new TeX({ packages: TEX_PACKAGES }),
      OutputJax: new SVG({ fontCache: 'none' }),
    });
  }
  return { document: cachedDocument, adaptor: cachedAdaptor };
}

/**
 * svg-to-pdfkit honors presentation attributes but not inline CSS. menclose
 * notations (long division's vinculum) carry stroke-width as CSS while
 * inheriting stroke-width="0" from the parent group, so they stroke at zero
 * width and vanish without a trace.
 */
function promoteInlineStrokeWidth(svgString) {
  return svgString.replace(/style="([^"]*)"/g, (whole, css) => {
    const kept = [];
    let strokeWidth = null;
    for (const declaration of css.split(';')) {
      const trimmed = declaration.trim();
      if (!trimmed) continue;
      const match = /^stroke-width\s*:\s*(.+)$/.exec(trimmed);
      if (match) strokeWidth = match[1].trim();
      else kept.push(trimmed);
    }
    if (strokeWidth === null) return whole;
    const remainder = kept.length ? ` style="${kept.join('; ')};"` : '';
    return `stroke-width="${strokeWidth}"${remainder}`;
  });
}

/**
 * Strips width/height from the ROOT svg tag only. They carry `ex` units that
 * svg-to-pdfkit misparses, after which it also ignores the explicit
 * width/height draw options and renders ~1.4x too large. Nested <svg> elements
 * (stretchy accents, extensible delimiters) size in viewBox units and must keep
 * theirs.
 */
function stripRootSizeAttributes(svgString) {
  const rootTagEnd = svgString.indexOf('>');
  const rootTag = svgString.slice(0, rootTagEnd).replace(/\s(?:width|height)="[^"]*"/g, '');
  return rootTag + svgString.slice(rootTagEnd);
}

/**
 * Render TeX to an SVG string sized in points.
 *
 * @param {string} tex - TeX source, without \require (never resolves server-side).
 * @param {Object} [options]
 * @param {boolean} [options.display=true] - Display style vs inline style.
 * @param {number} [options.fontSizePt=12] - Em size the returned dimensions are in.
 * @param {string} [options.ink='#000000'] - Literal colour replacing currentColor.
 * @returns {{ svgString: string, widthPt: number, heightPt: number, depthPt: number }}
 *   depthPt is the extent below the baseline, for baseline-aligned placement.
 * @throws {MathRenderError} on empty input, a bad font size, or any TeX error.
 */
export function texToSvg(tex, { display = true, fontSizePt = DEFAULT_FONT_SIZE_PT, ink = DEFAULT_INK } = {}) {
  if (typeof tex !== 'string' || tex.trim() === '') {
    throw new MathRenderError('TeX source must be a non-empty string', { tex });
  }
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
    throw new MathRenderError(`fontSizePt must be a positive number, got ${fontSizePt}`, { tex });
  }

  const { document, adaptor } = getConverter();
  const svgNode = document.convert(tex, { display }).children[0];
  const rawSvg = adaptor.outerHTML(svgNode);

  if (ERROR_MARKUP.test(rawSvg)) {
    const detail = ERROR_MESSAGE.exec(rawSvg)?.[1] ?? 'TeX error';
    throw new MathRenderError(`${detail} in TeX: ${tex}`, { tex });
  }

  const [, vbY, vbW, vbH] = adaptor.getAttribute(svgNode, 'viewBox').split(/\s+/).map(Number);
  const svgString = promoteInlineStrokeWidth(stripRootSizeAttributes(rawSvg)).replaceAll('currentColor', ink);

  return {
    svgString,
    widthPt: (vbW / VIEWBOX_UNITS_PER_EM) * fontSizePt,
    heightPt: (vbH / VIEWBOX_UNITS_PER_EM) * fontSizePt,
    depthPt: ((vbY + vbH) / VIEWBOX_UNITS_PER_EM) * fontSizePt,
  };
}
