import { describe, it, expect } from 'vitest';
import { detectKey, KEY_SIGNATURES } from './keySignature.js';

describe('KEY_SIGNATURES', () => {
  it('every key has a 7-note scale', () => {
    for (const data of Object.values(KEY_SIGNATURES)) {
      expect(data.scale).toHaveLength(7);
    }
  });
});

describe('detectKey', () => {
  it('returns current key when too few notes', () => {
    expect(detectKey([0, 2], 'G')).toBe('G');
  });
  it('returns current key when too few unique pitches', () => {
    expect(detectKey([0, 0, 0, 0, 0, 0], 'F')).toBe('F');
  });
  it('detects G major when F# weighs against C (clears hysteresis)', () => {
    // Repeated F# (6) drags C major's score down enough for G to win by >0.2.
    const pcs = [6, 6, 6, 7, 9, 11, 2];
    expect(detectKey(pcs, 'C')).toBe('G');
  });
  it('stays put without a 20% improvement (hysteresis)', () => {
    // Plain C-major run: C should not flip to anything else.
    const pcs = [0, 2, 4, 5, 7, 9, 11, 0];
    expect(detectKey(pcs, 'C')).toBe('C');
  });
});
