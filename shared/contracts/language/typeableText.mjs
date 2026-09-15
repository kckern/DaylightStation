/**
 * The part of a sentence a learner can actually type on a School keyboard.
 *
 * Corpus sentences carry characters no key produces. Glossika marks speaker
 * variants with ♂/♀ (`♂형과 (♀오빠와)`), and its punctuation is typographic —
 * curly apostrophes, em dashes, full-width marks. A typing drill that asks for
 * those is a dead end: the column waits for a character the child cannot make,
 * and every syllable after it lands one column off (found live 2026-09-14).
 *
 * So the text to type is the sentence with:
 * - typographic punctuation mapped to what the keyboard types (’ → ', — → -,
 *   full-width ？ → ?),
 * - anything still not typeable dropped — only Hangul (syllables and jamo),
 *   printable ASCII and whitespace remain,
 * - runs of whitespace collapsed to one space, and the ends trimmed.
 *
 * Shared by the typing rungs, the Review diff and the backend's accuracy score,
 * so what is typed, what is shown and what is scored are the same string.
 */

const TYPOGRAPHIC = Object.freeze({
  '‘': "'", '’': "'", '‚': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '″': '"',
  '–': '-', '—': '-', '−': '-',
  '…': '...',
  ' ': ' ', '　': ' ',
});

const FULL_WIDTH_START = 0xff01;
const FULL_WIDTH_END = 0xff5e;

const isHangul = codePoint => (codePoint >= 0xac00 && codePoint <= 0xd7a3) // precomposed syllables
  || (codePoint >= 0x3131 && codePoint <= 0x318e) // compatibility jamo
  || (codePoint >= 0x1100 && codePoint <= 0x11ff); // conjoining jamo
const isPrintableAscii = codePoint => codePoint >= 0x20 && codePoint <= 0x7e;

function mapCharacter(character) {
  if (TYPOGRAPHIC[character] != null) return TYPOGRAPHIC[character];
  const codePoint = character.codePointAt(0);
  if (codePoint >= FULL_WIDTH_START && codePoint <= FULL_WIDTH_END) {
    return String.fromCodePoint(codePoint - 0xfee0);
  }
  return character;
}

/**
 * @param {string} text
 * @returns {string} the typeable form of `text`
 */
export function typeableText(text) {
  let kept = '';
  for (const character of String(text ?? '')) {
    for (const mapped of mapCharacter(character)) {
      if (/\s/u.test(mapped)) { kept += ' '; continue; }
      const codePoint = mapped.codePointAt(0);
      if (isHangul(codePoint) || isPrintableAscii(codePoint)) kept += mapped;
    }
  }
  return kept.replace(/ {2,}/g, ' ').trim();
}

export default typeableText;
