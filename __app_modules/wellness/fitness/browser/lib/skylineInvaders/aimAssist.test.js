import { describe, expect, it } from 'vitest';
import { driftAim, manualAim } from './aimAssist.js';
import { aimToX } from './threats.js';

describe('aim assist', () => {
  const threat = (x, y, type = 'meteor') => ({ id: x, type, x, y });
  it('drifts slowly toward the threat nearest the ground', () => {
    const next = driftAim(0.5, [threat(aimToX(0.9), 400), threat(aimToX(0.1), 100)], 1);
    expect(next).toBeCloseTo(0.6);
  });
  it('does not overshoot and holds still with nothing to chase', () => {
    expect(driftAim(0.5, [threat(aimToX(0.52), 400)], 1)).toBeCloseTo(0.52);
    expect(driftAim(0.5, [], 1)).toBe(0.5);
    expect(driftAim(0.5, null, 1)).toBe(0.5);
  });
  it('does not chase a falling bomb', () => {
    expect(driftAim(0.5, [threat(aimToX(0.9), 500, 'bomb'), threat(aimToX(0.1), 100)], 1)).toBeCloseTo(0.4);
  });
  it('manual aim moves with the stick and clamps', () => {
    expect(manualAim(0.5, 1, 0.5)).toBeCloseTo(0.8);
    expect(manualAim(0.9, 1, 1)).toBe(1);
    expect(manualAim(0.1, -1, 1)).toBe(0);
  });
});
