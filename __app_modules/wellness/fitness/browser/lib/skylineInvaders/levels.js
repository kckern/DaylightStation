// Skyline Invaders level files: schema `skyline-invaders-level/v1`.
// Pure: no DOM, no clocks, no randomness of its own. The engine never imports
// this file (one-way dependency).
import { nextRandom } from '../../../../../../__capabilities/gaming/portable/mechanics/random.mjs';
import { MUZZLE_Y, SHOT_SPEED, createGameState, step } from './engine.js';
import { LANES, laneAim, laneOfX } from './lanes.js';
import { BOOST_KINDS, FIRE_KEYS, boostRules } from './rules.js';
import { LEVEL_THREAT_TYPES, THREATS, moveThreat } from './threats.js';
import { INVADERS_TUNABLES } from './tunables.js';

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

function fireErrors(fire) {
  if (fire == null) return [];
  if (!isObject(fire)) return ['fire must be an object'];
  const errors = [];
  for (const [key, value] of Object.entries(fire)) {
    if (!FIRE_KEYS.includes(key)) errors.push(`fire.${key} is not a fire rule (${FIRE_KEYS.join(', ')})`);
    else if (!(num(value) && value > 0)) errors.push(`fire.${key} must be a number > 0`);
  }
  return errors;
}

// Per-level fall speeds, by threat type, in scene units per second.
function fallErrors(fall) {
  if (fall == null) return [];
  if (!isObject(fall)) return ['fall must be an object'];
  const errors = [];
  for (const [type, value] of Object.entries(fall)) {
    if (!THREATS[type] || !(THREATS[type].fall > 0)) errors.push(`fall.${type} is not a falling threat`);
    else if (!(num(value) && value > 0)) errors.push(`fall.${type} must be a number > 0`);
  }
  return errors;
}

// The run of lanes threats may spawn in: [first, last], both inside 0..LANES-1.
function spawnLaneErrors(lanes) {
  if (lanes == null) return [];
  const ok = Array.isArray(lanes) && lanes.length === 2 && lanes.every((lane) => Number.isInteger(lane) && lane >= 0 && lane < LANES) && lanes[0] <= lanes[1];
  return ok ? [] : [`spawn_lanes must be [first, last] within 0..${LANES - 1}`];
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
  errors.push(...nukeErrors(raw.nuke), ...boostErrors(raw.boost), ...fireErrors(raw.fire), ...fallErrors(raw.fall), ...spawnLaneErrors(raw.spawn_lanes));
  return errors;
}

const BOT_STEP_S = 1 / 30;

/**
 * Play the level the way a child on the mat does, with no partner: step on
 * the mat every `botStepIntervalS` while anything is falling (each step buys
 * fuel and the stream fires by itself), and move the cannon a lane at a time
 * toward the lowest threat. The bot is deliberately imperfect, because the
 * perfect one is how a level that no child could pass was shipped:
 * - it re-chooses its lane only every `botDecisionS`;
 * - for `botLaneErrorRate` of the threats it lines up one lane to the side
 *   and never corrects (a child whose aim does not reach that lane), so about
 *   that share of what falls gets through;
 * - the cannon takes `botLaneMoveS` to cross each lane;
 * - it never drops a bomb.
 * Which threats it misreads depends on the seed and the threat only, so a
 * seed replays. Returns the final engine state.
 */
