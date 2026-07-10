import { describe, it, expect, beforeEach } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';
import { _resetCacheForTests } from '#adapters/content/media/plex/CurriculumIndex.mjs';

// A real index file for 676490 must exist (Task 2). Use a season+episode known present.
function adapter() { return new PlexAdapter({ host: 'http://x', token: 't' }, { httpClient: { get: async () => ({}) } }); }

describe('PlexAdapter curriculum merge', () => {
  beforeEach(() => _resetCacheForTests());

  it('episode in an indexed show gets corrected title + metadata.piano', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'episode', ratingKey: '1', title: 'Intro',
      grandparentRatingKey: '676490', parentIndex: 8, index: 1, Media: [] });
    expect(item.title).toBe('Intro');
    expect(item.metadata.piano.course).toBe("Ain’t Misbehavin’");
    expect(item.metadata.piano.styles).toContain('Jazz Ballads');
  });

  it('season in an indexed show gets the lane block', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'season', ratingKey: '677395', title: 'Song Library',
      parentRatingKey: '676490', index: 8 });
    expect(item.metadata.piano.lane).toBe('repertoire');
    expect(item.metadata.piano.kind).toBeUndefined();
  });

  it('item in a non-indexed show is untouched (no piano)', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'episode', ratingKey: '9', title: 'Ep', grandparentRatingKey: '999999', parentIndex: 1, index: 1, Media: [] });
    expect(item.metadata.piano).toBeUndefined();
  });
});
