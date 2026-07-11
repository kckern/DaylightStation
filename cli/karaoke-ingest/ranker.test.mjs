import { describe, it, expect } from 'vitest';
import { pickBest } from './ranker.mjs';

const cfg = {
  karaokeTerms: ['karaoke', 'instrumental'],
  rejectTerms: ['reaction', 'cover by', 'live at'],
  channelWeights: { 'sing king': 1.5 },
  minDurationS: 90,
  maxDurationS: 480,
  scoreFloor: 0,
};
const meta = { song: 'Viva la Vida', artist: 'Coldplay' };
const cand = (over) => ({ id: 'x', title: 'Viva la Vida (Karaoke Version)', channel: 'Random', viewCount: 1000, duration: 240, ...over });

describe('pickBest', () => {
  it('drops non-karaoke, reject-term, wrong-duration, and song-mismatch candidates', () => {
    const cands = [
      cand({ id: 'no-karaoke', title: 'Viva la Vida (Official Video)' }),
      cand({ id: 'reaction', title: 'Viva la Vida Karaoke reaction' }),
      cand({ id: 'too-short', duration: 30 }),
      cand({ id: 'wrong-song', title: 'Clocks Karaoke Version' }),
    ];
    expect(pickBest(cands, meta, cfg)).toBeNull();
  });

  it('prefers higher view count among acceptable candidates', () => {
    const cands = [cand({ id: 'low', viewCount: 100 }), cand({ id: 'high', viewCount: 500000 })];
    expect(pickBest(cands, meta, cfg).id).toBe('high');
  });

  it('applies a channel bonus that can overcome a view deficit', () => {
    const cands = [
      cand({ id: 'popular', channel: 'Random', viewCount: 20000 }),
      cand({ id: 'singking', channel: 'Sing King', viewCount: 8000 }),
    ];
    // log10(20010)≈4.30 vs log10(8010)+1.5≈3.90+1.5=5.40 → Sing King wins
    expect(pickBest(cands, meta, cfg).id).toBe('singking');
  });

  it('returns null when there are no candidates', () => {
    expect(pickBest([], meta, cfg)).toBeNull();
  });
});
