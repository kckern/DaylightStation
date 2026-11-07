import { describe, expect, it } from 'vitest';
import { mergeRefine } from './refineOutput.mjs';

const stamp = { part: 101, at: '2026-01-01' };

describe('mergeRefine', () => {
  it('writes refined cues with a part-bound stamp and keeps person-set keys', () => {
    const override = { sync: { offsetSec: 1 }, cueOverrides: { a1: { in: 1, out: 2, precision: 'ms', refine: { v: 1, part: '101' }, nudgeMs: 40, disabled: true } } };
    const { override: out, counts } = mergeRefine(override, [
      { id: 'a1', status: 'refined', precision: 'ms', in: 10.5, out: 10.9, conf: 0.913, how: 'agree/model' },
      { id: 'v1', status: 'refined', precision: 'frame', in: 20, out: 22, frameIn: 480, frameOut: 527, segments: [{ in: 20, out: 22, region: { whole: true } }] },
    ], stamp);
    expect(out.sync).toEqual({ offsetSec: 1 });
    expect(out.cueOverrides.a1).toEqual({ nudgeMs: 40, disabled: true, in: 10.5, out: 10.9, precision: 'ms', refine: { v: 1, part: '101', at: '2026-01-01', conf: 0.91, how: 'agree/model' } });
    expect(out.cueOverrides.v1).toMatchObject({ in: 20, out: 22, precision: 'frame', frameIn: 480, frameOut: 527 });
    expect(out.cueOverrides.v1.regions).toBeUndefined();
    expect(counts.written).toBe(2);
  });

  it('never replaces a manual override and lists the proposal for review', () => {
    const { override: out, review, counts } = mergeRefine({ cueOverrides: { m1: { in: 5, out: 6, precision: 'ms' } } },
      [{ id: 'm1', status: 'refined', precision: 'ms', in: 5.2, out: 6.1 }], stamp);
    expect(out.cueOverrides.m1).toEqual({ in: 5, out: 6, precision: 'ms' });
    expect(counts.keptManual).toBe(1);
    expect(review[0]).toMatchObject({ id: 'm1', status: 'kept-manual', proposed: { in: 5.2, out: 6.1 } });
  });

  it('leaves existing entries alone for unknown and giveup cues', () => {
    const prior = { cueOverrides: { u1: { in: 1, out: 2, refine: { v: 1 } } } };
    const { override: out, review, counts } = mergeRefine(prior, [
      { id: 'u1', status: 'unknown', kind: 'visual', reason: 'edge-wide-unsure', path: [{ step: 'shots' }, { step: 'nav-start', action: 'unknown', reason: 'wide-unsure' }] },
      { id: 'g1', status: 'giveup', kind: 'speech', reason: 'not-found', expected: 100.2 },
    ], stamp);
    expect(out.cueOverrides.u1).toEqual({ in: 1, out: 2, refine: { v: 1 } });
    expect(counts).toMatchObject({ unknown: 1, giveup: 1 });
    expect(review[0].steps).toEqual(['shots', 'nav-start:unknown(wide-unsure)']);
    expect(review[1]).toMatchObject({ id: 'g1', status: 'giveup', expected: 100.2, decision: null });
  });

  it('writes segments and a region track for localized content', () => {
    const track = [{ in: 20, grid: 6, cells: [0, 1], box: { x: 0, y: 0, w: 0.333, h: 0.167 } }, { in: 21, cells: [] }];
    const { override: out } = mergeRefine(null, [{
      id: 'r1', status: 'refined', precision: 'frame', in: 20, out: 25, frameIn: 1, frameOut: 2,
      segments: [{ in: 20, out: 21, region: { whole: false, track } }, { in: 24, out: 25, region: { whole: true } }],
    }], stamp);
    expect(out.cueOverrides.r1.segments).toEqual([{ in: 20, out: 21 }, { in: 24, out: 25 }]);
    expect(out.cueOverrides.r1.regions).toEqual([...track, { in: 24, whole: true }, { in: 25, cells: [] }]);
  });
});

