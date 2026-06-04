import { describe, it, expect } from 'vitest';
import { circuitTargetFor, circuitProgress, ovalProgressFor } from './ovalTrackModel.js';

describe('circuitTargetFor', () => {
  it('uses the goal for a distance race', () => {
    expect(circuitTargetFor('distance', 2500, 1000)).toBe(2500);
  });
  it('uses the arbitrary oval circuit for a time race', () => {
    expect(circuitTargetFor('time', null, 1000)).toBe(1000);
  });
  it('falls back to the default circuit when nothing valid is given', () => {
    expect(circuitTargetFor('time', null, 0)).toBe(1000);
    expect(circuitTargetFor('distance', 0, undefined)).toBe(1000);
  });
});

describe('circuitProgress', () => {
  it('maps distance to a fraction of the target (one loop = whole race)', () => {
    expect(circuitProgress(1250, 2500)).toBe(0.5);
  });
  it('clamps to 1 at/after the finish when clamp is on (distance race)', () => {
    expect(circuitProgress(2500, 2500, { clamp: true })).toBe(1);
    expect(circuitProgress(3000, 2500, { clamp: true })).toBe(1);
  });
  it('lets a fast time-racer exceed 1 (laps the oval) when unclamped', () => {
    expect(circuitProgress(1500, 1000)).toBe(1.5);
  });
  it('is 0 for no distance and never negative', () => {
    expect(circuitProgress(0, 1000)).toBe(0);
    expect(circuitProgress(-50, 1000)).toBe(0);
  });
});

describe('ovalProgressFor — laps drive one revolution per lap', () => {
  it('when laps are ON, returns the fraction INTO the current lap (one rev/lap)', () => {
    expect(ovalProgressFor({
      winCondition: 'time', distanceM: 250, goalM: null, ovalCircuitM: 1000, lapLengthM: 100
    })).toBeCloseTo(0.5, 5);
  });

  it('a rider exactly on a lap boundary reads 0 (top of the oval)', () => {
    expect(ovalProgressFor({
      winCondition: 'time', distanceM: 300, goalM: null, ovalCircuitM: 1000, lapLengthM: 100
    })).toBeCloseTo(0, 5);
  });

  it('when laps are OFF, falls back to whole-race circuit progress (distance race, clamped)', () => {
    expect(ovalProgressFor({
      winCondition: 'distance', distanceM: 1500, goalM: 3000, ovalCircuitM: 1000, lapLengthM: 0
    })).toBeCloseTo(0.5, 5);
    expect(ovalProgressFor({
      winCondition: 'distance', distanceM: 4000, goalM: 3000, ovalCircuitM: 1000, lapLengthM: 0
    })).toBeCloseTo(1, 5);
  });

  it('when laps are OFF in a time race, uses oval_circuit_m unclamped', () => {
    expect(ovalProgressFor({
      winCondition: 'time', distanceM: 1500, goalM: null, ovalCircuitM: 1000, lapLengthM: 0
    })).toBeCloseTo(1.5, 5);
  });
});
