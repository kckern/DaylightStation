import { describe, expect, it } from 'vitest';
import { boostRules, createGameState, nukeRules, step, stepFrame } from './engine.js';
import { FIELD, THREATS } from './threats.js';
import { LEVEL_SCHEMA } from './levels.js';

const level = (over = {}) => ({
  schema: LEVEL_SCHEMA, id: 'invaders-test', name: 'Test', duration_s: 60, cannons: 1, max_bombers: 2,
  pass: { kills: 3, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }], ...over,
});
const idle = (over = {}) => ({ aim: 0.5, tier: 'small', armsUp: false, fire: [], partnerRpm: null, ...over });
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
  it('spawns one threat per rate_s from the active wave, inside the cannon range', () => {
    const state = run(createGameState(level(), { seed: 7 }), level(), 5);
    expect(state.threats.map((t) => t.type)).toEqual(['meteor', 'meteor', 'meteor']); // t = 0, 2, 4
    for (const threat of state.threats) {
      expect(threat.originX).toBeGreaterThanOrEqual(FIELD.marginX);
      expect(threat.originX).toBeLessThanOrEqual(FIELD.width - FIELD.marginX);
    }
    expect(state.events.filter((e) => e.type === 'threat.spawned')).toHaveLength(3);
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

const press = (over = {}) => ({ aim: 0.5, tier: 'small', armsUp: false, source: 'mat', at: null, ...over });
// Fire one press on the first step, then let the round run.
const fireOnce = (state, lvl, shot, seconds = 1, dt = 1 / 60) => run(step(state, idle({ fire: [shot] }), dt, lvl), lvl, seconds, idle(), dt);

describe('engine: firing and hits', () => {
  it('one press makes one small shot at the pressed aim, and scores a kill', () => {
    const lvl = level();
    const first = step(seeded(lvl, [at('meteor', 500, 200)]), idle({ fire: [press()] }), 1 / 60, lvl);
    expect(first.shots).toHaveLength(1);
    expect(first.shots[0].x).toBe(500);
    expect(first.shotsFired).toBe(1);
    const done = run(first, lvl, 1);
    expect(done).toMatchObject({ kills: 1, hits: 1, combo: 1, bestCombo: 1, score: 11, shots: [] }); // 10 pts x 1.1 (combo 1)
    expect(done.threats).toEqual([]);
    expect(eventsOf(done, 'threat.destroyed')).toEqual([{ type: 'threat.destroyed', data: expect.objectContaining({ id: 900, threat: 'meteor', points: 11, by: 'small' }) }]);
  });
  it('reports each press as a shot.fired event with its source and press time', () => {
    const lvl = level();
    const first = step(seeded(lvl), idle({ fire: [press({ aim: 0.25, source: 'keyboard', at: 1731340800000, armsUp: true })] }), 1 / 60, lvl);
    expect(eventsOf(first, 'shot.fired')).toEqual([{ type: 'shot.fired', data: { tier: 'small', aim: 0.25, source: 'keyboard', armsUp: true, pressAt: 1731340800000 } }]);
  });
  it('uses the press aim, not the continuous aim', () => {
    const lvl = level();
    const first = step(seeded(lvl, []), idle({ aim: 0.9, fire: [press({ aim: 0.1 })] }), 1 / 60, lvl);
    expect(first.shots[0].x).toBeCloseTo(60 + 0.1 * 880);
  });
  it('fires a small shot when the press names no known tier', () => {
    const lvl = level();
    const first = step(seeded(lvl), idle({ fire: [{ aim: 0.5, tier: 'plasma' }] }), 1 / 60, lvl);
    expect(first.shots).toMatchObject([{ tier: 'small', damage: 1 }]);
  });
  it('a big shot does 2 damage and reaches wider', () => {
    const lvl = level();
    const pod = fireOnce(seeded(lvl, [at('pod', 500, 200)]), lvl, press({ tier: 'big' }));
    expect(pod.kills).toBe(1);
    const offset = 500 + THREATS.meteor.width / 2 + 10; // outside a small shot, inside a big one
    expect(fireOnce(seeded(lvl, [at('meteor', offset, 200)]), lvl, press({ tier: 'small' })).kills).toBe(0);
    expect(fireOnce(seeded(lvl, [at('meteor', offset, 200)]), lvl, press({ tier: 'big' })).kills).toBe(1);
  });
  it('a pod survives one small shot, then splits into two drones when destroyed', () => {
    const lvl = level();
    const once = fireOnce(seeded(lvl, [at('pod', 500, 200)]), lvl, press());
    expect(once.threats.map((t) => [t.type, t.hp])).toEqual([['pod', 1]]);
    expect(eventsOf(once, 'threat.damaged')).toHaveLength(1);
    expect(once).toMatchObject({ kills: 0, hits: 1, combo: 1 });
    const twice = fireOnce(once, lvl, press({ aim: (once.threats[0].x - 60) / 880 }));
    expect(twice.threats.map((t) => t.type)).toEqual(['drone', 'drone']);
    expect(twice.kills).toBe(1);
  });
  it('the two drones leave the pod from where it was and peel apart', () => {
    const lvl = level();
    let state = step(seeded(lvl, [at('pod', 500, 300, { hp: 1 })]), idle({ fire: [press()] }), 1 / 60, lvl);
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
  it('a spread volley fires three shots and counts as one press', () => {
    const lvl = level();
    const first = step(seeded(lvl, []), idle({ fire: [press({ tier: 'spread' })] }), 1 / 60, lvl);
    expect(first.shots).toHaveLength(3);
    expect(new Set(first.shots.map((s) => s.vx)).size).toBe(3);
    expect(first.shotsFired).toBe(1);
  });
  it('hits the lowest threat in the column first', () => {
    const lvl = level();
    const done = fireOnce(seeded(lvl, [at('meteor', 500, 100, { id: 1 }), at('meteor', 500, 300, { id: 2 })]), lvl, press());
    expect(done.threats.map((t) => t.id)).toEqual([1]);
  });
  it('a shot is spent on the first threat it hits', () => {
    const lvl = level();
    const done = fireOnce(seeded(lvl, [at('meteor', 500, 290, { id: 1 }), at('meteor', 500, 300, { id: 2 })]), lvl, press({ tier: 'big' }));
    expect(done.threats.map((t) => t.id)).toEqual([1]);
    expect(done.kills).toBe(1);
  });
  it('still hits at a low frame rate: the shot path is swept, not sampled', () => {
    const lvl = level();
    for (const dt of [1 / 13, 0.1]) {
      const done = fireOnce(seeded(lvl, [at('bomb', 500, 300)]), lvl, press(), 1, dt); // the thinnest target
      expect(done.threats).toEqual([]);
      expect(done.hits).toBe(1);
    }
  });
  it('a miss resets the combo; a spread volley misses only when all three miss', () => {
    const lvl = level();
    const hit = fireOnce(seeded(lvl, [at('meteor', 500, 200)]), lvl, press());
    expect(hit.combo).toBe(1);
    const miss = fireOnce(hit, lvl, press({ aim: 0.05 }));
    expect(miss.combo).toBe(0);
    expect(miss.bestCombo).toBe(1);
    expect(eventsOf(miss, 'shot.missed')).toHaveLength(1);
    const spread = fireOnce(seeded(lvl, [at('meteor', 500, 200)]), lvl, press({ tier: 'spread' }), 1.5);
    expect(spread).toMatchObject({ kills: 1, combo: 1 });
    expect(eventsOf(spread, 'shot.missed')).toEqual([]);
    expect(spread.volleys).toEqual({});
  });
  it('a spread volley that hits twice extends the combo once', () => {
    const lvl = level();
    // 300 units up takes 1/3 s, in which the side shots drift 50 units.
    const done = fireOnce(seeded(lvl, [at('meteor', 500, 220, { id: 1 }), at('meteor', 550, 220, { id: 2 })]), lvl, press({ tier: 'spread' }), 1.5);
    expect(done).toMatchObject({ kills: 2, hits: 1, combo: 1 });
  });
  it('consecutive hits build the combo and the points', () => {
    const lvl = level();
    let state = seeded(lvl, [at('meteor', 300, 200, { id: 1 }), at('meteor', 500, 200, { id: 2 }), at('meteor', 700, 200, { id: 3 })]);
    for (const x of [300, 500, 700]) state = fireOnce(state, lvl, press({ aim: (x - 60) / 880 }), 0.5);
    expect(state).toMatchObject({ kills: 3, combo: 3, bestCombo: 3, score: 11 + 12 + 13 });
  });
  it('arms-up shots score x1.5 and are never needed to hit', () => {
    const lvl = level();
    expect(fireOnce(seeded(lvl, [at('meteor', 500, 200)]), lvl, press({ armsUp: true })).score).toBe(17); // round(10 x 1.1 x 1.5)
    expect(fireOnce(seeded(lvl, [at('meteor', 500, 200)]), lvl, press({ armsUp: false })).kills).toBe(1);
  });
  it('shooting a bomb scores but is not a kill', () => {
    const lvl = level();
    const done = fireOnce(seeded(lvl, [at('bomb', 500, 300)]), lvl, press());
    expect(done.kills).toBe(0);
    expect(done.score).toBeGreaterThan(0);
  });
  it('a level with two cannons fires one shot per cannon from one press', () => {
    const lvl = level({ cannons: 2 });
    const first = step(seeded(lvl, []), idle({ fire: [press({ aim: [0.2, 0.8] })] }), 1 / 60, lvl);
    expect(first.shots.map((s) => Math.round(s.x))).toEqual([236, 764]);
    expect(first.shotsFired).toBe(1);
  });
  it('a one-cannon level ignores a second aim', () => {
    const lvl = level();
    const first = step(seeded(lvl, []), idle({ fire: [press({ aim: [0.2, 0.8] })] }), 1 / 60, lvl);
    expect(first.shots.map((s) => Math.round(s.x))).toEqual([236]);
  });
});

describe('engine: nuke', () => {
  const nuke = press({ tier: 'nuke' });

  it('blasts a radius around the impact point, not the whole screen', () => {
    const lvl = level();
    const done = fireOnce(seeded(lvl, [at('meteor', 500, 200, { id: 1 }), at('meteor', 600, 200, { id: 2 }), at('meteor', 900, 200, { id: 3 })]), lvl, nuke);
    expect(done.threats.map((t) => t.id)).toEqual([3]);
    expect(done).toMatchObject({ kills: 2, nukes: 1, combo: 1, hits: 1 });
    expect(eventsOf(done, 'nuke')).toEqual([{ type: 'nuke', data: { x: 500, y: expect.any(Number), radius: 160 } }]);
    expect(eventsOf(done, 'threat.destroyed').map((e) => e.data.by)).toEqual(['nuke', 'nuke']);
  });
  it('a nuke that hits nothing is a miss and makes no blast', () => {
    const lvl = level();
    const done = fireOnce(seeded(lvl, [at('meteor', 900, 200, { id: 1 })]), lvl, nuke);
    expect(done).toMatchObject({ kills: 0, nukes: 0, combo: 0, blasts: [] });
    expect(done.threats).toHaveLength(1);
    expect(eventsOf(done, 'shot.missed')).toHaveLength(1);
  });
  it('a full-health bomber survives one nuke; a pod is destroyed without splitting', () => {
    const lvl = level();
    const done = fireOnce(seeded(lvl, [at('pod', 500, 200, { id: 1 }), at('bomber', 520, 90, { id: 2 })]), lvl, nuke);
    expect(done.threats.map((t) => [t.type, t.hp])).toEqual([['bomber', 1]]);
  });
  it('the threat the nuke lands on is always caught, however small the radius', () => {
    const lvl = level({ nuke: { radius: 1, damage: 1 } });
    const done = fireOnce(seeded(lvl, [at('meteor', 520, 200, { id: 1 })]), lvl, nuke); // hit off-centre
    expect(done.threats).toEqual([]);
  });
  it('reads radius and damage from the level', () => {
    const lvl = level({ nuke: { radius: 30, damage: 4 } });
    const done = fireOnce(seeded(lvl, [at('bomber', 500, 90, { id: 1 }), at('meteor', 600, 90, { id: 2 })]), lvl, nuke);
    expect(done.threats.map((t) => t.id)).toEqual([2]);
  });
  it('leaves a short-lived blast for the renderer and emits a nuke event', () => {
    const lvl = level();
    const first = run(step(seeded(lvl, [at('meteor', 500, 500, { id: 1 })]), idle({ fire: [nuke] }), 1 / 60, lvl), lvl, 0.05);
    expect(first.blasts).toHaveLength(1);
    expect(first.blasts[0]).toMatchObject({ x: 500, radius: 160 });
    expect(first.blasts[0].ttl).toBeGreaterThan(0);
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
  it('rapid fire auto-fires at the continuous aim and tier', () => {
    const lvl = level();
    const state = run(boosted(lvl, 'rapid'), lvl, 1, idle({ aim: 0.25, tier: 'big' }));
    expect(state.shotsFired).toBeGreaterThanOrEqual(3);
    expect(eventsOf(state, 'shot.fired').every((e) => e.data.source === 'auto' && e.data.tier === 'big' && e.data.aim === 0.25)).toBe(true);
  });
  it('rapid fire keeps its rate at a low frame rate', () => {
    const lvl = level();
    const shots = (dt) => run(boosted(lvl, 'rapid'), lvl, 2, idle(), dt).shotsFired;
    expect(shots(1 / 60)).toBe(8); // every 0.25 s, the first on the first step
    expect(shots(1 / 13)).toBe(8);
    expect(shots(0.5)).toBe(8);    // slower than the fire interval: no shots are lost
  });
  it('caps the auto-fire rate, so a level with a tiny interval cannot stall a step', () => {
    const lvl = level({ boost: { rapid_interval_s: 1e-12 } });
    expect(run(boosted(lvl, 'rapid'), lvl, 1).shotsFired).toBe(20); // at most one every 0.05 s
  });
  it('stops auto-firing when the rapid boost runs out', () => {
    const lvl = level();
    const state = run(boosted(lvl, 'rapid', { boost: { meter: 0, next: 1, used: 1, active: { kind: 'rapid', remaining: 1 } } }), lvl, 3);
    expect(state.boost.active).toBeNull();
    expect(state.shotsFired).toBe(4);
  });
  it('a press during rapid fire still fires', () => {
    const lvl = level();
    const state = step(boosted(lvl, 'rapid'), idle({ fire: [press({ aim: 0.1 })] }), 1 / 60, lvl);
    expect(eventsOf(state, 'shot.fired').map((e) => e.data.source)).toEqual(['mat', 'auto']);
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
    const state = step(boosted(lvl, 'twin'), idle({ fire: [{ aim: 0.2, tier: 'small' }] }), 1 / 60, lvl);
    expect(state.shots.map((s) => Math.round(s.x))).toEqual([236, 764]);
    expect(state.shotsFired).toBe(1);
  });
});

describe('stepFrame', () => {
  it('fires a press once however many sub-steps the frame takes, and keeps every sub-step event', () => {
    const lvl = level();
    const state = stepFrame(seeded(lvl), idle({ fire: [{ aim: 0.5, tier: 'small' }] }), 0.1, lvl);
    expect(state.shotsFired).toBe(1);
    expect(state.time).toBeCloseTo(0.1);
    expect(eventsOf(state, 'shot.fired')).toHaveLength(1);
  });
  it('starts each frame with an empty event list', () => {
    const lvl = level();
    const first = stepFrame(createGameState(lvl, { seed: 7 }), idle(), 0.05, lvl);
    expect(first.events.some((e) => e.type === 'threat.spawned')).toBe(true);
    expect(stepFrame(first, idle(), 0.05, lvl).events).toEqual([]);
  });
  it('does not change the intents it was given', () => {
    const lvl = level();
    const intents = idle({ fire: [press()] });
    stepFrame(seeded(lvl), intents, 0.1, lvl);
    expect(intents.fire).toHaveLength(1);
  });
  it('plays the same round from 13 Hz frames as from 60 Hz frames', () => {
    const lvl = level({ waves: [{ at: 0, spawn: { meteor: 2, drone: 1, pod: 1, bomber: 1 }, rate_s: 1 }] });
    // The same presses at the same round times, delivered on different frame grids.
    const play = (fps) => {
      let state = createGameState(lvl, { seed: 9 });
      let fired = 0;
      const spawned = [];
      for (let i = 1; i <= Math.round(20 * fps); i += 1) {
        const due = Math.floor((i / fps) / 1.5);
        const fire = due > fired ? [press({ aim: 0.5, tier: 'spread' })] : [];
        fired = due;
        state = stepFrame(state, idle({ fire }), 1 / fps, lvl);
        spawned.push(...eventsOf(state, 'threat.spawned').filter((e) => e.data.from === 'wave').map((e) => e.data.x));
      }
      return { state, spawned };
    };
    const slow = play(13);
    const fast = play(60);
    expect(slow.state.time).toBeCloseTo(fast.state.time, 6);
    expect(slow.state.shotsFired).toBe(fast.state.shotsFired);
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
    const rapid = { ...fresh, boost: { meter: 0, next: 1, used: 1, active: { kind: 'rapid', remaining: 60 } } };
    const watched = columns(fresh, idle());
    const played = columns(rapid, idle({ tier: 'big' })); // pods split, bombers die and respawn
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
