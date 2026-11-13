// Skyline Invaders simulation. Pure: no DOM, no clocks, no unseeded randomness. All
// randomness is the Mulberry32 state carried in `state.rng`, so a seed and a
// list of inputs replay to the same round.
//
// Time only enters through `dt`, so the round plays the same at any display or
// pose frame rate. Aim arrives as a plain number in the intents and may be a
// few frames old; nothing here assumes it changes every step.
import { nextRandom } from '../../../../../../__capabilities/gaming/portable/mechanics/random.mjs';
import { advance, box, sweepHits } from '../../../../../../__capabilities/gaming/portable/realtime/index.mjs';
import { LANES, LANE_WIDTH, laneOfX, laneX, nearestThreat } from './lanes.js';
import { boostRules, fireRules, nukeRules } from './rules.js';
import { killPoints } from './scoring.js';
import { FIELD, THREATS, aimToX, clampX, moveThreat, threatBox } from './threats.js';
import { SHOT_TIERS, TOP_WEAPON_LEVEL, bombReady, weaponTier } from './tiers.js';

export { boostRules, fireRules, nukeRules };

export const STEP_S = 1 / 60;
export const SHOT_SPEED = 900;                 // scene units per second, straight up
export const MUZZLE_Y = FIELD.groundY - 20;
const BUILDINGS = 10;
const EPS = 1e-9;
const MIN_AUTO_FIRE_S = 0.05;                  // auto-fire never runs faster than this, whatever a level asks
const BLAST_S = 0.5;                           // how long a bomb blast stays in state for the renderer
const BOMB_EMPTY_Y = 250;                      // where a bomb goes off when the sky is empty
const RANGE_X = FIELD.width - 2 * FIELD.marginX;

/**
 * A fresh round of `level` (a validated level, see levels.js). The same seed
 * gives the same threats in the same columns.
 */
export function createGameState(level, { seed = 1 } = {}) {
  return {
    phase: 'playing', time: 0, rng: Number(seed) >>> 0, nextId: 1,
    nextSpawnAt: level.waves[0].at,
    threats: [], shots: [], blasts: [], volleys: {},
    base: { hp: 100, maxHp: 100, buildings: Array.from({ length: BUILDINGS }, () => true) },
    score: 0, kills: 0, combo: 0, bestCombo: 0, shotsFired: 0, hits: 0, bombs: 0,
    // Fuel is seconds of stream left; steps buy it. streamIn is the wait to the next volley.
    fuel: 0, streamIn: 0, steps: 0, firingS: 0,
    // level indexes tiers.js WEAPON_LADDER; meter 0..1; idleS = seconds since the stream last ran.
    weapon: { level: 0, meter: 0, idleS: 0, peak: 0 },
    boost: { meter: 0, next: 0, used: 0, active: null },
    events: [],
  };
}

// A step works on a private copy and mutates it; callers only ever see whole
// states. Entries inside the lists are replaced, never edited in place.
function draft(state) {
  return {
    ...state,
    threats: [...state.threats], shots: [...state.shots], blasts: [...state.blasts],
    volleys: { ...state.volleys },
    base: { ...state.base, buildings: [...state.base.buildings] },
    weapon: { ...state.weapon }, boost: { ...state.boost }, events: [...state.events],
  };
}

function rand(s) {
  const next = nextRandom(s.rng);
  s.rng = next.state;
  return next.value;
}

// `originX` is the column a zigzag swings around. The threat starts where its
// zigzag is at age 0, so it never jumps sideways on its first step.
function addThreat(s, level, type, originX, y, { from, phase = 0, dir = 1 }) {
  const spec = THREATS[type];
  const x = spec.zigzag ? clampX(originX + spec.zigzag.amplitude * Math.sin(phase)) : originX;
  const fall = level?.fall?.[type] ?? spec.fall;
  const threat = { id: s.nextId++, type, x, y, originX, hp: spec.hp, fall, age: 0, phase, dir, bombIn: spec.bombEvery_s || 0 };
  s.threats.push(threat);
  s.events.push({ type: 'threat.spawned', data: { id: threat.id, threat: type, x, from } });
  return threat;
}

