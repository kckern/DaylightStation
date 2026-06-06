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
  it('defaults to a 400m lap when none is configured (laps always on)', () => {
    expect(effectiveLapLength({ lapLengthM: 0, winCondition: 'time', goalM: null })).toBe(400);
    expect(effectiveLapLength({ lapLengthM: 0, winCondition: 'distance', goalM: 3000 })).toBe(400);
  });
  it('collapses to the race distance for a short distance race even when unconfigured', () => {
    // goal (100) < default lap (400) → one lap = the whole race.
    expect(effectiveLapLength({ lapLengthM: 0, winCondition: 'distance', goalM: 100 })).toBe(100);
  });
});
