import { describe, expect, it } from 'vitest';
import { boostRules, createGameState, fireRules, nukeRules, step, stepFrame } from './engine.js';
import { LANES, laneAim, laneX } from './lanes.js';
import { FIELD, THREATS } from './threats.js';
import { LEVEL_SCHEMA } from './levels.js';

const level = (over = {}) => ({
  schema: LEVEL_SCHEMA, id: 'invaders-test', name: 'Test', duration_s: 60, cannons: 1, max_bombers: 2,
  pass: { kills: 3, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }], ...over,
});
const idle = (over = {}) => ({ aim: 0.5, armsUp: false, steps: [], stomps: [], partnerRpm: null, ...over });
const run = (state, lvl, seconds, intents = idle(), dt = 1 / 60) => {
  let next = state;
  for (let t = 0; t < seconds - 1e-9; t += dt) next = step(next, intents, dt, lvl);
  return next;
};
// A round with spawning switched off and a hand-placed set of threats.
const seeded = (lvl, threats = []) => ({ ...createGameState(lvl, { seed: 7 }), nextSpawnAt: 1e9, threats });
const at = (type, x, y, over = {}) => ({ id: 900, type, x, y, originX: x, hp: THREATS[type].hp, age: 0, phase: 0, dir: 1, bombIn: 99, ...over });
const eventsOf = (state, type) => state.events.filter((e) => e.type === type);

describe('engine: state and spawning', () => {
  it('starts a round with a full base and nothing on screen', () => {
    const state = createGameState(level(), { seed: 7 });
    expect(state).toMatchObject({ phase: 'playing', time: 0, threats: [], shots: [], score: 0, kills: 0, combo: 0, base: { hp: 100, maxHp: 100 } });
    expect(state.base.buildings).toHaveLength(10);
    expect(state.base.buildings.every(Boolean)).toBe(true);
  });
  it('spawns one threat per rate_s from the active wave, on a lane centre', () => {
    const state = run(createGameState(level(), { seed: 7 }), level(), 5);
    expect(state.threats.map((t) => t.type)).toEqual(['meteor', 'meteor', 'meteor']); // t = 0, 2, 4
    const centres = Array.from({ length: LANES }, (_, lane) => laneX(lane));
    for (const threat of state.threats) expect(centres).toContain(threat.originX);
    expect(state.events.filter((e) => e.type === 'threat.spawned')).toHaveLength(3);
  });
  it('uses every lane, or only the run of lanes the level names', () => {
    const lvl = level({ duration_s: 900, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 0.3 }] });
    const lanesOf = (l) => new Set(eventsOf(run(createGameState(l, { seed: 5 }), l, 60, idle(), 0.1), 'threat.spawned').map((e) => e.data.x));
    expect(lanesOf(lvl).size).toBe(LANES);
    const middle = lanesOf({ ...lvl, spawn_lanes: [1, 6] });
    expect([...middle].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6].map(laneX));
  });
  it('lets a level set how fast a threat type falls', () => {
    const lvl = level({ fall: { meteor: 50 } });
    const next = step(seeded(lvl, [{ ...at('meteor', 500, 100), fall: 50 }]), idle(), 1, lvl);
    expect(next.threats[0].y).toBeCloseTo(150);
    const spawned = step(createGameState(lvl, { seed: 7 }), idle(), 1 / 60, lvl).threats[0];
    expect(spawned.fall).toBe(50);
    expect(step(createGameState(level(), { seed: 7 }), idle(), 1 / 60, level()).threats[0].fall).toBe(THREATS.meteor.fall);
  });
  it('waits for the first wave', () => {
    const lvl = level({ waves: [{ at: 3, spawn: { meteor: 1 }, rate_s: 2 }] });
    expect(run(createGameState(lvl, { seed: 7 }), lvl, 2.9).threats).toEqual([]);
    expect(run(createGameState(lvl, { seed: 7 }), lvl, 3.1).threats).toHaveLength(1);
  });
  it('switches mix when the next wave starts', () => {
    const lvl = level({ waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }, { at: 4, spawn: { drone: 1 }, rate_s: 2 }] });
    const state = run(createGameState(lvl, { seed: 7 }), lvl, 5);
    expect(state.threats.map((t) => t.type)).toEqual(['meteor', 'meteor', 'drone']);
  });
  it('starts a wave at its own time, not at the previous wave\'s next beat', () => {
    const lvl = level({ waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 10 }, { at: 3, spawn: { drone: 1 }, rate_s: 1 }] });
    const state = run(createGameState(lvl, { seed: 7 }), lvl, 5.5);
    expect(state.threats.map((t) => t.type)).toEqual(['meteor', 'drone', 'drone', 'drone']); // t = 0, 3, 4, 5
  });
  it('picks threats by weight', () => {
    const lvl = level({ duration_s: 900, waves: [{ at: 0, spawn: { meteor: 9, pod: 1 }, rate_s: 0.3 }] });
    const state = run(createGameState(lvl, { seed: 11 }), lvl, 300, idle(), 0.1);
    const spawned = state.events.filter((e) => e.type === 'threat.spawned').map((e) => e.data.threat);
    const pods = spawned.filter((type) => type === 'pod').length / spawned.length;
    expect(Math.abs(spawned.length - 1000)).toBeLessThanOrEqual(1);
    expect(pods).toBeGreaterThan(0.06);
    expect(pods).toBeLessThan(0.14);
  });
  it('is deterministic for a seed and differs across seeds', () => {
    const lvl = level({ waves: [{ at: 0, spawn: { meteor: 1, drone: 1, pod: 1 }, rate_s: 0.5 }] });
    const a = run(createGameState(lvl, { seed: 42 }), lvl, 10);
    const b = run(createGameState(lvl, { seed: 42 }), lvl, 10);
    const c = run(createGameState(lvl, { seed: 43 }), lvl, 10);
    expect(a).toEqual(b);
    expect(a.threats.map((t) => [t.type, t.originX])).not.toEqual(c.threats.map((t) => [t.type, t.originX]));
  });
  it('spawns the same sequence at 13 frames per second as at 60', () => {
    const lvl = level({ waves: [{ at: 0, spawn: { meteor: 1, drone: 1, pod: 1 }, rate_s: 0.5 }] });
    const spawned = (dt) => run(createGameState(lvl, { seed: 42 }), lvl, 10.2, idle(), dt)
      .events.filter((e) => e.type === 'threat.spawned').map((e) => [e.data.threat, e.data.x]);
    expect(spawned(1 / 13)).toEqual(spawned(1 / 60));
    expect(spawned(1 / 13)).toHaveLength(21);
  });
  it('caps bombers and spawns a meteor in their place', () => {
    const lvl = level({ max_bombers: 1, waves: [{ at: 0, spawn: { bomber: 1 }, rate_s: 1 }] });
    const state = run(createGameState(lvl, { seed: 7 }), lvl, 2.5);
    expect(state.threats.filter((t) => t.type === 'bomber')).toHaveLength(1);
    expect(state.threats.filter((t) => t.type === 'meteor').length).toBeGreaterThan(0);
  });
  it('does nothing once ended, and for a zero-length step', () => {
    const state = createGameState(level(), { seed: 7 });
    expect(step(state, idle(), 0, level())).toBe(state);
    const ended = { ...state, phase: 'ended' };
    expect(step(ended, idle(), 1, level())).toBe(ended);
  });
  it('never changes the state it was given', () => {
    const lvl = level();
    const before = run(createGameState(lvl, { seed: 7 }), lvl, 3);
    const copy = JSON.parse(JSON.stringify(before));
    step(before, idle(), 1 / 60, lvl);
    expect(JSON.parse(JSON.stringify(before))).toEqual(copy);
  });
});

