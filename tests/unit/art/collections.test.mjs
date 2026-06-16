import { describe, it, expect } from 'vitest';
import { parseYear, buildArtPredicate, resolveCollection }
  from '../../../backend/src/1_adapters/content/art/collections.mjs';

describe('parseYear', () => {
  it('extracts the first 4-digit run', () => {
    expect(parseYear('c. 1860')).toBe(1860);
    expect(parseYear('1519')).toBe(1519);
    expect(parseYear('1880-1885')).toBe(1880);
  });
  it('returns null for 0000 / missing / non-year', () => {
    expect(parseYear('0000')).toBeNull();
    expect(parseYear('')).toBeNull();
    expect(parseYear(null)).toBeNull();
    expect(parseYear('undated')).toBeNull();
  });
});

describe('buildArtPredicate', () => {
  const entry = (over = {}) => ({
    folder: 'Claude Monet - 1900 - Water Lilies',
    meta: { artist: 'Claude Monet', date: 'c. 1900', origin: 'France', medium: 'Oil on canvas', department: 'European Painting', ...over },
  });

  it('empty def matches everything', () => {
    expect(buildArtPredicate({})(entry())).toBe(true);
  });
  it('date range filters by parsed year (inclusive)', () => {
    const p = buildArtPredicate({ dateMin: 1600, dateMax: 1750 });
    expect(p(entry({ date: '1700' }))).toBe(true);
    expect(p(entry({ date: '1900' }))).toBe(false);
    expect(p(entry({ date: '0000' }))).toBe(false);
  });
  it('field match is case-insensitive substring', () => {
    expect(buildArtPredicate({ origin: 'france' })(entry())).toBe(true);
    expect(buildArtPredicate({ artist: 'monet' })(entry())).toBe(true);
    expect(buildArtPredicate({ medium: 'sculpture' })(entry())).toBe(false);
  });
  it('filters by category and display tier', () => {
    expect(buildArtPredicate({ display: 'high' })(entry({ display: 'high' }))).toBe(true);
    expect(buildArtPredicate({ display: 'high' })(entry({ display: 'low' }))).toBe(false);
    expect(buildArtPredicate({ category: 'painting' })(entry({ category: 'painting' }))).toBe(true);
    expect(buildArtPredicate({ category: 'painting' })(entry({ category: 'print' }))).toBe(false);
  });
  it('works restricts by exact folder name', () => {
    const p = buildArtPredicate({ works: ['Claude Monet - 1900 - Water Lilies', 'Other'] });
    expect(p(entry())).toBe(true);
    expect(buildArtPredicate({ works: ['Nope'] })(entry())).toBe(false);
  });
  it('criteria combine with AND', () => {
    const p = buildArtPredicate({ dateMin: 1850, dateMax: 1950, origin: 'france' });
    expect(p(entry({ date: '1900', origin: 'France' }))).toBe(true);
    expect(p(entry({ date: '1900', origin: 'Italy' }))).toBe(false);
  });
});

describe('resolveCollection', () => {
  const defs = { all: {}, baroque: { dateMin: 1600, dateMax: 1750 } };
  it('returns the named def', () => {
    expect(resolveCollection(defs, 'baroque')).toEqual({ key: 'baroque', def: { dateMin: 1600, dateMax: 1750 } });
  });
  it('falls back to all for unknown / empty key', () => {
    expect(resolveCollection(defs, 'nope')).toEqual({ key: 'all', def: {} });
    expect(resolveCollection(defs, undefined)).toEqual({ key: 'all', def: {} });
  });
  it('falls back to an empty def when all is undefined', () => {
    expect(resolveCollection({}, 'x')).toEqual({ key: 'all', def: {} });
  });
});
