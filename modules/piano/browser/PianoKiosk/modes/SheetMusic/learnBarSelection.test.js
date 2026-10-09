import { describe, expect, it } from 'vitest';
import { completeBarSelection, moveBarEdge, validBarRange } from './learnBarSelection.js';

describe('Learn bar selection', () => {
  it('treats both taps as whole bars, even in reverse order or on the same bar', () => {
    expect(completeBarSelection(8, 3)).toEqual({ inMeasure: 3, outMeasure: 8 });
    expect(completeBarSelection(4, 4)).toEqual({ inMeasure: 4, outMeasure: 4 });
  });

  it('moves one handle without reversing the range', () => {
    expect(moveBarEdge({ inMeasure: 3, outMeasure: 8 }, 'in', 6))
      .toEqual({ inMeasure: 6, outMeasure: 8 });
    expect(moveBarEdge({ inMeasure: 3, outMeasure: 8 }, 'out', 1))
      .toEqual({ inMeasure: 3, outMeasure: 3 });
  });

  it('rejects a saved range outside a revised score', () => {
    expect(validBarRange({ inMeasure: 2, outMeasure: 5 }, 8)).toBe(true);
    expect(validBarRange({ inMeasure: 2, outMeasure: 8 }, 8)).toBe(false);
    expect(validBarRange({ inMeasure: -1, outMeasure: 3 }, 8)).toBe(false);
  });
});
