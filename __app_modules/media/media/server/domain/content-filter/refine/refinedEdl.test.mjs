import { describe, it, expect } from 'vitest';
import { buildRefinedEdl, anchorsFrom, refinedEdlName, stripRefined } from './refinedEdl.mjs';

const edl = {
  contentId: 'plex:40417', title: 'Test Film', year: 1999, source: 'vidangel',
  sourceRef: { workId: 12, slug: 'test-film', tagSetId: 345 }, runtimeUnalteredSec: 6000, precision: 'second-approx',
  cues: [
    { id: 'a', type: 'mute', category: 'language/x', in: 100, out: 100, label: 'd*mn' },
    { id: 'b', type: 'skip', category: 'violence/x', in: 200, out: 210, label: 'A fight.' },
    { id: 'c', type: 'skip', category: 'sex/x', in: 300, out: 306, label: 'A sign.' },
    { id: 'd', type: 'skip', category: 'violence/x', in: 400, out: 404, label: 'Unsettled.' },
  ],
};
const sync = { scale: 1, offsetSec: 8 };
const cueOverrides = {
  a: { in: 108.123, out: 108.456, precision: 'ms', refine: { v: 1, part: '777', at: '2026-11-06', how: 'snap/snap' } },
  b: { in: 207.5, out: 219.25, precision: 'frame', frameIn: 4980, frameOut: 5261, segments: [{ in: 207.5, out: 210 }, { in: 212, out: 219.25 }],
    refine: { v: 1, part: '777', at: '2026-11-06', conf: 0.8 } },
  c: { in: 308, out: 312, precision: 'frame', frameIn: 7392, frameOut: 7487, regions: [{ in: 308, cells: [1, 2] }, { in: 310, cells: [2] }, { in: 312, cells: [] }],
    refine: { v: 1, part: '777', at: '2026-11-06' } },
  d: { disabled: true }, // manual, not refined
};

describe('buildRefinedEdl', () => {
  const out = buildRefinedEdl({ edl, cueOverrides, sync, anchors: [], refinedFrom: { fps: '24/1', startTime: 0 } });
  const byId = Object.fromEntries(out.cues.map((c) => [c.id, c]));

  it('drops the Plex id and puts cue times on the VidAngel clock', () => {
    expect(out.contentId).toBeUndefined();
    expect(out.timebase.clock).toBe('vidangel');
    expect(byId.a.in).toBeCloseTo(100.123, 6);
    expect(byId.a.out).toBeCloseTo(100.456, 6);
    expect(byId.a.precision).toBe('ms');
  });
  it('converts segments and region keyframes, and drops copy-specific frame numbers and part', () => {
    expect(byId.b.segments).toEqual([{ in: 199.5, out: 202 }, { in: 204, out: 211.25 }]);
    expect(byId.b.frameIn).toBeUndefined();
    expect(byId.b.refine.part).toBeUndefined();
    expect(byId.b.refine.conf).toBe(0.8);
    expect(byId.c.regions.map((k) => k.in)).toEqual([300, 302, 304]);
  });
  it('keeps unrefined cues as they are, marked approximate', () => {
    expect(byId.d).toMatchObject({ in: 400, out: 404 });
    expect(byId.d.precision).toBe('second-approx');
    expect(byId.d.refine).toBeUndefined();
  });
  it('records the reference copy and counts', () => {
    expect(out.timebase.refinedFrom).toMatchObject({ fps: '24/1', sync: { scale: 1, offsetSec: 8 } });
    expect(out.timebase.refinedCount).toBe(3);
  });
  it('rounds times to the millisecond', () => {
    const o = buildRefinedEdl({ edl, cueOverrides: { a: { ...cueOverrides.a, in: 108.12345678 } }, sync });
    expect(o.cues.find((c) => c.id === 'a').in).toBe(100.123);
  });
});

describe('anchorsFrom', () => {
  const words = [
    { w: 'oh', s: 107.5, e: 107.8, seg: 3 }, { w: 'damn,', s: 108.1, e: 108.5, seg: 3 },
    { w: 'hell', s: 512.0, e: 512.3, seg: 9 },
  ];
  const segments = [{ id: 3, text: 'Oh damn, Doc.' }, { id: 9, text: 'What the hell?' }];
  const pairs = [{ x: 100, y: 108.1, wi: 1, id: 'a' }, { x: 500, y: 512.0, wi: 2, id: 'z' }];

  it('turns inlier word pairs into anchors on the VidAngel clock with their line', () => {
    const anchors = anchorsFrom({ pairs, words, segments, sync, refinedById: {} });
    expect(anchors[0]).toEqual({ t: 100.1, kind: 'word', text: 'damn', line: 'Oh damn, Doc.' });
  });
  it('prefers the refined start of the tagged word', () => {
    const anchors = anchorsFrom({ pairs, words, segments, sync, refinedById: { a: { in: 108.123 } } });
    expect(anchors[0].t).toBe(100.123);
  });
  it('drops pairs the sync does not explain', () => {
    const anchors = anchorsFrom({ pairs, words, segments, sync, refinedById: {}, tol: 3 });
    expect(anchors.map((a) => a.text)).toEqual(['damn']); // 512 - 8 = 504, 4 s from the tag at 500
  });
});

describe('refinedEdlName', () => {
  it('names the file by VidAngel work and tag set', () => {
    expect(refinedEdlName(edl)).toBe('12-345.edl.yml');
  });
  it('refuses without a tag set', () => {
    expect(() => refinedEdlName({ sourceRef: { workId: 12 } })).toThrow();
  });
});

describe('stripRefined', () => {
  it('removes refined timing, keeps person-set keys and manual entries', () => {
    const { cueOverrides: o, removed } = stripRefined({
      a: { in: 1, out: 2, precision: 'ms', refine: { v: 1 } },
      b: { in: 3, out: 4, precision: 'frame', frameIn: 1, frameOut: 2, refine: { v: 1 }, effect: 'mute', nudgeMs: 20 },
      c: { in: 5, out: 6 }, // manual timing, no refine stamp
      d: { disabled: true },
    });
    expect(removed).toBe(2);
    expect(o).toEqual({ b: { effect: 'mute', nudgeMs: 20 }, c: { in: 5, out: 6 }, d: { disabled: true } });
  });
});
