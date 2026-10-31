import {
  HIGH_ALTITUDE,
  LOW_ALTITUDE,
  SKYLINE_CRAFT_GEOMETRY,
  entitiesTouchingCraft,
  pointOverlapsCraft,
  safeBandAt,
  terrainContact,
} from "./flightGeometry.js";
import { advanceWeapons, fireWeapons, initialWeaponState, weaponRules } from "./weapons.js";
import { initialBoostState, activateBoost, advanceBoost, boostTargetAltitude } from './liftBoost.js';

const STEP = 1 / 60;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function targetForRpm(rpm, calibration) {
  const normalized = clamp((rpm - calibration.lowRpm) / (calibration.highRpm - calibration.lowRpm), 0, 1);
  return LOW_ALTITUDE + (HIGH_ALTITUDE - LOW_ALTITUDE) * normalized;
}

function crossingSegments(course, from, to, type) {
  return course.segments.filter((segment) => segment.type === type && segment.start_s > from && segment.start_s <= to);
}

function applyCourseEvents(state, previousTime, course) {
  let next = state;
  for (const checkpoint of crossingSegments(course, previousTime, next.courseTime, 'checkpoint')) {
    next = {
      ...next,
      bombsLeft: weaponRules(course).bombs,
      missilesLeft: weaponRules(course).missiles,
      boostRemaining: 0,
      boostRechargeRemaining: 0,
      checkpoint: {
        id: checkpoint.id,
        time: checkpoint.start_s,
        restartAltitude: checkpoint.restart_altitude ?? 0.5,
        collectedIds: [...next.collectedIds],
        destroyedIds: [...(next.destroyedIds || [])],
        destroyedBy: { ...(next.destroyedBy || {}) },
        entityDamage: { ...(next.entityDamage || {}) },
      },
    };
  }
  const collected = new Set(next.collectedIds);
  for (const segment of course.segments.filter((entry) => entry.type === 'collectible-path')) {
    for (const item of segment.collectibles || []) {
      const reached = pointOverlapsCraft(item.at_s, next.courseTime);
      if (reached && Math.abs(next.altitude - item.altitude) <= 0.08) collected.add(item.id);
    }
  }
  next = { ...next, collectedIds: [...collected] };
  if (next.courseTime >= course.duration_s || crossingSegments(course, previousTime, next.courseTime, 'finish').length) {
    next = { ...next, phase: 'completed', courseTime: course.duration_s };
  }
  return next;
}

function crash(state, course, { cause, segmentId = null, entityId = null, counted = false }) {
  return {
    ...state,
    lives: 0,
    phase: 'crashed',
    crashRemaining: course.rules.restart_delay_s,
    crashCause: cause,
    projectiles: [],
    blasts: [],
    collisions: counted ? state.collisions : state.collisions + 1,
    lastCollisionSegmentId: segmentId,
    lastCollisionEntityId: entityId,
  };
}

// Terrain and solid entities are walls: touching one crashes, invincible or
// not. Only a sensor pause protects the rider, and then the craft is held
// inside the open band so it can never drift through the ground.
function holdInsideTerrain(state, course) {
  const band = safeBandAt(course, state.courseTime);
  const top = band.top + SKYLINE_CRAFT_GEOMETRY.radius;
  const bottom = band.bottom - SKYLINE_CRAFT_GEOMETRY.radius;
  if (top > bottom) return state;
  const altitude = clamp(state.altitude, top, bottom);
  return altitude === state.altitude ? state : { ...state, altitude };
}

function collide(state, course) {
  if (state.phase !== 'playing') return state;
  if (state.collisionProtected) return holdInsideTerrain(state, course);
  const terrain = terrainContact(course, state.courseTime, state.altitude);
  if (terrain) {
    if (course.rules.assist_terrain && terrain.type === 'lower-terrain') {
      state = { ...holdInsideTerrain(state, course), verticalRate: Math.min(0, state.verticalRate) };
    } else return crash(state, course, { cause: terrain.type === 'lava' ? 'lava' : 'terrain', segmentId: terrain.id });
  }
  // Anything already destroyed (by a crash, laser or bomb) is gone for collision.
  const destroyed = new Set(state.destroyedIds || []);
  const touching = entitiesTouchingCraft(course, state.courseTime, state.altitude).filter((entity) => !destroyed.has(entity.id));
  const solid = touching.find((entity) => entity.class === 'solid');
  if (solid) return crash(state, course, { cause: 'entity', entityId: solid.id });

  // Breakables shatter on contact and cost one life, except while blinking.
  const broken = touching.filter((entity) => entity.class === 'breakable');
  if (!broken.length) return state;
  const next = {
    ...state,
    destroyedIds: [...destroyed, ...broken.map((entity) => entity.id)],
    destroyedBy: { ...(state.destroyedBy || {}), ...Object.fromEntries(broken.map((entity) => [entity.id, 'crash'])) },
  };
  if (state.invincibleRemaining > 0) return next;
  const hit = {
    ...next,
    lives: state.lives - 1,
    collisions: state.collisions + 1,
    lastCollisionSegmentId: null,
    lastCollisionEntityId: broken[0].id,
    invincibleRemaining: course.rules.invincibility_s,
  };
  return hit.lives > 0 ? hit : crash(hit, course, { cause: 'lives', entityId: broken[0].id, counted: true });
}

