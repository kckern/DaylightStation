import { describe, it, expect } from 'vitest';
import {
  computeOverlayBoxes, boxesIntersect, boxWithin, multiplierChipBox,
  MULTIPLIER_CHIP_MIN_WIDTH_PX, MULTIPLIER_CHIP_MIN_HEIGHT_PX
} from './speedometerOverlayLayout.js';

// audit UX §3.1-3.2 — the old fixed-percentage/fixed-rem overlay geometry
// collided (rpm digits atop the 12-o'clock tick label) or collapsed (badge
// onto a 38px wide-mode avatar). The T10 fix is ratio-based so it's provably
// collision-free at any gauge size; this test checks the two sizes the audit
// named explicitly — 96 (wide-mode minGauge floor) and 360 (solo/sidebar max).
describe('speedometerOverlayLayout — bounding-box invariants', () => {
  const SIZES = [96, 360];
  const PAIRS = [
    ['avatar', 'badge'],
    ['avatar', 'speed'],
    ['avatar', 'rpm'],
    ['badge', 'speed'],
    ['badge', 'rpm'],
    ['speed', 'rpm']
  ];

  it.each(SIZES)('every overlay box fits inside the gauge box at gaugePx=%i', (gaugePx) => {
    const boxes = computeOverlayBoxes(gaugePx);
    expect(boxWithin(boxes.avatar, boxes.gauge)).toBe(true);
    expect(boxWithin(boxes.badge, boxes.gauge)).toBe(true);
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
      const { speed, gauge } = computeOverlayBoxes(gaugePx);
      expect(speed.y).toBeGreaterThanOrEqual(gauge.height / 2);
    }
  });

  // 2026-07-02 legibility fix: the multiplier badge used to be a circle capped
  // at 30% of the avatar's diameter, which shrank to an unreadable ~11px dot at
  // the wide-mode floor (96px gauge) — the number had to move out to tiny
  // inline text elsewhere. It's now a PILL, sized off the gauge (not the
  // avatar) with an absolute px floor, so it never drops below a legible size.
  it('the multiplier pill never shrinks below its legible min-size floor, even at the smallest gauge', () => {
    const chip = multiplierChipBox(96); // wide-mode floor — the exact size that broke before
    expect(chip.width).toBeGreaterThanOrEqual(MULTIPLIER_CHIP_MIN_WIDTH_PX);
    expect(chip.height).toBeGreaterThanOrEqual(MULTIPLIER_CHIP_MIN_HEIGHT_PX);
    // Comfortably wide enough to hold "×1.4" / "×1.6" at a 1.1rem (~17.6px) font.
    expect(chip.width).toBeGreaterThanOrEqual(50);
  });

  it('the multiplier pill grows past its floor at larger gauges', () => {
    const small = multiplierChipBox(96);
    const big = multiplierChipBox(360);
    expect(big.width).toBeGreaterThan(small.width);
    expect(big.height).toBeGreaterThan(small.height);
  });

  it('the multiplier pill sits inside the gauge at the top-right, never overlapping the avatar', () => {
    for (const gaugePx of [96, 150, 220, 280, 360]) {
      const { avatar, badge, gauge } = computeOverlayBoxes(gaugePx);
      expect(boxWithin(badge, gauge)).toBe(true);
      expect(boxesIntersect(badge, avatar)).toBe(false);
      // top-right quadrant: right-anchored, and above the gauge's vertical center.
      expect(badge.x + badge.width).toBeLessThanOrEqual(gauge.width);
      expect(badge.y).toBeLessThan(gauge.height / 2);
    }
  });

  it('scales linearly — doubling gaugePx doubles avatar/speed/rpm box dimensions', () => {
    // The multiplier pill is excluded here — it has a min-size floor, so it is
    // deliberately NOT linear at small sizes (that's the whole point of the fix).
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
