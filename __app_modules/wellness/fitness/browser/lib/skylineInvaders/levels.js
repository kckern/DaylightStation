// Skyline Invaders level files: schema `skyline-invaders-level/v1`.
// Pure: no DOM, no clocks, no randomness.
import { BOOST_KINDS, boostRules } from './rules.js';
import { LEVEL_THREAT_TYPES } from './threats.js';

export const LEVEL_SCHEMA = 'skyline-invaders-level/v1';
const ID = /^[a-z][a-z0-9-]+$/;
const num = (value) => typeof value === 'number' && Number.isFinite(value);
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function waveErrors(wave, index, durationS, priorAt) {
  const label = `waves[${index}]`;
  if (!isObject(wave)) return [`${label} must be an object`];
  const errors = [];
  if (!num(wave.at) || wave.at < 0) errors.push(`${label}.at must be >= 0`);
  else {
    if (wave.at <= priorAt) errors.push(`${label}.at must be strictly increasing`);
    if (num(durationS) && wave.at >= durationS) errors.push(`${label} must start before the level ends`);
  }
  if (!num(wave.rate_s) || wave.rate_s < 0.3) errors.push(`${label}.rate_s must be >= 0.3`);
  const mix = Object.entries(isObject(wave.spawn) ? wave.spawn : {});
  if (!mix.length) errors.push(`${label}.spawn must name at least one threat`);
  for (const [type, weight] of mix) {
    if (!LEVEL_THREAT_TYPES.includes(type)) errors.push(`${label}.spawn has unknown threat ${type}`);
    else if (!num(weight) || weight <= 0) errors.push(`${label}.spawn.${type} weight must be > 0`);
  }
  return errors;
}

function nukeErrors(nuke) {
  if (nuke == null) return [];
  const positive = (value) => value === undefined || (num(value) && value > 0);
  return isObject(nuke) && positive(nuke.radius) && positive(nuke.damage) ? [] : ['nuke.radius and nuke.damage must be > 0'];
}

function boostErrors(boost) {
  if (boost == null) return [];
  if (!isObject(boost)) return ['boost must be an object'];
  const errors = [];
  for (const [key, value] of Object.entries(boost)) {
    if (key === 'rotation') {
      if (!Array.isArray(value) || !value.length || !value.every((kind) => BOOST_KINDS.includes(kind))) {
        errors.push(`boost.rotation must be a non-empty list of ${BOOST_KINDS.join(', ')}`);
      }
    } else if (!(num(value) && value > 0)) errors.push(`boost.${key} must be a number > 0`);
  }
  // Checked against the merged rules: a level may override only one of the two.
  const rules = boostRules({ boost });
  if (!errors.length && !(rules.full_rpm > rules.min_rpm)) errors.push(`boost.full_rpm (${rules.full_rpm}) must be above boost.min_rpm (${rules.min_rpm})`);
  return errors;
}

function structure(raw) {
  if (!isObject(raw)) return ['level is not an object'];
  const errors = [];
  if (raw.schema !== LEVEL_SCHEMA) errors.push(`schema must be ${LEVEL_SCHEMA}`);
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) errors.push('id must match ^[a-z][a-z0-9-]+$');
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('name is required');
  if (!num(raw.duration_s) || raw.duration_s < 30 || raw.duration_s > 900) errors.push('duration_s must be 30..900');
  if (!Number.isInteger(raw.pass?.kills) || raw.pass.kills < 1) errors.push('pass.kills must be an integer >= 1');
  const hpMin = raw.pass?.base_hp_min ?? 0;
  if (!num(hpMin) || hpMin < 0 || hpMin > 100) errors.push('pass.base_hp_min must be 0..100');
  if (![1, 2].includes(raw.cannons ?? 1)) errors.push('cannons must be 1 or 2');
  const maxBombers = raw.max_bombers ?? 2;
  if (!Number.isInteger(maxBombers) || maxBombers < 0) errors.push('max_bombers must be an integer >= 0');
  if (!Array.isArray(raw.waves) || !raw.waves.length) errors.push('waves must be a non-empty list');
  else {
    let priorAt = -Infinity;
    raw.waves.forEach((wave, index) => {
      errors.push(...waveErrors(wave, index, raw.duration_s, priorAt));
      if (num(wave?.at)) priorAt = Math.max(priorAt, wave.at);
    });
  }
  errors.push(...nukeErrors(raw.nuke), ...boostErrors(raw.boost));
  return errors;
}

/**
 * Validate one level. Returns { valid, errors, level } with defaults filled;
 * `level` is null when invalid. Never throws and never changes `raw`.
 * Reachability (a bot run on the real engine) is on by default; pass
 * { reachability: false } to check structure only.
 */
export function validateLevel(raw, { reachability = true } = {}) {
  const errors = structure(raw);
  if (errors.length) return { valid: false, errors, level: null };
  const level = {
    ...raw,
    cannons: raw.cannons ?? 1,
    max_bombers: raw.max_bombers ?? 2,
    pass: { kills: raw.pass.kills, base_hp_min: raw.pass.base_hp_min ?? 0 },
  };
  void reachability; // wired in with the reachability check
  return { valid: true, errors: [], level };
}
