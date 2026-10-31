import { SKYLINE_CRAFT_GEOMETRY, blastTouches, entityAtPoint, firstHitAlong, terrainAtPoint } from "./flightGeometry.js";

// Lasers and bombs live in course coordinates (seconds along the course,
// altitude 0..1), like entities, so every hit test reuses flightGeometry.
// Shots never hurt the rider; they only destroy entities that are vulnerable.

export const WEAPON_DEFAULTS = Object.freeze({
  enabled: true,
  laser_cooldown_s: 0.3,
  laser_speed_s: 3,
  laser_range_s: 7,
  bombs: 5,
  missiles: 3,
  missile_cooldown_s: .8,
  missile_range_s: 7,
  missile_speed_s: 3,
  missile_turn_rate: .3,
  bomb_cooldown_s: 0.8,
  bomb_gravity: 1.4,
  blast_width_s: 1.2,
  blast_height: 0.16,
  blast_s: 0.5,
});

export const WEAPON_KINDS = Object.freeze(['laser', 'bomb', 'missile']);

const DEFAULT_VULNERABILITY = Object.freeze({ breakable: ['laser', 'bomb'], solid: ['bomb'], scenery: [] });

export function weaponRules(course) {
  return { ...WEAPON_DEFAULTS, ...(course?.rules?.weapons || {}) };
}

export function vulnerableTo(entity, weapon) {
  if (weapon === 'missile' && entity?.required_weapon === 'bomb') return false;
  const list = Array.isArray(entity?.vulnerable_to) ? entity.vulnerable_to : DEFAULT_VULNERABILITY[entity?.class] || [];
  return list.includes(weapon);
}

export function initialWeaponState(course) {
  return {
    projectiles: [],
    blasts: [],
    bombsLeft: weaponRules(course).bombs,
    missilesLeft: weaponRules(course).missiles,
    missileCooldown: 0,
    missilesFired: 0,
    laserCooldown: 0,
    bombCooldown: 0,
    shotsFired: 0,
    bombsDropped: 0,
    destroyedBy: {},
    entityDamage: {},
  };
}

