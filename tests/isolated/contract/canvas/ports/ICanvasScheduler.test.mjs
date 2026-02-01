// tests/isolated/contract/canvas/ports/ICanvasScheduler.test.mjs
import { describe, it, expect } from '@jest/globals';
import { validateScheduler } from '../../../../../backend/src/3_applications/canvas/ports/ICanvasScheduler.mjs';

describe('ICanvasScheduler contract', () => {
  it('validates compliant implementation', () => {
    const validImpl = {
      scheduleRotation: (intervalMs, cb) => {},
      resetTimer: () => {},
      cancelRotation: () => {},
    };
    expect(() => validateScheduler(validImpl)).not.toThrow();
  });

  it('rejects missing scheduleRotation', () => {
    const invalid = {
      resetTimer: () => {},
      cancelRotation: () => {},
    };
    expect(() => validateScheduler(invalid)).toThrow(/scheduleRotation/);
  });

  it('rejects missing resetTimer', () => {
    const invalid = {
      scheduleRotation: (intervalMs, cb) => {},
      cancelRotation: () => {},
    };
    expect(() => validateScheduler(invalid)).toThrow(/resetTimer/);
  });

  it('rejects missing cancelRotation', () => {
    const invalid = {
      scheduleRotation: (intervalMs, cb) => {},
      resetTimer: () => {},
    };
    expect(() => validateScheduler(invalid)).toThrow(/cancelRotation/);
  });

  it('rejects non-function methods', () => {
    const invalid = {
      scheduleRotation: 'not a function',
      resetTimer: () => {},
      cancelRotation: () => {},
    };
    expect(() => validateScheduler(invalid)).toThrow(/scheduleRotation.*function/);
  });
});
