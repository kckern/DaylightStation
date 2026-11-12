// Skyline Invaders simulation. Pure: no DOM, no clocks, no Math.random. All
// randomness is the Mulberry32 state carried in `state.rng`, so a seed and a
// list of inputs replay to the same round.
//
// Time only enters through `dt`, so the round plays the same at any display or
// pose frame rate. Aim arrives as a plain number in the intents and may be a
// few frames old; nothing here assumes it changes every step.
import { nextRandom } from '../../../../../../__capabilities/gaming/portable/mechanics/random.mjs';
import { box, sweepHits } from '../../../../../../__capabilities/gaming/portable/realtime/index.mjs';
import { boostRules, nukeRules } from './rules.js';
import { killPoints } from './scoring.js';
import { FIELD, THREATS, aimToX, clampX, moveThreat, threatBox } from './threats.js';
import { SHOT_TIERS } from './tiers.js';

export { boostRules, nukeRules };

export const STEP_S = 1 / 60;
export const SHOT_SPEED = 900;                 // scene units per second, straight up
export const MUZZLE_Y = FIELD.groundY - 20;
const BUILDINGS = 10;
const BLAST_S = 0.5;                           // how long a nuke blast stays in state for the renderer
const RANGE_X = FIELD.width - 2 * FIELD.marginX;

export function createGameState(level, { seed = 1 } = {}) {
  return {
    phase: 'playing', time: 0, rng: Number(seed) >>> 0, nextId: 1,
    nextSpawnAt: level.waves[0].at,
    threats: [], shots: [], blasts: [], volleys: {},
    base: { hp: 100, maxHp: 100, buildings: Array.from({ length: BUILDINGS }, () => true) },
    score: 0, kills: 0, combo: 0, bestCombo: 0, shotsFired: 0, hits: 0, nukes: 0,
    boost: { meter: 0, next: 0, used: 0, active: null }, autoFireIn: 0,
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
    boost: { ...state.boost }, events: [...state.events],
  };
}

function rand(s) {
  const next = nextRandom(s.rng);
  s.rng = next.state;
  return next.value;
}

// `originX` is the column a zigzag swings around. The threat starts where its
// zigzag is at age 0, so it never jumps sideways on its first step.
function addThreat(s, type, originX, y, { phase = rand(s) * Math.PI * 2 } = {}) {
  const spec = THREATS[type];
  const x = spec.zigzag ? clampX(originX + spec.zigzag.amplitude * Math.sin(phase)) : originX;
  const threat = {
    id: s.nextId++, type, x, y, originX, hp: spec.hp, age: 0,
    phase, dir: rand(s) < 0.5 ? -1 : 1, bombIn: spec.bombEvery_s || 0,
  };
  s.threats.push(threat);
  s.events.push({ type: 'threat.spawned', data: { id: threat.id, threat: type, x } });
  return threat;
}

// The wave in force at `time`, and the one after it (if any).
function wavesAt(level, time) {
  let index = 0;
  level.waves.forEach((wave, i) => { if (wave.at <= time) index = i; });
  return { wave: level.waves[index], next: level.waves[index + 1] || null };
}

function pickType(s, wave) {
  const mix = Object.keys(wave.spawn).sort();   // sorted: the pick must not depend on YAML key order
  const total = mix.reduce((sum, type) => sum + wave.spawn[type], 0);
  let pick = rand(s) * total;
  for (const type of mix) {
    pick -= wave.spawn[type];
    if (pick < 0) return type;
  }
  return mix[mix.length - 1];
}