describe('engine: movement and the base', () => {
  it('moves threats down each step', () => {
    const next = step(seeded(level(), [at('meteor', 500, 100)]), idle(), 1, level());
    expect(next.threats[0].y).toBeCloseTo(100 + THREATS.meteor.fall);
  });
  it('a threat reaching the ground damages the base, knocks out the nearest building and never ends the round', () => {
    const next = step(seeded(level(), [at('meteor', 500, FIELD.groundY - 1)]), idle(), 0.1, level());
    expect(next.threats).toEqual([]);
    expect(next.base.hp).toBe(100 - THREATS.meteor.baseDamage);
    expect(next.base.buildings.filter(Boolean)).toHaveLength(9);
    expect(next.phase).toBe('playing');
    expect(next.events).toContainEqual({ type: 'base.hit', data: expect.objectContaining({ threat: 'meteor', damage: THREATS.meteor.baseDamage, hp: 90 }) });
  });
  it('knocks out the building under the impact, then its nearest standing neighbour', () => {
    const lvl = level();
    const landAt = (state, x, id) => step({ ...state, threats: [at('meteor', x, FIELD.groundY - 1, { id })] }, idle(), 0.1, lvl);
    const first = landAt(seeded(lvl), FIELD.marginX + 1, 1);
    expect(first.base.buildings.indexOf(false)).toBe(0);
    const second = landAt(first, FIELD.marginX + 1, 2);
    expect(second.base.buildings.slice(0, 3)).toEqual([false, false, true]);
    const far = landAt(seeded(lvl), FIELD.width - FIELD.marginX, 3);
    expect(far.base.buildings.indexOf(false)).toBe(9);
    expect(eventsOf(far, 'base.hit')[0].data.buildings).toEqual([9]);
  });
  it('keeps the standing buildings in step with base HP', () => {
    const lvl = level();
    const pod = step(seeded(lvl, [at('pod', 500, FIELD.groundY - 1)]), idle(), 0.1, lvl);   // 20 damage
    expect([pod.base.hp, pod.base.buildings.filter(Boolean).length]).toEqual([80, 8]);
    const bomb = step(seeded(lvl, [at('bomb', 500, FIELD.groundY - 1)]), idle(), 0.1, lvl); // 15 damage
    expect([bomb.base.hp, bomb.base.buildings.filter(Boolean).length]).toEqual([85, 9]);
    const again = step({ ...bomb, threats: [at('bomb', 500, FIELD.groundY - 1)] }, idle(), 0.1, lvl);
    expect([again.base.hp, again.base.buildings.filter(Boolean).length]).toEqual([70, 7]);
  });
  it('never drops base HP below zero', () => {
    let state = seeded(level(), []);
    for (let i = 0; i < 15; i += 1) state = step({ ...state, threats: [at('pod', 500, FIELD.groundY - 1, { id: 900 + i })] }, idle(), 0.1, level());
    expect(state.base.hp).toBe(0);
    expect(state.base.buildings.some(Boolean)).toBe(false);
    expect(state.phase).toBe('playing');
  });
  it('a bomber drops a bomb on its timer and the bomb falls onto the base', () => {
    const lvl = level();
    let state = seeded(lvl, [at('bomber', 500, FIELD.bomberY, { bombIn: 0.05 })]);
    state = step(state, idle(), 0.1, lvl);
    expect(state.threats.map((t) => t.type).sort()).toEqual(['bomb', 'bomber']);
    state = run(state, lvl, 5);
    expect(state.base.hp).toBeLessThan(100);
    expect(state.threats.some((t) => t.type === 'bomber')).toBe(true);
  });
  it('a bomber keeps its bombing rhythm at a low frame rate', () => {
    const lvl = level();
    const bombs = (dt) => eventsOf(run(seeded(lvl, [at('bomber', 500, FIELD.bomberY, { bombIn: 4 })]), lvl, 13, idle(), dt), 'threat.spawned').length;
    expect(bombs(1 / 60)).toBe(3); // t = 4, 8, 12
    expect(bombs(1 / 13)).toBe(3);
  });
  it('lands a falling threat at the same moment at 13 frames per second as at 60', () => {
    const lvl = level();
    const landedAt = (dt) => {
      let state = seeded(lvl, [at('meteor', 500, 100)]);
      for (let i = 0; i < 2000 && !eventsOf(state, 'base.hit').length; i += 1) state = step(state, idle(), dt, lvl);
      return eventsOf(state, 'base.hit').length ? state.time : NaN;
    };
    const exact = (FIELD.groundY - 100) / THREATS.meteor.fall;
    expect(landedAt(1 / 60)).toBeGreaterThanOrEqual(exact - 1e-9);
    expect(landedAt(1 / 60) - exact).toBeLessThanOrEqual(1 / 60 + 1e-9);
    expect(landedAt(1 / 13) - exact).toBeLessThanOrEqual(1 / 13 + 1e-9);
  });
  it('ends the round when the timer runs out, exactly once', () => {
    const lvl = level({ duration_s: 30 });
    const state = run({ ...createGameState(lvl, { seed: 7 }), nextSpawnAt: 1e9 }, lvl, 30.1);
    expect(state.phase).toBe('ended');
    expect(eventsOf(state, 'level.ended')).toHaveLength(1);
  });
});

