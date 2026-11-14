import { describe, it, expect } from 'vitest';
import { diffNoteSurface, buildRenderColumns } from './liveStaffColumns.js';

const col = (midis, startedAt, extra = {}) => ({
  midis, startedAt, lastOnsetAt: startedAt, arrivals: midis.map((midi) => ({ midi, at: startedAt })),
  duration: 'q', heldAtClose: false, releasedAt: null, ...extra,
});
const flowOf = (...columns) => ({ columns, lastOnsetAt: 0, recentIois: [] });

describe('diffNoteSurface', () => {
  it('a new key is an onset', () => {
    const r = diffNoteSurface(new Map(), new Map([[60, { timestamp: 1000 }]]), 2000);
    expect(r.onsets).toEqual([60]);
    expect(r.at).toBe(1000);
    expect(r.next.get(60)).toBe(1000);
  });
  it('a re-strike on a held key is an onset', () => {
    const r = diffNoteSurface(new Map([[60, 1000]]), new Map([[60, { timestamp: 1500 }]]), 2000);
    expect(r.onsets).toEqual([60]);
    expect(r.at).toBe(1500);
  });
  it('an unchanged held key is not an onset', () => {
    const r = diffNoteSurface(new Map([[60, 1000]]), new Map([[60, { timestamp: 1000 }]]), 2000);
    expect(r.onsets).toEqual([]);
    expect(r.released).toBe(false);
    expect(r.at).toBe(2000);
  });
  it('a release is reported', () => {
    const r = diffNoteSurface(new Map([[60, 1000], [64, 1000]]), new Map([[64, { timestamp: 1000 }]]), 2000);
    expect(r.released).toBe(true);
    expect(r.onsets).toEqual([]);
    expect([...r.next.keys()]).toEqual([64]);
  });
  it('at is the earliest onset stamp', () => {
    const r = diffNoteSurface(new Map(), new Map([[60, { timestamp: 1200 }], [64, { timestamp: 1100 }]]), 2000);
    expect(r.at).toBe(1100);
  });
  it('a missing timestamp is stamped now', () => {
    const r = diffNoteSurface(new Map(), new Map([[60, {}]]), 2000);
    expect(r.next.get(60)).toBe(2000);
    expect(r.at).toBe(2000);
  });
});

describe('buildRenderColumns', () => {
  const flow = flowOf(col([60, 64, 67], 100), col([62, 65, 69], 400), col([60], 700, { duration: null }));
  const durs = ['q', 'q', 'q'];

  it("freezes a closed column's spelling when the key changes", () => {
    const cache = new Map();
    const a = buildRenderColumns(flow, durs, 'C', cache);
    const b = buildRenderColumns(flow, durs, 'Ab', cache);
    expect(b[0].spelling).toBe(a[0].spelling);
    expect(b[1].spelling).toBe(a[1].spelling);
    expect(b[2].spelling).not.toBe(a[2].spelling);
  });
  it('prunes cache entries that scrolled off', () => {
    const cache = new Map();
    buildRenderColumns(flow, durs, 'C', cache);
    expect(cache.has(100)).toBe(true);
    buildRenderColumns(flowOf(col([62, 65, 69], 400), col([60], 700)), ['q', 'q'], 'C', cache);
    expect(cache.has(100)).toBe(false);
    expect(cache.has(400)).toBe(true);
  });
  it('arrivals are carried through, and no roll', () => {
    const arrivals = [{ midi: 67, at: 100 }, { midi: 64, at: 180 }, { midi: 60, at: 300 }];
    const out = buildRenderColumns(flowOf(col([60, 64, 67], 100, { arrivals }), col([60], 700)), ['q', 'q'], 'C', new Map());
    expect(out[0].arrivals).toEqual(arrivals);
    expect(out[1].arrivals).toEqual([{ midi: 60, at: 700 }]);
    expect(out.every((c) => !('roll' in c))).toBe(true);
  });
});
