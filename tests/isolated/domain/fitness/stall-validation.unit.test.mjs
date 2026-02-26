import { describe, it, expect } from '@jest/globals';

describe('stall validation', () => {
  // Simulate the validation function we'll add
  function isRealStall(playheadAtStart, playheadAtCheck, wallElapsedMs) {
    // If playhead is advancing at >80% of real-time, it's not a real stall
    if (playheadAtStart == null || playheadAtCheck == null) return true; // can't validate
    const playheadAdvance = playheadAtCheck - playheadAtStart;
    const wallElapsedSec = wallElapsedMs / 1000;
    if (wallElapsedSec <= 0) return true; // too brief to validate
    const ratio = playheadAdvance / wallElapsedSec;
    return ratio < 0.8; // Real stall: playhead advancing at <80% of wall time
  }

  it('should detect phantom stall (playhead advancing normally)', () => {
    // Video played 8s of content in 8s of wall time — not stalled
    expect(isRealStall(335.2, 343.2, 8000)).toBe(false);
  });

  it('should detect real stall (playhead frozen)', () => {
    // Video played 0s of content in 8s of wall time — real stall
    expect(isRealStall(335.2, 335.2, 8000)).toBe(true);
  });

  it('should detect real stall (playhead barely moving)', () => {
    // Video played 1s of content in 8s — real stall
    expect(isRealStall(335.2, 336.2, 8000)).toBe(true);
  });

  it('should handle null playhead as possible real stall', () => {
    expect(isRealStall(null, null, 8000)).toBe(true);
  });

  it('should handle very short intervals as possible real stall', () => {
    expect(isRealStall(335.2, 335.2, 0)).toBe(true);
  });
});
