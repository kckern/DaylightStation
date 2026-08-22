import { describe, it, expect } from '@jest/globals';
import { encodeText } from '#adapters/hardware/thermal-printer/escposEncode.mjs';

/**
 * The Volcora V-WLRP5 prints from a single-byte code-page ROM (CP858 once
 * selected via `ESC t 19`). encodeText() is the bridge: it maps a JS/Unicode
 * string to the exact bytes that ROM renders, transliterating typographic
 * characters CP858 lacks and dropping anything truly unrepresentable instead
 * of spraying iconv's '?' replacement.
 */
describe('encodeText (CP858 wire encoding)', () => {
  const bytes = (buf) => [...buf];

  it('passes ASCII through unchanged', () => {
    expect(bytes(encodeText('AB'))).toEqual([0x41, 0x42]);
  });

  it('encodes Western-European accents to their CP858 ROM bytes', () => {
    // Curaçao — the ç that garbled on paper — must become 0x87, not '?'.
    expect(bytes(encodeText('ç'))).toEqual([0x87]);
    expect(bytes(encodeText('é'))).toEqual([0x82]);
  });

  it('encodes the middle dot natively (·  → 0xFA)', () => {
    expect(bytes(encodeText('·'))).toEqual([0xfa]);
  });

  it('transliterates the em dash to a hyphen rather than emitting 0x3F', () => {
    expect(bytes(encodeText('a—b'))).toEqual([0x61, 0x2d, 0x62]);
  });

  it('drops characters CP858 cannot represent (emoji) instead of 0x3F', () => {
    expect(bytes(encodeText('⚽X'))).toEqual([0x58]);
  });

  it('keeps a literal question mark', () => {
    expect(bytes(encodeText('?'))).toEqual([0x3f]);
  });
});

/**
 * The result-receipt mark row (2026-08-22 incident).
 *
 * `DocumentEscPosRenderer` prints one bracketed mark per question — `[✓]` for a
 * correct answer, `[×]` for a wrong one. U+2713 is absent from CP858, so
 * encodeText mapped it to iconv's 0x3F and then deliberately DROPPED it: a
 * correct answer printed as an empty `[]` while a wrong one printed `[×]`.
 *
 * Measured on 2026-08-22 — CP858 cannot represent U+2713 (✓), U+221A (√),
 * U+2717 (✗), U+2610 (☐) or U+2611 (☑). Its 0xFB is `¹`, NOT the `√` that
 * CP437 carries there, so "just emit 0xFB" would print a superscript one.
 * The mark therefore has to transliterate to something CP858 really has.
 */
describe('encodeText — receipt mark glyphs', () => {
  const bytes = (buf) => [...buf];

  it('renders a correct mark as a visible glyph instead of dropping it', () => {
    const out = bytes(encodeText('[✓]'));
    expect(out.length).toBe(3);              // was 2 — the mark vanished
    expect(out[0]).toBe(0x5b);               // [
    expect(out[2]).toBe(0x5d);               // ]
    expect(out[1]).not.toBe(0x3f);           // never iconv's replacement
  });

  it('keeps the wrong mark on its native CP858 byte', () => {
    expect(bytes(encodeText('[×]'))).toEqual([0x5b, 0x9e, 0x5d]);
  });

  it('gives correct and wrong marks DIFFERENT bytes', () => {
    expect(bytes(encodeText('✓'))[0]).not.toBe(bytes(encodeText('×'))[0]);
  });

  it('never silently drops a glyph the receipt renderers actually emit', () => {
    // The guard the original bug slipped through: dropping is right for emoji,
    // but a mark the renderer deliberately prints must never encode to nothing.
    for (const glyph of ['✓', '×', '✗', '·', '—', '’', '…']) {
      expect(bytes(encodeText(glyph)).length).toBeGreaterThan(0);
    }
  });
});
