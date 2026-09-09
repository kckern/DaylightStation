/**
 * GeneratedCover — a real-looking cover for a book nobody has art for.
 *
 * ## THE LAST RUNG IS NOT A SHRUG
 *
 * When the whole cascade in `BookCoverArt` misses, the shelf used to draw a
 * grey box with a star in it — identical for every such book, which made two
 * different books look like the same failure. This draws a BOOK instead:
 * a coloured board, a spine, a hairline frame, the title set in a serif, and
 * the author under a rule. It is obviously not the publisher's art and is not
 * meant to be mistaken for it; it is meant to be recognisable, so a child
 * picks their book out of a row by its colour and shape the way they do with
 * every other tile.
 *
 * ## THE SAME BOOK IS ALWAYS THE SAME COLOUR
 *
 * The hue comes from a hash of the ISBN, so a generated cover is stable across
 * renders, panels, and rebuilds — recognition depends on it not moving. It is
 * also why nothing here reads a clock or a random source.
 *
 * ## SVG, BECAUSE IT IS TEXT
 *
 * No raster encoder, no font files, no measurement pass: an `<img>` renders it,
 * it scales to any tile, and it costs a few hundred bytes. The price is that
 * line breaking has to be estimated rather than measured, which is what
 * `wrapTitle` does — deliberately conservative, since a title that overflows
 * its board looks broken while one that breaks early merely looks set.
 *
 * Layer: DOMAIN (2_domains/books). Imports nothing.
 *
 * @module domains/books/GeneratedCover
 */

const WIDTH = 400;
const HEIGHT = 600;
/** Roughly the average advance of the serif stack at a given size. */
const GLYPH_RATIO = 0.5;
const MAX_TITLE_LINES = 5;

const ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

