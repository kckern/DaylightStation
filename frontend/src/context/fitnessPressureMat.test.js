import { describe, expect, it } from 'vitest';
import { normalizePressureMatMessage, pressureMatFitnessEvent } from './fitnessPressureMat.js';

describe('fitness pressure mat', () => {
  it('normalizes a live step count and analog diagnostics', () => {
    expect(normalizePressureMatMessage({
      topic: 'pressure-mat', id: 'mat1', type: 'presence', event: 'pressed',
      occupied: true, steps: 12, stomps: 3, voltage: 2.1, deltaV: .6, gradientVps: -1.2,
    })).toMatchObject({ id: 'mat1', event: 'pressed', steps: 12, stomps: 3, occupied: true });
  });

  it('keeps step and stomp events distinct', () => {
    const step = { id: 'mat1', type: 'presence', event: 'pressed', steps: 4, stomps: 0 };
    const stomp = { ...step, event: 'stomped', stomps: 1 };
    expect(pressureMatFitnessEvent(step).type).toBe('pressure-mat:step');
    expect(pressureMatFitnessEvent(stomp).type).toBe('pressure-mat:stomp');
    expect(pressureMatFitnessEvent(stomp).payload.steps).toBe(4);
  });

  it('rejects unrelated or malformed messages', () => {
    expect(normalizePressureMatMessage({ topic: 'fitness', id: 'mat1', type: 'presence', event: 'pressed' })).toBeNull();
    expect(normalizePressureMatMessage({ topic: 'pressure-mat', id: 'mat1', type: 'presence', event: 'maybe' })).toBeNull();
  });
});
