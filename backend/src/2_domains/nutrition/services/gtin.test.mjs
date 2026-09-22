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
});
