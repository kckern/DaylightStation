import { describe, it, expect } from 'vitest';
import {
  computeOverlayBoxes, boxesIntersect, boxWithin, TAG_HEIGHT_PX, TAG_OVERHANG_PX
} from "./speedometerOverlayLayout.js";

// The gauge is the hero of its column: rpm and km/h share ONE line in the
// lower hemisphere, and the zone multiplier is a one-line tag straddling the
// dial's base (it hangs TAG_OVERHANG_PX below the gauge box, so the readout
// keeps its room at the smallest gauge). Ratio-based except the tag, whose
// text is a fixed legible size.
const SIZES = [140, 150, 190, 230, 280, 360];

describe('speedometerOverlayLayout — bounding-box invariants', () => {
  it.each(SIZES)('avatar and readout fit inside the gauge box at gaugePx=%i', (gaugePx) => {
    const boxes = computeOverlayBoxes(gaugePx);
    expect(boxWithin(boxes.avatar, boxes.gauge)).toBe(true);
    expect(boxWithin(boxes.readout, boxes.gauge)).toBe(true);
  });

  it.each(SIZES)('no two overlay boxes intersect at gaugePx=%i', (gaugePx) => {
    const boxes = computeOverlayBoxes(gaugePx);
    for (const [a, b] of [['avatar', 'readout'], ['avatar', 'tag'], ['readout', 'tag']]) {
      expect(boxesIntersect(boxes[a], boxes[b]), `${a} vs ${b} at ${gaugePx}px`).toBe(false);
    }
  });

  it.each(SIZES)('the tag straddles the dial base: one line tall, overhanging by TAG_OVERHANG_PX at %ipx', (gaugePx) => {
    const { tag, gauge } = computeOverlayBoxes(gaugePx);
    expect(tag.height).toBe(TAG_HEIGHT_PX);
    expect(tag.y + tag.height).toBe(gauge.height + TAG_OVERHANG_PX);
    expect(tag.y).toBeLessThan(gauge.height);
    expect(TAG_HEIGHT_PX).toBeLessThanOrEqual(30); // never taller than one text line
  });

  it('the readout stays in the lower hemisphere, clear of the dial labels', () => {
    for (const gaugePx of SIZES) {
      const { readout, gauge } = computeOverlayBoxes(gaugePx);
      expect(readout.y).toBeGreaterThanOrEqual(gauge.height / 2);
    }
  });

  it('only the avatar, the readout and the tag overlay the dial', () => {
    expect(Object.keys(computeOverlayBoxes(200)).sort()).toEqual(['avatar', 'gauge', 'readout', 'tag']);
  });

  it('avatar and readout scale linearly with the gauge', () => {
    const small = computeOverlayBoxes(100);
    const big = computeOverlayBoxes(200);
    for (const key of ['avatar', 'readout']) {
      expect(big[key].width).toBeCloseTo(small[key].width * 2, 6);
      expect(big[key].height).toBeCloseTo(small[key].height * 2, 6);
    }
  });

  it('returns an all-zero gauge box for a non-finite/non-positive gaugePx', () => {
    const boxes = computeOverlayBoxes(0);
    expect(boxes.gauge).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