describe('refineScore', () => {
  it('scores visual frames, routing and speech ms against a key', async () => {
    const { scoreVisual, scoreSpeech } = await import('./refineScore.mjs');
    const v = scoreVisual([
      { id: 'a', status: 'refined', kind: 'visual', frameIn: 101, frameOut: 199, segments: [{ frameIn: 101, frameOut: 199 }] },
      { id: 'b', status: 'unknown', kind: 'visual', reason: 'all-unsure' },
      { id: 'c', status: 'refined', kind: 'speech-line' },
    ], {
      a: { modality: 'visual', confidence: 'high', segments: [{ frameIn: 100, frameOut: 200 }] },
      b: { modality: 'visual', confidence: 'high', segments: [{ frameIn: 1, frameOut: 2 }] },
      c: { modality: 'speech' },
    });
    expect(v).toMatchObject({ keyed: 2, refined: 1, within1: 1, routing: { n: 1, ok: 1 } });
    expect(v.iouMedian).toBeCloseTo(99 / 101, 3);
    const s = scoreSpeech([{ id: 'w', status: 'refined', in: 10.01, out: 10.5 }], { w: { start: 10, end: 10.4, confidence: 'high' } });
    expect(s).toMatchObject({ refined: 1, within30: 0, within80: 0, startMedian: 10, endMedian: 100 });
  });
});

describe('mergeRefine household rulings (R7)', () => {
  it('leaves every ruling and unrefined cue override untouched, including a partial run', () => {
    const override = {
      sceneOverrides: { s1: { card: { text: 'Approved.' }, disabled: false } },
      profilePatch: { language: { effect: 'mute' } },
      cueOverrides: {
        a: { in: 1, out: 2, precision: 'ms', refine: { v: 1, part: '101' }, card: { text: 'Hi' }, cardDraft: { text: 'Draft' } },
        b: { in: 5, out: 6, precision: 'ms', refine: { v: 1, part: '101' }, disabled: true },
        c: { card: { text: 'Only a ruling' } },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(override));
    const { override: out } = mergeRefine(override, [{ id: 'a', status: 'refined', precision: 'ms', in: 9, out: 9.5 }], stamp);
    expect(override).toEqual(snapshot); // input not mutated
    expect(out.sceneOverrides).toEqual(snapshot.sceneOverrides);
    expect(out.profilePatch).toEqual(snapshot.profilePatch);
    expect(out.cueOverrides.b).toEqual(snapshot.cueOverrides.b);
    expect(out.cueOverrides.c).toEqual(snapshot.cueOverrides.c);
    expect(out.cueOverrides.a.card).toEqual({ text: 'Hi' });
    expect(out.cueOverrides.a.cardDraft).toEqual({ text: 'Draft' });
    expect(out.cueOverrides.a.in).toBe(9);
  });

  it('a failed re-measure leaves the previous refined entry as it was', () => {
    const override = { cueOverrides: { a: { in: 1, out: 2, precision: 'ms', refine: { v: 1, part: '101' } } } };
    const { override: out } = mergeRefine(override, [{ id: 'a', status: 'giveup', kind: 'speech', reason: 'x' }], stamp);
    expect(out.cueOverrides.a).toEqual(override.cueOverrides.a);
  });
});

describe('mergeRefine: region-only results (coarse edges)', () => {
  const region = (id = 'va1') => ({ id, status: 'region', kind: 'visual', edges: 'coarse', reason: 'edge-all-unsure', path: [],
    segments: [{ frameIn: 1, frameOut: 2, region: { whole: false, track: [{ in: 5, grid: 6, cells: [4], box: { x: 0, y: 0, w: 0.2, h: 0.2 } }, { in: 7, cells: [] }] } }] });

  it('writes regions + a coarse stamp and no times, and lists the cue for review', () => {
    const { override, review, counts } = mergeRefine({}, [region()], { part: '9', at: '2026-11-06' });
    expect(override.cueOverrides.va1).toEqual({ regions: [expect.objectContaining({ in: 5, cells: [4] }), { in: 7, cells: [] }], refine: { v: 1, part: '9', at: '2026-11-06', edges: 'coarse' } });
    expect(override.cueOverrides.va1.in).toBeUndefined();
    expect(counts.region).toBe(1);
    expect(review[0]).toMatchObject({ id: 'va1', status: 'coarse-edges', reason: 'edge-all-unsure' });
  });

  it('never replaces a measured entry and keeps a person\'s keys', () => {
    const prev = { cueOverrides: { va1: { in: 10, out: 11, precision: 'frame', refine: { v: 1, part: '9', at: 'x' } }, va2: { effect: 'blur' } } };
    const { override } = mergeRefine(prev, [region('va1'), region('va2')], { part: '9', at: '2026-11-06' });
    expect(override.cueOverrides.va1).toEqual(prev.cueOverrides.va1);
    expect(override.cueOverrides.va2.effect).toBe('blur');
    expect(override.cueOverrides.va2.regions).toHaveLength(2);
  });
});
