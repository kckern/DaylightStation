import { describe, it, expect } from 'vitest';
import { MACRO_GOAL_FIELDS, WATCH_MICRO_FIELDS, setMacroGoal, setWatchMicro, watchFor } from './goalFields.js';

// The invariant these guard: a goals file written before this phase has NEITHER
// key, and editing an unrelated field must never invent one. `settled` was bitten
// by exactly this (decision 2.6) — absence has to survive a round trip.
const LEGACY_GOALS = { heightIn: 70, birthYear: 1986, sex: 'male' };

describe('setMacroGoal', () => {
  it('adds macroGoals only when a target is actually set', () => {
    const next = setMacroGoal(LEGACY_GOALS, 'proteinG', 150);
    expect(next.macroGoals).toEqual({ proteinG: 150 });
    expect(next.heightIn).toBe(70);
  });

  it('keeps a cleared target as null, not 0', () => {
    const withGoals = { ...LEGACY_GOALS, macroGoals: { proteinG: 150, carbsG: 200 } };
    const next = setMacroGoal(withGoals, 'carbsG', '');
    expect(next.macroGoals).toEqual({ proteinG: 150, carbsG: null });
  });

  it('REMOVES macroGoals entirely once every target is cleared — never leaves an object of nulls', () => {
    const withGoals = { ...LEGACY_GOALS, macroGoals: { proteinG: 150 } };
    const next = setMacroGoal(withGoals, 'proteinG', '');
    expect(Object.prototype.hasOwnProperty.call(next, 'macroGoals')).toBe(false);
  });

  it('never invents macroGoals on a legacy goals object', () => {
    const next = setMacroGoal(LEGACY_GOALS, 'proteinG', null);
    expect(Object.prototype.hasOwnProperty.call(next, 'macroGoals')).toBe(false);
  });

  it('rejects garbage into null rather than NaN', () => {
    const next = setMacroGoal({ ...LEGACY_GOALS, macroGoals: { fatG: 60 } }, 'proteinG', 'lots');
    expect(next.macroGoals.proteinG).toBeNull();
  });

  it('exposes exactly the three server-accepted macro keys', () => {
    expect(MACRO_GOAL_FIELDS.map((f) => f.key)).toEqual(['proteinG', 'carbsG', 'fatG']);
  });
});

describe('setWatchMicro', () => {
  it('adds a watch with the micro\'s default direction', () => {
    const next = setWatchMicro(LEGACY_GOALS, 'sodium', { limit: 2300 });
    expect(next.watchMicros).toEqual([{ key: 'sodium', limit: 2300, direction: 'ceiling' }]);
  });

  it('defaults fiber to a FLOOR — more is the goal, not less', () => {
    const next = setWatchMicro(LEGACY_GOALS, 'fiber', { limit: 30 });
    expect(next.watchMicros[0].direction).toBe('floor');
  });

  it('updates an existing watch in place without reordering', () => {
    let goals = setWatchMicro(LEGACY_GOALS, 'sodium', { limit: 2300 });
    goals = setWatchMicro(goals, 'fiber', { limit: 30 });
    goals = setWatchMicro(goals, 'sodium', { limit: 1800 });
    expect(goals.watchMicros.map((w) => w.key)).toEqual(['sodium', 'fiber']);
    expect(goals.watchMicros[0].limit).toBe(1800);
  });

  it('REMOVES the watch when its limit is cleared', () => {
    let goals = setWatchMicro(LEGACY_GOALS, 'sodium', { limit: 2300 });
    goals = setWatchMicro(goals, 'fiber', { limit: 30 });
    goals = setWatchMicro(goals, 'sodium', { limit: '' });
    expect(goals.watchMicros).toEqual([{ key: 'fiber', limit: 30, direction: 'floor' }]);
  });

  it('removes watchMicros ENTIRELY once the last watch is cleared', () => {
    let goals = setWatchMicro(LEGACY_GOALS, 'sodium', { limit: 2300 });
    goals = setWatchMicro(goals, 'sodium', { limit: 0 });
    expect(Object.prototype.hasOwnProperty.call(goals, 'watchMicros')).toBe(false);
  });

  it('never invents watchMicros on a legacy goals object', () => {
    const next = setWatchMicro(LEGACY_GOALS, 'sodium', { limit: null });
    expect(Object.prototype.hasOwnProperty.call(next, 'watchMicros')).toBe(false);
  });

  it('ignores an unknown micro key rather than writing one the server refuses', () => {
    const next = setWatchMicro(LEGACY_GOALS, 'potassium', { limit: 3500 });
    expect(next).toBe(LEGACY_GOALS);
  });

  it('changes direction without disturbing the limit', () => {
    let goals = setWatchMicro(LEGACY_GOALS, 'sugar', { limit: 50 });
    goals = setWatchMicro(goals, 'sugar', { direction: 'floor' });
    expect(goals.watchMicros[0]).toEqual({ key: 'sugar', limit: 50, direction: 'floor' });
  });

  it('exposes exactly the four server-accepted micro keys', () => {
    expect(WATCH_MICRO_FIELDS.map((f) => f.key).sort()).toEqual(['cholesterol', 'fiber', 'sodium', 'sugar']);
  });
});

describe('watchFor', () => {
  it('returns null on goals with no watchMicros at all', () => {
    expect(watchFor(LEGACY_GOALS, 'sodium')).toBeNull();
  });
  it('finds the entry for a watched micro', () => {
    const goals = setWatchMicro(LEGACY_GOALS, 'sodium', { limit: 2300 });
    expect(watchFor(goals, 'sodium').limit).toBe(2300);
    expect(watchFor(goals, 'fiber')).toBeNull();
  });
});
