import { describe, it, expect } from 'vitest';
import { sanitizeSegment, buildEpisodeFilename, assignEpisodes } from './filename.mjs';

describe('sanitizeSegment', () => {
  it('strips filesystem-reserved characters and collapses whitespace', () => {
    expect(sanitizeSegment('AC/DC:  Back?')).toBe('ACDC Back');
  });
});

describe('buildEpisodeFilename', () => {
  it('produces the Plex SxxExx form with zero padding', () => {
    expect(buildEpisodeFilename({ show: 'Karaoke', season: 6, episode: 3, song: 'Viva la Vida', artist: 'Coldplay' }))
      .toBe('Karaoke - S06E03 - Viva la Vida (Coldplay).mp4');
  });
});

describe('assignEpisodes', () => {
  it('numbers new episodes above each season\'s existing max, preserving explicit numbers', () => {
    const rows = [
      { season: 1, episode: null, artist: 'A', song: 'a', searchHint: '', status: 'pending', videoId: '' },
      { season: 2, episode: null, artist: 'B', song: 'b', searchHint: '', status: 'pending', videoId: '' },
      { season: 1, episode: 5,    artist: 'C', song: 'c', searchHint: '', status: 'downloaded', videoId: 'x' },
      { season: 1, episode: null, artist: 'D', song: 'd', searchHint: '', status: 'pending', videoId: '' },
    ];
    const out = assignEpisodes(rows);
    expect(out.map((r) => [r.season, r.episode])).toEqual([[1, 6], [2, 1], [1, 5], [1, 7]]);
  });

  it('never assigns a duplicate episode within a season, even when nulls precede a low explicit number', () => {
    const rows = [
      { season: 1, episode: null, artist: 'A', song: 'a', searchHint: '', status: 'pending', videoId: '' },
      { season: 1, episode: null, artist: 'B', song: 'b', searchHint: '', status: 'pending', videoId: '' },
      { season: 1, episode: 1,    artist: 'C', song: 'c', searchHint: '', status: 'downloaded', videoId: 'x' },
    ];
    const eps = assignEpisodes(rows).map((r) => r.episode);
    expect(new Set(eps).size).toBe(eps.length);
    expect(eps).toEqual([2, 3, 1]);
  });
});
