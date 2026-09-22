/**
 * Product names arrive from barcode databases as printed on the pack, often in
 * capitals ("OIKOS PRO PLAIN"). Normalize ONCE at ingest, before the catalog and
 * the ledger see them. Only shouting is changed: mixed-case words ("McCormick")
 * and short acronyms inside a mixed name ("PB") are the brand's own spelling.
 * A word repeated back to back ("Cheddar Cheddar") is a database join artifact
 * and is collapsed.
 */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const ACRONYMS = new Set(['BBQ', 'BLT', 'USA', 'XL', 'PB', 'PBJ', 'GF', 'DHA', 'UHT', 'OJ']);
const letters = word => word.replace(/[^A-Za-z]/g, '');
const shouting = word => letters(word).length > 0 && letters(word) === letters(word).toUpperCase();
const titleWord = word => word.toLowerCase().replace(/(^|[-/(])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());

/**
 * @param {unknown} raw
 * @returns {string} the name with shouting words title-cased; '' for nothing
 */
export function normalizeProductName(raw) {
  const words = String(raw ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  const wholeNameShouts = words.every(w => !letters(w) || shouting(w));
  const cased = words.map((word, index) => {
    if (!shouting(word) || ACRONYMS.has(letters(word))) return word;
    if (!wholeNameShouts && letters(word).length < 4) return word;
    const lower = word.toLowerCase();
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    return titleWord(word);
  });
  return cased.filter((word, index) => index === 0 || word.toLowerCase() !== cased[index - 1].toLowerCase()).join(' ');
}
