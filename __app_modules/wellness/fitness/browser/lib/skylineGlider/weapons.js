import { SKYLINE_CRAFT_GEOMETRY, blastTouches, entityAtPoint, entityBounds, entityPresent, firstHitAlong, terrainAtPoint } from "./flightGeometry.js";
import { cameraTime, courseSpeed } from "./liftBoost.js";
import { VIEW_AHEAD_S } from "./courseProjection.js";

// Lasers and bombs live in course coordinates (seconds along the course,
// altitude 0..1), like entities, so every hit test reuses flightGeometry.
// Shots never hurt the rider; they only destroy entities that are vulnerable.
// A laser or missile flies until it hits something or leaves the right edge of
// the screen; `*_range_s`, when a course sets it, only shortens that.

export const WEAPON_DEFAULTS = Object.freeze({
  enabled: true,
  laser_cooldown_s: 0.3,
  laser_speed_s: 3,
  laser_range_s: null,
  bombs: 5,
  missiles: 3,
  missile_cooldown_s: .8,
  missile_range_s: null,
  missile_speed_s: 3,
  missile_turn_rate: .3,
  missile_max_turn_rate: 2.5,
  laser_aim: 0.045,
  missile_aim: 0.04,
  impact_s: 0.35,
  bomb_cooldown_s: 0.8,
  bomb_gravity: 1.4,
  blast_width_s: 1.2,
  blast_height: 0.16,
  blast_s: 0.5,
});

const clampAbs = (value, limit) => Math.max(-limit, Math.min(limit, value));

export const WEAPON_KINDS = Object.freeze(['laser', 'bomb', 'missile']);

const DEFAULT_VULNERABILITY = Object.freeze({ breakable: ['laser', 'bomb', 'missile'], solid: ['bomb'], scenery: [] });

// Past the screen edge plus a sprite's length, so a shot is gone before it is cut off.
const SHOT_MARGIN_S = .8;
const horizonOf = (state) => cameraTime(state) + VIEW_AHEAD_S + SHOT_MARGIN_S;
const reachOf = (shot, range, horizon) => (range > 0 ? Math.min(horizon, shot.origin_s + range) : horizon);

// A laser or missile keeps the craft's course speed from the moment it left
// the nose, so one fired mid-dash is never overtaken and one already downrange
// never lurches when the craft surges. A bomb falls in the world's frame
// (speed 1): it lands where the ground was under the craft, boost or not.
const launchSpeed = (state) => Math.max(1, courseSpeed(state));

const centreOf = (entity) => Number(entity.altitude) - Number(entity.height) / 2;

/**
 * Whether destroying this entity is a scored target. An explicit role decides
 * (shoot/bomb score; avoid/scenery do not); courses without roles keep the old
 * rule that every weapon kill counts.
 */
export function scoresAsTarget(entity) {
  if (!entity) return false;
  return entity.role ? ['shoot', 'bomb', 'missile'].includes(entity.role) : entity.class !== 'scenery';
}

// A missile cannot pass a wall it cannot break, so never lock onto what is behind one.
function blockedBySolid(course, destroyed, from, altitude, target, camera) {
  const low = Math.min(altitude, centreOf(target)), high = Math.max(altitude, centreOf(target));
  return (course?.entities || []).some((wall) => wall !== target && wall.class === 'solid' && !destroyed.has(wall.id) && entityPresent(wall, camera)
    && !vulnerableTo(wall, 'missile') && wall.at_s > from && wall.at_s < target.at_s
    && entityBounds(wall).top <= high && entityBounds(wall).bottom >= low);
}