const STEP = { source: 'mat', at: null };
// Enough fuel for exactly one volley, then the round runs on.
const oneVolley = (state, lvl, intents = idle(), seconds = 1, dt = 1 / 60) => run({ ...state, fuel: 0.01 }, lvl, seconds, intents, dt);
const armed = (state, level_, meter = 0) => ({ ...state, weapon: { level: level_, meter, idleS: 0, peak: level_ } });
const aimAt = (x) => (x - FIELD.marginX) / (FIELD.width - 2 * FIELD.marginX);

describe('engine: fuel and the stream', () => {
  it('a step buys 1.5 s of fuel and the tank holds 5 s', () => {
    const lvl = level();
    const rules = fireRules(lvl);
    expect(rules).toMatchObject({ fuel_per_step_s: 1.5, fuel_cap_s: 5, stream_interval_s: 0.25 });
    const one = step(seeded(lvl), idle({ steps: [STEP] }), 1 / 60, lvl);
    expect(one.fuel).toBeCloseTo(1.5 - 1 / 60);
    expect(one.steps).toBe(1);
    expect(eventsOf(one, 'fuel.added')).toEqual([{ type: 'fuel.added', data: { source: 'mat', fuel: 1.5, pressAt: null } }]);
    const spam = step(seeded(lvl), idle({ steps: Array.from({ length: 9 }, () => STEP) }), 1 / 60, lvl);
    expect(spam.fuel).toBeCloseTo(5 - 1 / 60);
    expect(spam.steps).toBe(9);
  });
  it('fires nothing without fuel', () => {
    const lvl = level();
    const state = run(seeded(lvl), lvl, 3);
    expect(state).toMatchObject({ shotsFired: 0, fuel: 0, firingS: 0 });
  });
  it('streams four volleys a second while there is fuel, the first on the step itself', () => {
    const lvl = level();
    const first = step(seeded(lvl), idle({ steps: [STEP] }), 1 / 60, lvl);
    expect(first.shotsFired).toBe(1);
    const done = run(first, lvl, 3);
    expect(done.shotsFired).toBe(6);         // t = 0, 0.25 .. 1.25
    expect(done.fuel).toBe(0);
    expect(done.firingS).toBeCloseTo(1.5);
    expect(eventsOf(done, 'shot.fired').every((e) => e.data.source === 'stream')).toBe(true);
  });
  it('spamming the mat only fills the tank: twenty steps fire for five seconds', () => {
    const lvl = level();
    const done = run(step(seeded(lvl), idle({ steps: Array.from({ length: 20 }, () => STEP) }), 1 / 60, lvl), lvl, 8);
    expect(done.shotsFired).toBe(20);
    expect(done.firingS).toBeCloseTo(5);
  });
  it('keeps its rate at a low frame rate', () => {
    const lvl = level();
    const shots = (dt) => run({ ...seeded(lvl), fuel: 2 }, lvl, 4, idle(), dt).shotsFired;
    expect(shots(1 / 60)).toBe(8);
    expect(shots(1 / 13)).toBe(8);
    expect(shots(0.5)).toBe(8);
  });
  it('lets a level set its own fuel and stream rules', () => {
    const lvl = level({ fire: { fuel_per_step_s: 1, stream_interval_s: 0.5 } });
    expect(run(step(seeded(lvl), idle({ steps: [STEP] }), 1 / 60, lvl), lvl, 3).shotsFired).toBe(2);
  });
  it('fires from where the cannon is: the continuous aim, on every volley', () => {
    const lvl = level();
    let state = step({ ...seeded(lvl), fuel: 1 }, idle({ aim: laneAim(1) }), 1 / 60, lvl);
    expect(state.shots[0].x).toBeCloseTo(laneX(1));
    state = run(state, lvl, 0.3, idle({ aim: laneAim(6) }));
    expect(state.shots[state.shots.length - 1].x).toBeCloseTo(laneX(6));
  });
  it('reports each volley with its lane, source and the nearest threat', () => {
    const lvl = level();
    const first = step({ ...seeded(lvl, [at('meteor', 600, 200)]), fuel: 0.01 }, idle({ aim: 0.5, armsUp: true }), 1 / 60, lvl);
    expect(eventsOf(first, 'shot.fired')).toEqual([{ type: 'shot.fired', data: {
      volley: expect.any(Number), tier: 'small', aim: 0.5, x: 500, lane: 4, source: 'stream', armsUp: true,
      target: { id: 900, type: 'meteor', x: 600, y: expect.any(Number), miss: 100 },
    } }]);
    expect(eventsOf(step({ ...seeded(lvl), fuel: 0.01 }, idle(), 1 / 60, lvl), 'shot.fired')[0].data.target).toBeNull();
  });
  it('settles every volley as a hit or a miss', () => {
    const lvl = level();
    const hit = oneVolley(seeded(lvl, [at('meteor', 500, 200)]), lvl);
    expect(eventsOf(hit, 'volley.settled')).toEqual([{ type: 'volley.settled', data: { volley: expect.any(Number), hit: true } }]);
    const miss = oneVolley(seeded(lvl, [at('meteor', 800, 200)]), lvl);
    expect(eventsOf(miss, 'volley.settled')[0].data.hit).toBe(false);
    expect(miss).toMatchObject({ shotsFired: 1, hits: 0, volleys: {} });
  });
});

