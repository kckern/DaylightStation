import { describe, it, expect } from 'vitest';
import { noteheadOffsets, accidentalColumns } from './chordLayout.js';

describe('noteheadOffsets', () => {
  it('leaves a lone note in the column', () => {
    expect(noteheadOffsets([4], 'up')).toEqual([0]);
    expect(noteheadOffsets([4], 'down')).toEqual([0]);
  });

  it('leaves a chord with no seconds in the column', () => {
    expect(noteheadOffsets([0, 2, 4], 'up')).toEqual([0, 0, 0]);
    expect(noteheadOffsets([0, 2, 4], 'down')).toEqual([0, 0, 0]);
  });

  // The rule both renderers had backwards. The head that steps aside steps
  // ACROSS THE STEM; stepping to the empty side leaves it floating away from
  // the chord with a gap where the stem should be.
  it('an up-stem pushes the UPPER note of a second across the stem, to the right', () => {
    expect(noteheadOffsets([3, 4], 'up')).toEqual([0, 1]);
  });

  it('a down-stem pushes the LOWER note of a second across the stem, to the left', () => {
    expect(noteheadOffsets([3, 4], 'down')).toEqual([-1, 0]);
  });

  it('displaces only the second of the pair in a three-note chord', () => {
    // Positions 0/3/4: the second is at the top.
    expect(noteheadOffsets([0, 3, 4], 'up')).toEqual([0, 0, 1]);
    expect(noteheadOffsets([0, 3, 4], 'down')).toEqual([0, -1, 0]);
    // ...and at the bottom.
    expect(noteheadOffsets([0, 1, 4], 'up')).toEqual([0, 1, 0]);
    expect(noteheadOffsets([0, 1, 4], 'down')).toEqual([-1, 0, 0]);
  });

  it('alternates through a run of three seconds, so no two heads share a spot', () => {
    // A displaced head has vacated the main column, so the next head up can
    // use it again — zig-zag, never two in a row on the same side.
    expect(noteheadOffsets([2, 3, 4], 'up')).toEqual([0, 1, 0]);
    expect(noteheadOffsets([2, 3, 4, 5], 'up')).toEqual([0, 1, 0, 1]);
    expect(noteheadOffsets([2, 3, 4, 5], 'down')).toEqual([-1, 0, -1, 0]);
  });

  it('treats a unison as a second — two heads cannot share one spot either', () => {
    expect(noteheadOffsets([4, 4], 'up')).toEqual([0, 1]);
  });

  it('handles an empty set', () => {
    expect(noteheadOffsets([], 'up')).toEqual([]);
  });
});

describe('accidentalColumns', () => {
  // The glyph is nearly two staff spaces tall, so on a 14-unit staff with a
  // 26-unit glyph the separation two accidentals need to share a column is
  // 26/7 ≈ 3.7 staff half-steps: a fifth (4) clears, a fourth (3) does not.
  const SEP = 26 / 7;

  it('gives a lone accidental the column nearest the heads', () => {
    expect([...accidentalColumns([{ index: 0, position: 4 }], SEP)]).toEqual([[0, 0]]);
  });

  it('lets two accidentals a fifth apart share a column', () => {
    const columns = accidentalColumns(
      [{ index: 0, position: 1 }, { index: 1, position: 5 }],
      SEP,
    );
    expect(columns.get(0)).toBe(0);
    expect(columns.get(1)).toBe(0);
  });

  // The old rule was `index % 2`: alternate regardless of distance, which took
  // a column out for accidentals that were never going to collide — and on a
  // narrow card that extra column is what ran the glyph into the clef.
  it('moves an accidental out a column only when it would be drawn through', () => {
    const columns = accidentalColumns(
      [{ index: 0, position: 2 }, { index: 1, position: 5 }],
      SEP,
    );
    // Placed top down, so the higher note takes the near column.
    expect(columns.get(1)).toBe(0);
    expect(columns.get(0)).toBe(1);
  });

  it('reuses a near column once a third accidental has cleared the first', () => {
    const columns = accidentalColumns(
      [{ index: 0, position: 0 }, { index: 1, position: 3 }, { index: 2, position: 6 }],
      SEP,
    );
    expect(columns.get(2)).toBe(0); // top
    expect(columns.get(1)).toBe(1); // a fourth below it, collides
    expect(columns.get(0)).toBe(0); // a fourth below THAT, clear of the top one
  });

  it('handles no accidentals at all', () => {
    expect(accidentalColumns([], SEP).size).toBe(0);
    expect(accidentalColumns(null, SEP).size).toBe(0);
  });
});
