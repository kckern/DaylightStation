import { describe, it, expect } from 'vitest';
import { stepZoom, xForDist, pickGridMeters, gridLines, niceRound, ZOOM_DEFAULTS } from './leaderAnchoredZoom.js';

const { rightPct, homePct, lowPct, highPct } = ZOOM_DEFAULTS;

describe('leaderAnchoredZoom', () => {
  it('first tick puts last place at home (25%) and pins the leader at right', () => {
    const k = stepZoom(null, 100, 40, {}); // gap 60
    expect(xForDist(40, 100, k)).toBeCloseTo(homePct, 6);
    expect(xForDist(100, 100, k)).toBeCloseTo(rightPct, 6);
  });

  it('holds the zoom while last place stays in the [15%,33%] band', () => {
    const k0 = stepZoom(null, 100, 40, {});      // last at 25%
    const k1 = stepZoom(k0, 110, 55, {});         // gap 55 → last drifts toward 33% but in band
    expect(k1).toBe(k0);                          // unchanged
    const lastX = xForDist(55, 110, k1);
    expect(lastX).toBeGreaterThan(lowPct);
    expect(lastX).toBeLessThan(highPct);
  });

  it('zooms OUT when last place drifts left past 15% (gap grew), resetting to 25%', () => {
    const k0 = stepZoom(null, 100, 40, {});       // gap 60, last at 25%
    // Leader pulls way ahead → gap 140 at held zoom would push last well left of 15%.
    const heldX = xForDist(40, 180, k0);          // dist unchanged, leader 180 → gap 140
    expect(heldX).toBeLessThan(lowPct);
    const k1 = stepZoom(k0, 180, 40, {});
    expect(k1).not.toBe(k0);
    expect(k1).toBeLessThan(k0);                  // zoomed out (fewer width per metre)
    expect(xForDist(40, 180, k1)).toBeCloseTo(homePct, 6); // last reset to 25%
  });

  it('zooms IN when last place pushes right past 33% (gap shrank), resetting to 25%', () => {
    const k0 = stepZoom(null, 100, 40, {});       // gap 60, last at 25%
    const heldX = xForDist(92, 100, k0);          // last closes to gap 8 → pushes right
    expect(heldX).toBeGreaterThan(highPct);
    const k1 = stepZoom(k0, 100, 92, {});
    expect(k1).not.toBe(k0);
    expect(k1).toBeGreaterThan(k0);               // zoomed in
    expect(xForDist(92, 100, k1)).toBeCloseTo(homePct, 6);
  });

  it('clamps near-zero field gaps so k stays finite (race start)', () => {
    const k = stepZoom(null, 2, 2, {});           // everyone at ~2m, gap 0
    expect(Number.isFinite(k)).toBe(true);
    expect(k).toBeGreaterThan(0);
  });

  it('niceRound snaps to 1/2/5 ×10ⁿ', () => {
    expect(niceRound(0.9)).toBe(1);
    expect(niceRound(3)).toBe(2);
    expect(niceRound(6)).toBe(5);
    expect(niceRound(40)).toBe(50);
    expect(niceRound(120)).toBe(100);
  });

  it('grid interval steps up as you zoom out (k smaller → bigger metre cells)', () => {
    const kIn = stepZoom(null, 100, 90, {});      // tight gap → zoomed in
    const kOut = stepZoom(null, 1000, 200, {});   // huge gap → zoomed out
    expect(pickGridMeters(kOut)).toBeGreaterThan(pickGridMeters(kIn));
  });

  it('grid lines fall left of the leader pin and are keyed by metre', () => {
    const k = stepZoom(null, 100, 40, {});
    const lines = gridLines(100, k, pickGridMeters(k));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.x <= rightPct + 0.02)).toBe(true);
    expect(lines.every((l) => Number.isInteger(l.m))).toBe(true);
  });
});

describe('gridLines coarsening', () => {
  it('never exceeds maxLines and covers the whole visible span (no truncation)', () => {
    const lines = gridLines(10000, 0.00002, 1, { maxLines: 24 });
    expect(lines.length).toBeLessThanOrEqual(24);
    expect(lines.length).toBeGreaterThan(2);
    const ms = lines.map((l) => l.m);
    const span = 0.88 / 0.00002; // rightPct / k metres visible
    expect(Math.min(...ms)).toBeLessThan(10000 - span * 0.5); // a genuinely-near line survives
    expect(Math.max(...ms)).toBeGreaterThan(10000 - 200);     // a near-leader line survives
  });
  it('keeps the requested interval when it already fits', () => {
    const lines = gridLines(500, 0.0017, 50, { maxLines: 24 });
    const ms = lines.map((l) => l.m).sort((a, b) => a - b);
    if (ms.length >= 2) expect(ms[1] - ms[0]).toBe(50);
  });
});
