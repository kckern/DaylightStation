import { resolveScoreGroups, groupSlug, groupIndexBySlug } from './scoreGroups.js';

describe('resolveScoreGroups', () => {
  it('resolves the grouped form into ordered {label, ref} tabs', () => {
    expect(resolveScoreGroups({
      collections: [
        { label: 'Video Games', ref: 'files:docs/sheet-music/video-games' },
        { label: 'TV Shows', ref: 'files:docs/sheet-music/tv-shows' },
      ],
    })).toEqual([
      { label: 'Video Games', ref: 'files:docs/sheet-music/video-games' },
      { label: 'TV Shows', ref: 'files:docs/sheet-music/tv-shows' },
    ]);
  });

  it('drops entries without a ref and defaults a missing label to null', () => {
    expect(resolveScoreGroups({
      collections: [
        { label: 'Empty' },
        { ref: 'files:docs/sheet-music' },
      ],
    })).toEqual([{ label: null, ref: 'files:docs/sheet-music' }]);
  });

  it('maps the legacy single collection to one unlabeled group', () => {
    expect(resolveScoreGroups({ collection: 'files:docs/sheet-music' }))
      .toEqual([{ label: null, ref: 'files:docs/sheet-music' }]);
  });

  it('prefers the grouped form when both are present', () => {
    expect(resolveScoreGroups({
      collection: 'files:old',
      collections: [{ label: 'A', ref: 'files:a' }],
    })).toEqual([{ label: 'A', ref: 'files:a' }]);
  });

  it('returns [] for empty, absent, or malformed config', () => {
    expect(resolveScoreGroups(undefined)).toEqual([]);
    expect(resolveScoreGroups({})).toEqual([]);
    expect(resolveScoreGroups({ collections: [] })).toEqual([]);
    expect(resolveScoreGroups({ collections: 'nope' })).toEqual([]);
    expect(resolveScoreGroups('nope')).toEqual([]);
  });
});

describe('groupSlug', () => {
  it('turns a label into a url-safe slug', () => {
    expect(groupSlug({ label: 'Video Games' }, 0)).toBe('video-games');
    expect(groupSlug({ label: 'TV Shows' }, 1)).toBe('tv-shows');
  });

  it('strips punctuation and collapses runs of separators', () => {
    expect(groupSlug({ label: "Bach's  Preludes & Fugues" }, 0)).toBe('bachs-preludes-fugues');
  });

  it('falls back to a positional slug when a group has no usable label', () => {
    // A collection may be configured with a ref and no label at all.
    expect(groupSlug({ label: null }, 0)).toBe('group-1');
    expect(groupSlug({ label: '—' }, 2)).toBe('group-3');
  });
});

describe('groupIndexBySlug', () => {
  const GROUPS = [{ label: 'Video Games' }, { label: 'TV Shows' }, { label: 'Classical' }];

  it('finds the group a slug names', () => {
    expect(groupIndexBySlug(GROUPS, 'tv-shows')).toBe(1);
    expect(groupIndexBySlug(GROUPS, 'classical')).toBe(2);
  });

  it('is case-insensitive, so a hand-typed url still lands', () => {
    expect(groupIndexBySlug(GROUPS, 'TV-Shows')).toBe(1);
  });

  it('falls back to the first group rather than showing nothing', () => {
    // A stale bookmark or a typo should still open the game, not a dead end.
    expect(groupIndexBySlug(GROUPS, 'beginner')).toBe(0);
    expect(groupIndexBySlug(GROUPS, '')).toBe(0);
    expect(groupIndexBySlug([], 'anything')).toBe(0);
  });
});
