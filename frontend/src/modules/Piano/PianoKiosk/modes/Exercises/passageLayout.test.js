import { describe, expect, it } from 'vitest';
import { resolvePassageLayout, systemForStep } from './passageLayout.js';

const grand = {
  width: 1200, height: 720,
  staffBoxes: [
    { system: 0, staff: 0, top: 80, left: 40, right: 1160, lineSpacing: 10 },
    { system: 0, staff: 1, top: 180, left: 40, right: 1160, lineSpacing: 10 },
    { system: 1, staff: 0, top: 400, left: 40, right: 1160, lineSpacing: 10 },
    { system: 1, staff: 1, top: 500, left: 40, right: 1160, lineSpacing: 10 },
  ],
  measureBounds: [
    { left: 40, right: 600, top: 50, bottom: 250 },
    { left: 600, right: 1160, top: 50, bottom: 250 },
    { left: 40, right: 600, top: 370, bottom: 570 },
    { left: 600, right: 1160, top: 370, bottom: 570 },
  ],
};

describe('passage layout policy', () => {
  it('uses the full score only when every staff remains readable', () => {
    expect(resolvePassageLayout({ layout: grand, viewport: { width: 1200, height: 800 }, cursorSystem: 0 })).toMatchObject({ mode: 'full', compact: false, systemCount: 2 });
  });

  it('includes every stave when the engraved SVG reports a height above its actual bottom staff', () => {
    const stalePageHeight = { ...grand, height: 480 };
    const result = resolvePassageLayout({ layout: stalePageHeight, viewport: { width: 1200, height: 800 }, cursorSystem: 0 });
    expect(result.viewBox.y + result.viewBox.height).toBeGreaterThanOrEqual(560);
  });

  it('focuses one complete grand-staff system instead of clipping the second line', () => {
    const result = resolvePassageLayout({ layout: grand, viewport: { width: 1200, height: 420 }, cursorSystem: 1 });
    expect(result).toMatchObject({ mode: 'system', activeSystem: 1, compact: false, systemCount: 2 });
    expect(result.viewBox.y).toBeLessThanOrEqual(400);
    expect(result.viewBox.y + result.viewBox.height).toBeGreaterThanOrEqual(540);
    expect(result.projectedStaffSpacePx).toBeGreaterThanOrEqual(8);
  });

  it('requests compact chrome when even one whole system is too small', () => {
    expect(resolvePassageLayout({ layout: grand, viewport: { width: 500, height: 160 }, cursorSystem: 0 })).toMatchObject({ mode: 'system', compact: true });
  });

  it('maps a cursor step to the nearest complete system', () => {
    expect(systemForStep({ top: 430, bottom: 450 }, grand.staffBoxes)).toBe(1);
    expect(systemForStep({ top: 120, bottom: 140 }, grand.staffBoxes)).toBe(0);
  });
});
