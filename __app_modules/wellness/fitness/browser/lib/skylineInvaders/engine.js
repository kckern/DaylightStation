// Skyline Invaders simulation. Pure: no DOM, no clocks, no Math.random. All
// randomness is the Mulberry32 state carried in `state.rng`, so a seed and a
// list of inputs replay to the same round.
//
// Time only enters through `dt`, so the round plays the same at any display or
// pose frame rate. Aim arrives as a plain number in the intents and may be a
// few frames old; nothing here assumes it changes every step.
import { nextRandom } from '../../../../../../__capabilities/gaming/portable/mechanics/random.mjs';
import { FIELD, THREATS, moveThreat } from './threats.js';

export const STEP_S = 1 / 60;
const BUILDINGS = 10;
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

function addThreat(s, type, x, y) {
  const spec = THREATS[type];
  const threat = {
    id: s.nextId++, type, x, y, originX: x, hp: spec.hp, age: 0,
    phase: rand(s) * Math.PI * 2, dir: rand(s) < 0.5 ? -1 : 1, bombIn: spec.bombEvery_s || 0,
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

export function step(state, intents, dt, level) {
  if (state.phase !== 'playing' || !(dt > 0)) return state;
  const s = draft(state);
  s.time += dt;
  spawn(s, level);
  move(s, dt);
  // Keep the timer check last: everything above still happens on the final step.
  if (s.time >= level.duration_s) { s.phase = 'ended'; s.events.push({ type: 'level.ended', data: {} }); }
  return s;
}
