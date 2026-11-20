/**
 * Is an SVG poster safe to store and serve? `checkSvg(text)` → `{ ok: true }` or
 * `{ ok: false, code }`.
 *
 * Posters are uploaded by the admin browser (a cut of the OSMD engraving) and
 * served from the media stream route, which a person can open directly. `<img>`
 * never runs an SVG's scripts, but a top-level navigation would, same-origin, so
 * the stream route also sends a sandboxing CSP. This is the other half: the
 * upload is read as XML and refused when it carries anything active or anything
 * that loads from elsewhere.
 *
 * No XML parser is a dependency here, so this is a single forward scan: every
 * search starts where the last one ended and nothing backtracks, so the cost is
 * linear in the input (no regex runs over the whole text). It checks
 * well-formedness only as far as the rules need: tags open and close in order,
 * attribute values are quoted, the root element is `svg`.
 *
 * Codes:
 *   not-svg                 not text, not well-formed, or the root is not <svg>
 *   too-large               over MAX_POSTER_BYTES (UTF-8)
 *   doctype                 <!DOCTYPE>, <!ENTITY> or any other <! declaration
 *   processing-instruction  a <?...?> other than the leading <?xml ...?>
 *   script                  a <script> element
 *   foreign-object          a <foreignObject> element
 *   style                   a <style> element (CSS can @import from elsewhere)
 *   event-handler           an attribute named on*
 *   external-href           href / xlink:href not starting with # or data:image/,
 *                           or a url(...) value that points anywhere but #id
 *
 * Layer: PORTABLE (pure).
 */

/** Largest poster accepted: the score grid loads one per tile. */
export const MAX_POSTER_BYTES = 300 * 1024;

const FORBIDDEN_ELEMENTS = {
  script: 'script',
  foreignobject: 'foreign-object',
  style: 'style',
};

const fail = (code) => ({ ok: false, code });

const isSpace = (c) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/** Name characters, loosely: anything up to whitespace, `/`, `>`, `=` or a quote. */
const isNameChar = (c) => c > 0x20 && c !== 0x2f && c !== 0x3e && c !== 0x3d && c !== 0x22 && c !== 0x27 && c !== 0x3c;

/** The local part of a possibly prefixed name, lowercased (`xlink:href` → `href`). */
function localName(name) {
  const cut = name.lastIndexOf(':');
  return (cut >= 0 ? name.slice(cut + 1) : name).toLowerCase();
}

/** UTF-8 length without allocating the encoded bytes. */
function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { n += 4; i += 1; } else n += 3;
  }
  return n;
}

const isLocalHref = (value) => {
  const v = value.trim();
  return v.startsWith('#') || v.toLowerCase().startsWith('data:image/');
};

/** True when every `url(...)` in the value names a local `#id`. Linear in the value. */
function urlsAreLocal(value) {
  const lower = value.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf('url(', from);
    if (at < 0) return true;
    let j = at + 4;
    while (j < lower.length && (isSpace(lower.charCodeAt(j)) || lower[j] === '"' || lower[j] === "'")) j += 1;
    if (lower[j] !== '#') return false;
    from = j;
  }
}

function checkAttribute(name, value) {
  const local = localName(name);
  if (local.startsWith('on')) return 'event-handler';
  if (local === 'href' && !isLocalHref(value)) return 'external-href';
  if (!urlsAreLocal(value)) return 'external-href';
  return null;
}

/**
 * @param {string} text
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
export function checkSvg(text) {
  if (typeof text !== 'string' || text.length === 0) return fail('not-svg');
  // Characters never outnumber UTF-8 bytes, so a long string is too large without counting.
  if (text.length > MAX_POSTER_BYTES || utf8Length(text) > MAX_POSTER_BYTES) return fail('too-large');

  const n = text.length;
  const stack = [];
  let rootSeen = false;
  let rootClosed = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    // Text outside the root is whitespace only.
    if (stack.length === 0) {
      for (let k = i; k < lt; k += 1) if (!isSpace(text.charCodeAt(k))) return fail('not-svg');
    }
    const next = text.charCodeAt(lt + 1);

    if (next === 0x21 /* ! */) {
      if (text.startsWith('<!--', lt)) {
        const end = text.indexOf('-->', lt + 4);
        if (end < 0) return fail('not-svg');
        i = end + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', lt)) {
        if (stack.length === 0) return fail('not-svg');
        const end = text.indexOf(']]>', lt + 9);
        if (end < 0) return fail('not-svg');
        i = end + 3;
        continue;
      }
      return fail('doctype');
    }

    if (next === 0x3f /* ? */) {
      const isXmlDecl = lt === (text.charCodeAt(0) === 0xfeff ? 1 : 0)
        && text.startsWith('<?xml', lt) && (isSpace(text.charCodeAt(lt + 5)) || text.charCodeAt(lt + 5) === 0x3f);
      if (!isXmlDecl) return fail('processing-instruction');
      const end = text.indexOf('?>', lt + 5);
      if (end < 0) return fail('not-svg');
      i = end + 2;
      continue;
    }

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
    if (stack.length === 0) {
      if (rootSeen || localName(name) !== 'svg') return fail('not-svg');
      rootSeen = true;
    }
    const forbidden = FORBIDDEN_ELEMENTS[localName(name)];
    if (forbidden) return fail(forbidden);

    let selfClosing = false;
    for (;;) {
      const before = j;
      while (j < n && isSpace(text.charCodeAt(j))) j += 1;
      const c = text.charCodeAt(j);
      if (j >= n) return fail('not-svg');
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
      if (!attr) return fail('not-svg');
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
      const problem = checkAttribute(attr, value);
      if (problem) return fail(problem);
      j = close + 1;
    }

    if (selfClosing) {
      if (stack.length === 0) rootClosed = true;
    } else {
      stack.push(name);
    }
    i = j;
  }

  if (!rootSeen || !rootClosed || stack.length) return fail('not-svg');
  // Anything after the root is whitespace only.
  for (let k = i; k < n; k += 1) if (!isSpace(text.charCodeAt(k))) return fail('not-svg');
  return { ok: true };
}

export default checkSvg;
