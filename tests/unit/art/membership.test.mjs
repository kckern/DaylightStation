import { describe, it, expect } from 'vitest';
import { isMember } from '../../../backend/src/1_adapters/content/art/collections.mjs';

// entry shape the predicate sees: { folder, meta }
const entry = (meta) => ({ folder: 'W', meta });

describe('isMember (hybrid membership)', () => {
  const impressionism = { dateMin: 1860, dateMax: 1900 };

  it('includes a work that matches the date rule', () => {
    expect(isMember('impressionism', impressionism, entry({ date: '1875' }))).toBe(true);
  });

  it('excludes a work outside the date rule', () => {
    expect(isMember('impressionism', impressionism, entry({ date: '1500' }))).toBe(false);
  });

  it('includes a rule-miss that is hand-tagged with the collection name', () => {
    expect(isMember('impressionism', impressionism,
      entry({ date: '1500', tags: ['impressionism'] }))).toBe(true);
  });

  it('hidden works are never members, even if tagged', () => {
    expect(isMember('impressionism', impressionism,
      entry({ date: '1875', hidden: true }))).toBe(false);
    expect(isMember('impressionism', impressionism,
      entry({ date: '1500', tags: ['impressionism'], hidden: true }))).toBe(false);
  });

  it('flagged works are never members', () => {
    expect(isMember('impressionism', impressionism, entry({ date: '1875', flagged: true }))).toBe(false);
  });

  it('exclude pulls a rule-matched work out of that one collection', () => {
    expect(isMember('impressionism', impressionism,
      entry({ date: '1875', exclude: ['impressionism'] }))).toBe(false);
    // still a member of a different collection it matches
    expect(isMember('realism', { dateMin: 1840, dateMax: 1880 },
      entry({ date: '1875', exclude: ['impressionism'] }))).toBe(true);
  });

  it('exclude beats a hand-tag for the same collection', () => {
    expect(isMember('impressionism', impressionism,
      entry({ date: '1500', tags: ['impressionism'], exclude: ['impressionism'] }))).toBe(false);
  });

  it('the catch-all key still drops hidden/flagged', () => {
    expect(isMember('all', {}, entry({ date: '1875' }))).toBe(true);
    expect(isMember('all', {}, entry({ date: '1875', hidden: true }))).toBe(false);
  });
});
