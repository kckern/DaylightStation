import { describe, it, expect } from 'vitest';
import { segmentItems, avoidNeighbourRepeats } from './surroundSegments.mjs';

// Deterministic rng (mulberry32), so a shuffle is a fixed permutation per seed.
const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const seg = (n, kind, start, end, extra = {}) => ({
  n, name: `Piece ${n}`, kind, start, end, confidence: 'derived', ...extra,
});

const CONCERT_A = {
  contentId: 'plex:1001', title: 'Winter Concert', year: 2001,
  segments: [
    seg(1, 'song', 10, 200, { song: 'alpha' }),
    seg(2, 'introduction', 210, 260),
    seg(3, 'song', 270, 500, { song: 'beta' }),
    seg(4, 'narration', 510, 700),
  ],
};
const CONCERT_B = {
  contentId: 'plex:1002', title: 'Snow Concert', year: 2002,
  segments: [
    seg(1, 'song', 5, 150, { song: 'alpha' }),
    seg(2, 'song', 160, 300, { song: 'gamma', confidence: 'guessed' }),
    seg(3, 'song', 310, 480, { song: 'delta', confidence: 'verified' }),
  ],
};

const ids = (items) => items.map((i) => i.id).sort();

describe('segmentItems', () => {
  it('returns nothing for empty input', () => {
    expect(segmentItems({ sidecars: [], params: {}, rng: seeded(1) })).toEqual([]);
    expect(segmentItems({ params: {}, rng: seeded(1) })).toEqual([]);
  });

  it('filters by kind', () => {
    const items = segmentItems({ sidecars: [CONCERT_A], params: { kinds: ['song'] }, rng: seeded(1) });
    expect(ids(items)).toEqual(['plex:1001#1', 'plex:1001#3']);
    const narration = segmentItems({ sidecars: [CONCERT_A], params: { kinds: ['narration'] }, rng: seeded(1) });
    expect(ids(narration)).toEqual(['plex:1001#4']);
  });

  it('keeps every kind when no kinds are given', () => {
    expect(segmentItems({ sidecars: [CONCERT_A], params: {}, rng: seeded(1) })).toHaveLength(4);
  });

  it('filters by confidence, dropping guessed segments', () => {
    const items = segmentItems({
      sidecars: [CONCERT_B], params: { confidence: ['verified', 'derived'] }, rng: seeded(1),
    });
    expect(ids(items)).toEqual(['plex:1002#1', 'plex:1002#3']);
  });

  it('drops a segment without a usable span', () => {
    const broken = {
      contentId: 'plex:1003', title: 'Broken', year: 2003,
      segments: [
        seg(1, 'song', 10, 10),
        seg(2, 'song', 50, 20),
        seg(3, 'song', undefined, 90),
        seg(4, 'song', 30, null),
        seg(5, 'song', 'x', 40),
        seg(6, 'song', 100, 160),
      ],
    };
    expect(ids(segmentItems({ sidecars: [broken], params: {}, rng: seeded(1) }))).toEqual(['plex:1003#6']);
  });

  it('builds the clip item shape', () => {
    const [item] = segmentItems({
      sidecars: [{ ...CONCERT_A, segments: [CONCERT_A.segments[0]] }], params: {}, rng: seeded(1),
    });
    expect(item).toEqual({
      id: 'plex:1001#1',
      contentId: 'plex:1001',
      title: 'Piece 1',
      subtitle: 'Winter Concert (2001)',
      segment: { start: 10, end: 200 },
      duration: 190,
      song: 'alpha',
    });
  });

  it('leaves the year out of the subtitle when the work has none', () => {
    const [item] = segmentItems({
      sidecars: [{ contentId: 'plex:9', title: 'Undated', segments: [seg(1, 'song', 0, 5)] }],
      params: {}, rng: seeded(1),
    });
    expect(item.subtitle).toBe('Undated');
    expect(item).not.toHaveProperty('song');
  });

  it('shuffles deterministically with a seeded rng', () => {
    const many = {
      contentId: 'plex:2000', title: 'Many', year: 2010,
      segments: Array.from({ length: 12 }, (_, i) => seg(i + 1, 'song', i * 100, i * 100 + 90)),
    };
    const first = segmentItems({ sidecars: [many], params: {}, rng: seeded(42) }).map((i) => i.id);
    const again = segmentItems({ sidecars: [many], params: {}, rng: seeded(42) }).map((i) => i.id);
    const other = segmentItems({ sidecars: [many], params: {}, rng: seeded(7) }).map((i) => i.id);
    expect(first).toEqual(again);
    expect(first).not.toEqual(other);
    expect([...first].sort()).toEqual(many.segments.map((s) => `plex:2000#${s.n}`).sort());
  });

  it('keeps two clips of the same song apart when noRepeatSong is set', () => {
    // Four performances of one song among four others: always separable.
    const sidecars = [1, 2, 3, 4].map((k) => ({
      contentId: `plex:30${k}`, title: `Concert ${k}`, year: 2000 + k,
      segments: [
        seg(1, 'song', 0, 100, { song: 'carol' }),
        seg(2, 'song', 100, 200, { song: `other-${k}` }),
      ],
    }));
    for (let s = 1; s <= 50; s += 1) {
      const items = segmentItems({ sidecars, params: { noRepeatSong: true }, rng: seeded(s) });
      expect(items).toHaveLength(8);
      for (let i = 1; i < items.length; i += 1) {
        expect(items[i].song).not.toBe(items[i - 1].song);
      }
    }
  });
});

describe('avoidNeighbourRepeats', () => {
  const songs = (list) => list.map((song, i) => ({ id: String(i), song }));

  it('moves a trailing repeat back into a gap', () => {
    const out = avoidNeighbourRepeats(songs(['a', 'b', 'c', 'c'])).map((i) => i.song);
    for (let i = 1; i < out.length; i += 1) expect(out[i]).not.toBe(out[i - 1]);
  });

  it('leaves the order alone when separation is impossible', () => {
    const input = songs(['a', 'a', 'a', 'b']);
    expect(avoidNeighbourRepeats(input).map((i) => i.song)).toHaveLength(4);
  });

  it('never treats missing songs as repeats', () => {
    const input = [{ id: '1' }, { id: '2' }, { id: '3', song: 'x' }];
    expect(avoidNeighbourRepeats(input).map((i) => i.id)).toEqual(['1', '2', '3']);
  });
});
