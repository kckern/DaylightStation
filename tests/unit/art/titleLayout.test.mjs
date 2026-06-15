import { describe, it, expect } from 'vitest';
import { layoutTitle } from '../../../frontend/src/screen-framework/widgets/titleLayout.js';

// fake measurer: width = character count
const measure = (s) => s.length;

describe('layoutTitle', () => {
  it('returns one line when it fits', () => {
    expect(layoutTitle('Short', 100, measure)).toEqual(['Short']);
  });
  it('returns [] for empty/blank', () => {
    expect(layoutTitle('', 100, measure)).toEqual([]);
    expect(layoutTitle('   ', 100, measure)).toEqual([]);
  });
  it('one line when no measurer or no width', () => {
    expect(layoutTitle('A very long title here', 0, measure)).toEqual(['A very long title here']);
    expect(layoutTitle('A very long title here', 100, null)).toEqual(['A very long title here']);
  });
  it('splits into two balanced lines when too wide', () => {
    const lines = layoutTitle('one two three four', 10, measure);
    expect(lines).toHaveLength(2);
    expect(Math.abs(measure(lines[0]) - measure(lines[1]))).toBeLessThanOrEqual(3);
    expect(`${lines[0]} ${lines[1]}`).toBe('one two three four');
  });
  it('single unsplittable word stays one line', () => {
    expect(layoutTitle('Supercalifragilistic', 5, measure)).toEqual(['Supercalifragilistic']);
  });
});
