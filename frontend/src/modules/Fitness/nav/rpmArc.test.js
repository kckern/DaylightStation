import { describe, it, expect } from 'vitest';
import { rpmArcValue } from './rpmArc.js';

describe('rpmArcValue', () => {
  it('returns the base at tick 0 (sin 0)', () => {
    expect(rpmArcValue(0, { base: 80, amp: 10, periodS: 20 })).toBe(80);
  });
  it('returns base+amp at a quarter period (sin π/2)', () => {
    expect(rpmArcValue(5, { base: 80, amp: 10, periodS: 20 })).toBe(90);
  });
  it('clamps to the 0..150 range', () => {
    expect(rpmArcValue(5, { base: 145, amp: 50, periodS: 20 })).toBe(150);
    expect(rpmArcValue(15, { base: 5, amp: 50, periodS: 20 })).toBe(0);
  });
});
