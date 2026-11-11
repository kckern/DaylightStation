// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { worthLine } from './worthLine.mjs';

describe('worthLine', () => {
  it('prints silver, gems and the day bonus in the fixed order', () => {
    expect(worthLine({ silver: 2, gems: 0, dayBonus: { silver: 0, gems: 0 } })).toBe('Worth 2 silver');
    expect(worthLine({ silver: 2, gems: 1, dayBonus: { silver: 5, gems: 0 } })).toBe('Worth 2 silver · 1 gem · +5 silver if it finishes your day');
    expect(worthLine({ silver: 0, gems: 2, dayBonus: { silver: 0, gems: 0 } })).toBe('Worth 2 gems');
  });
  it('nothing to print when the sheet is worth nothing, or there is no price', () => {
    expect(worthLine({ silver: 0, gems: 0, dayBonus: { silver: 5, gems: 0 } })).toBeNull();
    expect(worthLine(null)).toBeNull();
  });
});