// The nearest live missile-eligible entity ahead of `from` and on screen,
// preferring one the missile can still turn onto before it gets there.
function missileTarget(course, destroyed, from, altitude, rules, craftSpeed, camera, reach) {
  const closing = craftSpeed + rules.missile_speed_s;
  const ahead = (course?.entities || [])
    .filter((e) => !destroyed.has(e.id) && entityPresent(e, camera) && vulnerableTo(e, 'missile') && e.at_s + e.width_s / 2 >= from && e.at_s - e.width_s / 2 <= reach
      && !blockedBySolid(course, destroyed, from, altitude, e, camera))
    .sort((a, b) => a.at_s - b.at_s || a.id.localeCompare(b.id));
  const reachable = (e) => Math.abs(centreOf(e) - altitude) <= rules.missile_max_turn_rate * Math.max(0, e.at_s - from) / closing + e.height / 2;
  return ahead.find(reachable) || ahead[0] || null;
}

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
    impacts: [],
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
      const reach = reachOf({ origin_s: at }, rules.missile_range_s, horizonOf(next));
      const target = missileTarget(course, new Set(next.destroyedIds || []), at, next.altitude, rules, courseSpeed(next), cameraTime(next), reach);
      const count = (next.missilesFired || 0) + 1;
      next = { ...next, missilesFired: count, missilesLeft: next.missilesLeft - 1, missileCooldown: rules.missile_cooldown_s,
        projectiles: [...next.projectiles, { id: 'missile-' + count, kind: 'missile', power, at_s: at, origin_s: at, altitude: next.altitude, targetId: target?.id || null, speed: launchSpeed(next) }] };
    } else if (action === 'laser' && !(next.laserCooldown > 0)) {
      const shotsFired = next.shotsFired + 1;
      const at = next.courseTime + SKYLINE_CRAFT_GEOMETRY.frontSeconds;
      next = {
        ...next,
        shotsFired,
        laserCooldown: rules.laser_cooldown_s,
        projectiles: [...next.projectiles, { id: `laser-${shotsFired}`, kind: 'laser', power, at_s: at, origin_s: at, altitude: next.altitude, speed: launchSpeed(next) }],
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
  // Every shot that lands leaves a short-lived impact, so a hit that does not
  // kill still flashes ('damage'), a kill shatters ('kill'), and a shot the
  // thing shrugs off sparks ('absorbed').
  const impacts = (state.impacts || []).map((impact) => ({ ...impact, remaining: impact.remaining - dt })).filter((impact) => impact.remaining > 1e-9);
  const impact = (id, kind, at_s, altitude, entity, effect) => impacts.push({
    id, kind, at_s, altitude, effect, entityId: entity?.id || null, scores: scoresAsTarget(entity), remaining: rules.impact_s,
    ...(entity ? { hitPoints: entity.hit_points || 1, damage: entityDamage[entity.id] || 0 } : {}),
  });
  const camera = cameraTime(state);
  const horizon = horizonOf(state);
  const targets = () => (course?.entities || []).filter((entity) => entity.class !== 'scenery' && !destroyed.has(entity.id) && entityPresent(entity, camera));
  const damage = (entity, by, power) => {
    entityDamage[entity.id] = (entityDamage[entity.id] || 0) + (power || 1);
    if (entityDamage[entity.id] >= (entity.hit_points || 1)) {
      destroyed.add(entity.id);
      destroyedBy[entity.id] = by;
      delete entityDamage[entity.id];
      return 'kill';
    }
    return 'damage';
  };
  const strike = (shot, hit, at_s, altitude) => {
    if (hit.entity && vulnerableTo(hit.entity, shot.kind)) {
      const effect = damage(hit.entity, shot.kind, shot.power);
      impact(shot.id, shot.kind, at_s, altitude, hit.entity, effect);
    } else if (hit.entity) impact(shot.id, shot.kind, at_s, altitude, hit.entity, 'absorbed');
    // A shot into the ground just ends; it is not a "that did nothing" moment.
  };
  // Float residue would stretch a cooldown by one sub-step.
  const cool = (value) => { const left = (value || 0) - dt; return left > 1e-9 ? left : 0; };
  const blasts = (state.blasts || []).map((blast) => ({ ...blast, remaining: blast.remaining - dt })).filter((blast) => blast.remaining > 1e-9);
  const projectiles = [];
  for (const shot of state.projectiles || []) {
    if (shot.kind === 'missile') {
      const limit = reachOf(shot, rules.missile_range_s, horizon);
      const craftSpeed = shot.speed || 1;
      const closing = craftSpeed + rules.missile_speed_s;
      const end = Math.min(limit, shot.at_s + closing * dt);
      // Re-acquire when the lock is gone (destroyed or already passed).
      let target = targets().find((e) => e.id === shot.targetId && vulnerableTo(e, 'missile') && e.at_s + e.width_s / 2 >= shot.at_s);
      if (!target) target = missileTarget(course, destroyed, shot.at_s, shot.altitude, rules, craftSpeed, camera, limit);
      // Steer onto the target's centre by the time we reach it: the turn rate
      // rises to whatever the intercept needs, up to missile_max_turn_rate.
      const delta = target ? centreOf(target) - shot.altitude : 0;
      const timeLeft = target ? Math.max(dt, (target.at_s - shot.at_s) / closing) : Infinity;
      const turn = Math.min(rules.missile_max_turn_rate, Math.max(rules.missile_turn_rate, Math.abs(delta) / timeLeft)) * dt;
      const altitude = shot.altitude + clampAbs(delta, turn);
      const steps = Math.max(1, Math.ceil((end - shot.at_s) / .05));
      let hit = null, hitAlt = altitude;
      for (let i = 0; i < steps && !hit; i++) {
        hitAlt = shot.altitude + (altitude - shot.altitude) * (i + .5) / steps;
        hit = firstHitAlong(targets(), course, shot.at_s + (end - shot.at_s) * i / steps, shot.at_s + (end - shot.at_s) * (i + 1) / steps, hitAlt, rules.missile_aim);
      }
      if (hit) { strike(shot, hit, hit.at, hitAlt); continue; }
      if (end < limit) projectiles.push({ ...shot, at_s: end, altitude, targetId: target?.id || null });
      continue;
    }
    if (shot.kind === 'laser') {
      // Sweep the whole step so a narrow entity or zero-width wall is never skipped.
      const limit = reachOf(shot, rules.laser_range_s, horizon);
      const end = Math.min(shot.at_s + ((shot.speed || 1) + rules.laser_speed_s) * dt, limit);
      const hit = firstHitAlong(targets(), course, shot.at_s, end, shot.altitude, rules.laser_aim);
      if (hit) { strike(shot, hit, hit.at, shot.altitude); continue; }
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
    for (const entity of targets()) {
      if (!vulnerableTo(entity, 'bomb') || !blastTouches(entity, blast, blast)) continue;
      const effect = damage(entity, 'bomb', moved.power);
      impact(`${moved.id}:${entity.id}`, 'bomb', entity.at_s, centreOf(entity), entity, effect);
    }
  }
  return {
    ...state,
    projectiles,
    blasts,
    impacts,
    destroyedIds: [...destroyed],
    destroyedBy,
    entityDamage,
    laserCooldown: cool(state.laserCooldown),
    bombCooldown: cool(state.bombCooldown),
    missileCooldown: cool(state.missileCooldown),
  };
}

/**
 * Why a press would not fire right now, or null when it will. The HUD shows
 * this so a refused press reads as "Empty"/"Reloading", never as a dead button.
 */
export function weaponRefusal(state, action, course) {
  if (!state || state.phase !== 'playing' || state.stalled || state.pausedForSensor || state.collisionProtected) return 'paused';
  if (action === 'boost') {
    if (course?.rules?.weapons?.enabled === false || course?.rules?.boost?.enabled === false) return 'off';
    if (state.boostRemaining > 0) return 'active';
    return state.boostRechargeRemaining > 0 ? 'recharging' : null;
  }
  if (!weaponRules(course).enabled) return 'off';
  if (action === 'laser') return state.laserCooldown > 0 ? 'cooldown' : null;
  if (action === 'bomb') return !(state.bombsLeft > 0) ? 'empty' : state.bombCooldown > 0 ? 'cooldown' : null;
  if (action === 'missile') return !(state.missilesLeft > 0) ? 'empty' : state.missileCooldown > 0 ? 'cooldown' : null;
  return 'off';
}
