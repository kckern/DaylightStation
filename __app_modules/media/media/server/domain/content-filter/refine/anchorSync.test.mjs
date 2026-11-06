import { describe, it, expect } from 'vitest';
import { matchAnchors, fitSegments, lineSimilarity } from './anchorSync.mjs';

const seg = (id, text) => ({ id, text });

describe('lineSimilarity', () => {
  it('scores shared words', () => {
    expect(lineSimilarity('What the hell is it?', 'what the hell is this')).toBeGreaterThan(0.6);
    expect(lineSimilarity('What the hell is it?', 'Go to hell, Biff.')).toBeLessThan(0.4);
  });
});

describe('matchAnchors', () => {
  // Copy runs 5 s later than VidAngel. Two "hell"s near the anchor; only one has the right line.
  const segments = [seg(1, 'What the hell is it?'), seg(2, 'Go to hell, Biff.'), seg(3, 'Oh my god, Doc.')];
  const words = [
    { w: 'hell', s: 105.2, seg: 1 }, { w: 'hell', s: 106.0, seg: 2 },
    { w: 'god', s: 305.1, seg: 3 },
  ];
  const anchors = [
    { t: 100.2, kind: 'word', text: 'hell', line: 'What the hell is it?' },
    { t: 300.1, kind: 'word', text: 'god', line: 'Oh, my God, Doc!' },
    { t: 500, kind: 'word', text: 'damn', line: 'Damn it.' }, // not in this copy's transcript
  ];
  const m = matchAnchors(anchors, words, segments);

  it('finds the occurrence whose line matches', () => {
    expect(m.pairs).toEqual([
      { x: 100.2, y: 105.2, wi: 0 },
      { x: 300.1, y: 305.1, wi: 2 },
    ]);
  });
  it('reports the coarse offset and how many matched', () => {
    expect(m.coarse).toBeCloseTo(5, 0);
    expect(m.matched).toBe(2);
    expect(m.total).toBe(3);
  });
});

describe('fitSegments', () => {
  const along = (xs, f) => xs.map((x) => ({ x, y: f(x) }));
  it('fits one segment for a plain offset and scale', () => {
    const pairs = along([100, 500, 900, 1500, 2500, 4000, 5000], (x) => x * 1.0004 + 3.2);
    const s = fitSegments(pairs, { runtimeSec: 6000 });
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0].scale).toBeCloseTo(1.0004, 5);
    expect(s.segments[0].offsetSec).toBeCloseTo(3.2, 2);
  });
  it('finds PAL speed-up', () => {
    const k = 25 / 23.976;
    const s = fitSegments(along([100, 800, 1600, 2400, 3200, 4000], (x) => x / k), { runtimeSec: 5000 });
    expect(s.segments[0].scale).toBeCloseTo(1 / k, 4);
  });
  it('splits where a scene was removed and the offset jumps', () => {
    const pairs = [
      ...along([100, 400, 800, 1200, 1600], (x) => x + 8),
      ...along([2400, 2800, 3200, 3600, 4000], (x) => x - 52), // 60 s removed between 1600 and 2400
    ];
    const s = fitSegments(pairs, { runtimeSec: 5000 });
    expect(s.segments).toHaveLength(2);
    expect(s.segments[0]).toMatchObject({ fromVa: 0, scale: 1 });
    expect(s.segments[0].offsetSec).toBeCloseTo(8, 2);
    expect(s.segments[1].offsetSec).toBeCloseTo(-52, 2);
    expect(s.segments[0].toVa).toBeGreaterThan(1600);
    expect(s.segments[0].toVa).toBeLessThan(2400);
    expect(s.segments[1].fromVa).toBe(s.segments[0].toVa);
    expect(s.segments[1].toVa).toBe(5000);
  });
  it('ignores a lone outlier instead of splitting on it', () => {
    const pairs = along([100, 500, 900, 1300, 1700, 2100, 2500], (x) => x + 4);
    pairs[3] = { x: 1300, y: 1300 + 40 };
    const s = fitSegments(pairs, { runtimeSec: 3000 });
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0].offsetSec).toBeCloseTo(4, 2);
    expect(s.used).toBe(6);
  });
  it('returns null with too few pairs', () => {
    expect(fitSegments(along([100, 200], (x) => x), { runtimeSec: 300 })).toBeNull();
  });
});
