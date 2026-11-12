import { describe, expect, it } from 'vitest';
import { killPoints } from './scoring.js';
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
