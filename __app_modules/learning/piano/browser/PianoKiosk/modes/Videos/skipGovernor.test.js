import { describe, it, expect } from 'vitest';
import { createSkipGovernor, skipTarget, SKIP_BURST_GAP_MS, SKIP_BURST_MAX_FORWARD_SEC } from './skipGovernor.js';

describe('createSkipGovernor', () => {
  it('a mashed +30 (presses 250 ms apart) moves at most the burst cap', () => {
    let t = 0;
    const g = createSkipGovernor({ now: () => t });
    let total = 0;
    for (let i = 0; i < 9; i += 1) { total += g.admit(30); t += 250; }
    expect(total).toBe(SKIP_BURST_MAX_FORWARD_SEC);
  });

  it('a deliberate double tap still gets +60', () => {
    let t = 0;
    const g = createSkipGovernor({ now: () => t });
    expect(g.admit(30)).toBe(30);
    t += 300;
    expect(g.admit(30)).toBe(30);
  });

  it('a pause longer than the gap starts a new burst', () => {
    let t = 0;
    const g = createSkipGovernor({ now: () => t });
    g.admit(30); t += 200; g.admit(30); t += 200;
    expect(g.admit(30)).toBe(0);
    t += SKIP_BURST_GAP_MS;
    expect(g.admit(30)).toBe(30);
  });

  it('clips a partial press to what is left in the burst; back skips are never limited', () => {
    let t = 0;
    const g = createSkipGovernor({ now: () => t });
    g.admit(45); t += 100;
    expect(g.admit(30)).toBe(15);
    t += 100;
    expect(g.admit(-15)).toBe(-15);
    expect(g.admit(-30)).toBe(-30);
  });
});

describe('skipTarget', () => {
  it('clamps to duration and zero', () => {
    expect(skipTarget({ current: 590, delta: 30, duration: 600 })).toBe(600);
    expect(skipTarget({ current: 10, delta: -30, duration: 600 })).toBe(0);
  });

  it('a sequential lesson cannot skip past the furthest watched point', () => {
    expect(skipTarget({ current: 100, delta: 30, duration: 600, isSequential: true, furthestWatched: 115 })).toBe(115);
    // Never moves backward because of the clamp.
    expect(skipTarget({ current: 120, delta: 30, duration: 600, isSequential: true, furthestWatched: 115 })).toBe(120);
    // Back skips are unaffected.
    expect(skipTarget({ current: 100, delta: -15, duration: 600, isSequential: true, furthestWatched: 115 })).toBe(85);
  });

  it('a free lesson skips normally', () => {
    expect(skipTarget({ current: 100, delta: 30, duration: 600, isSequential: false, furthestWatched: 0 })).toBe(130);
  });
});
