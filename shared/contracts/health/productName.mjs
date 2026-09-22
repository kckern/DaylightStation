/**
 * Product names arrive from barcode databases as printed on the pack, often in
 * capitals ("OIKOS PRO PLAIN"). Normalize ONCE at ingest, before the catalog and
 * the ledger see them. Only shouting is changed: mixed-case words ("McCormick"),
 * short acronyms inside a mixed name ("PB"), digit-led tokens ("7UP") and
 * ampersand names ("M&M'S") are the brand's own spelling. Repeated words are
 * kept: "Mahi Mahi" and "Cous Cous" are real names.
 */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const ACRONYMS = new Set(['BBQ', 'BLT', 'USA', 'XL', 'PB', 'PBJ', 'GF', 'DHA', 'UHT', 'OJ']);
const letters = word => word.replace(/[^\p{L}]/gu, '');
// Scripts without case (upper === lower) never shout.
const shouting = word => {
  const only = letters(word);
  return only.length > 0 && only === only.toUpperCase() && only !== only.toLowerCase();
};
const keepAsPrinted = word => /^\p{N}/u.test(word) || word.includes('&');
// Capitalise the first letter, the letter after - / (, and after a one-letter
// prefix with an apostrophe (O'Brien). A possessive (Kellogg's) stays lower.
const titleWord = word => word.toLowerCase()
  .replace(/(^|[-/(])(\p{Ll})/gu, (_, lead, ch) => lead + ch.toUpperCase())
  .replace(/^(\p{Lu})(['’])(\p{Ll})/u, (_, first, mark, ch) => first + mark + ch.toUpperCase());

/**
 * @param {unknown} raw
 * @returns {string} the name with shouting words title-cased; '' for nothing
 */
export function normalizeProductName(raw) {
  const words = String(raw ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  const wholeNameShouts = words.every(w => !letters(w) || shouting(w));
  return words.map((word, index) => {
    if (!shouting(word) || keepAsPrinted(word) || ACRONYMS.has(letters(word))) return word;
    if (!wholeNameShouts && letters(word).length < 4) return word;
    const lower = word.toLowerCase();
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    return titleWord(word);
  }).join(' ');
}
