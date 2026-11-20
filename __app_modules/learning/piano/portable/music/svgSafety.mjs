/**
 * Is an SVG poster safe to store and serve? `checkSvg(text)` → `{ ok: true }` or
 * `{ ok: false, code }`.
 *
 * Posters are uploaded by the admin browser (a cut of the OSMD engraving) and
 * served from the media stream route, which a person can open directly. `<img>`
 * never runs an SVG's scripts, but a top-level navigation would, same-origin, so
 * the stream route also sends a sandboxing CSP. This is the other half: the
 * upload must be plain static SVG, judged by ALLOW-LISTS rather than by naming
 * what is dangerous:
 *
 * - UTF-8 text only: no XML declaration (so no `encoding=` to reinterpret the
 *   bytes), no byte-order mark, no C0 control characters other than tab, LF and
 *   CR, no noncharacters or lone surrogates.
 * - No DOCTYPE/ENTITY, CDATA, comments or processing instructions.
 * - Root `<svg>` with `xmlns="http://www.w3.org/2000/svg"`. A namespace may be
 *   declared only as SVG (`xmlns`) or XLink (`xmlns:xlink`).
 * - Elements from ELEMENTS only, unprefixed and case-exact: the shapes, text and
 *   grouping VexFlow draws with. No `a`, `image`, animation, `style`, `script`,
 *   `foreignObject` or anything else.
 * - Attributes from ATTRIBUTES only. Values carry no `&` (character references
 *   could spell anything), no `\` and no `url(`; the two reference attributes are
 *   local only: `href`/`xlink:href` exactly `#id`, `clip-path` exactly `url(#id)`.
 *   There is no `style` attribute and no `on*` attribute.
 * - Text may use the five XML entities and numeric character references only.
 *
 * No XML parser is a dependency here, so this is a single forward scan: every
 * search starts where the last one ended and nothing backtracks, so the cost is
 * linear in the input (no regex runs over the whole text).
 *
 * Codes:
 *   not-svg                 not text, not well-formed, or the root is not <svg>
 *   too-large               over MAX_POSTER_BYTES (UTF-8)
 *   bad-char                BOM, control character, noncharacter, lone surrogate
 *   processing-instruction  any <?...?>, the XML declaration included
 *   doctype                 <!DOCTYPE>, <!ENTITY>, CDATA, comments: any <!
 *   namespace               root not in the SVG namespace, or another namespace declared
 *   script / foreign-object a <script> / <foreignObject> element (any case or prefix)
 *   element                 any other element off the allow-list
 *   event-handler           an attribute named on*
 *   attribute               any other attribute off the allow-list (style included)
 *   external-href           a reference that is not a local #id
 *   entity                  a character reference in an attribute, or an unknown entity in text
 *
 * Layer: PORTABLE (pure).
 */

/** Largest poster accepted: the score grid loads one per tile. */
export const MAX_POSTER_BYTES = 300 * 1024;

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** What VexFlow draws with (svg, g, path, rect, text), plus inert structure. */
const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'line', 'polyline', 'polygon', 'circle', 'ellipse',
  'text', 'tspan', 'defs', 'use', 'symbol', 'clipPath', 'title', 'desc',
]);

/** Presentation and geometry attributes; values are checked separately. */
const ATTRIBUTES = new Set([
  'x', 'y', 'width', 'height', 'd', 'points', 'cx', 'cy', 'r', 'rx', 'ry',
  'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'stroke-opacity', 'opacity', 'clip-path', 'clip-rule', 'visibility', 'pointer-events',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
  'viewBox', 'preserveAspectRatio', 'version', 'id', 'clipPathUnits',
  'data-daylight-poster',
]);

const LOCAL_ID_RE = /^#[A-Za-z_][\w.-]{0,127}$/;
const LOCAL_URL_RE = /^url\(#[A-Za-z_][\w.-]{0,127}\)$/;
const TEXT_ENTITY_RE = /^(?:amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9A-Fa-f]{1,6})$/;
const MAX_ENTITY_NAME = 10;

const fail = (code) => ({ ok: false, code });

const isSpace = (c) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/** Name characters, loosely: anything up to whitespace, `/`, `>`, `=`, a quote or `<`. */
const isNameChar = (c) => c > 0x20 && c !== 0x2f && c !== 0x3e && c !== 0x3d && c !== 0x22 && c !== 0x27 && c !== 0x3c;

/** True when `name` is an element a poster may contain. */
export function elementAllowed(name) {
  return ELEMENTS.has(name);
}

/** Why an attribute is refused, or null. Namespace declarations are judged separately. */
function attributeProblem(name, value) {
  const lower = name.toLowerCase();
  if (lower.startsWith('on')) return 'event-handler';
  if (name === 'href' || name === 'xlink:href') return LOCAL_ID_RE.test(value) ? null : 'external-href';
  if (!ATTRIBUTES.has(name)) return 'attribute';
  if (value.includes('&')) return 'entity';
  if (value.includes('\\')) return 'attribute';
  if (name === 'clip-path') return LOCAL_URL_RE.test(value) ? null : 'external-href';
  if (value.toLowerCase().includes('url(')) return 'external-href';
  return null;
}

/** True when the serializer may keep this attribute as it is. */
export function attributeAllowed(element, name, value) {
  if (name === 'xmlns') return value === SVG_NS;
  if (name === 'xmlns:xlink') return value === XLINK_NS;
  return elementAllowed(element) && attributeProblem(name, String(value)) === null;
}