describe('engine: hits', () => {
  it('a volley kills a meteor in its column and scores', () => {
    const lvl = level();
    const done = oneVolley(seeded(lvl, [at('meteor', 500, 200)]), lvl);
    expect(done).toMatchObject({ kills: 1, hits: 1, combo: 1, bestCombo: 1, score: 11, shots: [] }); // 10 pts x 1.1 (streak 1)
    expect(done.threats).toEqual([]);
    expect(eventsOf(done, 'threat.destroyed')).toEqual([{ type: 'threat.destroyed', data: expect.objectContaining({ id: 900, threat: 'meteor', points: 11, by: 'small' }) }]);
  });
  it('a pod survives one small shot, then splits into two drones when destroyed', () => {
    const lvl = level();
    const once = oneVolley(seeded(lvl, [at('pod', 500, 200)]), lvl);
    expect(once.threats.map((t) => [t.type, t.hp])).toEqual([['pod', 1]]);
    expect(eventsOf(once, 'threat.damaged')).toHaveLength(1);
    expect(once).toMatchObject({ kills: 0, hits: 1, combo: 0 });
    const twice = oneVolley(once, lvl, idle({ aim: aimAt(once.threats[0].x) }));
    expect(twice.threats.map((t) => t.type)).toEqual(['drone', 'drone']);
    expect(twice.kills).toBe(1);
  });
  it('the two drones leave the pod from where it was and peel apart', () => {
    const lvl = level();
    let state = step({ ...seeded(lvl, [at('pod', 500, 300, { hp: 1 })]), fuel: 0.01 }, idle(), 1 / 60, lvl);
    for (let i = 0; i < 60 && state.threats[0].type === 'pod'; i += 1) state = step(state, idle(), 1 / 60, lvl);
    expect(state.threats.map((t) => [t.type, t.x])).toEqual([['drone', 500], ['drone', 500]]);
    const later = run(state, lvl, 0.25);
    const [left, right] = later.threats.map((t) => t.x);
    expect(left).toBeLessThan(480);
    expect(right).toBeGreaterThan(520);
    expect(500 - left).toBeCloseTo(right - 500);
  });
  it('a spawned drone starts on its zigzag path instead of jumping onto it', () => {
    const lvl = level({ waves: [{ at: 0, spawn: { drone: 1 }, rate_s: 30 }] });
    for (const seed of [5, 6, 7, 8]) {
      const first = step(createGameState(lvl, { seed }), idle(), 1 / 60, lvl);
      const spawnedAt = eventsOf(first, 'threat.spawned')[0].data.x;
      expect(Math.abs(first.threats[0].x - spawnedAt)).toBeLessThan(6); // top zigzag speed is ~283 units/s
    }
  });
  it('hits the lowest threat in the column first, and is spent on it', () => {
    const lvl = level();
    const done = oneVolley(seeded(lvl, [at('meteor', 500, 100, { id: 1 }), at('meteor', 500, 300, { id: 2 })]), lvl);
    expect(done.threats.map((t) => t.id)).toEqual([1]);
    expect(done.kills).toBe(1);
  });
  it('still hits at a low frame rate: the shot path is swept, not sampled', () => {
    const lvl = level();
    for (const dt of [1 / 13, 0.1]) {
      const done = oneVolley(seeded(lvl, [at('bomb', 500, 300)]), lvl, idle(), 1, dt); // the thinnest target
      expect(done.threats).toEqual([]);
      expect(done.hits).toBe(1);
    }
  });
  it('the combo is a kill streak: kills build it and the points, a missed volley costs nothing', () => {
    const lvl = level();
    let state = seeded(lvl, [at('meteor', 300, 200, { id: 1 }), at('meteor', 500, 200, { id: 2 }), at('meteor', 700, 200, { id: 3 })]);
    for (const x of [300, 500, 60, 700]) state = oneVolley(state, lvl, idle({ aim: aimAt(x) }), 0.7);
    expect(state).toMatchObject({ kills: 3, combo: 3, bestCombo: 3, score: 11 + 12 + 13, shotsFired: 4, hits: 3 });
  });
  it('a threat reaching the ground ends the streak; a shielded one does not', () => {
    const lvl = level();
    const streak = { ...seeded(lvl, [at('meteor', 500, FIELD.groundY - 1)]), combo: 5, bestCombo: 5 };
    expect(step(streak, idle(), 0.1, lvl)).toMatchObject({ combo: 0, bestCombo: 5 });
    const shielded = { ...streak, boost: { meter: 0, next: 1, used: 1, active: { kind: 'shield', remaining: 8 } } };
    expect(step(shielded, idle(), 0.1, lvl).combo).toBe(5);
  });
  it('arms-up shots score x1.5 and are never needed to hit', () => {
    const lvl = level();
    expect(oneVolley(seeded(lvl, [at('meteor', 500, 200)]), lvl, idle({ armsUp: true })).score).toBe(17); // round(10 x 1.1 x 1.5)
    expect(oneVolley(seeded(lvl, [at('meteor', 500, 200)]), lvl).kills).toBe(1);
  });
  it('shooting a bomb scores but is not a kill and does not extend the streak', () => {
    const lvl = level();
    const done = oneVolley(seeded(lvl, [at('bomb', 500, 300)]), lvl);
    expect(done).toMatchObject({ kills: 0, combo: 0 });
    expect(done.score).toBeGreaterThan(0);
  });
  it('a level with two cannons fires one shot per cannon in each volley', () => {
    const lvl = level({ cannons: 2 });
    const first = step({ ...seeded(lvl), fuel: 0.01 }, idle({ aim: [0.2, 0.8] }), 1 / 60, lvl);
    expect(first.shots.map((s) => Math.round(s.x))).toEqual([236, 764]);
    expect(first.shotsFired).toBe(1);
    const single = step({ ...seeded(level()), fuel: 0.01 }, idle({ aim: [0.2, 0.8] }), 1 / 60, level());
    expect(single.shots.map((s) => Math.round(s.x))).toEqual([236]);
  });
});

