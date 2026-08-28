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
});
