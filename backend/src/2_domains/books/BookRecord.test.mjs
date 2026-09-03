import { describe, expect, it } from 'vitest';
import { BOOK_RECORD_FIELDS, createBookRecord, mergeBookRecords } from './BookRecord.mjs';

describe('createBookRecord', () => {
  it('returns every field, stubbed, so an adapter cannot emit a partial shape', () => {
    const record = createBookRecord({ source: 'openlibrary' });
    for (const field of BOOK_RECORD_FIELDS) {
      expect(record, `missing field: ${field}`).toHaveProperty(field);
    }
    expect(record.sources).toEqual(['openlibrary']);
  });

  it('carries every vendor-specific concept, so no provider has to be lossy', () => {
    // The model is the UNION of what providers know, not the intersection. A
    // concept only one vendor has is surfaced here and stubbed by the rest, so
    // the only way to tell which provider answered is which fields came back
    // filled.
    const record = createBookRecord({ source: 'openlibrary' });
    const vendorConcepts = [
      'people', 'places', 'excerpts', 'wikipediaUrl',   // OpenLibrary
      'categories', 'googleVolumeId',                   // Google Books
      'series', 'seriesVolume',                         // MyBibliotheca / MARC
      'libraryRecordId', 'format',                      // BiblioCommons
      'averageRating', 'ratingCount',                   // OpenLibrary + Google
    ];
    for (const field of vendorConcepts) {
      expect(BOOK_RECORD_FIELDS, `not in the model: ${field}`).toContain(field);
      expect(record, `not stubbed: ${field}`).toHaveProperty(field);
    }
  });

  it('defaults list fields to empty arrays and scalars to null', () => {
    const record = createBookRecord({ source: 'openlibrary' });
    expect(record.title).toBeNull();
    expect(record.pageCount).toBeNull();
    expect(record.authors).toEqual([]);
    expect(record.people).toEqual([]);
  });

  it('keeps the values an adapter does supply', () => {
    const record = createBookRecord({
      source: 'openlibrary', title: 'Charlotte’s Web', pageCount: 184, authors: ['E. B. White'],
    });
    expect(record).toMatchObject({ title: 'Charlotte’s Web', pageCount: 184, authors: ['E. B. White'] });
  });

  it('normalises a zero pageCount to null — Google returns 0 for books it has', () => {
    // Measured 2026-09-02: Narnia and Guys from Space both came back pageCount 0.
    // A 0 reaching the shelf disables the progress bar.
    expect(createBookRecord({ source: 'googlebooks', pageCount: 0 }).pageCount).toBeNull();
  });

  it('normalises blank strings to null so they never beat a real value', () => {
    expect(createBookRecord({ source: 'googlebooks', title: '   ' }).title).toBeNull();
  });

  it('refuses a record with no source, because provenance is not optional', () => {
    expect(() => createBookRecord({ title: 'x' })).toThrow(/source/i);
  });

  it('is frozen — a record is evidence, not a scratchpad', () => {
    const record = createBookRecord({ source: 'openlibrary' });
    expect(Object.isFrozen(record)).toBe(true);
  });
});

describe('mergeBookRecords', () => {
  const ol = createBookRecord({
    source: 'openlibrary',
    isbn13: '9780064400558',
    title: 'Charlotte’s Web',
    pageCount: 184,
    coverUrl: 'https://covers.openlibrary.org/b/isbn/9780064400558-L.jpg',
    description: null,
    people: ['Wilbur', 'Charlotte'],
  });
  const google = createBookRecord({
    source: 'googlebooks',
    isbn13: '9780064400558',
    title: 'Charlotte’s Web Book and Charm',
    pageCount: 196,
    coverUrl: null,
    description: 'When he discovers that he is destined to be someone’s dinner…',
  });

  it('prefers OpenLibrary for the fields it was measured to be better at', () => {
    const merged = mergeBookRecords([google, ol]);
    // Order of the argument list must not decide this — the policy does.
    expect(merged.title).toBe('Charlotte’s Web');
    expect(merged.pageCount).toBe(184);
    expect(merged.coverUrl).toContain('covers.openlibrary.org');
  });

  it('prefers Google for description, which is why it is in the chain at all', () => {
    expect(mergeBookRecords([ol, google]).description).toMatch(/destined to be someone/);
  });

  it('falls through to a lower-precedence source when the preferred one is null', () => {
    const olNoCover = createBookRecord({ source: 'openlibrary', coverUrl: null });
    const googleCover = createBookRecord({ source: 'googlebooks', coverUrl: 'https://books.google/x.jpg' });
    expect(mergeBookRecords([olNoCover, googleCover]).coverUrl).toBe('https://books.google/x.jpg');
  });

  it('records every contributing source, in the order given', () => {
    expect(mergeBookRecords([ol, google]).sources).toEqual(['openlibrary', 'googlebooks']);
  });

  it('unions list fields rather than letting one source shadow another', () => {
    const a = createBookRecord({ source: 'openlibrary', authors: ['E. B. White'] });
    const b = createBookRecord({ source: 'googlebooks', authors: ['E. B. White', 'Garth Williams'] });
    expect(mergeBookRecords([a, b]).authors).toEqual(['E. B. White', 'Garth Williams']);
  });

  it('merges a source it has no precedence rule for, rather than dropping it', () => {
    const unknown = createBookRecord({ source: 'mybibliotheca', publisher: 'Harper' });
    expect(mergeBookRecords([unknown]).publisher).toBe('Harper');
  });

  it('returns null when there is nothing to merge', () => {
    expect(mergeBookRecords([])).toBeNull();
    expect(mergeBookRecords([null, undefined])).toBeNull();
  });

  it('produces a frozen record, like every other book record', () => {
    expect(Object.isFrozen(mergeBookRecords([ol, google]))).toBe(true);
  });
});