describe('engine: power meter and weapon levels', () => {
  it('fills with firing time and with kills', () => {
    const lvl = level();
    const fired = run({ ...seeded(lvl), fuel: 5 }, lvl, 5);
    expect(fired.weapon.meter).toBeCloseTo(5 * 0.03);
    const killed = oneVolley(seeded(lvl, [at('meteor', 500, 200)]), lvl);
    expect(killed.weapon.meter).toBeCloseTo(0.08 + 0.01 * 0.03);
  });
  it('fills at the same pace at 13 frames per second as at 60', () => {
    const lvl = level();
    const meter = (dt) => run({ ...seeded(lvl), fuel: 4 }, lvl, 4, idle(), dt).weapon.meter;
    expect(meter(1 / 13)).toBeCloseTo(meter(1 / 60), 3);
  });
  it('a full meter moves the weapon up: single, double, spread', () => {
    const lvl = level();
    const up = step({ ...armed(seeded(lvl), 0, 0.999), fuel: 1 }, idle(), 0.1, lvl);
    expect(up.weapon).toMatchObject({ level: 1, meter: 0, peak: 1 });
    expect(eventsOf(up, 'weapon.level')).toEqual([{ type: 'weapon.level', data: { level: 1, tier: 'double', reason: 'power' } }]);
    const top = step({ ...armed(seeded(lvl), 1, 0.999), fuel: 1 }, idle(), 0.1, lvl);
    expect(top.weapon).toMatchObject({ level: 2, meter: 0, peak: 2 });
  });
  it('double fires two side-by-side shots and spread fans three, each one volley', () => {
    const lvl = level();
    const double = step({ ...armed(seeded(lvl), 1), fuel: 0.01 }, idle(), 1 / 60, lvl);
    expect(double.shots.map((s) => [s.x, s.vx, s.tier])).toEqual([[486, 0, 'double'], [514, 0, 'double']]);
    expect(double.shotsFired).toBe(1);
    const spread = step({ ...armed(seeded(lvl), 2), fuel: 0.01 }, idle(), 1 / 60, lvl);
    expect(spread.shots.map((s) => s.vx)).toEqual([-150, 0, 150]);
    expect(spread.shotsFired).toBe(1);
  });
  it('a double volley takes a pod down in one beat and counts as one hit', () => {
    const lvl = level();
    const done = oneVolley(armed(seeded(lvl, [at('pod', 500, 200)]), 1), lvl);
    expect(done.threats.map((t) => t.type)).toEqual(['drone', 'drone']);
    expect(done).toMatchObject({ kills: 1, hits: 1 });
  });
  it('at the top the meter stays full: a bomb is ready, announced once', () => {
    const lvl = level();
    let state = step({ ...armed(seeded(lvl), 2, 0.999), fuel: 5 }, idle(), 0.1, lvl);
    expect(state.weapon).toMatchObject({ level: 2, meter: 1 });
    expect(eventsOf(state, 'bomb.ready')).toHaveLength(1);
    state = run(state, lvl, 2);
    expect(state.weapon.meter).toBe(1);
    expect(eventsOf(state, 'bomb.ready')).toHaveLength(1);
  });
  it('an idle stream costs a level and the meter after eight seconds, and again after eight more', () => {
    const lvl = level();
    const start = armed(seeded(lvl), 2, 0.6);
    expect(run(start, lvl, 7.9).weapon).toMatchObject({ level: 2, meter: 0.6 });
    const dropped = run(start, lvl, 8.1);
    expect(dropped.weapon).toMatchObject({ level: 1, meter: 0 });
    expect(eventsOf(dropped, 'weapon.level')).toEqual([{ type: 'weapon.level', data: { level: 1, tier: 'double', reason: 'idle' } }]);
    expect(run(start, lvl, 16.2).weapon.level).toBe(0);
    expect(run(start, lvl, 40).weapon).toMatchObject({ level: 0, meter: 0, peak: 2 });
  });
  it('firing resets the idle clock', () => {
    const lvl = level();
    let state = run(armed(seeded(lvl), 1, 0.2), lvl, 7);
    state = run(step(state, idle({ steps: [STEP] }), 1 / 60, lvl), lvl, 7);
    expect(state.weapon.level).toBe(1);
  });
});