export function simulateBot(level, { seed = 1, tunables = INVADERS_TUNABLES } = {}) {
  let state = createGameState(level, { seed });
  // One draw per threat, from the seed and the threat's id: 0..1 for whether
  // it is misread, then which side.
  const misread = (id) => {
    const first = nextRandom(((Number(seed) >>> 0) * 2654435761 + id * 40503) >>> 0);
    if (first.value >= tunables.botLaneErrorRate) return 0;
    return nextRandom(first.state).value < 0.5 ? -1 : 1;
  };
  let lane = Math.floor(LANES / 2);
  let goal = lane;
  let nextDecisionAt = 0;
  let nextMoveAt = 0;
  let nextStepAt = 0;
  // The round ends itself on its timer; the cap only guards a level that was never validated.
  const maxSteps = Math.ceil((Number(level.duration_s) || 0) / BOT_STEP_S) + 2;
  for (let i = 0; i < maxSteps && state.phase === 'playing'; i += 1) {
    const target = state.threats.filter((t) => t.type !== 'bomb').sort((a, b) => b.y - a.y || a.id - b.id)[0];
    if (target && state.time >= nextDecisionAt) {
      // Lead the target: aim at the lane it will be in when a shot gets there.
      const flight = Math.max(0, (MUZZLE_Y - target.y) / (SHOT_SPEED + (target.fall ?? THREATS[target.type].fall)));
      const wanted = laneOfX(moveThreat(target, flight).x);
      const side = misread(target.id);
      goal = wanted + side >= 0 && wanted + side < LANES ? wanted + side : wanted - side;
      nextDecisionAt = state.time + tunables.botDecisionS;
    }
    if (lane !== goal && state.time >= nextMoveAt) {
      lane += Math.sign(goal - lane);
      nextMoveAt = state.time + tunables.botLaneMoveS;
    }
    const steps = [];
    if (target && state.time >= nextStepAt) {
      steps.push({ source: 'bot', at: null });
      nextStepAt = state.time + tunables.botStepIntervalS;
    }
    state = step({ ...state, events: [] }, { aim: laneAim(lane), armsUp: false, steps, stomps: [], partnerRpm: null }, BOT_STEP_S, level);
  }
  return state;
}

/**
 * Can a child on the step mat pass this level? The bot plays it on each of
 * `reachabilitySeeds`, and the level is held to the worst of them: it may ask
 * for `reachabilityHitRate` of the bot's kills, and for no more skyline than
 * the bot kept, less `reachabilityBaseHpMargin`.
 */
export function checkReachability(level, tunables = INVADERS_TUNABLES) {
  const runs = tunables.reachabilitySeeds.map((seed) => simulateBot(level, { seed, tunables }));
  const reachableKills = Math.floor(Math.min(...runs.map((bot) => bot.kills)) * tunables.reachabilityHitRate);
  const botBaseHpPct = Math.min(...runs.map((bot) => Math.round((100 * bot.base.hp) / bot.base.maxHp)));
  const reachableBaseHp = Math.max(0, botBaseHpPct - tunables.reachabilityBaseHpMargin);
  const errors = [];
  if (reachableKills < level.pass.kills) errors.push(`pass.kills ${level.pass.kills} is not reachable from the step mat: at most ${reachableKills}`);
  if (reachableBaseHp < (level.pass.base_hp_min ?? 0)) errors.push(`pass.base_hp_min ${level.pass.base_hp_min} is above what a shooter on the mat holds: at most ${reachableBaseHp} (the bot kept ${botBaseHpPct})`);
  return { reachable: !errors.length, errors, reachableKills, botBaseHpPct, reachableBaseHp };
}

/**
 * Validate one level. Returns { valid, errors, level } with defaults filled;
 * `level` is null when invalid. Never throws and never changes `raw`.
 * Reachability (a bot run on the real engine) is on by default and runs only
 * on a structurally sound level; pass { reachability: false } to check
 * structure only.
 */
export function validateLevel(raw, { reachability = true, tunables = INVADERS_TUNABLES } = {}) {
  const errors = structure(raw);
  if (errors.length) return { valid: false, errors, level: null };
  const level = {
    ...raw,
    cannons: raw.cannons ?? 1,
    max_bombers: raw.max_bombers ?? 2,
    pass: { kills: raw.pass.kills, base_hp_min: raw.pass.base_hp_min ?? 0 },
  };
  if (reachability) {
    const reach = checkReachability(level, tunables);
    if (!reach.reachable) return { valid: false, errors: reach.errors, level: null };
  }
  return { valid: true, errors: [], level };
}