// The wave in force at `time`, and the one after it (if any).
function wavesAt(level, time) {
  let index = 0;
  level.waves.forEach((wave, i) => { if (wave.at <= time) index = i; });
  return { wave: level.waves[index], next: level.waves[index + 1] || null };
}

function pickType(wave, roll) {
  const mix = Object.keys(wave.spawn).sort();   // sorted: the pick must not depend on YAML key order
  const total = mix.reduce((sum, type) => sum + wave.spawn[type], 0);
  let pick = roll * total;
  for (const type of mix) {
    pick -= wave.spawn[type];
    if (pick < 0) return type;
  }
  return mix[mix.length - 1];
}

function spawn(s, level) {
  while (s.time >= s.nextSpawnAt) {
    const { wave, next } = wavesAt(level, s.nextSpawnAt);
    // Every spawn draws the same four numbers, used or not, and nothing else
    // draws any. So what falls and where depends on the seed and the level
    // only, never on the frame rate or on what the player shot down.
    const roll = { type: rand(s), x: rand(s), phase: rand(s), dir: rand(s) };
    let type = pickType(wave, roll.type);
    if (type === 'bomber' && s.threats.filter((t) => t.type === 'bomber').length >= (level.max_bombers ?? 2)) type = 'meteor';
    // Threats come down lane centres, so the cannon (which sits on one) can
    // always line up with them. A level may keep them to a run of lanes.
    const [lo, hi] = level.spawn_lanes || [0, LANES - 1];
    const lane = Math.min(hi, lo + Math.floor(roll.x * (hi - lo + 1)));
    addThreat(s, level, type, laneX(lane), type === 'bomber' ? FIELD.bomberY : FIELD.spawnY, {
      from: 'wave', phase: roll.phase * Math.PI * 2, dir: roll.dir < 0.5 ? -1 : 1,
    });
    // A wave spawns every rate_s until the next wave's `at`; the next wave
    // then starts on its own time, not on this wave's beat.
    const beat = s.nextSpawnAt + wave.rate_s;
    s.nextSpawnAt = next && next.at < beat ? next.at : beat;
  }
}

// Buildings are the picture of base HP: the share left standing never exceeds
// the share of HP left. An impact takes out the building it lands on first,
// then the nearest ones still standing.
function knockOutBuildings(s, x) {
  const { buildings } = s.base;
  const count = buildings.length;
  const allowed = Math.ceil((s.base.hp / s.base.maxHp) * count);
  const home = Math.min(count - 1, Math.max(0, Math.floor(((x - FIELD.marginX) / RANGE_X) * count)));
  const lost = [];
  for (let reach = 0; reach < count && buildings.filter(Boolean).length > allowed; reach += 1) {
    for (const index of reach ? [home - reach, home + reach] : [home]) {
      if (index >= 0 && index < count && buildings[index] && buildings.filter(Boolean).length > allowed) {
        buildings[index] = false;
        lost.push(index);
      }
    }
  }
  return lost;
}

// A threat reached the ground. It costs base HP (and stars) and the kill
// streak; it never ends the round.
function impact(s, threat) {
  const shielded = s.boost.active?.kind === 'shield';
  const damage = shielded ? 0 : THREATS[threat.type].baseDamage || 0;
  let buildings = [];
  if (damage > 0) {
    s.base.hp = Math.max(0, s.base.hp - damage);
    buildings = knockOutBuildings(s, threat.x);
    s.combo = 0;
  }
  s.events.push({ type: 'base.hit', data: { threat: threat.type, x: threat.x, damage, shielded, hp: s.base.hp, buildings } });
}

function move(s, dt, level) {
  const kept = [];
  const droppers = [];
  for (const prior of s.threats) {
    let threat = moveThreat(prior, dt);
    const every = THREATS[threat.type].bombEvery_s;
    if (every) {
      let bombIn = threat.bombIn - dt;
      if (bombIn <= 0) { bombIn += every; droppers.push(threat); }
      threat = { ...threat, bombIn };
    }
    if (threat.y >= FIELD.groundY) impact(s, threat); else kept.push(threat);
  }
  s.threats = kept;
  for (const bomber of droppers) addThreat(s, level, 'bomb', bomber.x, bomber.y + THREATS.bomber.height / 2, { from: 'bomber' });
}

