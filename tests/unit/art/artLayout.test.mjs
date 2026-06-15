import { describe, it, expect } from 'vitest';
import { boxAspect, artLayout } from '../../../frontend/src/screen-framework/widgets/artLayout.js';

const FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
const CFG = { frame: FRAME, matMargin: 4, crop: 0.08 };

describe('boxAspect', () => {
  it('returns the cell aspect when within the crop budget', () => {
    expect(boxAspect(1.5, 1.5, 0.08)).toBeCloseTo(1.5, 5);
  });
  it('clamps to the widen cap (crop top/bottom) for a tall cell vs wide art', () => {
    expect(boxAspect(3.0, 0.7, 0.08)).toBeCloseTo(0.7 / 0.84, 5);
  });
  it('clamps to the narrow cap (crop sides) for a wide art vs narrow cell', () => {
    expect(boxAspect(0.3, 1.6, 0.08)).toBeCloseTo(1.6 * 0.84, 5);
  });
});

describe('artLayout single', () => {
  it('returns one centered panel with a clamped box aspect', () => {
    const L = artLayout({ mode: 'single', ratios: [1.4], ...CFG });
    expect(L.justify).toBe('center');
    expect(L.panels).toHaveLength(1);
    const c = 0.08; const ar = 1.4;
    expect(L.panels[0].boxAspect).toBeGreaterThanOrEqual(ar * (1 - 2 * c) - 1e-9);
    expect(L.panels[0].boxAspect).toBeLessThanOrEqual(ar / (1 - 2 * c) + 1e-9);
    expect(L.panels[0].heightPct).toBeGreaterThan(0);
    expect(L.panels[0].heightPct).toBeLessThanOrEqual(100.0001);
    expect(L.panels[0].centerXPct).toBeCloseTo((FRAME.left + (100 - FRAME.left - FRAME.right) / 2), 0);
  });
});

describe('artLayout diptych', () => {
  it('two panels, equal three gaps, within the window, crop within cap', () => {
    const r1 = 0.79, r2 = 0.64, c = 0.08;
    const L = artLayout({ mode: 'diptych', ratios: [r1, r2], ...CFG });
    expect(L.justify).toBe('space-evenly');
    expect(L.panels).toHaveLength(2);
    for (const [p, r] of [[L.panels[0], r1], [L.panels[1], r2]]) {
      expect(p.boxAspect).toBeGreaterThanOrEqual(r * (1 - 2 * c) - 1e-9);
      expect(p.boxAspect).toBeLessThanOrEqual(r / (1 - 2 * c) + 1e-9);
    }
    const SW = 16, SH = 9;
    const openTop = (FRAME.top + CFG.matMargin) / 100 * SH;
    const openBot = SH - (FRAME.bottom + CFG.matMargin) / 100 * SH;
    const openHpx = openBot - openTop;
    const Hpx = (L.panels[0].heightPct / 100) * openHpx;
    const w1 = Hpx * L.panels[0].boxAspect, w2 = Hpx * L.panels[1].boxAspect;
    const openLeft = FRAME.left / 100 * SW, openRight = SW - FRAME.right / 100 * SW;
    const c1 = (L.panels[0].centerXPct / 100) * SW, c2 = (L.panels[1].centerXPct / 100) * SW;
    const gapL = (c1 - w1 / 2) - openLeft;
    const gapM = (c2 - w2 / 2) - (c1 + w1 / 2);
    const gapR = openRight - (c2 + w2 / 2);
    expect(gapM).toBeCloseTo(gapL, 3);
    expect(gapR).toBeCloseTo(gapL, 3);
    expect(gapL).toBeGreaterThan(0);
  });

  it('panels share a common height', () => {
    const L = artLayout({ mode: 'diptych', ratios: [0.7, 0.9], ...CFG });
    expect(L.panels[0].heightPct).toBeCloseTo(L.panels[1].heightPct, 6);
  });
});

describe('artLayout widthPct', () => {
  it('single panel reports widthPct (% of stage)', () => {
    const out = artLayout({ mode: 'single', ratios: [1.6], ...CFG });
    expect(out.panels[0].widthPct).toBeGreaterThan(0);
    expect(out.panels[0].widthPct).toBeLessThanOrEqual(100);
  });

  it('diptych panels report widthPct', () => {
    const out = artLayout({ mode: 'diptych', ratios: [0.75, 0.7], ...CFG });
    expect(out.panels[0].widthPct).toBeGreaterThan(0);
    expect(out.panels[1].widthPct).toBeGreaterThan(0);
  });
});
