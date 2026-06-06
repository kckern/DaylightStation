import { describe, it, expect } from 'vitest';
import { povFollowCam } from './povFollowCam.js';

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