// One aim per cannon: one cannon unless the level has two. A twin boost adds
// a cannon that mirrors the first.
function cannonAims(s, aim, level) {
  const aims = (Array.isArray(aim) ? aim : [aim]).slice(0, level.cannons === 2 ? 2 : 1);
  if (s.boost.active?.kind === 'twin') aims.push(1 - aims[0]);
  return aims;
}

// One beat of the stream = one volley, however many shots it makes (double,
// spread, two cannons). Accuracy is counted per volley, not per shot. Every
// shot leaves from the cannon's own x: where it is drawn is where it fires.
function fireVolley(s, intents, source, level) {
  const spec = SHOT_TIERS[weaponTier(s.weapon)];
  const aims = cannonAims(s, intents.aim, level);
  const volley = s.nextId++;
  let live = 0;
  for (const aim of aims) {
    for (const shot of spec.shots) {
      s.shots.push({ id: s.nextId++, volley, x: aimToX(aim) + shot.dx, y: MUZZLE_Y, vx: shot.vx, tier: spec.id, damage: spec.damage, halfWidth: spec.halfWidth, armsUp: !!intents.armsUp });
      live += 1;
    }
  }
  s.volleys[volley] = { live, hit: false };
  s.shotsFired += 1;
  const x = aimToX(aims[0]);
  s.events.push({ type: 'shot.fired', data: { volley, tier: spec.id, aim: aims[0], x, lane: laneOfX(x), source, armsUp: !!intents.armsUp, target: nearestThreat(s.threats, x) } });
}

function addFuel(s, press, rules) {
  s.fuel = Math.min(rules.fuel_cap_s, s.fuel + rules.fuel_per_step_s);
  s.steps += 1;
  s.events.push({ type: 'fuel.added', data: { source: press?.source || 'mat', fuel: s.fuel, pressAt: press?.at ?? null } });
}

// A bomb: a blast around the lowest threat in the cannon's lane, or with that
// lane clear around the nearest threat, or in the empty sky above the cannon.
// It spends the full power meter. Pods caught in it are destroyed outright
// (no split).
function dropBomb(s, intents, press, level) {
  const { radius, damage } = nukeRules(level);
  const cannonX = aimToX(cannonAims(s, intents.aim, level)[0]);
  const live = s.threats.filter((threat) => threat.type !== 'bomb');
  const lowest = (a, b) => b.y - a.y || a.id - b.id;
  const target = live.filter((threat) => Math.abs(threat.x - cannonX) <= LANE_WIDTH / 2).sort(lowest)[0]
    || [...live].sort((a, b) => Math.abs(a.x - cannonX) - Math.abs(b.x - cannonX) || lowest(a, b))[0];
  const x = target ? target.x : cannonX;
  const y = target ? target.y : BOMB_EMPTY_Y;
  s.weapon.meter = 0;
  s.bombs += 1;
  s.blasts.push({ id: s.nextId++, x, y, radius, ttl: BLAST_S });
  s.events.push({ type: 'bomb', data: { x, y, radius, source: press?.source || 'mat' } });
  const shot = { armsUp: false, tier: 'bomb' };
  for (const threat of [...s.threats]) {
    if (Math.hypot(threat.x - x, threat.y - y) <= radius) damageThreat(s, threat, damage, shot, { splits: false });
  }
}

// Steps buy fuel; fuel runs the stream. Every volley that falls due inside
// this step is fired, so the rate does not drop when steps are long. A stomp
// is a step that also drops the bomb when one is ready. Rapid fire (the
// partner's boost) runs the stream faster and burns no fuel. Returns the
// seconds of this step the stream was firing.
function stream(s, intents, dt, level) {
  const rules = fireRules(level);
  for (const press of intents.steps || []) addFuel(s, press, rules);
  for (const press of intents.stomps || []) {
    addFuel(s, press, rules);
    if (bombReady(s.weapon)) dropBomb(s, intents, press, level);
  }
  const rapid = s.boost.active?.kind === 'rapid';
  const burn = rapid ? dt : Math.min(dt, s.fuel);
  if (!(burn > EPS)) { if (s.fuel <= EPS) s.fuel = 0; s.streamIn = 0; return 0; }
  const interval = Math.max(MIN_AUTO_FIRE_S, rapid ? boostRules(level).rapid_interval_s : rules.stream_interval_s);
  let wait = s.streamIn;
  while (wait < burn - EPS) {
    fireVolley(s, intents, rapid ? 'rapid' : 'stream', level);
    wait += interval;
  }
  s.streamIn = wait - burn;
  if (!rapid) s.fuel = s.fuel - dt > EPS ? s.fuel - dt : 0;
  s.firingS += burn;
  return burn;
}