export function retryFlightCheckpoint(state, course) {
  if (state.phase !== 'crashed') return state;
  return {
    ...state,
    phase: 'playing',
    crashRemaining: 0,
    courseTime: state.checkpoint.time,
    lives: course.rules.lives,
    altitude: state.checkpoint.restartAltitude ?? 0.5,
    verticalRate: 0,
    zeroElapsed: 0,
    stalled: false,
    invincibleRemaining: 0,
    crashCause: null,
    collectedIds: [...state.checkpoint.collectedIds],
    destroyedIds: [...(state.checkpoint.destroyedIds || [])],
    destroyedBy: { ...(state.checkpoint.destroyedBy || {}) },
    entityDamage: { ...(state.checkpoint.entityDamage || {}) },
    projectiles: [],
    blasts: [],
    bombsLeft: weaponRules(course).bombs,
    missilesLeft: weaponRules(course).missiles,
    missileCooldown: 0,
    boostRemaining: 0,
    boostRechargeRemaining: 0,
    laserCooldown: 0,
    bombCooldown: 0,
    restarts: state.restarts + 1,
  };
}

// A confirmed zero commits this attempt to a fall. Once latched, neither
// renewed cadence, terrain assistance nor transport loss can recover it.
function advanceStall(state, input, dt, course) {
  const verticalRate = course.motion.max_descent_rate;
  const altitude = Math.min(1, state.altitude + verticalRate * dt);
  const next = {
    ...state, stalled: true, altitude, targetAltitude: 1, verticalRate,
    rawRpm: Math.max(0, Number(input?.rpm) || 0),
    zeroElapsed: state.zeroElapsed + dt,
    pausedForSensor: false, collisionProtected: false, inputMode: 'stalled',
    projectiles: [], blasts: [],
  };
  const terrain = terrainContact(course, state.courseTime, altitude);
  return terrain || altitude + SKYLINE_CRAFT_GEOMETRY.radius >= 1
    ? crash(next, course, { cause: 'stall', segmentId: terrain?.id }) : next;
}

