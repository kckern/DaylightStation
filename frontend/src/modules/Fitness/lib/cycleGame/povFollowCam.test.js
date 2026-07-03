import { describe, it, expect } from 'vitest';
import { povFollowCam, horizonChipState } from './povFollowCam.js';

describe('povFollowCam', () => {
  it('spans from ahead-of-leader to last place', () => {
    const box = povFollowCam({ leaderZ: -100, lastZ: -40, aheadM: 25, minSpanM: 20, roadHalfW: 4 });
    expect(box.min.z).toBeCloseTo(-125); // leaderZ - aheadM (most negative)
    expect(box.max.z).toBeCloseTo(-40);  // lastZ (least negative)
  });

  it('uses ±roadHalfW for x', () => {
    const box = povFollowCam({ leaderZ: -50, lastZ: -50, roadHalfW: 4 });
    expect(box.min.x).toBeCloseTo(-4);
    expect(box.max.x).toBeCloseTo(4);
  });

  it('expands a bunched field to minSpanM (max-zoom cap)', () => {
    const tight = povFollowCam({ leaderZ: -50, lastZ: -48, aheadM: 5, minSpanM: 20, roadHalfW: 4 });
    const span = tight.max.z - tight.min.z;
    expect(span).toBeCloseTo(20);
    // expansion is symmetric about the raw midpoint
    const rawMid = ((-50 - 5) + -48) / 2;
    expect((tight.min.z + tight.max.z) / 2).toBeCloseTo(rawMid);
  });

  it('does not shrink a spread field below its natural span', () => {
    const box = povFollowCam({ leaderZ: -200, lastZ: -40, aheadM: 25, minSpanM: 20, roadHalfW: 4 });
    expect(box.max.z - box.min.z).toBeCloseTo(185);
  });

  it('handles a single rider (leaderZ === lastZ)', () => {
    const box = povFollowCam({ leaderZ: -60, lastZ: -60, aheadM: 25, minSpanM: 20, roadHalfW: 4 });
    expect(box.min.z).toBeLessThan(box.max.z);
    expect(box.max.z - box.min.z).toBeCloseTo(25); // aheadM ≥ minSpanM
  });
});

describe('horizonChipState', () => {
  it('hides the chip for a small gap', () => {
    const st = horizonChipState({ gapM: 40, wasShown: false, showAtM: 120 });
    expect(st.show).toBe(false);
    expect(st.text).toBe(null);
  });

  it('shows the chip once the true gap exceeds showAtM', () => {
    const st = horizonChipState({ gapM: 130, wasShown: false, showAtM: 120 });
    expect(st.show).toBe(true);
    expect(st.text).toBe('LEADER +130 m');
  });

  it('does not flicker at the boundary (hysteresis band between 0.9X and X)', () => {
    // In the band (108–120 m): stays hidden if it was hidden, stays shown if shown.
    const gap = 115;
    expect(horizonChipState({ gapM: gap, wasShown: false, showAtM: 120 }).show).toBe(false);
    expect(horizonChipState({ gapM: gap, wasShown: true, showAtM: 120 }).show).toBe(true);
  });

  it('hides again only once the gap drops below 0.9X', () => {
    expect(horizonChipState({ gapM: 107, wasShown: true, showAtM: 120 }).show).toBe(false);
    expect(horizonChipState({ gapM: 109, wasShown: true, showAtM: 120 }).show).toBe(true);
  });

  it('rounds the reported gap and clamps negatives to 0', () => {
    expect(horizonChipState({ gapM: 311.6, wasShown: true, showAtM: 120 }).text).toBe('LEADER +312 m');
    const neg = horizonChipState({ gapM: -5, wasShown: false, showAtM: 120 });
    expect(neg.show).toBe(false);
    expect(neg.gapM).toBe(0);
  });
});
