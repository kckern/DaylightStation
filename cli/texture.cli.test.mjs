// cli/texture.cli.test.mjs
//
// Finding movement boundaries where there is no silence to find.
//
// Measured on the Sydney recording: only 20 of 53 boundaries produce a
// detectable gap, and loosening the silence threshold to -45dB/0.25s yields 16%
// more candidates where 2-3x is needed. Those movements run attacca — the music
// does not stop, the SCORING changes. A recitative over continuo giving way to a
// full-orchestra air is a different distribution of energy across the spectrum
// even when nothing goes quiet and nothing gets louder.
//
// So the feature is the SHAPE of the spectrum, normalised to remove loudness,
// and a boundary is where that shape changes most sharply.

import { describe, it, expect } from 'vitest';
import {
  bandProfile, textureNovelty, bestBoundaryIn, noveltyCurve,
} from './texture.cli.mjs';

/** A frame is per-second dB in four bands: bass, low-mid, presence, brilliance. */
const frame = (t, bands) => ({ t, bands });

describe('bandProfile', () => {
  it('turns dB levels into each band’s share of the energy', () => {
    const p = bandProfile([-20, -20, -20, -20]);
    expect(p).toHaveLength(4);
    p.forEach((v) => expect(v).toBeCloseTo(0.25, 6));
  });

  /**
   * LOUDNESS MUST NOT REGISTER AS TEXTURE. The same music played 10 dB louder is
   * the same movement; a profile that moved with volume would fire at every
   * crescendo and miss every attacca join.
   */
  it('is unchanged when the same texture gets louder', () => {
    const quiet = bandProfile([-40, -34, -46, -52]);
    const loud = bandProfile([-30, -24, -36, -42]);
    quiet.forEach((v, i) => expect(v).toBeCloseTo(loud[i], 6));
  });

  it('shifts when energy moves between bands', () => {
    const bassy = bandProfile([-20, -40, -40, -40]);
    const bright = bandProfile([-40, -40, -40, -20]);
    expect(bassy[0]).toBeGreaterThan(bright[0]);
    expect(bright[3]).toBeGreaterThan(bassy[3]);
  });

  /** Digital silence carries no texture and must not become NaN. */
  it('returns a flat profile for silence rather than dividing by zero', () => {
    const p = bandProfile([-120, -120, -120, -120]);
    expect(p.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('textureNovelty', () => {
  const bassy = [-20, -40, -40, -40];
  const bright = [-40, -40, -40, -20];

  it('is high where the texture changes and low where it does not', () => {
    const frames = [
      ...Array.from({ length: 30 }, (_, i) => frame(i, bassy)),
      ...Array.from({ length: 30 }, (_, i) => frame(30 + i, bright)),
    ];
    const atChange = textureNovelty(frames, 30, { halfWindowS: 10 });
    const inside = textureNovelty(frames, 15, { halfWindowS: 10 });
    expect(atChange).toBeGreaterThan(inside * 5);
  });

  it('is near zero in a passage of constant texture', () => {
    const frames = Array.from({ length: 60 }, (_, i) => frame(i, bassy));
    expect(textureNovelty(frames, 30, { halfWindowS: 10 })).toBeCloseTo(0, 6);
  });

  it('declines to judge where there is not a full window on both sides', () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(i, bassy));
    expect(textureNovelty(frames, 2, { halfWindowS: 10 })).toBeNull();
  });
});

describe('bestBoundaryIn', () => {
  const bassy = [-20, -40, -40, -40];
  const bright = [-40, -40, -40, -20];
  const frames = [
    ...Array.from({ length: 60 }, (_, i) => frame(i, bassy)),
    ...Array.from({ length: 60 }, (_, i) => frame(60 + i, bright)),
  ];

  it('finds the change inside the window it is given', () => {
    const hit = bestBoundaryIn(frames, { centreS: 55, radiusS: 20, halfWindowS: 10 });
    expect(hit.t).toBeGreaterThanOrEqual(58);
    expect(hit.t).toBeLessThanOrEqual(62);
  });

  /**
   * A WINDOW WITH NO BOUNDARY IN IT MUST SAY SO. The 33 unconfirmed predictions
   * include numbers this performance may have cut, where there is no boundary to
   * find — and returning the window's least-flat second regardless would invent
   * one, which is the failure every previous attempt made in a different form.
   */
  it('returns nothing when the window holds no real change', () => {
    const flat = Array.from({ length: 120 }, (_, i) => frame(i, bassy));
    expect(bestBoundaryIn(flat, { centreS: 60, radiusS: 20, halfWindowS: 10, minNovelty: 0.05 }))
      .toBeNull();
  });

  it('reports how far it moved from the prediction, so drift is visible', () => {
    const hit = bestBoundaryIn(frames, { centreS: 50, radiusS: 20, halfWindowS: 10 });
    expect(Math.abs(hit.offsetS)).toBeCloseTo(Math.abs(hit.t - 50), 6);
  });
});

describe('noveltyCurve', () => {
  it('scores every second that has a full window either side', () => {
    const frames = Array.from({ length: 50 }, (_, i) => frame(i, [-20, -30, -40, -50]));
    const curve = noveltyCurve(frames, { halfWindowS: 10 });
    expect(curve[0].t).toBe(10);
    // `after` spans t..t+9, so with 50 frames the last scoreable second is 40.
    expect(curve[curve.length - 1].t).toBe(40);
    expect(curve.every((c) => Number.isFinite(c.novelty))).toBe(true);
  });
});
