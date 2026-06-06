import { describe, it, expect } from 'vitest';
import { effectiveLapLength } from './effectiveLapLength.js';

describe('effectiveLapLength', () => {
  it('uses the configured lap for a long distance race', () => {
    expect(effectiveLapLength({ lapLengthM: 400, winCondition: 'distance', goalM: 3000 })).toBe(400);
  });
  it('makes one lap the whole race when the goal is shorter than the lap', () => {
    expect(effectiveLapLength({ lapLengthM: 400, winCondition: 'distance', goalM: 250 })).toBe(250);
    expect(effectiveLapLength({ lapLengthM: 400, winCondition: 'distance', goalM: 100 })).toBe(100);
  });
  it('uses the configured lap for time races (no distance goal)', () => {
    expect(effectiveLapLength({ lapLengthM: 400, winCondition: 'time', goalM: null })).toBe(400);
  });
  it('returns 0 when laps are disabled', () => {
    expect(effectiveLapLength({ lapLengthM: 0, winCondition: 'distance', goalM: 100 })).toBe(0);
  });
});
