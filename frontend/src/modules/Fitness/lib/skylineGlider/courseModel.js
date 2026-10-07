const SCHEMA = 'skyline-glider-course/v1';
const TYPES = new Set([
  'open', 'lower-terrain', 'upper-terrain', 'corridor',
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
    return { top: 0, bottom: Number(segment.top) };
  }
  if (segment.type === 'upper-terrain') {
    return { top: Number(segment.bottom), bottom: 1 };
  }
  return null;
}

function validateReachability(segments, motion, errors) {
  let prior = { top: 0.18, bottom: 0.78, end: 0 };
  for (const segment of segments) {
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
  for (const field of ['slow_signal_grace_s', 'inferred_slowdown_s']) {
    if (input.motion?.[field] != null && (!finite(input.motion[field]) || Number(input.motion[field]) <= 0)) {
      errors.push(`motion ${field} must be positive`);
    }
  }
  if (errors.length === 0) validateReachability(segments, motion, errors);

  return {
    valid: errors.length === 0,
    errors,
    ...(errors.length === 0 ? { course: { ...structuredClone(input), segments } } : {}),
  };
}

export function resolveCalibration(equipment = {}) {
  const rpm = equipment?.skyline_glider?.rpm || equipment?.rpm || {};
  const lowRpm = Number(rpm.min ?? 30);
  const highRpm = Number(rpm.max ?? 100);
  if (!Number.isFinite(lowRpm) || !Number.isFinite(highRpm) || lowRpm < 0 || highRpm <= lowRpm) {
    throw new Error('Invalid Skyline Glider cadence calibration');
  }
  return { lowRpm, highRpm };
}
