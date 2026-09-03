/**
 * The number under the barcode, judged before any network call.
 *
 * Mirrors the ISBN half of `backend/src/2_domains/books/BookIdentifier.test.mjs`
 * — same fixtures, same reasons — plus the one thing the frontend adds: a
 * LENGTH GATE. A child typing digit by digit is not wrong until they have typed
 * enough to be wrong, so anything under ten characters is still `typing` —
 * and so is ten, eleven or twelve, because the first ten digits of a
 * thirteen-digit number are not an ISBN-10 (they pass its checksum one time
 * in eleven, and then `Look it up` would light on the WRONG book). Ten is
 * judged only when the child stops there (`submit`) or ends on an `X`, which
 * only an ISBN-10 has.
 */
import { describe, expect, it } from 'vitest';
import { checkIsbn, COPY, hintFor } from './isbn.js';

describe('checkIsbn', () => {
  it('waits before judging: under ten characters is still typing', () => {
    for (const v of ['', '9', '97800', '978006440']) expect(checkIsbn(v)).toEqual({ state: 'typing' });
  });

  it('ten, eleven and twelve digits of a thirteen-digit number are still typing', () => {
    // 9780140328721 is valid; its first ten digits also pass the ISBN-10 checksum.
    const full = '9780140328721';
    expect(checkIsbn(full.slice(0, 10))).toEqual({ state: 'typing' });
    expect(checkIsbn(full.slice(0, 11))).toEqual({ state: 'typing' });
    expect(checkIsbn(full.slice(0, 12))).toEqual({ state: 'typing' });
    expect(checkIsbn(full)).toEqual({ state: 'valid', isbn13: full });
    // And the first ten of one whose prefix fails the ISBN-10 checksum: no
    // "one digit is off" while the child is mid-entry.
    expect(checkIsbn('9780064400558'.slice(0, 10))).toEqual({ state: 'typing' });
    expect(checkIsbn('9780064400558'.slice(0, 12))).toEqual({ state: 'typing' });
  });

  it('judges ten digits as an ISBN-10 when the child stops there (submit)', () => {
    expect(checkIsbn('0064400557', { submit: true })).toEqual({ state: 'valid', isbn13: '9780064400558' });
    expect(checkIsbn('0064400550', { submit: true })).toMatchObject({ state: 'invalid', reason: 'isbn10-checksum' });
    // Submit does not unlock eleven or twelve: those are still mid-entry.
    expect(checkIsbn('97800644005', { submit: true })).toEqual({ state: 'typing' });
    expect(checkIsbn('978006440055', { submit: true })).toEqual({ state: 'typing' });
    // Nor does it change a verdict at thirteen.
    expect(checkIsbn('9780064400557', { submit: true })).toMatchObject({ state: 'invalid', reason: 'isbn13-checksum' });
  });

  it('judges ten characters ending in X straight away — only an ISBN-10 ends that way', () => {
    expect(checkIsbn('080442957x')).toEqual({ state: 'valid', isbn13: '9780804429573' });
    expect(checkIsbn('080442950X')).toMatchObject({ state: 'invalid', reason: 'isbn10-checksum' });
  });

  it('accepts a valid ISBN-13 and returns it canonical', () => {
    expect(checkIsbn('9780064400558')).toEqual({ state: 'valid', isbn13: '9780064400558' });
    expect(checkIsbn('978-0-06-440055-8')).toEqual({ state: 'valid', isbn13: '9780064400558' });
    expect(checkIsbn('9780064400558\r\n')).toEqual({ state: 'valid', isbn13: '9780064400558' });
  });

  it('converts a valid ISBN-10, X included', () => {
    expect(checkIsbn('0064400557', { submit: true })).toEqual({ state: 'valid', isbn13: '9780064400558' });
    expect(checkIsbn('080442957x')).toEqual({ state: 'valid', isbn13: '9780804429573' });
  });

  it('names a wrong check digit', () => {
    expect(checkIsbn('9780064400557')).toMatchObject({ state: 'invalid', reason: 'isbn13-checksum' });
    expect(checkIsbn('0064400550', { submit: true })).toMatchObject({ state: 'invalid', reason: 'isbn10-checksum' });
  });

  it('names a non-book EAN and a library sticker', () => {
    expect(checkIsbn('4006381333931')).toMatchObject({ state: 'invalid', reason: 'not-a-book-prefix' });
    expect(checkIsbn('00100123456789')).toMatchObject({ state: 'invalid', reason: 'not-an-identifier' }); // 14 digits
    expect(checkIsbn('978006440055X')).toMatchObject({ state: 'invalid', reason: 'not-an-identifier' }); // X where a 13th digit goes
  });

  it('never throws on a non-string', () => {
    expect(checkIsbn(undefined)).toEqual({ state: 'typing' });
    expect(checkIsbn(null)).toEqual({ state: 'typing' });
  });

  it('maps every reason to a sentence a child can act on', () => {
    expect(COPY['isbn13-checksum']).toMatch(/one digit is off/);
    expect(COPY['isbn10-checksum']).toMatch(/one digit is off/);
    expect(COPY['not-a-book-prefix']).toMatch(/Flip the book over/);
    expect(COPY['not-an-identifier']).toMatch(/Flip the book over/);
    expect(COPY['not-found']).toMatch(/grown-up/);
    expect(COPY.unavailable).toMatch(/try again/);
  });

  it('hintFor reads the sentence off a verdict, and nothing off a non-verdict', () => {
    expect(hintFor(checkIsbn('9780064400557'))).toBe(COPY['isbn13-checksum']);
    expect(hintFor(checkIsbn('97800'))).toBeNull();
    expect(hintFor(checkIsbn('9780064400558'))).toBeNull();
    expect(hintFor(null)).toBeNull();
  });
});
