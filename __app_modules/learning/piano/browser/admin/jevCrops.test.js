import { describe, it, expect } from 'vitest';
import { cropBox, cropCanvasSize, CROP_MAX_SIDE, CROP_MIN_SIDE } from './jevCrops.js';

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

describe('cropBox', () => {
  const measures = [0, 1, 2, 3, 4].map((index) => ({ index }));
  const bounds = [0, 1, 2, 3, 4].map((i) => ({ left: i * 100, right: i * 100 + 100, top: 50, bottom: 110 }));
  it('spans two bars either side of the barline and marks it', () => {
    expect(cropBox(measures, bounds, 1)).toEqual({ x: 0, y: 26, width: 406, height: 108, markerX: 200 });
  });
  it('clamps at the start of the piece', () => {
    const box = cropBox(measures, bounds, 0);
    expect(box.markerX).toBe(100);
    expect(box.x).toBe(0);
    expect(box.width).toBe(306);
  });
  it('maps positions to engraved bars by index', () => {
    const repeated = [{ index: 0 }, { index: 1 }, { index: 3 }];
    expect(cropBox(repeated, bounds, 1).markerX).toBe(200);
    expect(cropBox(repeated, bounds, 1).width).toBe(406);
  });
  it('has no box after the last bar or without bounds', () => {
    expect(cropBox(measures, bounds, 4)).toBeNull();
    expect(cropBox(measures, [], 1)).toBeNull();
  });
});