/** Bounded, single-spaced plain text — the form wrapping is measured against. */
function plain(value) {
  return String(value ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** SVG is XML: everything that reaches a text node is escaped, always. */
function escapeXml(value) {
  return plain(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/**
 * A stable hue for one book. FNV-1a over the identifier: short, deterministic,
 * and well spread for the near-identical strings ISBNs are (two books in a
 * series differ in one digit and must not come out the same colour).
 */
export function hueFor(seed) {
  let hash = 0x811c9dc5;
  for (const character of String(seed ?? '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 360;
}

/**
 * How wide a string is, in half-em columns.
 *
 * CJK, Hangul and fullwidth punctuation occupy a full em where Latin occupies
 * about half of one, so counting characters overflows a Korean title by exactly
 * a factor of two — which is what pushed one off the board the first time.
 */
export function visualWidth(text) {
  let width = 0;
  for (const character of String(text ?? '')) {
    const point = character.codePointAt(0);
    const wide = (point >= 0x1100 && point <= 0x115f) || (point >= 0x2e80 && point <= 0xa4cf)
      || (point >= 0xac00 && point <= 0xd7a3) || (point >= 0xf900 && point <= 0xfaff)
      || (point >= 0xfe30 && point <= 0xfe6f) || (point >= 0xff00 && point <= 0xff60)
      || (point >= 0xffe0 && point <= 0xffe6) || (point >= 0x20000 && point <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/** As much of `text` as fits in `columns` half-ems. */
function clipToWidth(text, columns) {
  let width = 0;
  let out = '';
  for (const character of text) {
    const next = width + visualWidth(character);
    if (next > columns) break;
    width = next;
    out += character;
  }
  return out;
}

/**
 * Break a PLAIN title into lines that fit the board.
 *
 * Plain, not escaped: wrapping escaped text splits entities down the middle
 * (`Charlotte&` / `apos;s Web`), which produces an SVG the browser refuses
 * outright — a blank tile, which is the one outcome this whole file exists to
 * prevent. Escaping happens per line, after the break.
 *
 * A word longer than a line — a URL-ish title, an unspaced CJK run — is cut
 * rather than allowed to overflow, because a glyph that leaves the board reads
 * as a rendering fault.
 */
export function wrapTitle(title, { fontSize, maxWidth, maxLines = MAX_TITLE_LINES }) {
  const perLine = Math.max(6, Math.floor(maxWidth / (fontSize * GLYPH_RATIO)));
  const words = String(title ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  let dropped = false;

  for (const [index, word] of words.entries()) {
    if (!current) current = word;
    else if (visualWidth(current) + 1 + visualWidth(word) <= perLine) current = `${current} ${word}`;
    else { lines.push(current); current = word; }
    while (visualWidth(current) > perLine && lines.length < maxLines) {
      const head = clipToWidth(current, perLine - 1);
      lines.push(head);
      current = current.slice(head.length);
    }
    if (lines.length >= maxLines) { dropped = index < words.length - 1 || Boolean(current); break; }
  }
  if (current && lines.length < maxLines) lines.push(current);
  else if (current) dropped = true;
  if (lines.length === 0) return [];

  // An ellipsis whenever anything was left out — a title that simply STOPS mid
  // sentence reads as a rendering fault rather than as an abbreviation.
  if (dropped) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${clipToWidth(last, perLine - 1)}…`;
  }
  return lines;
}

/**
 * A cover for a book that has none.
 *
 * @param {object} book - needs `isbn13` (or any stable id) and ideally a title
 * @returns {string} a complete standalone SVG document
 */
export function generateCoverSvg(book = {}) {
  const seed = String(book.isbn13 ?? book.bookId ?? book.title ?? 'book');
  const hue = hueFor(seed);
  const plainTitle = plain(book.title) || `ISBN ${plain(book.isbn13) || 'unknown'}`;
  const authorRaw = plain(Array.isArray(book.authors) ? book.authors[0] : book.authors);

  // One hue, three roles: a board that goes darker down the page, a spine a
  // shade deeper still, and trim bright enough to read as foil.
  const board = `hsl(${hue} 42% 26%)`;
  const boardDeep = `hsl(${(hue + 22) % 360} 48% 14%)`;
  const spine = `hsl(${hue} 50% 18%)`;
  const trim = `hsl(${hue} 62% 72%)`;
  const ink = `hsl(${hue} 30% 96%)`;

  const measured = visualWidth(plainTitle);
  const fontSize = measured > 60 ? 30 : measured > 30 ? 36 : 42;
  const lines = wrapTitle(plainTitle, { fontSize, maxWidth: WIDTH - 150 });
  const blockHeight = lines.length * fontSize * 1.22;
  // The title block sits on the upper third's optical centre, which is where a
  // designed cover puts it and where a tile crops least of it.
  const firstBaseline = Math.max(fontSize * 2.4, 250 - blockHeight / 2);

  const titleLines = lines
    .map((line, index) => `<tspan x="${WIDTH / 2 + 22}" dy="${index === 0 ? 0 : fontSize * 1.22}">${escapeXml(line)}</tspan>`)
    .join('');

  const ruleY = firstBaseline + blockHeight + 18;
  // One line, clipped to the board: an unbounded author name ran off both
  // edges of the frame it is supposed to sit inside.
  const AUTHOR_SIZE = 22;
  const authorColumns = Math.floor((WIDTH - 150) / (AUTHOR_SIZE * GLYPH_RATIO));
  const author = escapeXml(visualWidth(authorRaw) > authorColumns
    ? `${clipToWidth(authorRaw, authorColumns - 1)}…`
    : authorRaw);
  const authorBlock = author
    ? `<line x1="${WIDTH / 2 - 70}" y1="${ruleY}" x2="${WIDTH / 2 + 114}" y2="${ruleY}" stroke="${trim}" stroke-width="2" opacity="0.75"/>`
      + `<text x="${WIDTH / 2 + 22}" y="${ruleY + 38}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"`
      + ` font-size="${AUTHOR_SIZE}" fill="${trim}" letter-spacing="1.5">${author}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img">`
    + `<defs><linearGradient id="b" x1="0" y1="0" x2="0.35" y2="1">`
    + `<stop offset="0" stop-color="${board}"/><stop offset="1" stop-color="${boardDeep}"/></linearGradient></defs>`
    + `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#b)"/>`
    // The spine: what makes the shape read as a book rather than a swatch.
    + `<rect x="0" y="0" width="44" height="${HEIGHT}" fill="${spine}"/>`
    + `<rect x="44" y="0" width="3" height="${HEIGHT}" fill="${trim}" opacity="0.55"/>`
    // Foil frame, inset from the board edge the way a printed one is.
    + `<rect x="70" y="34" width="${WIDTH - 104}" height="${HEIGHT - 68}" fill="none" stroke="${trim}" stroke-width="2" opacity="0.5"/>`
    + `<text y="${firstBaseline}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"`
    + ` font-size="${fontSize}" font-weight="700" fill="${ink}">${titleLines}</text>`
    + authorBlock
    + `</svg>`;
}

export default generateCoverSvg;