describe('engine: stomp bomb', () => {
  const STOMP = { source: 'mat', at: null };
  const ready = (lvl, threats) => armed(seeded(lvl, threats), 2, 1);

  it('a stomp with a full meter at the top blasts the lowest threat in the cannon lane and spends the meter', () => {
    const lvl = level();
    const sky = [at('meteor', laneX(4), 150, { id: 1 }), at('meteor', laneX(4), 300, { id: 2 }), at('meteor', laneX(5), 330, { id: 3 }), at('meteor', laneX(0), 300, { id: 4 })];
    const done = step(ready(lvl, sky), idle({ aim: laneAim(4), stomps: [STOMP] }), 1 / 60, lvl);
    expect(eventsOf(done, 'bomb')).toEqual([{ type: 'bomb', data: { x: laneX(4), y: expect.any(Number), radius: 160, source: 'mat' } }]);
    expect(done.threats.map((t) => t.id)).toEqual([4]);          // everything within 160 of threat 2 is gone
    expect(done).toMatchObject({ bombs: 1, kills: 3 });
    expect(done.weapon.level).toBe(2);
    expect(done.weapon.meter).toBeLessThan(0.5);                 // spent, then the three kills start the next one
    expect(done.blasts).toHaveLength(1);
    expect(eventsOf(done, 'threat.destroyed').map((e) => e.data.by)).toEqual(['bomb', 'bomb', 'bomb']);
  });
  it('with the lane clear it goes off on the nearest threat, and in the empty sky above the cannon with none', () => {
    const lvl = level();
    const near = step(ready(lvl, [at('meteor', laneX(6), 200, { id: 1 }), at('meteor', laneX(0), 200, { id: 2 })]), idle({ aim: laneAim(4), stomps: [STOMP] }), 1 / 60, lvl);
    expect(eventsOf(near, 'bomb')[0].data.x).toBe(laneX(6));
    expect(near.threats.map((t) => t.id)).toEqual([2]);
    const empty = step(ready(lvl, []), idle({ aim: laneAim(2), stomps: [STOMP] }), 1 / 60, lvl);
    expect(eventsOf(empty, 'bomb')[0].data).toMatchObject({ x: laneX(2), y: 250 });
    expect(empty.bombs).toBe(1);
  });
  it('a stomp without a ready bomb is a step: it buys fuel and drops nothing', () => {
    const lvl = level();
    for (const state of [armed(seeded(lvl), 2, 0.9), armed(seeded(lvl), 1, 0.99), seeded(lvl)]) {
      const done = step(state, idle({ stomps: [STOMP] }), 1 / 60, lvl);
      expect(done).toMatchObject({ bombs: 0, steps: 1, blasts: [] });
      expect(done.fuel).toBeGreaterThan(1.4);
    }
  });
  it('a stomp that drops a bomb also buys fuel, and one bomb is one stomp', () => {
    const lvl = level();
    const done = step(ready(lvl, []), idle({ stomps: [STOMP, STOMP] }), 1 / 60, lvl);
    expect(done).toMatchObject({ bombs: 1, steps: 2 });
  });
  it('a full-health bomber survives one bomb; a pod is destroyed without splitting', () => {
    const lvl = level();
    const done = step(ready(lvl, [at('pod', 500, 200, { id: 1 }), at('bomber', 520, 90, { id: 2 })]), idle({ stomps: [STOMP] }), 1 / 60, lvl);
    expect(done.threats.map((t) => [t.type, t.hp])).toEqual([['bomber', 1]]);
  });
  it('reads radius and damage from the level', () => {
    const lvl = level({ nuke: { radius: 30, damage: 4 } });
    const done = step(ready(lvl, [at('bomber', 500, 90, { id: 1 }), at('meteor', 600, 90, { id: 2 })]), idle({ stomps: [STOMP] }), 1 / 60, lvl);
    expect(done.threats.map((t) => t.id)).toEqual([2]);
  });
  it('leaves a short-lived blast for the renderer', () => {
    const lvl = level();
    const first = step(ready(lvl, [at('meteor', 500, 300, { id: 1 })]), idle({ stomps: [STOMP] }), 1 / 60, lvl);
    expect(first.blasts[0]).toMatchObject({ x: 500, radius: 160 });
    expect(run(first, lvl, 1).blasts).toEqual([]);
  });
});

