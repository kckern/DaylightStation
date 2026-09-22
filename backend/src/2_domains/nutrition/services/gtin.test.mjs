import { describe, it, expect } from 'vitest';
import { parseGtin } from './gtin.mjs';

describe('parseGtin', () => {
  it.each([
    ['037000338369', '037000338369'],   // UPC-A
    ['0049000000450', '0049000000450'], // EAN-13 with leading zero
    ['012345678905', '012345678905'],
    ['96385074', '96385074'],           // EAN-8
  ])('accepts %s', (raw, code) => {
    expect(parseGtin(raw)).toEqual({ ok: true, code, collapsed: false });
  });

  it('collapses two reads glued together', () => {
    expect(parseGtin('037000338369037000338369')).toEqual({ ok: true, code: '037000338369', collapsed: true });
  });

  it.each([
    ['', 'empty'],
    ['12345', 'length'],
    ['0370003383690', 'check-digit'],
    ['037000338368', 'check-digit'],
    ['9780306406157', 'isbn'],
    ['9791234567896', 'isbn'],
  ])('refuses %s (%s)', (raw, reason) => {
    expect(parseGtin(raw)).toMatchObject({ ok: false, reason });
  });

  it('ignores non-digits around the code', () => {
    expect(parseGtin(' 0370-0033-8369 ')).toMatchObject({ ok: true, code: '037000338369' });
  });

  // BarcodeDetector (web capture asks for upc_e) hands back the 8-digit
  // zero-suppressed form; about 42% of valid UPC-E codes fail EAN-8 weighting.
  it('expands a UPC-E that is not a valid EAN-8 to its UPC-A', () => {
    expect(parseGtin('04963406')).toEqual({ ok: true, code: '049000006346', collapsed: false, expanded: true });
  });

  it.each([
    ['01234505', '012000003455'], // last data digit 0-2: mfr d1 d2 d6 00, product 00 d3 d4 d5
    ['01234514', '012100003454'],
    ['01234531', '012300000451'], // 3: mfr d1 d2 d3 00, product 000 d4 d5
    ['01234543', '012340000053'], // 4: mfr d1..d4 0, product 0000 d5
  ])('UPC-E expansion %s → %s', (raw, code) => {
    expect(parseGtin(raw)).toMatchObject({ ok: true, code, expanded: true });
  });

  it('keeps an 8-digit code that is a valid EAN-8 as EAN-8', () => {
    expect(parseGtin('96385074')).toEqual({ ok: true, code: '96385074', collapsed: false });
  });

  it('refuses a UPC-E whose expansion fails its check digit too', () => {
    expect(parseGtin('04963407')).toMatchObject({ ok: false, reason: 'check-digit' });
  });

  it('pads an 11-digit UPC-A that lost its leading zero, only when it then validates', () => {
    expect(parseGtin('37000338369')).toEqual({ ok: true, code: '037000338369', collapsed: false, padded: true });
    expect(parseGtin('37000338368')).toMatchObject({ ok: false, reason: 'length' });
  });
});

