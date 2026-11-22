import { describe, it, expect } from 'vitest';
import { makeLinkPlan, keyframesCss, mergeIntervals, intersectIntervals, REACH_PERCENT, LINK_PLAN } from './linkCurve.js';

/** A seeded generator, so a plan can be reproduced. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Intervals (in ms) where a side's width does not change for at least minMs. */
function flats(frames, linkMs, minMs = 300) {
  const out = [];
  for (let k = 1; k < frames.length; k += 1) {
    const a = frames[k - 1]; const b = frames[k];
    if (b.width === a.width && (b.at - a.at) * linkMs >= minMs) out.push([a.at * linkMs, b.at * linkMs]);
  }
  return out;
}

describe('makeLinkPlan', () => {
  const seeds = Array.from({ length: 40 }, (_, k) => k + 1);
  const holds = [5000, 6400, 8100, 10000];

  it('always arrives at the full reach exactly when the hold ends, never going back', () => {
    for (const seed of seeds) for (const ms of holds) {
      const plan = makeLinkPlan(ms, seeded(seed));
      for (const side of [plan.left, plan.right]) {
        expect(side[0]).toEqual({ at: 0, width: 0 });
        expect(side.at(-1)).toEqual({ at: 1, width: REACH_PERCENT });
        for (let k = 1; k < side.length; k += 1) {
          expect(side[k].at).toBeGreaterThan(side[k - 1].at);
          expect(side[k].width).toBeGreaterThanOrEqual(side[k - 1].width);
        }
      }
    }
  });

  it('has real dead stops where the whole link waits, inside the stop budget', () => {
    for (const seed of seeds) for (const ms of holds) {
      const plan = makeLinkPlan(ms, seeded(seed));
      expect(plan.stalls.length).toBeGreaterThanOrEqual(1);
      for (const [a, b] of plan.stalls) {
        expect(b - a).toBeGreaterThan(150);
        expect(a).toBeGreaterThanOrEqual(LINK_PLAN.window[0] * ms - 1);
        expect(b).toBeLessThanOrEqual(LINK_PLAN.window[1] * ms + 1);
      }
      for (const side of [plan.left, plan.right]) {
        const stopped = flats(side, ms).reduce((s, [a, b]) => s + (b - a), 0);
        expect(stopped).toBeLessThanOrEqual(LINK_PLAN.stallBudget * ms + 1);
        // Both lines really are frozen through each shared stop.
        for (const [a, b] of plan.stalls) {
          const covering = flats(side, ms, 1).some(([fa, fb]) => fa <= a + 1 && fb >= b - 1);
          expect(covering).toBe(true);
        }
      }
    }
  });

  it('differs between plays and between the two sides', () => {
    const a = makeLinkPlan(7000, seeded(1));
    const b = makeLinkPlan(7000, seeded(2));
    expect(a.left).not.toEqual(b.left);
    expect(a.left).not.toEqual(a.right);
  });

  it('is reproducible from its random source', () => {
    expect(makeLinkPlan(7000, seeded(9))).toEqual(makeLinkPlan(7000, seeded(9)));
  });
});

describe('interval helpers', () => {
  it('merges and intersects', () => {
    expect(mergeIntervals([[5, 8], [1, 3], [2, 4]])).toEqual([[1, 4], [5, 8]]);
    expect(intersectIntervals([[0, 4], [6, 10]], [[3, 7]])).toEqual([[3, 4], [6, 7]]);
  });
});

describe('keyframesCss', () => {
  it('writes one @keyframes rule', () => {
    expect(keyframesCss('x', [{ at: 0, width: 0 }, { at: 0.5, width: 10 }, { at: 1, width: 44 }]))
      .toBe('@keyframes x{0%{width:0%}50%{width:10%}100%{width:44%}}');
  });
});