describe('engine: partner boost', () => {
  const boosted = (lvl, kind, over = {}) => ({ ...seeded(lvl), boost: { meter: 0, next: 1, used: 1, active: { kind, remaining: 8 } }, ...over });

  it('re-exports the level rules it plays by', () => {
    expect(boostRules(level()).rotation).toEqual(['rapid', 'shield', 'twin']);
    expect(nukeRules(level())).toEqual({ radius: 160, damage: 3 });
  });
  it('has no meter movement without a partner', () => {
    const lvl = level();
    expect(run(seeded(lvl), lvl, 10, idle({ partnerRpm: null })).boost.meter).toBe(0);
  });
  it('fills with cadence and fires the boosts in rotation', () => {
    const lvl = level({ duration_s: 300 });
    const rules = boostRules(lvl);
    let state = run(seeded(lvl), lvl, rules.fill_s + 0.1, idle({ partnerRpm: rules.full_rpm }));
    expect(state.boost.active).toMatchObject({ kind: 'rapid' });
    expect(state.boost.meter).toBe(0);
    expect(eventsOf(state, 'boost.activated')).toEqual([{ type: 'boost.activated', data: { kind: 'rapid' } }]);
    state = run(state, lvl, rules.duration_s + rules.fill_s + 0.2, idle({ partnerRpm: rules.full_rpm }));
    expect(state.boost.active).toMatchObject({ kind: 'shield' });
    expect(state.boost.used).toBe(2);
    expect(eventsOf(state, 'boost.ended')).toEqual([{ type: 'boost.ended', data: { kind: 'rapid' } }]);
  });
  it('fills in proportion to effort between the minimum and full cadence', () => {
    const lvl = level();
    const rules = boostRules(lvl);
    const half = (rules.min_rpm + rules.full_rpm) / 2;
    expect(run(seeded(lvl), lvl, rules.fill_s / 2, idle({ partnerRpm: half })).boost.meter).toBeCloseTo(0.25, 2);
    expect(run(seeded(lvl), lvl, rules.fill_s / 2, idle({ partnerRpm: rules.full_rpm * 3 })).boost.meter).toBeCloseTo(0.5, 2);
  });
  it('fills at the same pace at 13 frames per second as at 60', () => {
    const lvl = level();
    const meter = (dt) => run(seeded(lvl), lvl, 10, idle({ partnerRpm: 90 }), dt).boost.meter;
    expect(meter(1 / 13)).toBeCloseTo(meter(1 / 60), 2);
  });
  it('does not fill below the minimum cadence, nor while a boost is active', () => {
    const lvl = level();
    const rules = boostRules(lvl);
    expect(run(seeded(lvl), lvl, 30, idle({ partnerRpm: rules.min_rpm })).boost.meter).toBe(0);
    expect(run(boosted(lvl, 'shield'), lvl, 5, idle({ partnerRpm: rules.full_rpm })).boost.meter).toBe(0);
  });
  it('ignores a cadence that is not a number', () => {
    const lvl = level();
    for (const junk of [NaN, undefined, 'fast']) expect(run(seeded(lvl), lvl, 5, idle({ partnerRpm: junk })).boost.meter).toBe(0);
  });
  it('uses the fill time, duration and rotation the level sets', () => {
    const lvl = level({ boost: { fill_s: 2, duration_s: 1, rotation: ['twin'] } });
    const state = run(seeded(lvl), lvl, 2.1, idle({ partnerRpm: 200 }));
    expect(state.boost.active).toMatchObject({ kind: 'twin' });
    expect(run(state, lvl, 1.1).boost.active).toBeNull();
  });
  it('rapid fire runs the stream at twice the rate, at the live aim, and burns no fuel', () => {
    const lvl = level();
    const state = run({ ...boosted(lvl, 'rapid'), fuel: 3 }, lvl, 1, idle({ aim: 0.25 }));
    expect(state.shotsFired).toBe(8);
    expect(state.fuel).toBe(3);
    expect(eventsOf(state, 'shot.fired').every((e) => e.data.source === 'rapid' && e.data.aim === 0.25)).toBe(true);
    expect(run(boosted(lvl, 'rapid'), lvl, 1).shotsFired).toBe(8);   // with an empty tank too
  });
  it('rapid fire keeps its rate at a low frame rate', () => {
    const lvl = level();
    const shots = (dt) => run(boosted(lvl, 'rapid'), lvl, 2, idle(), dt).shotsFired;
    expect(shots(1 / 60)).toBe(16); // every 0.125 s, the first on the first step
    expect(shots(1 / 13)).toBe(16);
    expect(shots(0.5)).toBe(16);    // slower than the fire interval: no shots are lost
  });
  it('caps the auto-fire rate, so a level with a tiny interval cannot stall a step', () => {
    const lvl = level({ boost: { rapid_interval_s: 1e-12 }, fire: { stream_interval_s: 1e-12 } });
    expect(run(boosted(lvl, 'rapid'), lvl, 1).shotsFired).toBe(20); // at most one every 0.05 s
    expect(run({ ...seeded(lvl), fuel: 1 }, lvl, 2).shotsFired).toBe(20);
  });
  it('stops auto-firing when the rapid boost runs out', () => {
    const lvl = level();
    const state = run(boosted(lvl, 'rapid', { boost: { meter: 0, next: 1, used: 1, active: { kind: 'rapid', remaining: 1 } } }), lvl, 3);
    expect(state.boost.active).toBeNull();
    expect(state.shotsFired).toBe(8);
  });
  it('a shield absorbs ground impacts', () => {
    const lvl = level();
    const state = step({ ...boosted(lvl, 'shield'), threats: [at('meteor', 500, FIELD.groundY - 1)] }, idle(), 0.1, lvl);
    expect(state.base.hp).toBe(100);
    expect(state.base.buildings.every(Boolean)).toBe(true);
    expect(state.threats).toEqual([]);
    expect(eventsOf(state, 'base.hit')[0].data).toMatchObject({ shielded: true, damage: 0, hp: 100 });
  });
  it('a twin boost adds a mirrored cannon', () => {
    const lvl = level();
    const state = step({ ...boosted(lvl, 'twin'), fuel: 0.01 }, idle({ aim: 0.2 }), 1 / 60, lvl);
    expect(state.shots.map((s) => Math.round(s.x))).toEqual([236, 764]);
    expect(state.shotsFired).toBe(1);
  });
});

