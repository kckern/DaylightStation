import { describe, it, expect } from 'vitest';
import { guessSongArtist, filterKaraokeSiblings, toCandidateRows } from './discovery.mjs';

const cfg = { karaokeTerms: ['karaoke', 'instrumental'], rejectTerms: ['reaction'] };

describe('guessSongArtist', () => {
  it('splits "Artist - Song" and strips karaoke noise', () => {
    expect(guessSongArtist('Coldplay - Viva la Vida (Karaoke Version)')).toEqual({ artist: 'Coldplay', song: 'Viva la Vida' });
  });
  it('falls back to whole string as song when no separator', () => {
    expect(guessSongArtist('Viva la Vida Karaoke')).toEqual({ artist: '', song: 'Viva la Vida' });
  });
});

describe('filterKaraokeSiblings', () => {
  it('keeps karaoke-signal titles, drops known ids and reject terms', () => {
    const entries = [
      { id: 'keep', title: 'X - Y Karaoke', channel: 'Sing King', view_count: 3, url: 'u1' },
      { id: 'seen', title: 'Z Karaoke', channel: 'Sing King', view_count: 9 },
      { id: 'react', title: 'W Karaoke reaction', channel: 'Sing King', view_count: 1 },
      { id: 'nonkar', title: 'Q Official Video', channel: 'Sing King', view_count: 2 },
    ];
    const out = filterKaraokeSiblings(entries, new Set(['seen']), cfg);
    expect(out.map((e) => e.id)).toEqual(['keep']);
  });
});

describe('toCandidateRows', () => {
  it('projects siblings into CandidateRow with guessed song/artist and source', () => {
    const items = [{ id: 'k', title: 'Coldplay - Clocks Karaoke', channel: 'Sing King', viewCount: 4, url: 'https://youtu.be/k' }];
    expect(toCandidateRows(items, 'srcVid')).toEqual([
      { channel: 'Sing King', viewCount: 4, song: 'Clocks', artist: 'Coldplay', url: 'https://youtu.be/k', sourceVideo: 'srcVid' },
    ]);
  });
});
