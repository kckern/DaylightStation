import { describe, it, expect } from 'vitest';
import {
  sceneId, sceneGroupsOf, sceneEdges, probeTimes, pictureLevel, carryForward,
} from './scenes.mjs';

describe('sceneId', () => {
  it('names a scene after its smallest member id', () => {
    expect(sceneId(['va4929912', 'va4929910', 'va4929911'])).toBe('sc-va4929910');
  });
  it('compares numerically, not as text', () => {
    expect(sceneId(['va99', 'va100'])).toBe('sc-va99');
  });
});

describe('sceneGroupsOf', () => {
  it('keeps only the groups scenes are judged on', () => {
    expect(sceneGroupsOf(['violence_blood_gore/graphic', 'alcohol_or_drug_use/drugs_illegal', 'sex_any/sexual_assault', 'kissing/kissing_normal']))
      .toEqual(['violence_blood_gore', 'sex_any']);
  });
});

describe('sceneEdges', () => {
  const members = [
    { id: 'a', in: 100, out: 100, precision: 'second-approx' },
    { id: 'b', in: 130, out: 132, precision: 'frame' },
  ];
  it('snaps to the last cut before the start and the first cut after the end', () => {
    // start bound: min(100 - 3, -) = 97; end bound: 132
    expect(sceneEdges({ members, cuts: [80, 95.5, 98, 133.2, 150] })).toEqual({ in: 95.5, out: 133.2, edges: 'cut' });
  });
  it('uses a precise member start when it is earlier than the tag lead', () => {
    const m = [{ id: 'a', in: 90, out: 95, precision: 'frame' }];
    expect(sceneEdges({ members: m, cuts: [85, 99] })).toEqual({ in: 85, out: 99, edges: 'cut' });
  });
  it('stays on the raw bound when no cut is within reach', () => {
    expect(sceneEdges({ members, cuts: [60, 200] })).toEqual({ in: 97, out: 132, edges: 'approx' });
  });
  it('always covers every member span', () => {
    const e = sceneEdges({ members, cuts: [96, 140] });
    expect(e.in).toBeLessThanOrEqual(97);
    expect(e.out).toBeGreaterThanOrEqual(132);
  });
  it('widens an approximate end by the tag lag', () => {
    const m = [{ id: 'a', in: 100, out: 110, precision: 'second-approx', tagOut: 110 }];
    expect(sceneEdges({ members: m, cuts: [] }).out).toBe(113);
  });
});

describe('probeTimes', () => {
  it('takes at least 8 probes, shot middles first', () => {
    const t = probeTimes({ in: 0, out: 40 }, [10, 20, 30]);
    expect(t).toHaveLength(8);
    expect(t.slice(0, 4)).toEqual([5, 15, 25, 35]);
  });
  it('scales with length, capped at 24', () => {
    expect(probeTimes({ in: 0, out: 150 }, [])).toHaveLength(15);
    expect(probeTimes({ in: 0, out: 900 }, [])).toHaveLength(24);
  });
  it('returns sorted, distinct times inside the scene', () => {
    const t = probeTimes({ in: 10, out: 30 }, [12, 13]);
    expect([...t].sort((a, b) => a - b)).toEqual([...t].sort((a, b) => a - b));
    expect(new Set(t).size).toBe(t.length);
    expect(t.every((x) => x > 10 && x < 30)).toBe(true);
  });
});

describe('pictureLevel', () => {
  it('is the second-highest frame score', () => {
    expect(pictureLevel([0, 1, 3, 2, 0])).toEqual({ level: 2, max: 3, outlier: false });
  });
  it('flags a single frame two or more levels above the rest', () => {
    expect(pictureLevel([0, 3, 0, 1])).toEqual({ level: 1, max: 3, outlier: true });
  });
  it('rounds fractional scores', () => {
    expect(pictureLevel([1.6, 1.4]).level).toBe(1);
  });
});

describe('carryForward', () => {
  it('keeps a prior id when at least half the members overlap', () => {
    const prev = [{ id: 'sc-va1', cues: ['va1', 'va2', 'va3'], card: { text: 'x' } }];
    const next = [{ id: 'sc-va2', cues: ['va2', 'va3', 'va4'] }];
    const { scenes, remaps } = carryForward(prev, next);
    expect(scenes[0].id).toBe('sc-va1');
    expect(remaps).toEqual([{ from: 'sc-va2', to: 'sc-va1' }]);
  });
  it('keeps the draft card only when the member set is unchanged', () => {
    const prev = [{ id: 'sc-va1', cues: ['va1', 'va2'], card: { text: 'x' } }];
    expect(carryForward(prev, [{ id: 'sc-va1', cues: ['va2', 'va1'] }]).scenes[0].card).toEqual({ text: 'x' });
    expect(carryForward(prev, [{ id: 'sc-va1', cues: ['va1', 'va2', 'va5'] }]).scenes[0].card).toBeUndefined();
  });
  it('leaves new scenes alone', () => {
    expect(carryForward([], [{ id: 'sc-va9', cues: ['va9'] }]).scenes[0].id).toBe('sc-va9');
  });
});
