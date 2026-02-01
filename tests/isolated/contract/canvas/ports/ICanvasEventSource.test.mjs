// tests/isolated/contract/canvas/ports/ICanvasEventSource.test.mjs
import { describe, it, expect } from '@jest/globals';
import { validateEventSource } from '../../../../../backend/src/3_applications/canvas/ports/ICanvasEventSource.mjs';

describe('ICanvasEventSource contract', () => {
  it('validates compliant implementation', () => {
    const validImpl = {
      onMotionDetected: (cb) => {},
      onContextTrigger: (cb) => {},
      onManualAdvance: (cb) => {},
    };
    expect(() => validateEventSource(validImpl)).not.toThrow();
  });

  it('rejects missing onMotionDetected', () => {
    const invalid = {
      onContextTrigger: (cb) => {},
      onManualAdvance: (cb) => {},
    };
    expect(() => validateEventSource(invalid)).toThrow(/onMotionDetected/);
  });

  it('rejects non-function methods', () => {
    const invalid = {
      onMotionDetected: 'not a function',
      onContextTrigger: (cb) => {},
      onManualAdvance: (cb) => {},
    };
    expect(() => validateEventSource(invalid)).toThrow(/onMotionDetected.*function/);
  });
});
