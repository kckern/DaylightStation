import { describe, expect, it } from 'vitest';
import { parseBookIdentifier } from './BookIdentifier.mjs';

/** Capture rather than match a message: the kind is the contract, the prose is not. */
const kindOf = (raw) => parseBookIdentifier(raw).kind;

describe('parseBookIdentifier', () => {
  describe('ISBN-13', () => {
    it('accepts a valid ISBN-13 and returns it as the canonical key', () => {
      expect(parseBookIdentifier('9780064400558')).toEqual({
        kind: 'isbn', isbn13: '9780064400558', raw: '9780064400558',
      });
    });

    it('strips the hyphens a copyright page prints', () => {
      expect(parseBookIdentifier('978-0-06-440055-8').isbn13).toBe('9780064400558');
    });

    it('strips the CR a barcode scanner appends', () => {
      expect(parseBookIdentifier('9780064400558\r\n').isbn13).toBe('9780064400558');
    });

    it('rejects an ISBN-13 whose check digit is wrong', () => {
      // Same book, last digit bumped 8 -> 7.
      expect(parseBookIdentifier('9780064400557')).toEqual({
        kind: 'invalid', reason: 'isbn13-checksum', raw: '9780064400557',
      });
    });

    it('rejects a 13-digit code that is not a Bookland prefix', () => {
      // A grocery EAN-13 is not a book, however well-formed.
      expect(kindOf('4006381333931')).toBe('invalid');
    });
  });

  describe('ISBN-10', () => {
    it('converts a valid ISBN-10 to its ISBN-13 equivalent', () => {
      // 0064400557 is Charlotte's Web; the 978-prefixed form is the canonical key.
      expect(parseBookIdentifier('0064400557')).toEqual({
        kind: 'isbn', isbn13: '9780064400558', isbn10: '0064400557', raw: '0064400557',
      });
    });

    it('accepts a trailing X check digit in either case', () => {
      expect(parseBookIdentifier('080442957X').isbn13).toBe('9780804429573');
      expect(parseBookIdentifier('080442957x').isbn13).toBe('9780804429573');
    });

    it('rejects an ISBN-10 whose check digit is wrong', () => {
      expect(parseBookIdentifier('0064400550').reason).toBe('isbn10-checksum');
    });
  });

  describe('library record ids', () => {
    it('reads a bare BiblioCommons record id', () => {
      expect(parseBookIdentifier('S82C1482387')).toEqual({
        kind: 'library-record', recordId: 'S82C1482387', raw: 'S82C1482387',
      });
    });

    it('reads a record id out of a pasted KCLS url', () => {
      expect(parseBookIdentifier('https://kcls.bibliocommons.com/v2/record/S82C1482387'))
        .toMatchObject({ kind: 'library-record', recordId: 'S82C1482387' });
    });
  });

  describe('OpenLibrary keys', () => {
    it('reads a work key', () => {
      expect(parseBookIdentifier('OL15626917W'))
        .toMatchObject({ kind: 'openlibrary-work', workKey: 'OL15626917W' });
    });

    it('reads an edition key', () => {
      expect(parseBookIdentifier('OL61062640M'))
        .toMatchObject({ kind: 'openlibrary-edition', editionKey: 'OL61062640M' });
    });

    it('reads a work key out of a pasted openlibrary url', () => {
      expect(parseBookIdentifier('https://openlibrary.org/works/OL15626917W.json'))
        .toMatchObject({ kind: 'openlibrary-work', workKey: 'OL15626917W' });
    });
  });

  describe('what a child actually mistypes or mis-scans', () => {
    it('names a wrong-length digit string so the screen can say what is wrong', () => {
      // The library's own sticker barcode: digits, but not a book. B10/B11.
      expect(parseBookIdentifier('00100123456789')).toEqual({
        kind: 'invalid', reason: 'not-an-identifier', raw: '00100123456789',
      });
    });

    it.each([null, undefined, '', '   '])('treats %p as empty, not as a lookup', (value) => {
      expect(parseBookIdentifier(value)).toEqual({ kind: 'empty', raw: '' });
    });

    it('never throws, whatever it is handed', () => {
      for (const value of [42, {}, [], true, Symbol('x')]) {
        expect(() => parseBookIdentifier(value)).not.toThrow();
      }
    });
  });
});
