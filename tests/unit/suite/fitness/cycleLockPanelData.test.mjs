import { describe, it, expect } from '@jest/globals';
import { computeCycleLockPanelData } from '#frontend/modules/Fitness/player/overlays/cycleLockPanelData.js';

describe('computeCycleLockPanelData rounding', () => {
  const baseChallenge = {
    type: 'cycle',
    cycleState: 'locked',
    lockReason: 'maintain',
    rider: { id: 'felix', name: 'Felix' },
    currentPhase: { hiRpm: 84.7172, loRpm: 63.4 }
  };

  it('rounds fractional currentRpm to integer', () => {
    const out = computeCycleLockPanelData({ ...baseChallenge, currentRpm: 89.7383 }, 'hot');
    expect(out.currentRpm).toBe(90);
    expect(Number.isInteger(out.currentRpm)).toBe(true);
  });

  it('rounds fractional targetRpm to integer', () => {
    const out = computeCycleLockPanelData({ ...baseChallenge, currentRpm: 50 }, 'hot');
    expect(out.targetRpm).toBe(85);
    expect(Number.isInteger(out.targetRpm)).toBe(true);
  });

  it('preserves zero', () => {
    const out = computeCycleLockPanelData({ ...baseChallenge, currentRpm: 0 }, 'hot');
    expect(out.currentRpm).toBe(0);
  });

  it('handles init lockReason with fractional initMinRpm', () => {
    const out = computeCycleLockPanelData(
      { ...baseChallenge, lockReason: 'init', currentRpm: 12.5, initMinRpm: 30.7 },
      'cool'
    );
    expect(out.targetRpm).toBe(31);
    expect(out.currentRpm).toBe(13);
  });

  it('returns null for non-cycle challenges (unchanged contract)', () => {
    const out = computeCycleLockPanelData({ type: 'zone', cycleState: 'locked' }, 'hot');
    expect(out).toBeNull();
  });
});
