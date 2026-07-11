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
  it('numbers sequentially within each season in list order, preserving existing numbers', () => {
    const rows = [
      { season: 1, episode: null, artist: 'A', song: 'a', searchHint: '', status: 'pending', videoId: '' },
      { season: 2, episode: null, artist: 'B', song: 'b', searchHint: '', status: 'pending', videoId: '' },
      { season: 1, episode: 5,    artist: 'C', song: 'c', searchHint: '', status: 'downloaded', videoId: 'x' },
      { season: 1, episode: null, artist: 'D', song: 'd', searchHint: '', status: 'pending', videoId: '' },
    ];
    const out = assignEpisodes(rows);
    expect(out.map((r) => [r.season, r.episode])).toEqual([[1, 1], [2, 1], [1, 5], [1, 6]]);
  });
});
