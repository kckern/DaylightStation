import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { isValidAnchor, mergeWorkMetadata, filterWorks }
  from '../../../backend/src/1_adapters/content/art/workMetadata.mjs';

describe('isValidAnchor', () => {
  it('accepts keyword anchors (1-2 tokens) and percents', () => {
    ['top', 'center', 'bottom right', 'top left', '50% 20%'].forEach((a) =>
      expect(isValidAnchor(a)).toBe(true));
  });
  it('rejects junk and >2 tokens', () => {
    ['sideways', 'top top top', 'banana'].forEach((a) => expect(isValidAnchor(a)).toBe(false));
  });
  it('treats null as valid (a clear)', () => { expect(isValidAnchor(null)).toBe(true); });
});

describe('mergeWorkMetadata', () => {
  const base = "title: Lilies\nartist: Monet\nwidth: 1600\nheight: 1000\n";

  it('merges a patch and preserves untouched fields', () => {
    const out = yaml.load(mergeWorkMetadata(base, { tags: ['impressionism'], crop_anchor: 'top' }));
    expect(out).toMatchObject({ title: 'Lilies', artist: 'Monet', width: 1600, tags: ['impressionism'], crop_anchor: 'top' });
  });

  it('null clears a field', () => {
    const withAnchor = "title: X\nwidth: 1\nheight: 1\ncrop_anchor: top\n";
    const out = yaml.load(mergeWorkMetadata(withAnchor, { crop_anchor: null }));
    expect('crop_anchor' in out).toBe(false);
  });

  it('throws on an invalid anchor', () => {
    expect(() => mergeWorkMetadata(base, { crop_anchor: 'banana' })).toThrow(/anchor/i);
  });
});

describe('filterWorks', () => {
  const works = [
    { id: 'a', meta: { title: 'Sunrise', artist: 'Monet', tags: ['impressionism'], hidden: false, flagged: false } },
    { id: 'b', meta: { title: 'Night', artist: 'Goya', tags: [], hidden: true, flagged: false } },
    { id: 'c', meta: { title: 'Flag Study', artist: 'X', tags: [], hidden: false, flagged: true } },
  ];
  it('filters by tag', () => { expect(filterWorks(works, { tag: 'impressionism' }).map((w) => w.id)).toEqual(['a']); });
  it('filters by hidden flag', () => { expect(filterWorks(works, { hidden: true }).map((w) => w.id)).toEqual(['b']); });
  it('filters by flagged', () => { expect(filterWorks(works, { flagged: true }).map((w) => w.id)).toEqual(['c']); });
  it('searches title/artist case-insensitively', () => {
    expect(filterWorks(works, { q: 'goya' }).map((w) => w.id)).toEqual(['b']);
  });
  it('no filters → everything', () => { expect(filterWorks(works, {}).length).toBe(3); });
});
