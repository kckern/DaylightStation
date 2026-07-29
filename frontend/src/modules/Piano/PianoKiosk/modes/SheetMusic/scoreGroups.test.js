import { resolveScoreGroups } from './scoreGroups.js';

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
