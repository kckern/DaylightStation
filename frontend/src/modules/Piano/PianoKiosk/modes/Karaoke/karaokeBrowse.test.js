import { describe, it, expect } from 'vitest';
import {
  parseSongTitle, parseSongs, categoriesOf, filterSongs, sortKey, categoryHue, songArt,
} from './karaokeBrowse.js';

describe('parseSongTitle', () => {
  it('splits "Song (Artist)" into song + artist', () => {
    expect(parseSongTitle('My Way (Frank Sinatra)')).toEqual({ song: 'My Way', artist: 'Frank Sinatra' });
  });

  it('handles a nested parenthetical in the song itself', () => {
    expect(parseSongTitle('My Way (Live) (Frank Sinatra)')).toEqual({
      song: 'My Way (Live)',
      artist: 'Frank Sinatra',
    });
  });

  it('falls back to the whole title with no parens', () => {
    expect(parseSongTitle('Bohemian Rhapsody')).toEqual({ song: 'Bohemian Rhapsody', artist: '' });
  });

  it('falls back to the whole title when parens are unbalanced (no trailing close)', () => {
    expect(parseSongTitle('Piano (Man')).toEqual({ song: 'Piano (Man', artist: '' });
  });

  it('handles empty/null input', () => {
    expect(parseSongTitle('')).toEqual({ song: '', artist: '' });
    expect(parseSongTitle(null)).toEqual({ song: '', artist: '' });
  });
});

describe('parseSongs', () => {
  it('flattens /playable items into song rows', () => {
    const items = [
      { id: 'plex:683642', title: 'My Way (Frank Sinatra)', parentTitle: 'Crooners & Standards' },
      { id: 'plex:683699', title: 'Piano Man (Billy Joel)', parentTitle: 'Piano Men' },
    ];
    expect(parseSongs(items)).toEqual([
      { id: 'plex:683642', song: 'My Way', artist: 'Frank Sinatra', category: 'Crooners & Standards' },
      { id: 'plex:683699', song: 'Piano Man', artist: 'Billy Joel', category: 'Piano Men' },
    ]);
  });

  it('returns [] for null/undefined items', () => {
    expect(parseSongs(null)).toEqual([]);
    expect(parseSongs(undefined)).toEqual([]);
  });
});

describe('categoriesOf', () => {
  it('orders category labels by season index', () => {
    const parents = {
      683650: { index: 10, title: 'TV Themes', type: 'season' },
      683641: { index: 1, title: 'Crooners & Standards', type: 'season' },
      683642: { index: 2, title: 'Piano Men', type: 'season' },
    };
    expect(categoriesOf(parents)).toEqual(['Crooners & Standards', 'Piano Men', 'TV Themes']);
  });

  it('returns [] for empty/null parents', () => {
    expect(categoriesOf(null)).toEqual([]);
    expect(categoriesOf({})).toEqual([]);
  });
});

describe('filterSongs', () => {
  const songs = [
    { id: '1', song: 'My Way', artist: 'Frank Sinatra', category: 'Crooners & Standards' },
    { id: '2', song: 'Piano Man', artist: 'Billy Joel', category: 'Piano Men' },
    { id: '3', song: 'Fly Me to the Moon', artist: 'Frank Sinatra', category: 'Crooners & Standards' },
  ];

  it('with no query/category, returns everything sorted alphabetically by song', () => {
    expect(filterSongs(songs, {}).map((s) => s.song)).toEqual([
      'Fly Me to the Moon', 'My Way', 'Piano Man',
    ]);
  });

  it('filters by category when query is empty', () => {
    expect(filterSongs(songs, { category: 'Piano Men' }).map((s) => s.song)).toEqual(['Piano Man']);
  });

  it('"All" category shows everything', () => {
    expect(filterSongs(songs, { category: 'All' })).toHaveLength(3);
  });

  it('filters by query across song titles (case-insensitive)', () => {
    expect(filterSongs(songs, { query: 'piano man' }).map((s) => s.song)).toEqual(['Piano Man']);
  });

  it('filters by query across artist names (case-insensitive)', () => {
    expect(filterSongs(songs, { query: 'sinatra' }).map((s) => s.song)).toEqual([
      'Fly Me to the Moon', 'My Way',
    ]);
  });

  it('a non-empty query ignores the selected category', () => {
    expect(filterSongs(songs, { query: 'sinatra', category: 'Piano Men' }).map((s) => s.song)).toEqual([
      'Fly Me to the Moon', 'My Way',
    ]);
  });

  it('returns [] when nothing matches the query', () => {
    expect(filterSongs(songs, { query: 'zzz-no-match' })).toEqual([]);
  });

  it('normalizes leading articles/parentheticals for song sort', () => {
    const list = [
      { id: '1', song: 'The Way', artist: 'X', category: 'c' },
      { id: '2', song: '(Everything I Do) I Do It for You', artist: 'Bryan Adams', category: 'c' },
      { id: '3', song: 'A Whole New World', artist: 'Y', category: 'c' },
    ];
    // Sorts as "everything i do…", "the way" (→ "way"), "whole new world" → e, w(ay), w(hole)
    expect(filterSongs(list, {}).map((s) => s.id)).toEqual(['2', '1', '3']);
  });

  it('sort=artist orders by artist, artistless rows last, tie-break on song', () => {
    const list = [
      { id: '1', song: 'My Way', artist: 'Frank Sinatra', category: 'c' },
      { id: '2', song: 'Piano Man', artist: 'Billy Joel', category: 'c' },
      { id: '3', song: 'Africa', artist: '', category: 'c' },
      { id: '4', song: 'Fly Me to the Moon', artist: 'Frank Sinatra', category: 'c' },
    ];
    expect(filterSongs(list, { sort: 'artist' }).map((s) => s.id)).toEqual(['2', '4', '1', '3']);
  });
});

describe('sortKey', () => {
  it('strips a leading article', () => {
    expect(sortKey('The Way')).toBe('way');
    expect(sortKey('A Whole New World')).toBe('whole new world');
    expect(sortKey('An Ocean')).toBe('ocean');
  });
  it('strips a leading parenthetical', () => {
    expect(sortKey('(Everything I Do) I Do It for You')).toBe('i do it for you');
  });
  it('falls back to the raw lowercase when stripping empties it', () => {
    expect(sortKey('The')).toBe('the');
    expect(sortKey('(only parens)')).toBe('(only parens)');
  });
});

describe('categoryHue', () => {
  it('is deterministic per category and in 0..359', () => {
    const h = categoryHue('Piano Men');
    expect(h).toBe(categoryHue('Piano Men'));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
});

describe('songArt', () => {
  it('is stable for the same song and yields a slug seed + gradient', () => {
    const a = songArt({ song: 'Piano Man', artist: 'Billy Joel', category: 'Piano Men' });
    const b = songArt({ song: 'Piano Man', artist: 'Billy Joel', category: 'Piano Men' });
    expect(a).toEqual(b);
    expect(a.seed).toBe('slug:piano man|billy joel');
    expect(a.background).toMatch(/^linear-gradient\(/);
  });
});
