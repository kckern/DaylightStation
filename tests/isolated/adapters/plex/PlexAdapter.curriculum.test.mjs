import { describe, it, expect, beforeEach } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';
import { _resetCacheForTests } from '#adapters/content/media/plex/CurriculumIndex.mjs';

// A real index file for 676490 must exist (Task 2). Use a season+episode known present.
function adapter() { return new PlexAdapter({ host: 'http://x', token: 't' }, { httpClient: { get: async () => ({}) } }); }

describe('PlexAdapter curriculum merge', () => {
  beforeEach(() => _resetCacheForTests());

  it('episode in an indexed show gets corrected title + metadata.piano', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'episode', ratingKey: '1', title: '2026-07-09',
      grandparentRatingKey: '676490', parentIndex: 10, index: 1, Media: [] });
    expect(item.title).toBe('Ain’t Misbehavin’ – 1 – Intro');
    expect(item.metadata.piano.course).toBe('Ain’t Misbehavin’ – 1');
    expect(item.metadata.piano.styles).toContain('Jazz Ballads');
  });

  it('season in an indexed show gets the category block', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'season', ratingKey: '677395', title: 'Song Tutorials',
      parentRatingKey: '676490', index: 10 });
    expect(item.metadata.piano.category).toBe('repertoire');
    expect(item.metadata.piano.kind).toBe('tutorial');
  });

  it('item in a non-indexed show is untouched (no piano)', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'episode', ratingKey: '9', title: 'Ep', grandparentRatingKey: '999999', parentIndex: 1, index: 1, Media: [] });
    expect(item.metadata.piano).toBeUndefined();
  });
});
