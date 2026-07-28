import { describe, it, expect } from 'vitest';
import { tallyGrades } from './gradeTally.js';

const g = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { grade: v }]));

describe('tallyGrades', () => {
  it('counts each grade and picks an overall (greens win ties, then reds over yellows)', () => {
    expect(tallyGrades(g({ 0: 'green', 1: 'green', 2: 'yellow', 3: 'red' })))
      .toEqual({ green: 2, yellow: 1, red: 1, overall: 'green' });
  });
  it('red beats yellow when greens do not lead', () => {
    expect(tallyGrades(g({ 0: 'red', 1: 'red', 2: 'yellow' })))
      .toEqual({ green: 0, yellow: 1, red: 2, overall: 'red' });
  });
  it('yellow overall when it leads the non-greens and greens do not', () => {
    expect(tallyGrades(g({ 0: 'yellow', 1: 'yellow', 2: 'red' })))
      .toEqual({ green: 0, yellow: 2, red: 1, overall: 'yellow' });
  });
  it('empty → all zero and NO overall: an empty set has no overall quality', () => {
    // The tie rule used to make this 'green', so a run with nothing graded read
    // as a success — a congratulation for a passage the user never played.
    expect(tallyGrades({})).toEqual({ green: 0, yellow: 0, red: 0, overall: null });
  });
  it('nothing but ungraded entries also has no overall', () => {
    expect(tallyGrades({ 0: {}, 1: { grade: undefined } }))
      .toEqual({ green: 0, yellow: 0, red: 0, overall: null });
  });
  it('ignores ungraded entries', () => {
    expect(tallyGrades({ 0: { grade: 'green' }, 1: {}, 2: { grade: undefined } }))
      .toEqual({ green: 1, yellow: 0, red: 0, overall: 'green' });
  });
});
