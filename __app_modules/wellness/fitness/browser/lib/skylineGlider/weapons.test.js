import { describe, expect, it } from 'vitest';
import { advanceWeapons, fireWeapons, initialWeaponState, scoresAsTarget, vulnerableTo, weaponRefusal, weaponRules } from "./weapons.js";
import { VIEW_AHEAD_S } from "./courseProjection.js";

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
    expect(vulnerableTo({ class: 'breakable' }, 'missile')).toBe(true);
    expect(vulnerableTo({ class: 'solid' }, 'laser')).toBe(false);
    expect(vulnerableTo({ class: 'solid' }, 'bomb')).toBe(true);
    expect(vulnerableTo({ class: 'scenery' }, 'bomb')).toBe(false);
    expect(vulnerableTo({ class: 'solid', vulnerable_to: ['laser'] }, 'laser')).toBe(true);
  });
});

describe('firing', () => {
  it('fires one laser per cooldown from the craft nose', () => {
    const next = fireWeapons(flying(), ['laser', 'laser'], course);
    expect(next.projectiles).toEqual([{ id: 'laser-1', kind: 'laser', power: 1, at_s: 1.8, origin_s: 1.8, altitude: 0.6, speed: 1 }]);
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

  it('lets the laser fire again after exactly one cooldown', () => {
    const next = advance(fireWeapons(flying({ altitude: 0.3 }), ['laser'], course), 0.3);
    expect(fireWeapons(next, ['laser'], course).shotsFired).toBe(2);
  });

  it('sweeps the whole step so a narrow entity cannot be skipped', () => {
    const narrow = { ...course, entities: [{ id: 'post', class: 'breakable', at_s: 2.97, altitude: 0.78, width_s: 0.04, height: 0.3 }] };
    let state = fireWeapons(flying(), ['laser'], narrow);
    for (let i = 0; i < 30; i += 1) state = advanceWeapons(state, 1 / 60, narrow);
    expect(state.destroyedBy).toEqual({ post: 'laser' });
    expect(state.projectiles).toEqual([]);
  });

  it('stops at a zero-width terrain wall', () => {
    const walled = { ...course, entities: [], segments: [{ id: 'wall', type: 'lower-terrain', start_s: 3.03, top: 0.5 }] };
    let state = fireWeapons(flying(), ['laser'], walled);
    for (let i = 0; i < 30; i += 1) state = advanceWeapons(state, 1 / 60, walled);
    expect(state.projectiles).toEqual([]);
  });

  it('takes the nearest hit along the sweep', () => {
    const pair = { ...course, entities: [
      { id: 'far', class: 'breakable', at_s: 2.99, altitude: 0.78, width_s: 0.02, height: 0.3 },
      { id: 'near', class: 'breakable', at_s: 2.96, altitude: 0.78, width_s: 0.02, height: 0.3 },
    ] };
    let state = fireWeapons(flying(), ['laser'], pair);
    for (let i = 0; i < 30; i += 1) state = advanceWeapons(state, 1 / 60, pair);
    expect(state.destroyedBy).toEqual({ near: 'laser' });
  });

  it('flies a laser and a missile all the way to the right edge of the screen, then drops them', () => {
    const open = { ...course, entities: [] };
    let state = fireWeapons(flying(), ['laser', 'missile'], open);
    const edge = state.courseTime + VIEW_AHEAD_S;
    // Seven course-seconds out (where shots used to vanish, mid-screen) both are still flying.
    while (state.projectiles.some((shot) => shot.at_s < state.courseTime + 9.5)) state = advanceWeapons(state, 1 / 60, open);
    expect(state.projectiles.map((shot) => shot.kind).sort()).toEqual(['laser', 'missile']);
    for (let i = 0; i < 120; i += 1) state = advanceWeapons(state, 1 / 60, open);
    expect(state.projectiles).toEqual([]);
    expect(edge - state.courseTime).toBeCloseTo(VIEW_AHEAD_S);
  });

  it('measures the screen edge from the camera, so a boosted craft does not shoot further', () => {
    const open = { ...course, entities: [] };
    const ahead = { ...flying(), boostOffset: 2.8 };
    let state = fireWeapons(ahead, ['laser'], open);
    for (let i = 0; i < 600 && state.projectiles.length; i += 1) {
      const before = state.projectiles[0].at_s;
      state = advanceWeapons(state, 1 / 60, open);
      if (!state.projectiles.length) expect(before).toBeLessThanOrEqual(ahead.courseTime - 2.8 + VIEW_AHEAD_S + .8);
    }
    expect(state.projectiles).toEqual([]);
  });

  it('still honours a course that shortens the laser range', () => {
    const short = { ...course, entities: [], rules: { ...course.rules, weapons: { ...course.rules?.weapons, laser_range_s: 2 } } };
    let state = fireWeapons(flying(), ['laser'], short);
    for (let i = 0; i < 60; i += 1) state = advanceWeapons(state, 1 / 60, short);
    expect(state.projectiles).toEqual([]);
  });

  it('lets lasers through a shutter that has not closed yet, and stops them once it has', () => {
    const shutter = { id: 'shut', class: 'solid', at_s: 4, altitude: .6, width_s: .6, height: .2, closes_at_s: 10, vulnerable_to: [] };
    const gated = { ...course, entities: [shutter] };
    let open = fireWeapons(flying({ altitude: .5 }), ['laser'], gated);
    for (let i = 0; i < 60; i += 1) open = advanceWeapons(open, 1 / 60, gated);
    expect(open.impacts).toEqual([]);
    let shut = fireWeapons(flying({ altitude: .5, courseTime: 0 }), ['laser'], { ...gated, entities: [{ ...shutter, closes_at_s: -1 }] });
    for (let i = 0; i < 60; i += 1) shut = advanceWeapons(shut, 1 / 60, { ...gated, entities: [{ ...shutter, closes_at_s: -1 }] });
    expect(shut.impacts.map((impact) => impact.effect)).toEqual(['absorbed']);
  });

  it('scores a missile-only wall as a target and refuses lasers on it', () => {
    const wall = { id: 'crack', class: 'solid', role: 'missile', required_weapon: 'missile', at_s: 3, altitude: .95, width_s: 1, height: .9, vulnerable_to: ['missile'] };
    const walled = { ...course, entities: [wall] };
    expect(scoresAsTarget(wall)).toBe(true);
    let laser = fireWeapons(flying({ altitude: .5 }), ['laser'], walled);
    for (let i = 0; i < 60; i += 1) laser = advanceWeapons(laser, 1 / 60, walled);
    expect(laser.destroyedIds || []).not.toContain('crack');
    let missile = fireWeapons(flying({ altitude: .5 }), ['missile'], walled);
    for (let i = 0; i < 60; i += 1) missile = advanceWeapons(missile, 1 / 60, walled);
    expect(missile.destroyedBy).toMatchObject({ crack: 'missile' });
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

it('snapshots laser power and accumulates damage until a target breaks', () => {
  const armored = { ...course, segments: [], entities: [{ ...course.entities[0], at_s: 2, hit_points: 3 }] };
  let state = fireWeapons(flying(), ['laser'], armored, 2);
  expect(state.projectiles[0].power).toBe(2);
  state = advanceWeapons(state, .2, armored);
  expect(state.destroyedIds).toEqual([]);
  expect(state.entityDamage).toEqual({ tree: 2 });
  state = fireWeapons({ ...state, laserCooldown: 0 }, ['laser'], armored, 1);
  state = advanceWeapons(state, .2, armored);
  expect(state.destroyedBy.tree).toBe('laser');
});

it('uses snapshotted bomb power for damage and blast coverage', () => {
  const targets = { ...course, segments: [], entities: [
    { id: 'armored', class: 'solid', at_s: 1.2, altitude: .9, width_s: .4, height: .2, hit_points: 4 },
    { id: 'nearby', class: 'breakable', at_s: 2.05, altitude: .9, width_s: .1, height: .2 },
  ] };
  const shot = fireWeapons(flying({ altitude: .7 }), ['bomb'], targets, 4);
  let state = shot;
  for (let i = 0; i < 60 && !state.blasts.length; i++) state = advanceWeapons(state, 1 / 60, targets);
  expect(state.destroyedBy).toEqual({ armored: 'bomb', nearby: 'bomb' });
  expect(state.blasts[0]).toMatchObject({ power: 4, blast_width_s: 2.1, blast_height: .28 });
  expect(state.bombsLeft).toBe(1);
});

describe('impact and steering', () => {
  const ridge = (entities) => ({ ...course, segments: [], entities });
  const run = (state, seconds, scene) => {
    let next = state;
    for (let i = 0; i < Math.round(seconds * 60); i += 1) next = advanceWeapons({ ...next, courseTime: next.courseTime + 1 / 60 }, 1 / 60, scene);
    return next;
  };

  it('steers a missile up onto a high target it would have flown under', () => {
    // The prod miss: rider at 0.70, target band 0.19-0.35, fired ~3 course-s out.
    const scene = ridge([{ id: 'high', class: 'breakable', at_s: 5, altitude: 0.35, width_s: 0.55, height: 0.16, hit_points: 1 }]);
    const fired = fireWeapons(flying({ altitude: 0.7 }), ['missile'], scene);
    expect(fired.projectiles[0].targetId).toBe('high');
    const after = run(fired, 1, scene);
    expect(after.destroyedBy.high).toBe('missile');
    expect(after.impacts.some((impact) => impact.entityId === 'high' && impact.effect === 'kill')).toBe(true);
  });

  it('records a visible impact for a hit that does not kill and for a shrugged-off shot', () => {
    const scene = ridge([
      { id: 'tough', class: 'breakable', at_s: 3, altitude: 0.66, width_s: 0.5, height: 0.12, hit_points: 3 },
    ]);
    const hit = run(fireWeapons(flying(), ['laser'], scene), 1, scene);
    expect(hit.destroyedIds).toEqual([]);
    expect(hit.entityDamage.tough).toBe(1);
    const wall = ridge([{ id: 'wall', class: 'solid', at_s: 3, altitude: 0.9, width_s: 0.5, height: 0.6, vulnerable_to: ['bomb'] }]);
    const absorbed = advanceWeapons({ ...fireWeapons(flying(), ['laser'], wall), courseTime: 1 }, 0.3, wall);
    expect(absorbed.impacts).toMatchObject([{ kind: 'laser', effect: 'absorbed', entityId: 'wall' }]);
    const landed = advanceWeapons({ ...fireWeapons(flying(), ['laser'], scene), courseTime: 1 }, 0.3, scene);
    expect(landed.impacts).toMatchObject([{ kind: 'laser', effect: 'damage', entityId: 'tough', damage: 1, hitPoints: 3 }]);
    expect(advanceWeapons(landed, 1, scene).impacts).toEqual([]);
  });

  it('lets a laser a hair below a target still land', () => {
    const scene = ridge([{ id: 'just-above', class: 'breakable', at_s: 3, altitude: 0.57, width_s: 0.5, height: 0.12 }]);
    const next = run(fireWeapons(flying({ altitude: 0.6 }), ['laser'], scene), 1, scene);
    expect(next.destroyedBy['just-above']).toBe('laser');
  });

  it('says why a press would not fire', () => {
    const live = { ...flying(), phase: 'playing' };
    expect(weaponRefusal(live, 'laser', course)).toBeNull();
    expect(weaponRefusal({ ...live, laserCooldown: 0.1 }, 'laser', course)).toBe('cooldown');
    expect(weaponRefusal({ ...live, bombsLeft: 0 }, 'bomb', course)).toBe('empty');
    expect(weaponRefusal({ ...live, missilesLeft: 0 }, 'missile', course)).toBe('empty');
    expect(weaponRefusal({ ...live, boostRechargeRemaining: 3 }, 'boost', course)).toBe('recharging');
    expect(weaponRefusal({ ...live, boostRemaining: 1, boostRechargeRemaining: 7 }, 'boost', course)).toBe('active');
    expect(weaponRefusal({ ...live, stalled: true }, 'laser', course)).toBe('paused');
    expect(weaponRefusal(live, 'laser', { ...course, rules: { weapons: { enabled: false } } })).toBe('off');
  });

  it('ends a shot into the ground without a "nothing happened" impact', () => {
    const next = run(fireWeapons(flying({ altitude: 0.7 }), ['laser'], course), 1, course);
    expect(next.projectiles).toEqual([]);
    expect(next.impacts).toEqual([]);
  });

  it('never locks a missile onto a target hidden behind a wall it cannot break', () => {
    const scene = ridge([
      { id: 'wall', class: 'solid', at_s: 4, altitude: 0.95, width_s: 1.2, height: 0.9, vulnerable_to: ['bomb'] },
      { id: 'behind', class: 'breakable', at_s: 6, altitude: 0.66, width_s: 0.5, height: 0.12 },
    ]);
    expect(fireWeapons(flying(), ['missile'], scene).projectiles[0].targetId).toBeNull();
  });

  it('scores only entities whose role says to shoot or bomb them', () => {
    expect(scoresAsTarget({ role: 'shoot' })).toBe(true);
    expect(scoresAsTarget({ role: 'bomb' })).toBe(true);
    expect(scoresAsTarget({ role: 'avoid', class: 'breakable' })).toBe(false);
    expect(scoresAsTarget({ class: 'breakable' })).toBe(true);
  });
});
