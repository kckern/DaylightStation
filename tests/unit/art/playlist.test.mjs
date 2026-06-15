import { describe, it, expect } from 'vitest';
import { toTracks, advanceIndex, shuffleOrder }
  from '../../../frontend/src/lib/Player/playlist.js';

describe('toTracks', () => {
  it('maps items to {mediaUrl,title,artist}', () => {
    expect(toTracks({ items: [
      { mediaUrl: 'a.mp3', title: 'A', artist: 'X' },
    ] })).toEqual([{ mediaUrl: 'a.mp3', title: 'A', artist: 'X' }]);
  });
  it('falls back to grandparentTitle for the artist', () => {
    const out = toTracks({ items: [{ mediaUrl: 'b.mp3', title: 'B', grandparentTitle: 'Y' }] });
    expect(out[0].artist).toBe('Y');
  });
  it('drops items without a mediaUrl', () => {
    const out = toTracks({ items: [
      { title: 'no url' },
      { mediaUrl: 'c.mp3', title: 'C' },
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].mediaUrl).toBe('c.mp3');
  });
  it('returns [] for missing/empty input', () => {
    expect(toTracks(null)).toEqual([]);
    expect(toTracks({})).toEqual([]);
    expect(toTracks({ items: [] })).toEqual([]);
  });
});

describe('advanceIndex', () => {
  it('advances and wraps', () => {
    expect(advanceIndex(0, 3)).toBe(1);
    expect(advanceIndex(2, 3)).toBe(0);
  });
  it('returns 0 for empty length', () => {
    expect(advanceIndex(0, 0)).toBe(0);
  });
});

describe('shuffleOrder', () => {
  it('returns a permutation of 0..len-1', () => {
    const order = shuffleOrder(5);
    expect(order).toHaveLength(5);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
  it('returns [] for non-positive length', () => {
    expect(shuffleOrder(0)).toEqual([]);
    expect(shuffleOrder(-2)).toEqual([]);
  });
});
