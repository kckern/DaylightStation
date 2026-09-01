import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_FLOOR, FALLBACK_LEVEL, resolveRepertoire, levelById, startLevelFor,
  degradeLevel, climbLevel, isFloorLevel, pickMaterial, materialKey,
} from './gateRepertoire.js';

const CONFIG = [
  { id: 'L1', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['C'], hands: 'right' }] },
  { id: 'L2', tier: 2, material: [
    { kind: 'exercise', collection: 'scales', roots: ['G'], hands: 'right' },
    { kind: 'exercise', collection: 'scales', roots: ['D'], hands: 'right' },
  ] },
  { id: 'L7', tier: 3, grading: { cleanliness: 0.8 }, material: [{ kind: 'exercise', collection: 'scales', roots: ['C'], cued: true }] },
];

describe('resolveRepertoire', () => {
  it('prepends the built-in floor so no config can remove D9', () => {
    const levels = resolveRepertoire(CONFIG);
    expect(levels[0]).toEqual(BUILT_IN_FLOOR);
    expect(levels.map((l) => l.id)).toEqual(['floor-key', 'L1', 'L2', 'L7']);
  });
  it('keeps a config-authored tier-0 unfailable floor as THE floor', () => {
    const withFloor = [{ id: 'keys-1', tier: 0, material: [{ kind: 'keys', notes: 1 }] }, ...CONFIG];
    expect(resolveRepertoire(withFloor)[0].id).toBe('keys-1');
  });
  it('preserves explicit presentation axes for AskSession instead of reducing them back to a tier', () => {
    const [floor, explicit] = resolveRepertoire([
      { id: 'floor', tier: 0, material: [{ kind: 'keys', notes: 1 }] },
      {
        id: 'user_5-c-major', tier: 1,
        presentation: { prompt: 'recall', secondary: 'none', timing: 'free', hints: 'after-stall' },
        grading: { pitchClass: true }, material: [{ kind: 'keys', root: 'C', quality: 'major' }],
      },
    ]);
    expect(floor.id).toBe('floor');
    expect(explicit).toMatchObject({
      presentation: { prompt: 'recall', secondary: 'none', timing: 'free', hints: 'after-stall' },
      grading: { pitchClass: true },
    });
  });
  it.each([undefined, null, [], 'yes', 42, [{ id: 'bad' }], [{ tier: 2, material: [] }]])(
    'falls back to the built-in C major level on unusable config (%s)', (raw) => {
      const levels = resolveRepertoire(raw);
      expect(levels.map((l) => l.id)).toEqual(['floor-key', 'fallback-c-major']);
    });
});

describe('the walk', () => {
  const levels = resolveRepertoire(CONFIG);
  it('every degrade changes the level id until the floor, then holds', () => {
    let level = levelById(levels, 'L7');
    const walk = [];
    for (let i = 0; i < 6; i += 1) { level = degradeLevel(levels, level.id); walk.push(level.id); }
    expect(walk).toEqual(['L2', 'L1', 'floor-key', 'floor-key', 'floor-key', 'floor-key']);
  });
  it('climb is the inverse and clamps at the top', () => {
    expect(climbLevel(levels, 'floor-key').id).toBe('L1');
    expect(climbLevel(levels, 'L7').id).toBe('L7');
  });
  it('isFloorLevel is true only at index 0', () => {
    expect(isFloorLevel(levels, 'floor-key')).toBe(true);
    expect(isFloorLevel(levels, 'L1')).toBe(false);
  });
  it('startLevelFor honors config.startLevel and defaults above the floor', () => {
    expect(startLevelFor(levels, { startLevel: 'L2' }).id).toBe('L2');
    expect(startLevelFor(levels, {}).id).toBe('L1');
    expect(startLevelFor(resolveRepertoire(null), {}).id).toBe('fallback-c-major');
  });
});

describe('rotation', () => {
  const l2 = levelById(resolveRepertoire(CONFIG), 'L2');
  it('never serves the same material twice running within a level', () => {
    const first = pickMaterial(l2, null, 0);
    const second = pickMaterial(l2, materialKey(first), 1);
    expect(materialKey(second)).not.toBe(materialKey(first));
  });
  it('a single-material level serves its one spec regardless', () => {
    const l1 = levelById(resolveRepertoire(CONFIG), 'L1');
    expect(pickMaterial(l1, materialKey(l1.material[0]), 3)).toEqual(l1.material[0]);
  });

  // Review fix (round 1): the drop-then-modulo scheme shrank the candidate
  // list to n-1 and re-partitioned it identically every call, which at n=3
  // starves the middle candidate forever under the natural serve -> pass-key
  // -> increment-index caller pattern. Drive several material counts through
  // many more cycles than the 2-call test above can ever catch that with.
  const makeLevel = (n) => ({
    id: `rot-${n}`,
    tier: 1,
    grading: null,
    material: Array.from({ length: n }, (_, i) => ({ kind: 'exercise', instanceId: `inst-${i}` })),
  });
  it.each([3, 4])('starves no candidate across %d materials over many serve->feedback cycles', (n) => {
    const level = makeLevel(n);
    let last = null;
    const seen = new Set();
    for (let i = 0; i < 12; i += 1) {
      const spec = pickMaterial(level, last, i);
      expect(materialKey(spec)).not.toBe(last); // never an immediate repeat
      seen.add(materialKey(spec));
      last = materialKey(spec);
    }
    expect(seen.size).toBe(n); // every candidate was reached, none starved
  });
});

describe('ordering (review fix: tier-ascending is enforced, not just documented)', () => {
  it('sorts a misordered config tier-ascending, stable within a tier', () => {
    const misordered = [
      { id: 'hi', tier: 3, material: [{ kind: 'keys', notes: 1 }] },
      { id: 'lo-a', tier: 1, material: [{ kind: 'keys', notes: 1 }] },
      { id: 'lo-b', tier: 1, material: [{ kind: 'keys', notes: 1 }] },
    ];
    const levels = resolveRepertoire(misordered);
    expect(levels.map((l) => l.id)).toEqual(['floor-key', 'lo-a', 'lo-b', 'hi']);
  });
});

describe('duplicate ids (review fix, minor)', () => {
  it('drops a later duplicate id, and a level colliding with the built-in floor id', () => {
    const dup = [
      { id: 'L1', tier: 1, material: [{ kind: 'keys', notes: 1 }] },
      { id: 'L1', tier: 2, material: [{ kind: 'keys', notes: 2 }] }, // duplicate id: dropped
      { id: 'floor-key', tier: 0, material: [{ kind: 'keys', notes: 3 }] }, // collides w/ built-in floor id: dropped
    ];
    const levels = resolveRepertoire(dup);
    expect(levels.map((l) => l.id)).toEqual(['floor-key', 'L1']);
    expect(levels[1].tier).toBe(1); // the FIRST occurrence of L1 survived
    expect(levels[1].material[0].notes).toBe(1);
  });
});

describe('materialKey (review fix, minor)', () => {
  it('canonicalizes roots order so an equivalent root set shares a key', () => {
    const a = { kind: 'exercise', collection: 'scales', roots: ['C', 'G'], hands: 'right' };
    const b = { kind: 'exercise', collection: 'scales', roots: ['G', 'C'], hands: 'right' };
    expect(materialKey(a)).toBe(materialKey(b));
  });
});
