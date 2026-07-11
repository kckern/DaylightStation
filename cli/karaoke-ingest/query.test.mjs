import { describe, it, expect } from 'vitest';
import { buildSearchQuery, pinnedUrl, buildSearchArgv, extractVideoId } from './query.mjs';

const row = (over) => ({ season: 1, episode: null, artist: 'Coldplay', song: 'Viva la Vida', searchHint: '', status: 'pending', videoId: '', ...over });

describe('buildSearchQuery', () => {
  it('builds "{song} {artist} karaoke" with an optional hint appended', () => {
    expect(buildSearchQuery(row())).toBe('Viva la Vida Coldplay karaoke');
    expect(buildSearchQuery(row({ searchHint: 'HD lyrics' }))).toBe('Viva la Vida Coldplay karaoke HD lyrics');
  });
  it('returns null when the hint is a pinned URL', () => {
    expect(buildSearchQuery(row({ searchHint: 'https://youtu.be/abc' }))).toBeNull();
  });
});

describe('pinnedUrl', () => {
  it('detects a pinned http(s) URL, else null', () => {
    expect(pinnedUrl(row({ searchHint: 'https://www.youtube.com/watch?v=abc' }))).toBe('https://www.youtube.com/watch?v=abc');
    expect(pinnedUrl(row({ searchHint: 'HD' }))).toBeNull();
  });
});

describe('buildSearchArgv', () => {
  it('produces a ytsearchN argv with the query as the final positional', () => {
    expect(buildSearchArgv('a b karaoke', { searchCount: 12 })).toEqual([
      '--js-runtimes', 'node', '-J', '--flat-playlist', '--no-warnings', 'ytsearch12:a b karaoke',
    ]);
  });
});

describe('extractVideoId', () => {
  it('pulls the id from watch?v= and youtu.be forms', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=5')).toBe('dQw4w9WgXcQ');
  });
});