/**
 * First character problem in the text, linear: BOM, C0 controls other than
 * tab/LF/CR, U+FFFE/U+FFFF, and lone surrogates (text that came from bytes
 * that were not UTF-8). Also counts UTF-8 bytes.
 */
function scanChars(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return { bad: true };
    if (c === 0xfeff || c === 0xfffe || c === 0xffff) return { bad: true };
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return { bad: true };
      bytes += 4;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return { bad: true };
    } else {
      bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    }
  }
  return { bad: false, bytes };
}

/** Text between tags: entity references must be the five XML ones or numeric. Scans [from, to) only. */
function textProblem(text, from, to) {
  for (let at = from; at < to; at += 1) {
    if (text.charCodeAt(at) !== 0x26 /* & */) continue;
    let semi = at + 1;
    const limit = Math.min(to, at + 2 + MAX_ENTITY_NAME);
    while (semi < limit && text.charCodeAt(semi) !== 0x3b /* ; */) semi += 1;
    if (semi >= limit || !TEXT_ENTITY_RE.test(text.slice(at + 1, semi))) return 'entity';
    at = semi;
  }
  return null;
}

/**
 * @param {string} text
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
export function checkSvg(text) {
  if (typeof text !== 'string' || text.length === 0) return fail('not-svg');
  // Characters never outnumber UTF-8 bytes, so a long string is too large without counting.
  if (text.length > MAX_POSTER_BYTES) return fail('too-large');
  const chars = scanChars(text);
  if (chars.bad) return fail('bad-char');
  if (chars.bytes > MAX_POSTER_BYTES) return fail('too-large');

  const n = text.length;
  const stack = [];
  let rootSeen = false;
  let rootClosed = false;
  let i = 0;

  while (i < n) {
    const lt = text.indexOf('<', i);
    const end = lt < 0 ? n : lt;
    if (stack.length === 0) {
      // Text outside the root is whitespace only.
      for (let k = i; k < end; k += 1) if (!isSpace(text.charCodeAt(k))) return fail('not-svg');
    } else {
      const problem = textProblem(text, i, end);
      if (problem) return fail(problem);
    }
    if (lt < 0) break;
    const next = text.charCodeAt(lt + 1);

    if (next === 0x21 /* ! */) return fail('doctype');
    if (next === 0x3f /* ? */) return fail('processing-instruction');

    if (next === 0x2f /* / */) {
      let j = lt + 2;
      while (j < n && isNameChar(text.charCodeAt(j))) j += 1;
      const name = text.slice(lt + 2, j);
      while (j < n && isSpace(text.charCodeAt(j))) j += 1;
      if (text.charCodeAt(j) !== 0x3e || stack.length === 0 || stack.pop() !== name) return fail('not-svg');
      if (stack.length === 0) rootClosed = true;
      i = j + 1;
      continue;
    }

    // An element start tag.
    let j = lt + 1;
    while (j < n && isNameChar(text.charCodeAt(j))) j += 1;
    const name = text.slice(lt + 1, j);
    if (!name) return fail('not-svg');
    const isRoot = stack.length === 0;
    if (isRoot) {
      if (rootSeen || name !== 'svg') return fail('not-svg');
      rootSeen = true;
    }
    const local = name.slice(name.lastIndexOf(':') + 1).toLowerCase();
    if (local === 'script') return fail('script');
    if (local === 'foreignobject') return fail('foreign-object');
    if (!ELEMENTS.has(name)) return fail('element');

    let selfClosing = false;
    let svgNamespace = false;
    const seen = new Set();
    for (;;) {
      const before = j;
      while (j < n && isSpace(text.charCodeAt(j))) j += 1;
      if (j >= n) return fail('not-svg');
      const c = text.charCodeAt(j);
      if (c === 0x3e /* > */) { j += 1; break; }
      if (c === 0x2f /* / */) {
        if (text.charCodeAt(j + 1) !== 0x3e) return fail('not-svg');
        selfClosing = true;
        j += 2;
        break;
      }
      // Attributes are separated from the name and each other by whitespace.
      if (j === before) return fail('not-svg');
      const nameStart = j;
      while (j < n && isNameChar(text.charCodeAt(j))) j += 1;
      const attr = text.slice(nameStart, j);
      if (!attr || seen.has(attr)) return fail('not-svg');
      seen.add(attr);
      while (j < n && isSpace(text.charCodeAt(j))) j += 1;
      if (text.charCodeAt(j) !== 0x3d /* = */) return fail('not-svg');
      j += 1;
      while (j < n && isSpace(text.charCodeAt(j))) j += 1;
      const quote = text[j];
      if (quote !== '"' && quote !== "'") return fail('not-svg');
      const close = text.indexOf(quote, j + 1);
      if (close < 0) return fail('not-svg');
      const value = text.slice(j + 1, close);
      if (value.includes('<')) return fail('not-svg');
      j = close + 1;

      if (attr === 'xmlns') {
        if (value !== SVG_NS) return fail('namespace');
        svgNamespace = true;
      } else if (attr.startsWith('xmlns:')) {
        if (attr !== 'xmlns:xlink' || value !== XLINK_NS) return fail('namespace');
      } else {
        const problem = attributeProblem(attr, value);
        if (problem) return fail(problem);
      }
    }
    if (isRoot && !svgNamespace) return fail('namespace');

    if (selfClosing) {
      if (isRoot) rootClosed = true;
    } else {
      stack.push(name);
    }
    i = j;
  }

  if (!rootSeen || !rootClosed || stack.length) return fail('not-svg');
  return { ok: true };
}

export default checkSvg;
