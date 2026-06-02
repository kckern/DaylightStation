import { describe, it, expect } from 'vitest';
import { formatDistance } from './formatDistance.js';

describe('formatDistance', () => {
  it('shows whole meters below 1 km', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(250)).toBe('250 m');
    expect(formatDistance(999)).toBe('999 m');
  });
  it('rolls over to km with 2 decimals at/above 1 km', () => {
    expect(formatDistance(1000)).toBe('1.00 km');
    expect(formatDistance(4070)).toBe('4.07 km');
  });
  it('uses 1 decimal at/above 10 km', () => {
    expect(formatDistance(10000)).toBe('10.0 km');
    expect(formatDistance(12400)).toBe('12.4 km');
  });
  it('treats invalid / negative input as 0 m', () => {
    expect(formatDistance(-5)).toBe('0 m');
    expect(formatDistance(NaN)).toBe('0 m');
    expect(formatDistance(undefined)).toBe('0 m');
  });
  it('rounds meters before choosing the unit', () => {
    expect(formatDistance(999.6)).toBe('1.00 km');
  });
});
