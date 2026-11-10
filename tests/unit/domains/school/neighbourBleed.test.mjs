import { describe, it, expect } from 'vitest';
import { resolveNeighbourBleed } from '../../../../__app_modules/learning/school/server/domain/documents/neighbourBleed.mjs';

const sheet = { 20: 'E', 21: ['A', 'C', 'E'], 22: ['B', 'C', 'E'], 23: ['B', 'E'], 24: ['B', 'E'], 25: ['B', 'C'], 26: 'C' };

describe('resolveNeighbourBleed', () => {
  it('row 21: C,E explained by row 22 -> A', () => {
    const r = resolveNeighbourBleed({ row: 21, answers: sheet });
    expect(r.letter).toBe('A');
    expect(r.removed).toEqual(['C', 'E']);
  });
  it.each([23, 24, 25])('row %i is undecidable', (row) => {
    expect(resolveNeighbourBleed({ row, answers: sheet })).toBeNull();
  });
  it('single mark -> null', () => {
    expect(resolveNeighbourBleed({ row: 26, answers: sheet })).toBeNull();
  });
  it('no neighbours -> null', () => {
    expect(resolveNeighbourBleed({ row: 1, answers: { 1: ['A', 'B'] } })).toBeNull();
  });
  it('documented wrong-resolution case: neighbour letter is the true answer', () => {
    expect(resolveNeighbourBleed({ row: 25, answers: { 24: 'B', 25: ['B', 'C'], 26: 'D' } }).letter).toBe('C');
  });
  it('string neighbour normalised', () => {
    expect(resolveNeighbourBleed({ row: 1, answers: { 1: ['A', 'B'], 2: 'B' } }).letter).toBe('A');
  });
  it('blank neighbour explains nothing', () => {
    expect(resolveNeighbourBleed({ row: 4, answers: { 4: ['A', 'B'], 5: [] } })).toBeNull();
  });
  it('five marks with one unexplained is not resolved', () => {
    expect(resolveNeighbourBleed({ row: 10, answers: { 9: 'A', 10: ['A', 'B', 'C', 'D', 'E'], 11: 'B' } })).toBeNull();
  });
});
