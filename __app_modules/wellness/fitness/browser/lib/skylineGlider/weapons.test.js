import { describe, expect, it } from 'vitest';
import { advanceWeapons, fireWeapons, initialWeaponState, vulnerableTo, weaponRules } from "./weapons.js";

const course = {
  rules: { lives: 3, weapons: { bombs: 2 } },
  segments: [{ id: 'hill', type: 'lower-terrain', start_s: 20, end_s: 30, top: 0.6 }],
  entities: [
    { id: 'tree', class: 'breakable', at_s: 4, altitude: 0.78, width_s: 0.5, height: 0.3 },
    { id: 'rock', class: 'solid', at_s: 8, altitude: 0.78, width_s: 0.8, height: 0.3 },
    { id: 'sign', class: 'scenery', at_s: 2, altitude: 0.78, width_s: 0.3, height: 0.4 },
  ],
};
const flying = (over = {}) => ({ courseTime: 1, altitude: 0.6, destroyedIds: [], ...initialWeaponState(course), ...over });
const advance = (state, seconds) => {
  let next = state;
  for (let i = 0; i < Math.round(seconds * 60); i += 1) next = advanceWeapons({ ...next, courseTime: next.courseTime + 1 / 60 }, 1 / 60, course);
  return next;
};

describe('weapon rules', () => {
  it('merges act overrides onto the defaults', () => {
    expect(weaponRules(course)).toMatchObject({ enabled: true, bombs: 2, laser_cooldown_s: 0.3 });
    expect(initialWeaponState(course)).toMatchObject({ bombsLeft: 2, projectiles: [], blasts: [], destroyedBy: {} });
  });

  it('derives vulnerability from class unless the entity names its own', () => {
    expect(vulnerableTo({ class: 'breakable' }, 'laser')).toBe(true);
    expect(vulnerableTo({ class: 'solid' }, 'laser')).toBe(false);
    expect(vulnerableTo({ class: 'solid' }, 'bomb')).toBe(true);
    expect(vulnerableTo({ class: 'scenery' }, 'bomb')).toBe(false);
    expect(vulnerableTo({ class: 'solid', vulnerable_to: ['laser'] }, 'laser')).toBe(true);
  });
});

describe('firing', () => {
  it('fires one laser per cooldown from the craft nose', () => {
    const next = fireWeapons(flying(), ['laser', 'laser'], course);
    expect(next.projectiles).toEqual([{ id: 'laser-1', kind: 'laser', at_s: 1.8, origin_s: 1.8, altitude: 0.6 }]);
    expect(next.shotsFired).toBe(1);
    expect(next.laserCooldown).toBeCloseTo(0.3);
  });

  it('drops bombs until the rack is empty', () => {
    let state = flying();
    state = fireWeapons(state, ['bomb'], course);
    state = fireWeapons({ ...state, bombCooldown: 0 }, ['bomb'], course);
    state = fireWeapons({ ...state, bombCooldown: 0 }, ['bomb'], course);
    expect(state.bombsDropped).toBe(2);
    expect(state.bombsLeft).toBe(0);
    expect(state.projectiles.map((shot) => shot.id)).toEqual(['bomb-1', 'bomb-2']);
  });

  it('ignores actions when the act disables weapons', () => {
    const off = { ...course, rules: { ...course.rules, weapons: { enabled: false } } };
    expect(fireWeapons(flying(), ['laser', 'bomb'], off).projectiles).toEqual([]);
  });
});

describe('advancing shots', () => {
  it('lets a laser pass scenery and destroy a breakable', () => {
    const next = advance(fireWeapons(flying({ altitude: 0.6 }), ['laser'], course), 1);
    expect(next.destroyedIds).toEqual(['tree']);
    expect(next.destroyedBy).toEqual({ tree: 'laser' });
    expect(next.projectiles).toEqual([]);
  });

  it('absorbs a laser on a solid entity without destroying it', () => {
    const next = advance(fireWeapons(flying({ courseTime: 5, altitude: 0.6 }), ['laser'], course), 1);
    expect(next.destroyedIds).toEqual([]);
    expect(next.projectiles).toEqual([]);
  });

  it('expires a laser at its range', () => {
    const open = { ...course, entities: [] };
    let state = fireWeapons(flying(), ['laser'], open);
    for (let i = 0; i < 150; i += 1) state = advanceWeapons(state, 1 / 60, open);
    expect(state.projectiles).toEqual([]);
  });

  it('drops a bomb onto a boulder and leaves a blast that fades', () => {
    let next = advance(fireWeapons(flying({ courseTime: 7.7, altitude: 0.3 }), ['bomb'], course), 0.5);
    expect(next.destroyedBy).toEqual({ rock: 'bomb' });
    expect(next.blasts).toHaveLength(1);
    expect(next.blasts[0]).toMatchObject({ id: 'bomb-1' });
    next = advance(next, 0.6);
    expect(next.blasts).toEqual([]);
  });

  it('detonates a bomb on terrain', () => {
    const next = advance(fireWeapons(flying({ courseTime: 22, altitude: 0.4 }), ['bomb'], course), 0.6);
    expect(next.projectiles).toEqual([]);
    expect(next.blasts).toHaveLength(1);
    expect(next.blasts[0].altitude).toBeGreaterThan(0.6);
  });
});
