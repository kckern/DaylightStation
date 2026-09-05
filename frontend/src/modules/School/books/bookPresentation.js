/**
 * Child-facing book metadata presentation.
 *
 * Provider records stay untouched in the cache. This module removes only
 * transport/catalogue debris at render time, composes a useful title from a
 * subtitle, and turns an unbounded author list into a stable short label.
 */

const ENTITY = Object.freeze({
  amp: '&', apos: "'", gt: '>', hellip: '…', lt: '<', nbsp: ' ', quot: '"',
});

// Only trailing, wholly bracketed packaging/catalogue labels are discarded.
// Parentheses inside a real title stay untouched. The vocabulary covers the
// MARC general-material labels and the retail bindings providers commonly
// append to otherwise usable titles.
const CATALOGUE_NOTE = /\s*[[(]\s*(?:(?:unabridged|abridged)\s+)?(?:book|board book|braille|ebook|e-book|electronic resource|graphic novel|hardback|hardcover|kindle edition|kit|large print(?: edition)?|library binding|mass market paperback|paperback|sound recording|text|trade paperback|videorecording)(?:\s+edition)?\s*[\])]\s*$/i;

function decodeEntity(_whole, name, decimal, hex) {
  if (name) return ENTITY[name.toLowerCase()] ?? `&${name};`;
  const point = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
  return Number.isFinite(point) && point > 0 && point <= 0x10ffff
    ? String.fromCodePoint(point)
    : '';
}

/** Plain, bounded-whitespace text from a provider scalar. */
export function cleanBookText(value, { html = false } = {}) {
  if (value === null || value === undefined) return '';
  let text = String(value).normalize('NFC');
  if (html) {
    text = text
      .replace(/<(?:br|hr)\s*\/?>/gi, ' ')
      .replace(/<\/(?:div|li|p|section)>/gi, ' ')
      .replace(/<[^>]{1,300}>/g, ' ');
  }
  return text
    .replace(/&(\w+);|&#(\d+);|&#x([\da-f]+);/gi, decodeEntity)
    .replace(/\p{Cc}/gu, (character) => (/\s/u.test(character) ? ' ' : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove known library-format suffixes without guessing at real title text. */
export function cleanBookTitlePart(value) {
  let title = cleanBookText(value, { html: true });
  let before;
  do {
    before = title;
    title = title.replace(CATALOGUE_NOTE, '').trim();
  } while (title !== before);
  return title;
}

function comparable(value) {
  return cleanBookText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function humanizeAuthor(value) {
  const cleaned = cleanBookText(value, { html: true })
    .replace(/\s*,?\s*(?:b\.?\s*)?\d{4}\s*[-–]\s*(?:\d{4})?\s*$/i, '')
    .trim();
  const comma = /^([^,\d]+),\s*([^,\d]+)$/.exec(cleaned);
  if (!comma || /^(?:jr\.?|sr\.?|i{2,3}|iv)$/i.test(comma[2].trim())) return cleaned;
  return `${comma[2].trim()} ${comma[1].trim()}`;
}

/** Humanized, punctuation-insensitive de-duplication, preserving source order. */
export function cleanAuthors(authors) {
  const values = Array.isArray(authors) ? authors : [];
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const author = humanizeAuthor(raw);
    const key = comparable(author);
    if (!author || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(author);
  }
  return result;
}

export function authorsLabel(authors, { visible = 2 } = {}) {
  const list = cleanAuthors(authors);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length <= visible) return `${list.slice(0, -1).join(', ')} & ${list.at(-1)}`;
  return `${list.slice(0, visible).join(', ')} & ${list.length - visible} more`;
}

/** The complete clean label is useful as an accessible/title expansion. */
export function allAuthorsLabel(authors) {
  const list = cleanAuthors(authors);
  if (list.length < 3) return authorsLabel(list, { visible: 2 });
  return `${list.slice(0, -1).join(', ')} & ${list.at(-1)}`;
}

export function presentBook(book = {}) {
  const record = book && typeof book === 'object' ? book : {};
  const title = cleanBookTitlePart(record.title);
  const subtitle = cleanBookTitlePart(record.subtitle);
  const combined = title && subtitle && !comparable(title).includes(comparable(subtitle))
    ? `${title}: ${subtitle}`
    : (title || subtitle);
  const isbn = cleanBookText(record.isbn13 ?? record.bookId);
  const authors = cleanAuthors(record.authors);
  return {
    title: combined || (isbn ? `Book ${isbn}` : 'Untitled book'),
    authors,
    author: authorsLabel(authors),
    allAuthors: allAuthorsLabel(authors),
    description: cleanBookText(record.description, { html: true }).slice(0, 600),
  };
}

export default presentBook;
