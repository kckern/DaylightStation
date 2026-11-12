import { describe, expect, it } from 'vitest';
import { createGameState, step } from './engine.js';
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
