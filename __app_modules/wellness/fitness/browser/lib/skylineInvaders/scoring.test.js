import { describe, expect, it } from 'vitest';
import { invadersBonus, killPoints, levelOutcome } from './scoring.js';
import { THREATS } from './threats.js';

describe('killPoints', () => {
  it('pays the threat value, +10% per combo step up to 10, x1.5 with arms up', () => {
    expect(killPoints('meteor')).toBe(THREATS.meteor.points);
    expect(killPoints('meteor', { combo: 5 })).toBe(15);
    expect(killPoints('meteor', { combo: 50 })).toBe(20);
    expect(killPoints('drone', { combo: 0, armsUp: true })).toBe(30);
  });
  it('pays nothing for something that is not a threat', () => {
    expect(killPoints('squid', { combo: 3 })).toBe(0);
  });
});

describe('levelOutcome', () => {
  const lvl = { pass: { kills: 10, base_hp_min: 50 } };
  const state = (kills, hp) => ({ kills, score: 123, bestCombo: 4, base: { hp, maxHp: 100 } });
  it.each([
    [state(10, 100), { passed: true, stars: 3 }],
    [state(10, 80), { passed: true, stars: 2 }],
    [state(10, 75), { passed: true, stars: 2 }],
    [state(10, 60), { passed: true, stars: 1 }],
    [state(10, 50), { passed: true, stars: 1 }],
    [state(10, 40), { passed: false, stars: 0 }],
    [state(9, 100), { passed: false, stars: 0 }],
  ])('%j -> %j', (input, expected) => {
    expect(levelOutcome(input, lvl)).toMatchObject({ ...expected, kills: input.kills, score: 123, bestCombo: 4, baseHpPct: input.base.hp });
  });
  it('treats a missing base floor as zero', () => {
    expect(levelOutcome(state(10, 0), { pass: { kills: 10 } })).toMatchObject({ passed: true, stars: 1 });
  });
  it('gives three stars only for an untouched base, even when the percentage rounds up to 100', () => {
    expect(levelOutcome({ kills: 10, score: 0, base: { hp: 999, maxHp: 1000 } }, lvl)).toMatchObject({ stars: 2, baseHpPct: 100, bestCombo: 0 });
  });
  it('pays rings by stars and nothing for a fail', () => {
    expect([0, 1, 2, 3].map(invadersBonus)).toEqual([0, 10, 20, 30]);
  });
});
