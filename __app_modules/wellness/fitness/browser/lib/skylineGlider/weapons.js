import { SKYLINE_CRAFT_GEOMETRY, blastTouches, entityAtPoint, terrainAtPoint } from "./flightGeometry.js";

// Lasers and bombs live in course coordinates (seconds along the course,
// altitude 0..1), like entities, so every hit test reuses flightGeometry.
// Shots never hurt the rider; they only destroy entities that are vulnerable.

export const WEAPON_DEFAULTS = Object.freeze({
  enabled: true,
  laser_cooldown_s: 0.3,
  laser_speed_s: 3,
  laser_range_s: 7,
  bombs: 5,
  bomb_cooldown_s: 0.8,
  bomb_gravity: 1.4,
  blast_width_s: 1.2,
  blast_height: 0.16,
  blast_s: 0.5,
});

export const WEAPON_KINDS = Object.freeze(['laser', 'bomb']);

const DEFAULT_VULNERABILITY = Object.freeze({ breakable: ['laser', 'bomb'], solid: ['bomb'], scenery: [] });

export function weaponRules(course) {
  return { ...WEAPON_DEFAULTS, ...(course?.rules?.weapons || {}) };
}

export function vulnerableTo(entity, weapon) {
  const list = Array.isArray(entity?.vulnerable_to) ? entity.vulnerable_to : DEFAULT_VULNERABILITY[entity?.class] || [];
  return list.includes(weapon);
}

export function initialWeaponState(course) {
  return {
    projectiles: [],
    blasts: [],
    bombsLeft: weaponRules(course).bombs,
    laserCooldown: 0,
    bombCooldown: 0,
    shotsFired: 0,
    bombsDropped: 0,
    destroyedBy: {},
  };
}

/** Applies queued presses ('laser' | 'bomb'); cooldown and the bomb rack gate each one. */
export function fireWeapons(state, actions, course) {
  const rules = weaponRules(course);
  if (!rules.enabled || !actions?.length) return state;
  let next = state;
  for (const action of actions) {
    if (action === 'laser' && !(next.laserCooldown > 0)) {
      const shotsFired = next.shotsFired + 1;
      const at = next.courseTime + SKYLINE_CRAFT_GEOMETRY.frontSeconds;
      next = {
        ...next,
        shotsFired,
        laserCooldown: rules.laser_cooldown_s,
        projectiles: [...next.projectiles, { id: `laser-${shotsFired}`, kind: 'laser', at_s: at, origin_s: at, altitude: next.altitude }],
      };
    } else if (action === 'bomb' && !(next.bombCooldown > 0) && next.bombsLeft > 0) {
      const bombsDropped = next.bombsDropped + 1;
      next = {
        ...next,
        bombsDropped,
        bombsLeft: next.bombsLeft - 1,
        bombCooldown: rules.bomb_cooldown_s,
        projectiles: [...next.projectiles, { id: `bomb-${bombsDropped}`, kind: 'bomb', at_s: next.courseTime, altitude: next.altitude + SKYLINE_CRAFT_GEOMETRY.radius, fall: 0 }],
      };
    }
  }
  return next;
}

/** Moves every shot one step, resolves hits, and ages blasts and cooldowns. */
export function advanceWeapons(state, dt, course) {
  const rules = weaponRules(course);
  const destroyed = new Set(state.destroyedIds || []);
  const destroyedBy = { ...(state.destroyedBy || {}) };
  const targets = () => (course?.entities || []).filter((entity) => entity.class !== 'scenery' && !destroyed.has(entity.id));
  const destroy = (entity, by) => { destroyed.add(entity.id); destroyedBy[entity.id] = by; };
  const blasts = (state.blasts || []).map((blast) => ({ ...blast, remaining: blast.remaining - dt })).filter((blast) => blast.remaining > 1e-9);
  const projectiles = [];
  for (const shot of state.projectiles || []) {
    if (shot.kind === 'laser') {
      const moved = { ...shot, at_s: shot.at_s + (1 + rules.laser_speed_s) * dt };
      const target = entityAtPoint(targets(), moved.at_s, moved.altitude);
      if (target) {
        if (vulnerableTo(target, 'laser')) destroy(target, 'laser');
        continue;
      }
      if (terrainAtPoint(course, moved.at_s, moved.altitude) || moved.at_s - moved.origin_s > rules.laser_range_s) continue;
      projectiles.push(moved);
      continue;
    }
    const fall = shot.fall + rules.bomb_gravity * dt;
    const moved = { ...shot, at_s: shot.at_s + dt, altitude: shot.altitude + fall * dt, fall };
    const hit = entityAtPoint(targets(), moved.at_s, moved.altitude) || terrainAtPoint(course, moved.at_s, moved.altitude) || moved.altitude >= 1;
    if (!hit) { projectiles.push(moved); continue; }
    const blast = { id: moved.id, at_s: moved.at_s, altitude: Math.min(1, moved.altitude), remaining: rules.blast_s };
    blasts.push(blast);
    for (const entity of targets()) if (vulnerableTo(entity, 'bomb') && blastTouches(entity, blast, rules)) destroy(entity, 'bomb');
  }
  return {
    ...state,
    projectiles,
    blasts,
    destroyedIds: [...destroyed],
    destroyedBy,
    laserCooldown: Math.max(0, (state.laserCooldown || 0) - dt),
    bombCooldown: Math.max(0, (state.bombCooldown || 0) - dt),
  };
}