// Kills and firing time fill the power meter. A full meter moves the weapon
// up a level; at the top it stays full, which is a bomb ready for a stomp.
// A stream left idle for `idle_drop_s` costs a level and whatever the meter held.
function advanceWeapon(s, burn, kills, dt, level) {
  const rules = fireRules(level);
  const weapon = s.weapon;
  const wasReady = bombReady(weapon);
  weapon.meter += kills * rules.power_per_kill + burn * rules.power_per_firing_s;
  if (burn > 0) weapon.idleS = 0;
  else {
    weapon.idleS += dt;
    if (weapon.idleS >= rules.idle_drop_s && (weapon.level > 0 || weapon.meter > 0)) {
      weapon.level = Math.max(0, weapon.level - 1);
      weapon.meter = 0;
      weapon.idleS = 0;
      s.events.push({ type: 'weapon.level', data: { level: weapon.level, tier: weaponTier(weapon), reason: 'idle' } });
    }
  }
  if (weapon.meter < 1) return;
  if (weapon.level < TOP_WEAPON_LEVEL) {
    weapon.level += 1;
    weapon.meter = 0;
    weapon.peak = Math.max(weapon.peak, weapon.level);
    s.events.push({ type: 'weapon.level', data: { level: weapon.level, tier: weaponTier(weapon), reason: 'power' } });
    return;
  }
  weapon.meter = 1;
  if (!wasReady) s.events.push({ type: 'bomb.ready', data: {} });
}

// The partner's cadence fills the meter; a full meter starts the next boost
// in the level's rotation. The meter rests while a boost is running.
function advanceBoost(s, intents, dt, level) {
  const rules = boostRules(level);
  if (s.boost.active) {
    const remaining = s.boost.active.remaining - dt;
    if (remaining > 0) { s.boost.active = { ...s.boost.active, remaining }; return; }
    s.events.push({ type: 'boost.ended', data: { kind: s.boost.active.kind } });
    s.boost.active = null;
    s.streamIn = 0;
    return;
  }
  if (!Number.isFinite(intents.partnerRpm)) return;   // null = no partner
  const effort = Math.min(1, Math.max(0, (intents.partnerRpm - rules.min_rpm) / (rules.full_rpm - rules.min_rpm)));
  s.boost.meter = Math.min(1, s.boost.meter + (effort * dt) / rules.fill_s);
  if (s.boost.meter < 1) return;
  const kind = rules.rotation[s.boost.next % rules.rotation.length];
  s.boost = { meter: 0, next: s.boost.next + 1, used: s.boost.used + 1, active: { kind, remaining: rules.duration_s } };
  s.streamIn = 0;
  s.events.push({ type: 'boost.activated', data: { kind } });
}

// One shot of a volley is done. A volley counts as a hit once, on its first
// shot to land; when its last shot is done the volley is settled.
function settle(s, id, hit) {
  const volley = s.volleys[id];
  if (!volley) return;
  if (hit && !volley.hit) s.hits += 1;
  const next = { live: volley.live - 1, hit: volley.hit || hit };
  if (next.live > 0) { s.volleys[id] = next; return; }
  delete s.volleys[id];
  s.events.push({ type: 'volley.settled', data: { volley: id, hit: next.hit } });
}

// A destroyed pod breaks into drones that leave from where it was and peel apart.
function split(s, target, level) {
  const children = THREATS[target.type].splitsInto || [];
  children.forEach((child, index) => addThreat(s, level, child, clampX(target.x), target.y, { from: 'split', phase: index % 2 ? 0 : Math.PI }));
}