function singleStep(state, input, dt, course) {
  if (state.phase === 'completed') return state;
  if (state.phase === 'crashed') {
    return state;
  }

  if (state.stalled) return advanceStall(state, input, dt, course);

  const transportStalled = !!input?.transportStalled;
  const disconnected = !input?.connected && !transportStalled;
  const missing = disconnected || transportStalled;
  const inputTs = Number(input?.ts);
  if (!state.inputReady) {
    const freshAfterArm = !missing && Number.isFinite(inputTs) && inputTs > state.armedAtMs;
    if (!freshAfterArm) {
      return {
        ...state,
        rawRpm: Math.max(0, Number(input?.rpm) || 0),
        lastInputTs: Number.isFinite(inputTs) ? inputTs : state.lastInputTs,
        pausedForSensor: true,
        collisionProtected: true,
        inputMode: transportStalled ? 'transport-paused' : 'sensor-paused',
      };
    }
    state = { ...state, inputReady: true, pausedForSensor: false, collisionProtected: false, lastInputTs: inputTs };
  }
  if (transportStalled) {
    const missingFor = state.sensorMissingFor + dt;
    if (missingFor - course.motion.disconnect_grace_s > 1e-9) {
      return { ...state, sensorMissingFor: missingFor, pausedForSensor: true, collisionProtected: true, inputMode: 'transport-paused' };
    }
  }
  if (disconnected) {
    const missingFor = state.sensorMissingFor + dt;
    const grace = Number(course.motion.slow_signal_grace_s ?? 5);
    if (missingFor - grace > 1e-9) {
      return { ...state, sensorMissingFor: missingFor, pausedForSensor: true, collisionProtected: true, inputMode: 'sensor-paused' };
    }
  }

  const previousTime = state.courseTime;
  if (!missing && input?.rpm === 0) return advanceStall(state, input, dt, course);
  if (!missing) {
    state = advanceBoost(state, dt, course);
    if (input?.actions?.includes('boost')) state = activateBoost(state, course);
  }
  const measuredRpm = Math.max(0, Number(input?.rpm) || 0);
  const inferredFor = disconnected ? state.sensorMissingFor + dt : 0;
  const slowdownSeconds = Math.max(STEP, Number(course.motion.inferred_slowdown_s ?? 0.5));
  const rawRpm = disconnected
    ? Math.max(0, state.filteredRpm * (1 - Math.min(1, inferredFor / slowdownSeconds)))
    : measuredRpm;
  const zeroElapsed = !missing && rawRpm === 0 ? state.zeroElapsed + dt : 0;
  let filteredRpm = state.filteredRpm;
  const delta = rawRpm - filteredRpm;
  if (!missing && Math.abs(delta) > course.motion.deadband_rpm) {
    const alpha = 1 - Math.exp(-dt / course.motion.filter_s);
    filteredRpm += delta * alpha;
  }

  let targetAltitude = state.targetAltitude;
  if (!missing) {
    const endpointRpm = rawRpm <= state.calibration.lowRpm || rawRpm >= state.calibration.highRpm;
    targetAltitude = targetForRpm(endpointRpm ? rawRpm : filteredRpm, state.calibration);
  }
  if (disconnected) targetAltitude = targetForRpm(rawRpm, state.calibration);

  targetAltitude = boostTargetAltitude(state, targetAltitude, course);
  const desiredRate = (targetAltitude - state.altitude) / course.motion.response_s;
  const rate = clamp(desiredRate, -course.motion.max_climb_rate, course.motion.max_descent_rate);
  const altitude = clamp(state.altitude + rate * dt, HIGH_ALTITUDE, LOW_ALTITUDE);
  let next = {
    ...state,
    rawRpm,
    filteredRpm,
    targetAltitude,
    altitude,
    verticalRate: rate,
    lastInputTs: Number.isFinite(inputTs) ? inputTs : state.lastInputTs,
    zeroElapsed,
    sensorMissingFor: missing ? state.sensorMissingFor + dt : 0,
    pausedForSensor: false,
    collisionProtected: missing,
    inputMode: disconnected ? 'inferred-slowdown' : 'measured',
    invincibleRemaining: Math.max(0, state.invincibleRemaining - dt),
    courseTime: state.courseTime + dt,
  };
  if (!missing) next = fireWeapons(next, input?.actions, course, input?.weaponPower);
  next = advanceWeapons(next, dt, course);
  next = applyCourseEvents(next, previousTime, course);
  return collide(next, course);
}

export function createFlightState(course, {
  calibration, altitude = LOW_ALTITUDE, courseTime = 0, armedAtMs = null,
} = {}) {
  if (!calibration || calibration.highRpm <= calibration.lowRpm) throw new Error('Flight state requires valid calibration');
  return {
    phase: 'playing',
    courseTime,
    altitude,
    targetAltitude: altitude,
    rawRpm: 0,
    filteredRpm: calibration.lowRpm,
    verticalRate: 0,
    calibration: { ...calibration },
    lives: course.rules.lives,
    collisions: 0,
    lastCollisionSegmentId: null,
    lastCollisionEntityId: null,
    crashCause: null,
    restarts: 0,
    invincibleRemaining: 0,
    crashRemaining: 0,
    zeroElapsed: 0,
    stalled: false,
    sensorMissingFor: 0,
    pausedForSensor: false,
    collisionProtected: false,
    inputMode: 'measured',
    armedAtMs: Number.isFinite(Number(armedAtMs)) ? Number(armedAtMs) : 0,
    inputReady: armedAtMs == null,
    lastInputTs: null,
    collectedIds: [],
    destroyedIds: [],
    ...initialWeaponState(course),
    ...initialBoostState(),
    checkpoint: { id: 'start', time: 0, restartAltitude: 0.5, collectedIds: [], destroyedIds: [], destroyedBy: {}, entityDamage: {} },
  };
}

export function stepFlight(state, input, elapsedSeconds, course) {
  let remaining = Math.max(0, Number(elapsedSeconds) || 0);
  // Checkpoints saved before weapons existed lack these fields.
  let next = Array.isArray(state.projectiles) ? state : { ...initialWeaponState(course), ...state };
  // Presses fire once per frame, not once per 1/60 s sub-step.
  let stepInput = input;
  while (remaining > 1e-9) {
    const dt = Math.min(STEP, remaining);
    next = singleStep(next, stepInput, dt, course);
    if (stepInput?.actions) stepInput = { ...stepInput, actions: undefined };
    remaining -= dt;
  }
  return next;
}
