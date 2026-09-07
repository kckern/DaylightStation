import { describe, it, expect } from 'vitest';
import { omrAlignmentError } from './omrAlignment.mjs';

const previous = Object.fromEntries(['A', 'D', 'B', 'E', 'C', 'A', 'B', 'D', 'E', 'C', 'B', 'A']
  .map((answer, i) => [i + 1, answer]));
const shifted = (offset) => Object.fromEntries(Object.entries(previous)
  .map(([row, answer]) => [Number(row) + offset, answer]));

describe('incremental OMR alignment', () => {
  it('accepts new answers and two revisions', () => {
    expect(omrAlignmentError(previous, { ...previous, 2: 'C', 5: 'B', 26: 'E', 27: 'A' })).toBeNull();
  });
  it.each([-1, 1, -2, 2])('rejects a run shifted by %s positions', (offset) => {
    expect(omrAlignmentError(previous, shifted(offset))?.code).toBe('OMR_ALIGNMENT');
  });
  it('allows two revisions inside a shifted run and still detects it', () => {
    expect(omrAlignmentError(previous, { ...shifted(1), 4: 'A', 8: 'E' })?.code).toBe('OMR_ALIGNMENT');
  });
  it('detects a local offset after a correctly aligned prefix', () => {
    const current = { ...previous };
    for (let row = 6; row <= 12; row++) current[row + 1] = previous[row];
    current[6] = 'C';
    expect(omrAlignmentError(previous, current)?.code).toBe('OMR_ALIGNMENT');
  });
  it('does not infer an offset from blank, sparse, or repetitive evidence', () => {
    expect(omrAlignmentError({}, previous)).toBeNull();
    expect(omrAlignmentError({ 1: 'A', 2: 'B', 3: 'C' }, shifted(1))).toBeNull();
    const same = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, 'A']));
    expect(omrAlignmentError(same, { ...same, 1: 'B' })).toBeNull();
  });
  it('compares the lower bank without crossing the 25/26 boundary', () => {
    const lower = Object.fromEntries(Object.entries(previous).map(([r, v]) => [Number(r) + 25, v]));
    const current = Object.fromEntries(Object.entries(lower).map(([r, v]) => [Number(r) + 1, v]));
    expect(omrAlignmentError(lower, current)?.code).toBe('OMR_ALIGNMENT');
  });
  it('does not reject a valid unchanged scan containing multiselect marks', () => {
    const multi = { ...previous, 3: ['E', 'A'] };
    expect(omrAlignmentError(multi, { ...multi, 3: ['A', 'E'] })).toBeNull();
  });
});
