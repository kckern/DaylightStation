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

  it('ends the page where the ink does when every system stops short, so a few bars fill the stage', () => {
    const short = { width: 1200, height: 200,
      staffBoxes: [{ system: 0, staff: 0, top: 80, left: 40, right: 640, lineSpacing: 10 }],
      measureBounds: [{ left: 40, right: 340, top: 60, bottom: 140 }, { left: 340, right: 640, top: 60, bottom: 140 }] };
    const result = resolvePassageLayout({ layout: short, viewport: { width: 1200, height: 400 }, keepWholePassage: true });
    // The left margin is mirrored on the right: 640 + 40, not the engraver's 1200.
    expect(result.viewBox).toMatchObject({ x: 0, width: 680 });
    // A page whose first system reaches the edge keeps the engraver's width.
    expect(resolvePassageLayout({ layout: grand, viewport: { width: 1200, height: 800 }, keepWholePassage: true }).viewBox.width).toBe(1200);
  });

  it('frames the measured ink on every side, so a passage is as large as its stage allows', () => {
    // Two short systems in the middle of a tall page: the engraver's page margins are not the passage.
    const loose = { width: 1200, height: 720, ink: { x: 150, y: 190, width: 700, height: 320 },
      staffBoxes: [{ system: 0, staff: 0, top: 220, left: 160, right: 850, lineSpacing: 10 }, { system: 1, staff: 0, top: 440, left: 160, right: 600, lineSpacing: 10 }],
      measureBounds: [{ left: 160, right: 850, top: 200, bottom: 280 }, { left: 160, right: 600, top: 420, bottom: 500 }] };
    const framed = resolvePassageLayout({ layout: loose, viewport: { width: 1200, height: 440 }, keepWholePassage: true });
    // One and a half staff spaces of air beside the ink, two above and below
    // (room for a verdict mark at the highest and lowest noteheads), and nothing else.
    expect(framed.viewBox).toEqual({ x: 135, y: 170, width: 730, height: 360 });
    const unmeasured = resolvePassageLayout({ layout: { ...loose, ink: null }, viewport: { width: 1200, height: 440 }, keepWholePassage: true });
    expect(framed.projectedStaffSpacePx).toBeGreaterThan(unmeasured.projectedStaffSpacePx * 1.5);
    // Ink that the staves and bars outrun (a stale measurement) never crops them.
    const stale = resolvePassageLayout({ layout: { ...loose, ink: { x: 300, y: 300, width: 100, height: 50 } }, viewport: { width: 1200, height: 440 }, keepWholePassage: true });
    expect(stale.viewBox.x).toBeLessThanOrEqual(160 - 15); expect(stale.viewBox.y).toBeLessThanOrEqual(200 - 15);
    expect(stale.viewBox.x + stale.viewBox.width).toBeGreaterThanOrEqual(850 + 15); expect(stale.viewBox.y + stale.viewBox.height).toBeGreaterThanOrEqual(500 + 15);
    // A system the child is following keeps the same horizontal frame.
    const focused = resolvePassageLayout({ layout: loose, viewport: { width: 300, height: 60 }, cursorSystem: 1 });
    expect(focused).toMatchObject({ mode: 'system', viewBox: { x: 135, width: 730 } });
  });

  it('includes every stave when the engraved SVG reports a height above its actual bottom staff', () => {
    const stalePageHeight = { ...grand, height: 480 };
    const result = resolvePassageLayout({ layout: stalePageHeight, viewport: { width: 1200, height: 800 }, cursorSystem: 0 });
    expect(result.viewBox.y + result.viewBox.height).toBeGreaterThanOrEqual(560);
  });

  it('keeps both grand-staff systems visible in a constrained practice viewport', () => {
    const result = resolvePassageLayout({ layout: grand, viewport: { width: 1200, height: 420 }, cursorSystem: 1, keepWholePassage: true });
    expect(result).toMatchObject({ mode: 'full', activeSystem: null, compact: true, systemCount: 2 });
    expect(result.viewBox.y).toBe(0);
    expect(result.viewBox.y + result.viewBox.height).toBeGreaterThanOrEqual(560);
  });

  it('keeps the complete passage when compact chrome is required', () => {
    expect(resolvePassageLayout({ layout: grand, viewport: { width: 500, height: 160 }, cursorSystem: 0, keepWholePassage: true })).toMatchObject({ mode: 'full', compact: true, activeSystem: null });
  });

  it('preserves readable system focus for constrained score passages outside Learn Lab', () => {
    expect(resolvePassageLayout({ layout: grand, viewport: { width: 1200, height: 420 }, cursorSystem: 1 })).toMatchObject({ mode: 'system', compact: false, activeSystem: 1 });
  });

  it('maps a cursor step to the nearest complete system', () => {
    expect(systemForStep({ top: 430, bottom: 450 }, grand.staffBoxes)).toBe(1);
    expect(systemForStep({ top: 120, bottom: 140 }, grand.staffBoxes)).toBe(0);
  });
});
