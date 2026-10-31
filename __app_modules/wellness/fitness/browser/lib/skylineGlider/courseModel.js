import { SKYLINE_CRAFT_GEOMETRY, entityBounds, terrainContact } from "./flightGeometry.js";

const SCHEMA = 'skyline-glider-course/v1';
const ENTITY_CLASSES = new Set(['breakable', 'solid', 'scenery']);
const WEAPONS = new Set(['laser', 'bomb', 'missile']);
const TYPES = new Set([
  'open', 'lower-terrain', 'upper-terrain', 'corridor', 'lava',
  'collectible-path', 'checkpoint', 'finish',
]);

const finite = (value) => Number.isFinite(Number(value));
const inBand = (value) => finite(value) && Number(value) >= 0 && Number(value) <= 1;
const inPlayableAltitude = (value) => finite(value) && Number(value) >= 0.18 && Number(value) <= 0.78;

function safeBandFor(segment) {
  if (segment.type === 'corridor') {
    return { top: Number(segment.ceiling), bottom: Number(segment.floor) };
  }
  if (segment.type === 'lower-terrain') {
    return { top: 0, bottom: segment.profile?.length ? Math.min(...segment.profile.map(p => Number(p?.altitude))) : Number(segment.top) };
  }
  if (segment.type === 'upper-terrain') {
    return { top: Number(segment.bottom), bottom: 1 };
  }
  return null;
}

// A solid entity leaves the larger of the gaps above and below it open.
function solidEntityBand(entity) {
  const bounds = entityBounds(entity);
  const above = { top: 0, bottom: bounds.top };
  const below = { top: bounds.bottom, bottom: 1 };
  const room = (band) => Math.min(0.78, band.bottom) - Math.max(0.18, band.top);
  return { id: entity.id, start_s: bounds.start, end_s: bounds.end, safeBand: room(above) >= room(below) ? above : below };
}

function validateEntities(rawEntities, errors) {
  const ids = new Set();
  return rawEntities.map((raw, index) => {
    const entity = { ...raw };
    if (!entity.id || ids.has(entity.id)) errors.push(`duplicate or missing entity id at index ${index}`);
    ids.add(entity.id);
    if (!ENTITY_CLASSES.has(entity.class)) errors.push(`entity ${entity.id || index} has unsupported class`);
    if (!finite(entity.at_s) || !inBand(entity.altitude)) errors.push(`entity ${entity.id || index} is misplaced`);
    if (!(Number(entity.width_s) > 0) || !(Number(entity.height) > 0)) errors.push(`entity ${entity.id || index} has no size`);
    if (entity.required_weapon != null && entity.required_weapon !== 'bomb') errors.push(`entity ${entity.id} has unsupported required_weapon`);
    if (entity.hit_points != null && (!Number.isInteger(entity.hit_points) || entity.hit_points < 1)) errors.push(`entity ${entity.id} has invalid hit_points`);
    if (entity.vulnerable_to != null && (!Array.isArray(entity.vulnerable_to) || entity.vulnerable_to.some((weapon) => !WEAPONS.has(weapon)))) {
      errors.push(`entity ${entity.id || index} has unsupported vulnerable_to`);
    }
    for (const field of ['at_s', 'altitude', 'width_s', 'height']) entity[field] = Number(entity[field]);
    return entity;
  });
}

function validateReachability(segments, motion, errors) {
  let prior = { top: 0.18, bottom: 0.78, end: 0 };
  for (const segment of [...segments].sort((a, b) => a.start_s - b.start_s)) {
    if (!segment.safeBand) continue;
    const available = Math.max(0, segment.start_s - prior.end);
    const reachable = {
      top: Math.max(0.18, prior.top - available * motion.max_climb_rate),
      bottom: Math.min(0.78, prior.bottom + available * motion.max_descent_rate),
    };
    const top = Math.max(reachable.top, segment.safeBand.top);
    const bottom = Math.min(reachable.bottom, segment.safeBand.bottom);
    if (top >= bottom) errors.push(`segment ${segment.id} is unreachable from the preceding safe band`);
    prior = { ...segment.safeBand, end: segment.end_s ?? segment.start_s };
  }
}

