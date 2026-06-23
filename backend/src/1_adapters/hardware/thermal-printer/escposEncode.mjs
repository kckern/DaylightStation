/**
 * escposEncode — JS/Unicode string → single-byte code-page bytes for ESC/POS.
 *
 * Thermal printers (e.g. the Volcora V-WLRP5) render text from a 255-glyph ROM
 * code page selected with `ESC t n` — they have no real UTF-8 text mode. Writing
 * raw UTF-8 therefore shatters every multibyte character into code-page mojibake.
 *
 * This module is the single owner of the wire encoding:
 *   1. Transliterate typographic characters the code page lacks but that have a
 *      clean ASCII equivalent (em/en dash → '-', curly quotes → straight, …).
 *   2. Encode to the selected code page (default CP858 — DOS Latin-1 + Euro, so
 *      ç é ñ ô ü à … render as their true ROM glyphs).
 *   3. Drop anything still unrepresentable (emoji, exotic letters) rather than
 *      emit iconv's '?' (0x3F) replacement, which would litter the receipt.
 *
 * Pure: no I/O, no logging. Keep it that way so it stays trivially testable.
 *
 * @module adapters/hardware/thermal-printer/escposEncode
 */

import iconv from 'iconv-lite';

/** iconv-lite's single-byte replacement for an unmappable character. */
const REPLACEMENT_BYTE = 0x3f; // '?'

/** Typographic characters absent from DOS code pages → ASCII equivalents. */
const TRANSLITERATIONS = {
  '—': '-',   // em dash
  '–': '-',   // en dash
  '‘': "'",   // left single quote
  '’': "'",   // right single quote / apostrophe
  '“': '"',   // left double quote
  '”': '"',   // right double quote
  '…': '...', // horizontal ellipsis
  ' ': ' ',   // non-breaking space
};

/**
 * Encode a string to printable code-page bytes.
 * @param {string} input
 * @param {string} [codepage='cp858'] iconv-lite codec matching the `ESC t n` page
 * @returns {Buffer}
 */
export function encodeText(input, codepage = 'cp858') {
  const str = String(input ?? '');
  const out = [];

  // Iterate by code point so astral chars (emoji) are handled as one unit.
  for (const cp of str) {
    const mapped = TRANSLITERATIONS[cp] ?? cp;
    for (const ch of mapped) {
      const buf = iconv.encode(ch, codepage);
      // Drop characters the code page can't represent (iconv yields a lone
      // 0x3F), unless the source really is a literal '?'.
      if (buf.length === 1 && buf[0] === REPLACEMENT_BYTE && ch !== '?') continue;
      for (const b of buf) out.push(b);
    }
  }

  return Buffer.from(out);
}

export default encodeText;
