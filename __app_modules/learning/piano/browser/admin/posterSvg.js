/**
 * A score's poster from its engraving: the first systems of the OSMD `<svg>` as a
 * small standalone SVG the kiosk shows on its loading splash and the home desk.
 *
 * OSMD draws one `<g class="staffline">` per staff per system, in system order
 * (see `tagStaffGroups`), so the first systems are the first N staffline groups.
 * Later groups are dropped (they are most of the bytes) and the `viewBox` is cut
 * just below the last kept system, which also hides whatever is drawn outside the
 * staffline groups lower down.
 *
 * Music glyphs are paths in the VexFlow output; measure numbers and other text
 * stay `<text>` with a font-family, which `<img>` renders with the device's own
 * fonts (fonts are not inlined). The clone is cut down to svgSafety's
 * allow-lists (elements, attributes, local references only; comments and
 * control characters dropped), and the result is checked with svgSafety before
 * it is returned.
 */
import { attributeAllowed, checkSvg, elementAllowed, MAX_POSTER_BYTES } from '../../portable/music/svgSafety.mjs';

export const POSTER_SYSTEMS = 2;
/** Stamped on the root: the server replaces only a poster carrying it. */
export const POSTER_MARKER_ATTR = 'data-daylight-poster';
const POSTER_MARKER_VALUE = 'generated';
const SVG_NS = 'http://www.w3.org/2000/svg';
// C0 controls other than tab/LF/CR, the noncharacters and lone surrogates svgSafety refuses.
// eslint-disable-next-line no-control-regex
const BAD_TEXT_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFEFF\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// What XMLSerializer escapes in an attribute value (&quot;, &amp;, &lt;, &gt;, &#9; ...),
// all of which svgSafety refuses there.
const ESCAPED_IN_ATTRIBUTE_RE = /["&<>]/;

const round = (n) => Math.round(n * 100) / 100;

function posterError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/**
 * Where to cut: how many staffline groups make the first `systems` systems, and
 * the y (rendered px, the space `extractPerStaffGeometry` reports) halfway between
 * the last kept staff's bottom line and the next system's top line. `bottom` is
 * null when the score has no more systems than that (keep the full height).
 * @param {Array<{system:number, top:number, lineSpacing:number}>} staffBoxes
 */
export function posterCrop(staffBoxes, { systems = POSTER_SYSTEMS } = {}) {
  const boxes = Array.isArray(staffBoxes) ? staffBoxes : [];
  const kept = boxes.filter((b) => b.system < systems);
  const rest = boxes.filter((b) => b.system >= systems);
  if (!kept.length) return { stafflines: null, bottom: null };
  const keptBottom = Math.max(...kept.map((b) => b.top + 4 * (b.lineSpacing || 0)));
  const nextTop = rest.length ? Math.min(...rest.map((b) => b.top)) : null;
  return {
    stafflines: kept.length,
    bottom: nextTop != null && nextTop > keptBottom ? round((keptBottom + nextTop) / 2) : null,
  };
}

const isPlainSvgElement = (el) => el.namespaceURI === SVG_NS && !el.prefix && elementAllowed(el.localName);

/** Cut the clone down to what svgSafety accepts. */
function sanitize(root) {
  // Comments, processing instructions and CDATA go; text loses control characters.
  const walker = root.ownerDocument.createTreeWalker(root, 0x80 /* comments */ | 0x40 /* PIs */ | 0x08 /* CDATA */ | 0x04 /* text */);
  const drop = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) node.data = node.data.replace(BAD_TEXT_RE, '');
    else drop.push(node);
  }
  drop.forEach((node) => node.remove());
  for (const el of [...root.querySelectorAll('*')]) {
    if (root.contains(el) && !isPlainSvgElement(el)) el.remove();
  }
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name;
      if (name === 'xmlns' || name.startsWith('xmlns:')) {
        if (!attributeAllowed(el.localName, name, attr.value)) el.removeAttributeNode(attr);
        continue;
      }
      // Nothing references anything in a poster, so ids are noise.
      if (name === 'id') { el.removeAttributeNode(attr); continue; }
      // Whitespace characters serialize as &#9;/&#10;/&#13;; quotes in a font list as &quot;.
      let value = attr.value.replace(/[\t\n\r]/g, ' ').replace(BAD_TEXT_RE, '');
      if (name === 'font-family') value = value.replace(/"/g, '');
      if (ESCAPED_IN_ATTRIBUTE_RE.test(value) || !attributeAllowed(el.localName, name, value)) {
        el.removeAttributeNode(attr);
        continue;
      }
      if (value !== attr.value) el.setAttribute(name, value);
    }
  }
}

/**
 * @param {SVGSVGElement} svg - the engraving on screen (left untouched)
 * @param {{ stafflines?: number|null, bottom?: number|null, maxBytes?: number }} [opts]
 *   `stafflines`/`bottom` from posterCrop; null keeps everything / the full height.
 * @returns {{ text: string, bytes: number, width: number, height: number }}
 * @throws {Error} with `code`: `no-svg`, `too-large`, or an svgSafety code
 */
export function posterSvg(svg, { stafflines = null, bottom = null, maxBytes = MAX_POSTER_BYTES } = {}) {
  if (!svg || svg.localName?.toLowerCase() !== 'svg') throw posterError('no-svg', 'No engraved svg to make a poster from');
  const width = Number(svg.getAttribute('width')) || svg.clientWidth || 0;
  const height = Number(svg.getAttribute('height')) || svg.clientHeight || 0;
  if (!(width > 0) || !(height > 0)) throw posterError('no-svg', 'The engraved svg has no size');
  const vb = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
    ? vb : [0, 0, width, height];

  const clone = svg.cloneNode(true);
  if (Number.isInteger(stafflines) && stafflines > 0) {
    [...clone.querySelectorAll('g.staffline')].slice(stafflines).forEach((g) => g.remove());
  }
  sanitize(clone);

  const cropPx = Number.isFinite(bottom) && bottom > 0 ? Math.min(bottom, height) : height;
  const cropUnits = cropPx * (vh / height);
  clone.removeAttribute('style');
  clone.setAttribute('width', String(round(width)));
  clone.setAttribute('height', String(round(cropPx)));
  clone.setAttribute('viewBox', `${round(vx)} ${round(vy)} ${round(vw)} ${round(cropUnits)}`);
  clone.setAttribute(POSTER_MARKER_ATTR, POSTER_MARKER_VALUE);

  // Paper behind the ink: the kiosk shows posters on dark backgrounds.
  const doc = clone.ownerDocument;
  const paper = doc.createElementNS(SVG_NS, 'rect');
  paper.setAttribute('x', String(round(vx)));
  paper.setAttribute('y', String(round(vy)));
  paper.setAttribute('width', String(round(vw)));
  paper.setAttribute('height', String(round(cropUnits)));
  paper.setAttribute('fill', '#ffffff');
  clone.insertBefore(paper, clone.firstChild);

  const text = new XMLSerializer().serializeToString(clone);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > maxBytes) throw posterError('too-large', `Poster is ${bytes} bytes (limit ${maxBytes})`, { bytes });
  const checked = checkSvg(text);
  if (!checked.ok) throw posterError(checked.code, `Poster failed the svg check: ${checked.code}`);
  return { text, bytes, width: round(width), height: round(cropPx) };
}

export default posterSvg;