// The combo is a kill streak: each kill extends it, and a threat reaching the
// ground ends it. A stream fires through empty sky all the time, so a missed
// volley costs nothing.
function damageThreat(s, target, amount, shot, { splits = true, level = null } = {}) {
  const hp = target.hp - amount;
  if (hp > 0) {
    s.threats = s.threats.map((t) => (t.id === target.id ? { ...t, hp } : t));
    s.events.push({ type: 'threat.damaged', data: { id: target.id, threat: target.type, x: target.x, y: target.y, hp } });
    return;
  }
  s.threats = s.threats.filter((t) => t.id !== target.id);
  if (THREATS[target.type].countsAsKill !== false) { s.kills += 1; s.combo += 1; s.bestCombo = Math.max(s.bestCombo, s.combo); }
  const points = killPoints(target.type, { combo: s.combo, armsUp: shot.armsUp });
  s.score += points;
  s.events.push({ type: 'threat.destroyed', data: { id: target.id, threat: target.type, x: target.x, y: target.y, points, by: shot.tier } });
  if (splits) split(s, target, level);
}

// sweepHits does not rank, and its `at` is an x contact. A shot flies up, so
// the first threat it meets is the one with the lowest bottom edge (ties: oldest).
function firstHit(s, sweep) {
  const hits = sweepHits(s.threats.map(threatBox), sweep).map((hit) => s.threats[hit.index]);
  return hits.sort((a, b) => threatBox(b).y1 - threatBox(a).y1 || a.id - b.id)[0] || null;
}

function advanceShots(s, dt, level) {
  const kept = [];
  for (const shot of s.shots) {
    const x1 = shot.x + shot.vx * dt;
    const y1 = shot.y - SHOT_SPEED * dt;
    // Sweep the whole path of this step so a thin threat cannot be skipped at
    // a low frame rate.
    const target = firstHit(s, box(Math.min(shot.x, x1) - shot.halfWidth, Math.max(shot.x, x1) + shot.halfWidth, y1, shot.y));
    if (target) {
      settle(s, shot.volley, true);
      damageThreat(s, target, shot.damage, shot, { level });
    } else if (y1 < 0 || x1 < 0 || x1 > FIELD.width) settle(s, shot.volley, false);
    else kept.push({ ...shot, x: x1, y: y1 });
  }
  s.shots = kept;
}

/**
 * The round `dt` seconds later. Returns a new state and leaves `state` alone;
 * returns `state` itself when the round has ended or no time passed.
 *
 * intents: { aim, armsUp, steps: [{ source, at }], stomps: [{ source, at }], partnerRpm }
 * `aim` is 0..1 (0 = screen left), or [aim, aim] on a two-cannon level; the
 * shell passes the centre of the cannon's lane. `steps` are mat steps (or fire
 * buttons): each buys fuel. `stomps` are steps that also drop a ready bomb.
 * `armsUp` only multiplies points. `partnerRpm` null means no partner.
 *
 * Events are appended to `state.events` and never cleared here. A game loop
 * should call stepFrame, which starts each frame with an empty list.
 */
export function step(state, intents, dt, level) {
  if (state.phase !== 'playing' || !(dt > 0)) return state;
  const s = draft(state);
  const killsBefore = s.kills;
  s.time += dt;
  spawn(s, level);
  move(s, dt, level);
  advanceBoost(s, intents, dt, level);
  const burn = stream(s, intents, dt, level);
  advanceShots(s, dt, level);
  advanceWeapon(s, burn, s.kills - killsBefore, dt, level);
  s.blasts = s.blasts.map((blast) => ({ ...blast, ttl: blast.ttl - dt })).filter((blast) => blast.ttl > 0);
  // Keep the timer check last: everything above still happens on the final step.
  if (s.time >= level.duration_s) { s.phase = 'ended'; s.events.push({ type: 'level.ended', data: {} }); }
  return s;
}

/**
 * One animation frame: clears last frame's events, then folds fixed sub-steps
 * so the round plays the same at any frame rate. `intents.steps` and
 * `intents.stomps` are used by the first sub-step only (one press, one tank
 * of fuel); aim stays continuous. A frame with no elapsed time runs no step,
 * so its presses are not counted: hold them for the next frame.
 */
export function stepFrame(state, intents, elapsedS, level) {
  return advance({ ...state, events: [] }, intents, Math.max(0, Number(elapsedS) || 0), {
    step: (st, input, dt) => step(st, input, dt, level),
    stepS: STEP_S, remainder: 'partial', oncePerFrame: ['steps', 'stomps'],
  }).state;
}
