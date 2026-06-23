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
