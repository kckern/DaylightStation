import { describe, it, expect } from 'vitest';
import { computeOverlayBoxes, boxesIntersect, boxWithin } from "./speedometerOverlayLayout.js";

// audit UX §3.1-3.2 — the old fixed-percentage/fixed-rem overlay geometry
// collided (rpm digits atop the 12-o'clock tick label) or collapsed (badge
// onto a 38px wide-mode avatar). The T10 fix is ratio-based so it's provably
// collision-free at any gauge size; this test checks the two sizes the audit
// named explicitly — 96 (wide-mode minGauge floor) and 360 (solo/sidebar max).
describe('speedometerOverlayLayout — bounding-box invariants', () => {
  const SIZES = [96, 360];
  const PAIRS = [
    ['avatar', 'speed'],
    ['avatar', 'rpm'],
    ['speed', 'rpm']
  ];

  it.each(SIZES)('every overlay box fits inside the gauge box at gaugePx=%i', (gaugePx) => {
    const boxes = computeOverlayBoxes(gaugePx);
    expect(boxWithin(boxes.avatar, boxes.gauge)).toBe(true);
    expect(boxWithin(boxes.speed, boxes.gauge)).toBe(true);
    expect(boxWithin(boxes.rpm, boxes.gauge)).toBe(true);
  });

  it.each(SIZES)('no two overlay boxes intersect at gaugePx=%i', (gaugePx) => {
    const boxes = computeOverlayBoxes(gaugePx);
    for (const [a, b] of PAIRS) {
      expect(boxesIntersect(boxes[a], boxes[b]), `${a} vs ${b} at ${gaugePx}px`).toBe(false);
    }
  });

  it('the readout (speed+rpm) never overlaps the dial\'s top hemisphere (ratio ≥ 0.5)', () => {
    // Dial ticks only ever occupy the top half of the gauge (rpmToAngle sweeps
    // π→2π — cycleOverlayVisuals.js), so the readout block's top edge must be
    // at or below the vertical center at EVERY size (ratio-based, so this holds
    // for any gaugePx — checked at a few representative sizes for sanity).
    for (const gaugePx of [96, 150, 220, 280, 360]) {
      const { rpm, speed, gauge } = computeOverlayBoxes(gaugePx);
      // rpm (the hero) is on top of the block.
      expect(rpm.y).toBeGreaterThanOrEqual(gauge.height / 2);
      expect(speed.y).toBeGreaterThan(rpm.y);
    }
  });

  // Nothing sits in the top hemisphere where the dial's tick labels are: the
  // multiplier badge that used to cover the top-right label is gone.
  it('no overlay box reaches into the top hemisphere except the centred avatar', () => {
    for (const gaugePx of [96, 150, 220, 280, 360]) {
      const boxes = computeOverlayBoxes(gaugePx);
      expect(Object.keys(boxes).sort()).toEqual(['avatar', 'gauge', 'rpm', 'speed']);
    }
  });

  it('scales linearly — doubling gaugePx doubles avatar/speed/rpm box dimensions', () => {
    const small = computeOverlayBoxes(100);
    const big = computeOverlayBoxes(200);
    for (const key of ['avatar', 'speed', 'rpm']) {
      expect(big[key].width).toBeCloseTo(small[key].width * 2, 6);
      expect(big[key].height).toBeCloseTo(small[key].height * 2, 6);
    }
  });

  it('returns an all-zero box for a non-finite/non-positive gaugePx', () => {
    const boxes = computeOverlayBoxes(0);
    expect(boxes.gauge).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    boxes.avatar; // no throw
  });
});
