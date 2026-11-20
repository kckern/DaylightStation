import { describe, it, expect } from 'vitest';
import { cropPlan, cropCanvasSize, isBlank, CROP_MAX_SIDE, CROP_MIN_SIDE } from './jevCrops.js';

const inRange = (n) => n >= CROP_MIN_SIDE && n <= CROP_MAX_SIDE;

describe('cropCanvasSize', () => {
  it('pads a small crop up to the minimum side, after at most 2x upscale', () => {
    const s = cropCanvasSize(100, 50);
    expect(s).toMatchObject({ scale: 2, contentWidth: 200, contentHeight: 100, width: 280, height: 280, offsetX: 40, offsetY: 90 });
  });
  it('shrinks a wide crop to the maximum side and pads its height', () => {
    const s = cropCanvasSize(4000, 300);
    expect(s.width).toBe(1568);
    expect(s.height).toBe(280);
    expect(s.contentHeight).toBeLessThan(280);
  });
  it('keeps every side in Jev\'s range for many shapes', () => {
    for (const [w, h] of [[1, 1], [279, 281], [600, 400], [1568, 1568], [5000, 5000], [10000, 20], [20, 10000], [300.4, 120.7]]) {
      const s = cropCanvasSize(w, h);
      expect(inRange(s.width) && inRange(s.height), `${w}x${h} → ${s.width}x${s.height}`).toBe(true);
      expect(s.offsetX + s.contentWidth).toBeLessThanOrEqual(s.width);
      expect(s.offsetY + s.contentHeight).toBeLessThanOrEqual(s.height);
    }
  });
  it('refuses an empty box', () => {
    expect(cropCanvasSize(0, 100)).toBeNull();
  });
});

describe('cropPlan', () => {
  // 12 bars, 4 per system: system s spans y 100s+50 .. 100s+110, bars 100 px wide.
  const bounds = Array.from({ length: 12 }, (_, i) => {
    const sys = Math.floor(i / 4);
    const col = i % 4;
    return { left: col * 100, right: col * 100 + 100, top: sys * 200 + 50, bottom: sys * 200 + 110 };
  });
  const measures = bounds.map((_, index) => ({ index }));

  it('inside a system: one strip of two bars either side, marker on the barline', () => {
    const plan = cropPlan(measures, bounds, 1);
    expect(plan.strips).toEqual([{ x: 0, y: 26, width: 406, height: 108, dx: 0 }]);
    expect(plan.marker).toEqual({ x: 200, y: 24 });
  });

  it('never reaches into the next system for the bars after a barline near the end of a line', () => {
    // Barline after bar 2 (third on its system): right side is bar 3 only, same system.
    const plan = cropPlan(measures, bounds, 2);
    expect(plan.strips).toHaveLength(1);
    expect(plan.strips[0]).toMatchObject({ x: 94, width: 312 });
    expect(plan.marker.x).toBe(300 - 94);
  });

  it('at a system break: two strips side by side, marker at the seam', () => {
    // Barline after bar 3 ends system 0; bars 4-5 open system 1.
    const plan = cropPlan(measures, bounds, 3);
    expect(plan.strips).toHaveLength(2);
    const [a, b] = plan.strips;
    expect(a).toMatchObject({ x: 194, y: 26, width: 212 });
    expect(b).toMatchObject({ x: 0, y: 226, width: 206 });
    expect(b.dx).toBe(a.width + 16);
    expect(plan.width).toBe(a.width + 16 + b.width);
    expect(plan.marker).toEqual({ x: a.width + 8, y: 24 });
  });

  it('a jump in engraved bars (a skipped all-rest bar) splits the window too', () => {
    // Layout positions 0..3 are engraved bars 0, 1, 3, 4 (bar 2 has no onsets).
    const skipped = [0, 1, 3, 4].map((index) => ({ index }));
    const plan = cropPlan(skipped, bounds, 1);
    expect(plan.strips).toHaveLength(2);
    expect(plan.strips[0]).toMatchObject({ x: 0, width: 206 });
    expect(plan.strips[1]).toMatchObject({ x: 294, y: 26 });
    // Bar 4 (next system) is not consecutive with bar 3 on screen: right side is bar 3 alone.
    expect(plan.strips[1].width).toBe(112);
  });

  it('a repeat jump back is two strips as well', () => {
    const repeat = [0, 1, 0, 1].map((index) => ({ index }));
    expect(cropPlan(repeat, bounds, 1).strips).toHaveLength(2);
  });

  it('has no plan after the last bar or without bounds', () => {
    expect(cropPlan(measures, bounds, 11)).toBeNull();
    expect(cropPlan(measures, [], 1)).toBeNull();
    expect(cropPlan(measures, [bounds[0], null], 0)).toBeNull();
  });
});

describe('isBlank', () => {
  it('is true only when nothing but white or transparent was drawn', () => {
    const white = new Uint8ClampedArray(4 * 64).fill(255);
    expect(isBlank(white)).toBe(true);
    const inked = new Uint8ClampedArray(white);
    inked.set([0, 0, 0, 255], 4 * 32);
    expect(isBlank(inked, { step: 1 })).toBe(false);
    expect(isBlank(new Uint8ClampedArray(4 * 64))).toBe(true);
  });
});
