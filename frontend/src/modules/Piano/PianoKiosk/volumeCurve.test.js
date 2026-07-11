import { describe, it, expect } from 'vitest';
import { STEPS, stepToLevel, levelToStep } from './volumeCurve.js';

describe('volumeCurve — linear', () => {
  it('maps steps evenly across 0-1', () => {
    expect(stepToLevel(0, 'linear')).toBe(0);
    expect(stepToLevel(1, 'linear')).toBeCloseTo(0.25);
    expect(stepToLevel(2, 'linear')).toBeCloseTo(0.5);
    expect(stepToLevel(3, 'linear')).toBeCloseTo(0.75);
    expect(stepToLevel(4, 'linear')).toBe(1);
  });

  it('round-trips every step index', () => {
    STEPS.forEach((_, i) => {
      expect(levelToStep(stepToLevel(i, 'linear'), 'linear')).toBe(i);
    });
  });

  it('picks the nearest step for an in-between level', () => {
    expect(levelToStep(0.6, 'linear')).toBe(2); // closer to .5 than .75? check below
  });
});

describe('volumeCurve — log (perceptual taper)', () => {
  it('Off is exactly 0 and Max is exactly 1', () => {
    expect(stepToLevel(0, 'log')).toBe(0);
    expect(stepToLevel(4, 'log')).toBe(1);
  });

  it('low/mid steps sit lower than the linear equivalent (perceptual spread)', () => {
    expect(stepToLevel(1, 'log')).toBeLessThan(stepToLevel(1, 'linear'));
    expect(stepToLevel(2, 'log')).toBeLessThan(stepToLevel(2, 'linear'));
    expect(stepToLevel(3, 'log')).toBeLessThan(stepToLevel(3, 'linear'));
  });

  it('is monotonically increasing', () => {
    const levels = STEPS.map((_, i) => stepToLevel(i, 'log'));
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    }
  });

  it('round-trips every step index', () => {
    STEPS.forEach((_, i) => {
      expect(levelToStep(stepToLevel(i, 'log'), 'log')).toBe(i);
    });
  });
});

describe('volumeCurve — edges and defaults', () => {
  it('defaults to the log curve when none is given', () => {
    expect(stepToLevel(2)).toBe(stepToLevel(2, 'log'));
    expect(levelToStep(0.3)).toBe(levelToStep(0.3, 'log'));
  });

  it('clamps out-of-range step indices', () => {
    expect(stepToLevel(-1, 'linear')).toBe(0);
    expect(stepToLevel(99, 'linear')).toBe(1);
  });

  it('clamps out-of-range levels', () => {
    expect(levelToStep(-1, 'linear')).toBe(0);
    expect(levelToStep(2, 'linear')).toBe(4);
  });

  it('treats null/undefined level as 0 (Off)', () => {
    expect(levelToStep(undefined, 'log')).toBe(0);
    expect(levelToStep(null, 'linear')).toBe(0);
  });
});