export function validateCourse(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['course must be an object'] };
  }
  if (input.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(input.id || ''))) errors.push('course id is invalid');
  if (!Number.isInteger(input.version) || input.version < 1) errors.push('version must be a positive integer');
  if (!finite(input.duration_s) || Number(input.duration_s) <= 0) errors.push('duration_s must be positive');

  const rawSegments = Array.isArray(input.segments) ? input.segments : [];
  if (rawSegments.length === 0) errors.push('segments are required');
  const ids = new Set();
  let priorStart = -Infinity;
  let finishCount = 0;
  const collectibleIds = new Set();
  const segments = rawSegments.map((raw, index) => {
    const segment = { ...raw };
    if (!segment.id || ids.has(segment.id)) errors.push(`duplicate or missing segment id at index ${index}`);
    ids.add(segment.id);
    if (!TYPES.has(segment.type)) errors.push(`segment ${segment.id || index} has unsupported type`);
    if (!finite(segment.start_s) || Number(segment.start_s) < priorStart) errors.push('segments must be ordered by start_s');
    segment.start_s = Number(segment.start_s);
    priorStart = segment.start_s;
    if (segment.end_s != null) {
      segment.end_s = Number(segment.end_s);
      if (!finite(segment.end_s) || segment.end_s < segment.start_s) errors.push(`segment ${segment.id} has invalid end_s`);
    }
    if (segment.type === 'finish') finishCount += 1;
    if (segment.type === 'checkpoint' && segment.restart_altitude != null) {
      if (!inPlayableAltitude(segment.restart_altitude)) errors.push(`segment ${segment.id} has invalid restart_altitude`);
      else segment.restart_altitude = Number(segment.restart_altitude);
    }
    if (segment.type === 'corridor' && (!inBand(segment.ceiling) || !inBand(segment.floor) || Number(segment.ceiling) >= Number(segment.floor))) {
      errors.push(`segment ${segment.id} has invalid corridor bounds`);
    }
    if (segment.type === 'lower-terrain' && !inBand(segment.top)) errors.push(`segment ${segment.id} has invalid terrain top`);
    if (segment.profile != null) {
      const points = segment.profile;
      if (segment.type !== 'lower-terrain' || !Array.isArray(points) || points.length < 2
        || points[0]?.at_s !== segment.start_s || points.at(-1)?.at_s !== segment.end_s
        || points.some((p, i) => !p || !finite(p.at_s) || !inBand(p.altitude) || (i > 0 && Number(p.at_s) <= Number(points[i - 1]?.at_s)))) {
        errors.push(`segment ${segment.id} has invalid slope profile`);
      }
    }
    if (segment.type === 'lava' && (!inBand(segment.top) || Number(segment.top) <= .815 || !finite(segment.end_s))) errors.push(`segment ${segment.id} has invalid lava bounds`);
    if (segment.type === 'upper-terrain' && !inBand(segment.bottom)) errors.push(`segment ${segment.id} has invalid terrain bottom`);
    if (segment.type === 'collectible-path') {
      for (const item of segment.collectibles || []) {
        if (!item?.id || collectibleIds.has(item.id)) errors.push(`duplicate or missing collectible id in ${segment.id}`);
        collectibleIds.add(item?.id);
        if (!finite(item?.at_s) || !inBand(item?.altitude)) errors.push(`collectible ${item?.id || 'unknown'} is invalid`);
      }
    }
    const safeBand = safeBandFor(segment);
    return safeBand ? { ...segment, safeBand } : segment;
  });
  if (finishCount !== 1) errors.push('course must contain exactly one finish');

  const motion = {
    max_climb_rate: Number(input.motion?.max_climb_rate ?? 0.3),
    max_descent_rate: Number(input.motion?.max_descent_rate ?? 0.22),
  };
  if (motion.max_climb_rate <= 0 || motion.max_descent_rate <= 0) errors.push('motion rates must be positive');
  for (const field of ['slow_signal_grace_s', 'inferred_slowdown_s', 'stop_coast_s']) {
    if (input.motion?.[field] != null && (!finite(input.motion[field]) || Number(input.motion[field]) <= 0)) {
      errors.push(`motion ${field} must be positive`);
    }
  }
  if (input.rpm != null) {
    try { resolveCalibration({}, input); } catch { errors.push('course rpm calibration is invalid'); }
  }
  if (input.rules?.assist_terrain != null && typeof input.rules.assist_terrain !== 'boolean') errors.push('assist_terrain must be boolean');
  const weapons = input.rules?.weapons;
  if (weapons != null && (typeof weapons !== 'object' || Array.isArray(weapons))) errors.push('rules weapons must be a mapping');
  else for (const [field, value] of Object.entries(weapons || {})) {
    if (field === 'enabled') { if (typeof value !== 'boolean') errors.push('rules weapons enabled must be true or false'); continue; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push(`rules weapons ${field} must be a non-negative number`);
  }
  const entities = validateEntities(Array.isArray(input.entities) ? input.entities : [], errors);
  for (const field of ['bombs','missiles']) if (weapons?.[field] != null && !Number.isInteger(weapons[field])) errors.push('ammunition must be an integer');
  const boost = input.rules?.boost;
  if (boost != null && (typeof boost !== 'object' || Array.isArray(boost))) errors.push('rules boost must be a mapping');
  else for (const [field,value] of Object.entries(boost || {})) {
    if (field === 'enabled') { if (typeof value !== 'boolean') errors.push('boost enabled must be boolean'); }
    else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push('boost tuning must be non-negative');
  }
  if (errors.length === 0) {
    const required = entities.filter(entity => entity.required_weapon === 'bomb');
    for (const entity of required) {
      if (weapons?.enabled === false || (weapons?.bombs ?? 5) < (entity.hit_points || 1)
        || !(entity.vulnerable_to || ['bomb']).includes('bomb')) errors.push(`entity ${entity.id} requires unavailable bombs`);
    }
    const solids = entities.filter((entity) => entity.class === 'solid' && !entity.required_weapon).map(solidEntityBand);
    validateReachability([...segments, ...solids], motion, errors);
    for (const checkpoint of segments.filter((segment) => segment.type === 'checkpoint')) {
      const altitude = checkpoint.restart_altitude ?? 0.5;
      if (terrainContact({ segments }, checkpoint.start_s, altitude, SKYLINE_CRAFT_GEOMETRY)) {
        errors.push(`checkpoint ${checkpoint.id} restarts inside terrain`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    ...(errors.length === 0 ? { course: { ...structuredClone(input), segments, entities } } : {}),
  };
}

export function resolveCalibration(equipment = {}, course = {}) {
  const rpm = course?.rpm || equipment?.skyline_glider?.rpm || equipment?.rpm || {};
  const lowRpm = Number(rpm.min ?? 30);
  const highRpm = Number(rpm.max ?? 100);
  if (!Number.isFinite(lowRpm) || !Number.isFinite(highRpm) || lowRpm < 0 || highRpm <= lowRpm) {
    throw new Error('Invalid Skyline Glider cadence calibration');
  }
  return { lowRpm, highRpm };
}