describe('stepFrame', () => {
  it('counts a step once however many sub-steps the frame takes, and keeps every sub-step event', () => {
    const lvl = level();
    const state = stepFrame(seeded(lvl), idle({ steps: [STEP] }), 0.1, lvl);
    expect(state.steps).toBe(1);
    expect(state.fuel).toBeCloseTo(1.4);
    expect(state.time).toBeCloseTo(0.1);
    expect(eventsOf(state, 'fuel.added')).toHaveLength(1);
    expect(eventsOf(state, 'shot.fired')).toHaveLength(1);
  });
  it('drops one bomb for one stomp however many sub-steps the frame takes', () => {
    const lvl = level();
    const state = stepFrame(armed(seeded(lvl), 2, 1), idle({ stomps: [STEP] }), 0.1, lvl);
    expect(state).toMatchObject({ bombs: 1, steps: 1 });
  });
  it('starts each frame with an empty event list', () => {
    const lvl = level();
    const first = stepFrame(createGameState(lvl, { seed: 7 }), idle(), 0.05, lvl);
    expect(first.events.some((e) => e.type === 'threat.spawned')).toBe(true);
    expect(stepFrame(first, idle(), 0.05, lvl).events).toEqual([]);
  });
  it('does not change the intents it was given', () => {
    const lvl = level();
    const intents = idle({ steps: [STEP], stomps: [STEP] });
    stepFrame(seeded(lvl), intents, 0.1, lvl);
    expect(intents.steps).toHaveLength(1);
    expect(intents.stomps).toHaveLength(1);
  });
  it('plays the same round from 13 Hz frames as from 60 Hz frames', () => {
    const lvl = level({ waves: [{ at: 0, spawn: { meteor: 2, drone: 1, pod: 1, bomber: 1 }, rate_s: 1 }] });
    // The same steps at the same round times, delivered on different frame grids.
    const play = (fps) => {
      let state = createGameState(lvl, { seed: 9 });
      let stepped = 0;
      const spawned = [];
      for (let i = 1; i <= Math.round(20 * fps); i += 1) {
        const due = Math.floor((i / fps) / 1.5);
        const steps = due > stepped ? [STEP] : [];
        stepped = due;
        state = stepFrame(state, idle({ steps }), 1 / fps, lvl);
        spawned.push(...eventsOf(state, 'threat.spawned').filter((e) => e.data.from === 'wave').map((e) => e.data.x));
      }
      return { state, spawned };
    };
    const slow = play(13);
    const fast = play(60);
    expect(slow.state.time).toBeCloseTo(fast.state.time, 6);
    expect(slow.state.steps).toBe(fast.state.steps);
    expect(Math.abs(slow.state.shotsFired - fast.state.shotsFired)).toBeLessThanOrEqual(2);
    // What falls, and where, depends on the seed and the level only: not on
    // the frame rate and not on what the player shot down.
    expect(slow.spawned.length).toBeGreaterThanOrEqual(20); // t = 0..19; the one at t = 20 sits on the boundary
    expect(slow.spawned.slice(0, 20)).toEqual(fast.spawned.slice(0, 20));
    expect(slow.state.kills).toBeGreaterThan(0);
  });
  it('spawns the same columns whatever the player does', () => {
    const lvl = level({ waves: [{ at: 0, spawn: { pod: 1, bomber: 1 }, rate_s: 1 }] });
    const columns = (state, intents) => eventsOf(run(state, lvl, 20, intents), 'threat.spawned').filter((e) => e.data.from === 'wave').map((e) => e.data.x);
    const fresh = createGameState(lvl, { seed: 3 });
    const rapid = { ...armed(fresh, 2), boost: { meter: 0, next: 1, used: 1, active: { kind: 'rapid', remaining: 60 } } };
    const watched = columns(fresh, idle());
    const played = columns(rapid, idle()); // pods split, bombers die and respawn
    expect(played.length).toBeGreaterThanOrEqual(20);
    expect(played).toEqual(watched);
  });
  it('ends the round mid-frame and stops there', () => {
    const lvl = level({ duration_s: 30 });
    const state = stepFrame({ ...seeded(lvl), time: 29.95 }, idle(), 0.1, lvl);
    expect(state.phase).toBe('ended');
    expect(state.time).toBeLessThan(30.02);
    expect(eventsOf(state, 'level.ended')).toHaveLength(1);
  });
  it('treats a missing or negative frame time as no time at all', () => {
    const lvl = level();
    const state = seeded(lvl);
    for (const elapsed of [0, -1, NaN, undefined]) expect(stepFrame(state, idle(), elapsed, lvl).time).toBe(0);
  });
});
