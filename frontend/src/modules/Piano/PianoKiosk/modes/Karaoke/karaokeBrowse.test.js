import { describe, it, expect } from 'vitest';
import { parseSongTitle, parseSongs, categoriesOf, filterSongs } from './karaokeBrowse.js';

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
});