function spawn(s, level) {
  while (s.time >= s.nextSpawnAt) {
    const { wave, next } = wavesAt(level, s.nextSpawnAt);
    let type = pickType(s, wave);
    if (type === 'bomber' && s.threats.filter((t) => t.type === 'bomber').length >= (level.max_bombers ?? 2)) type = 'meteor';
    addThreat(s, type, FIELD.marginX + rand(s) * RANGE_X, type === 'bomber' ? FIELD.bomberY : FIELD.spawnY);
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

// A threat reached the ground. It costs base HP (and stars); it never ends the round.
function impact(s, threat) {
  const shielded = s.boost.active?.kind === 'shield';
  const damage = shielded ? 0 : THREATS[threat.type].baseDamage || 0;
  let buildings = [];
  if (damage > 0) {
    s.base.hp = Math.max(0, s.base.hp - damage);
    buildings = knockOutBuildings(s, threat.x);
  }
  s.events.push({ type: 'base.hit', data: { threat: threat.type, x: threat.x, damage, shielded, hp: s.base.hp, buildings } });
}

function move(s, dt) {
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
  for (const bomber of droppers) addThreat(s, 'bomb', bomber.x, bomber.y + THREATS.bomber.height / 2);
}

// One aim per cannon: one cannon unless the level has two.
function cannonAims(aim, level) {
  return (Array.isArray(aim) ? aim : [aim]).slice(0, level.cannons === 2 ? 2 : 1);
}

// One press = one volley, however many shots it makes (spread, two cannons).
// Accuracy and the combo are counted per volley, not per shot.
function fireVolley(s, press, level) {
  const spec = SHOT_TIERS[press.tier] || SHOT_TIERS.small;
  const aims = cannonAims(press.aim, level);
  const volley = s.nextId++;
  let live = 0;
  for (const aim of aims) {
    for (const vx of spec.spread) {
      s.shots.push({ id: s.nextId++, volley, x: aimToX(aim), y: MUZZLE_Y, vx, tier: spec.id, damage: spec.damage, halfWidth: spec.halfWidth, armsUp: !!press.armsUp });
      live += 1;
    }
  }
  s.volleys[volley] = { live, hit: false };
  s.shotsFired += 1;
  s.events.push({ type: 'shot.fired', data: { tier: spec.id, aim: aims[0], source: press.source || 'mat', armsUp: !!press.armsUp, pressAt: press.at ?? null } });
}

function fire(s, intents, level) {
  for (const press of intents.fire || []) fireVolley(s, press, level);
}

// One shot of a volley is done. The first hit of a volley extends the combo;
// a volley whose shots all leave the field without a hit breaks it.
function settle(s, id, hit) {
  const volley = s.volleys[id];
  if (!volley) return;
  if (hit && !volley.hit) { s.combo += 1; s.bestCombo = Math.max(s.bestCombo, s.combo); s.hits += 1; }
  const next = { live: volley.live - 1, hit: volley.hit || hit };
  if (next.live > 0) { s.volleys[id] = next; return; }
  delete s.volleys[id];
  if (!next.hit) { s.combo = 0; s.events.push({ type: 'shot.missed', data: {} }); }
}

// A destroyed pod breaks into drones that leave from where it was and peel apart.
function split(s, target) {
  const children = THREATS[target.type].splitsInto || [];
  children.forEach((child, index) => addThreat(s, child, clampX(target.x), target.y, { phase: index % 2 ? 0 : Math.PI }));
}

function damageThreat(s, target, amount, shot, { splits = true } = {}) {
  const hp = target.hp - amount;
  if (hp > 0) {
    s.threats = s.threats.map((t) => (t.id === target.id ? { ...t, hp } : t));
    s.events.push({ type: 'threat.damaged', data: { id: target.id, threat: target.type, x: target.x, y: target.y, hp } });
    return;
  }
  s.threats = s.threats.filter((t) => t.id !== target.id);
  if (THREATS[target.type].countsAsKill !== false) s.kills += 1;
  const points = killPoints(target.type, { combo: s.combo, armsUp: shot.armsUp });
  s.score += points;
  s.events.push({ type: 'threat.destroyed', data: { id: target.id, threat: target.type, x: target.x, y: target.y, points, by: shot.tier } });
  if (splits) split(s, target);
}

// A nuke shot goes off where it meets a threat: a blast around that point,
// not a screen wipe, so aim still matters in the fire zone. Pods caught in it
// are destroyed outright (no split).
function detonate(s, shot, target, level) {
  const { radius, damage } = nukeRules(level);
  const x = shot.x;
  const y = threatBox(target).y1;
  s.nukes += 1;
  s.blasts.push({ id: s.nextId++, x, y, radius, ttl: BLAST_S });
  s.events.push({ type: 'nuke', data: { x, y, radius } });
  for (const threat of [...s.threats]) {
    if (threat.id === target.id || Math.hypot(threat.x - x, threat.y - y) <= radius) damageThreat(s, threat, damage, shot, { splits: false });
  }
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
      if (shot.tier === 'nuke') detonate(s, shot, target, level); else damageThreat(s, target, shot.damage, shot);
    } else if (y1 < 0 || x1 < 0 || x1 > FIELD.width) settle(s, shot.volley, false);
    else kept.push({ ...shot, x: x1, y: y1 });
  }
  s.shots = kept;
}

export function step(state, intents, dt, level) {
  if (state.phase !== 'playing' || !(dt > 0)) return state;
  const s = draft(state);
  s.time += dt;
  spawn(s, level);
  move(s, dt);
  fire(s, intents, level);
  advanceShots(s, dt, level);
  s.blasts = s.blasts.map((blast) => ({ ...blast, ttl: blast.ttl - dt })).filter((blast) => blast.ttl > 0);
  // Keep the timer check last: everything above still happens on the final step.
  if (s.time >= level.duration_s) { s.phase = 'ended'; s.events.push({ type: 'level.ended', data: {} }); }
  return s;
}
