import { describe, it, expect } from 'vitest';
import { luxToDim } from '../../../frontend/src/screen-framework/widgets/luxToDim.js';

const curve = [
  { lux: 0, dim: 0.92 },
  { lux: 5, dim: 0.85 },
  { lux: 40, dim: 0.55 },
  { lux: 150, dim: 0.32 },
  { lux: 400, dim: 0.15 },
];

describe('luxToDim', () => {
  it('clamps below the first point', () => {
    expect(luxToDim(-10, curve)).toBeCloseTo(0.85, 5); // 0.92 clamped to 0.85 ceiling
    expect(luxToDim(0, curve)).toBeCloseTo(0.85, 5);
  });
  it('clamps above the last point', () => {
    expect(luxToDim(10000, curve)).toBeCloseTo(0.15, 5);
  });
  it('interpolates linearly between points', () => {
    // midway between {40,0.55} and {150,0.32}: lux 95 → t=0.5 → 0.435
    expect(luxToDim(95, curve)).toBeCloseTo(0.435, 3);
  });
  it('caps dim at 0.85 even if a point asks for more', () => {
    expect(luxToDim(0, [{ lux: 0, dim: 2 }, { lux: 100, dim: 0 }])).toBe(0.85);
  });
  it('returns a safe default for an empty/invalid curve', () => {
    expect(luxToDim(50, [])).toBe(0.4);
    expect(luxToDim(50, null)).toBe(0.4);
  });
});
