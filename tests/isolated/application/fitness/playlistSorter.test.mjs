// tests/isolated/application/fitness/playlistSorter.test.mjs
import { describe, test, expect } from '@jest/globals';
import { sortPlaylistItems, isPlaylist } from '#apps/fitness/playlistSorter.mjs';

describe('sortPlaylistItems', () => {
  test('sorts by userRating DESC (highest first)', () => {
    const items = [
      { id: 'plex:1', userRating: 6 },
      { id: 'plex:2', userRating: 9 },
      { id: 'plex:3', userRating: 3 },
    ];
    expect(sortPlaylistItems(items).map(i => i.id)).toEqual(['plex:2', 'plex:1', 'plex:3']);
  });

  test('unrated items sort last (under rated ones)', () => {
    const items = [
      { id: 'plex:1' },
      { id: 'plex:2', userRating: 5 },
      { id: 'plex:3' },
      { id: 'plex:4', userRating: 10 },
    ];
    const out = sortPlaylistItems(items).map(i => i.id);
    expect(out[0]).toBe('plex:4');
    expect(out[1]).toBe('plex:2');
    expect(out.slice(2).sort()).toEqual(['plex:1', 'plex:3']);
  });

  test('reads userRating from metadata fallback', () => {
    const items = [
      { id: 'plex:1', metadata: { userRating: 3 } },
      { id: 'plex:2', metadata: { userRating: 9 } },
    ];
    expect(sortPlaylistItems(items).map(i => i.id)).toEqual(['plex:2', 'plex:1']);
  });

  test('dedupes by id — first occurrence wins', () => {
    const items = [
      { id: 'plex:1', userRating: 3, label: 'orig' },
      { id: 'plex:2', userRating: 9 },
      { id: 'plex:1', userRating: 3, label: 'dup' },
    ];
    const out = sortPlaylistItems(items);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('plex:2');
    expect(out[1].label).toBe('orig');
  });

  test('dedupes by ratingKey fallback when id absent', () => {
    const items = [
      { ratingKey: '100', userRating: 5 },
      { ratingKey: '100', userRating: 5 }, // dup
      { ratingKey: '200', userRating: 9 },
    ];
    expect(sortPlaylistItems(items)).toHaveLength(2);
  });

  test('equal-rated items are shuffled (grab-bag)', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `plex:${i}`, userRating: 5 }));
    const input = items.map(i => i.id).join(',');
    let sawShuffle = false;
    for (let trial = 0; trial < 20; trial++) {
      const out = sortPlaylistItems(items).map(i => i.id);
      expect(out.sort()).toEqual(input.split(',').sort());
      if (sortPlaylistItems(items).map(i => i.id).join(',') !== input) {
        sawShuffle = true;
      }
    }
    expect(sawShuffle).toBe(true);
  });

  test('handles empty / single / non-array inputs', () => {
    expect(sortPlaylistItems([])).toEqual([]);
    expect(sortPlaylistItems(null)).toEqual([]);
    expect(sortPlaylistItems(undefined)).toEqual([]);
    expect(sortPlaylistItems([{ id: 'x', userRating: 5 }])).toEqual([{ id: 'x', userRating: 5 }]);
  });

  test('does not mutate input', () => {
    const items = [
      { id: 'plex:1', userRating: 3 },
      { id: 'plex:2', userRating: 9 },
    ];
    const snapshot = items.map(i => i.id);
    sortPlaylistItems(items);
    expect(items.map(i => i.id)).toEqual(snapshot);
  });
});

describe('isPlaylist', () => {
  test('true when info.type === "playlist"', () => {
    expect(isPlaylist({ type: 'playlist' })).toBe(true);
  });

  test('false for shows, movies, null, undefined', () => {
    expect(isPlaylist({ type: 'show' })).toBe(false);
    expect(isPlaylist({ type: 'movie' })).toBe(false);
    expect(isPlaylist(null)).toBe(false);
    expect(isPlaylist(undefined)).toBe(false);
    expect(isPlaylist({})).toBe(false);
  });
});