/** Applies queued presses ('laser' | 'bomb'); cooldown and the bomb rack gate each one. */
export function fireWeapons(state, actions, course, power = 1) {
  power = Math.max(1, Math.min(4, Math.floor(Number(power) || 1)));
  const rules = weaponRules(course);
  if (!rules.enabled || !actions?.length) return state;
  let next = state;
  for (const action of actions) {
    if (action === 'missile' && !(next.missileCooldown > 0) && next.missilesLeft > 0) {
      const at = next.courseTime + SKYLINE_CRAFT_GEOMETRY.frontSeconds;
      const target = (course.entities || []).filter(e => !(next.destroyedIds || []).includes(e.id) && vulnerableTo(e, 'missile') && e.at_s >= at && e.at_s <= at + rules.missile_range_s)
        .sort((a,b) => a.at_s - b.at_s || a.id.localeCompare(b.id))[0];
      const count = (next.missilesFired || 0) + 1;
      next = { ...next, missilesFired: count, missilesLeft: next.missilesLeft - 1, missileCooldown: rules.missile_cooldown_s,
        projectiles: [...next.projectiles, { id: 'missile-' + count, kind: 'missile', power, at_s: at, origin_s: at, altitude: next.altitude, targetId: target?.id || null }] };
    } else if (action === 'laser' && !(next.laserCooldown > 0)) {
      const shotsFired = next.shotsFired + 1;
      const at = next.courseTime + SKYLINE_CRAFT_GEOMETRY.frontSeconds;
      next = {
        ...next,
        shotsFired,
        laserCooldown: rules.laser_cooldown_s,
        projectiles: [...next.projectiles, { id: `laser-${shotsFired}`, kind: 'laser', power, at_s: at, origin_s: at, altitude: next.altitude }],
      };
    } else if (action === 'bomb' && !(next.bombCooldown > 0) && next.bombsLeft > 0) {
      const bombsDropped = next.bombsDropped + 1;
      next = {
        ...next,
        bombsDropped,
        bombsLeft: next.bombsLeft - 1,
        bombCooldown: rules.bomb_cooldown_s,
        projectiles: [...next.projectiles, { id: `bomb-${bombsDropped}`, kind: 'bomb', power, at_s: next.courseTime, altitude: next.altitude + SKYLINE_CRAFT_GEOMETRY.radius, fall: 0 }],
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
  const entityDamage = { ...(state.entityDamage || {}) };
  const targets = () => (course?.entities || []).filter((entity) => entity.class !== 'scenery' && !destroyed.has(entity.id));
  const damage = (entity, by, power) => {
    entityDamage[entity.id] = (entityDamage[entity.id] || 0) + (power || 1);
    if (entityDamage[entity.id] >= (entity.hit_points || 1)) {
      destroyed.add(entity.id);
      destroyedBy[entity.id] = by;
      delete entityDamage[entity.id];
    }
  };
  // Float residue would stretch a cooldown by one sub-step.
  const cool = (value) => { const left = (value || 0) - dt; return left > 1e-9 ? left : 0; };
  const blasts = (state.blasts || []).map((blast) => ({ ...blast, remaining: blast.remaining - dt })).filter((blast) => blast.remaining > 1e-9);
  const projectiles = [];
  for (const shot of state.projectiles || []) {
    if (shot.kind === 'missile') {
      const limit = shot.origin_s + rules.missile_range_s;
      const end = Math.min(limit, shot.at_s + (1 + rules.missile_speed_s) * dt);
      const target = targets().find(e => e.id === shot.targetId && vulnerableTo(e, 'missile'));
      const delta = target ? target.altitude - shot.altitude : 0;
      const altitude = shot.altitude + Math.max(-rules.missile_turn_rate * dt, Math.min(rules.missile_turn_rate * dt, delta));
      const steps = Math.max(1, Math.ceil((end - shot.at_s) / .05));
      let hit = null;
      for (let i=0;i<steps&&!hit;i++) hit = firstHitAlong(targets(), course,
        shot.at_s + (end-shot.at_s)*i/steps, shot.at_s + (end-shot.at_s)*(i+1)/steps,
        shot.altitude + (altitude-shot.altitude)*(i+.5)/steps);
      if (hit?.entity && vulnerableTo(hit.entity, 'missile')) damage(hit.entity, 'missile', shot.power);
      if (!hit && end < limit) projectiles.push({ ...shot, at_s: end, altitude });
      continue;
    }
    if (shot.kind === 'laser') {
      // Sweep the whole step so a narrow entity or zero-width wall is never skipped.
      const limit = shot.origin_s + rules.laser_range_s;
      const end = Math.min(shot.at_s + (1 + rules.laser_speed_s) * dt, limit);
      const hit = firstHitAlong(targets(), course, shot.at_s, end, shot.altitude);
      if (hit) {
        if (hit.entity && vulnerableTo(hit.entity, 'laser')) damage(hit.entity, 'laser', shot.power);
        continue;
      }
      if (end < limit) projectiles.push({ ...shot, at_s: end });
      continue;
    }
    const fall = shot.fall + rules.bomb_gravity * dt;
    const moved = { ...shot, at_s: shot.at_s + dt, altitude: shot.altitude + fall * dt, fall };
    const hit = entityAtPoint(targets(), moved.at_s, moved.altitude) || terrainAtPoint(course, moved.at_s, moved.altitude) || moved.altitude >= 1;
    if (!hit) { projectiles.push(moved); continue; }
    const scale = [1, 1, 1.25, 1.5, 1.75][moved.power || 1];
    const blast = { power: moved.power || 1, blast_width_s: rules.blast_width_s * scale, blast_height: rules.blast_height * scale, id: moved.id, at_s: moved.at_s, altitude: Math.min(1, moved.altitude), remaining: rules.blast_s };
    blasts.push(blast);
    for (const entity of targets()) if (vulnerableTo(entity, 'bomb') && blastTouches(entity, blast, blast)) damage(entity, 'bomb', moved.power);
  }
  return {
    ...state,
    projectiles,
    blasts,
    destroyedIds: [...destroyed],
    destroyedBy,
    entityDamage,
    laserCooldown: cool(state.laserCooldown),
    bombCooldown: cool(state.bombCooldown),
    missileCooldown: cool(state.missileCooldown),
  };
}
