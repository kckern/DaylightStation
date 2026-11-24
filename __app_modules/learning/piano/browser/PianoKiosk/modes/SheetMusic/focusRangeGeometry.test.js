import { describe, it, expect } from 'vitest';
import { passageNumberPlacements, passageNumberHeadroom, PASSAGE_NUMBER_LIFT, PASSAGE_NUMBER_ROOM } from './focusRangeGeometry.js';

// One system, two bars of two steps. The cursor stands on the staff (200-300);
// the second bar's first note climbs on ledger lines to 150.
const measures = [{ firstStep: 0, lastStep: 1 }, { firstStep: 2, lastStep: 3 }];
const cursorBoxes = [0, 1, 2, 3].map((i) => ({ x: 100 + i * 50, top: 200, bottom: 300 }));
const stepBoxes = cursorBoxes.map((box, i) => (i === 2 ? { ...box, top: 150 } : box));
const measureRects = [{ left: 80, right: 180, system: 0 }, { left: 180, right: 280, system: 0 }];
const geometry = { measures, stepBoxes, cursorBoxes, measureRects };
const passages = [{ id: 'a', inMeasure: 0, outMeasure: 0 }, { id: 'b', inMeasure: 1, outMeasure: 1 }];

describe('passageNumberPlacements', () => {
  it('stands each number a fixed lift over the staff, not over a high note elsewhere on the system', () => {
    const [a] = passageNumberPlacements(passages, geometry);
    expect(a).toMatchObject({ id: 'a', left: 84, anchor: 188 });
    expect(a.top).toBe(188 - PASSAGE_NUMBER_LIFT);
  });

  it('rises over ink in its own column (a slur, a stem) so it never sits on the music', () => {
    // A slur over bar 1 reaching 160, and the system above's stems far higher up (off to one side of the room).
    const ink = [[160, 175, 90, 170, 'slur'], [20, 60, 90, 170, 'system above']];
    const [a, b] = passageNumberPlacements(passages, { ...geometry, ink });
    expect(a.anchor).toBe(160);
    expect(a.top).toBe(160 - PASSAGE_NUMBER_LIFT);
    // Bar 2's column has no ink over it: its number keeps the staff anchor.
    expect(b.anchor).toBe(188);
  });

  it('ignores ink outside the column and strips that carry no x', () => {
    const ink = [[150, 170, 400, 420], [100, 190]];
    expect(passageNumberPlacements(passages, { ...geometry, ink })[0].anchor).toBe(188);
  });

  it('asks the engraving for the room plus the band pad', () => {
    expect(passageNumberHeadroom()).toBe(PASSAGE_NUMBER_ROOM + 12);
  });
});
