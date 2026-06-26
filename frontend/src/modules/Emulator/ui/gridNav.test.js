import { describe, it, expect } from 'vitest';
import { nextGridIndex } from './gridNav.js';

describe('nextGridIndex', () => {
  const count = 7; // indices 0..6, 4 columns → rows [0123][456]
  const columns = 4;

  it('left/right move linearly and clamp at edges', () => {
    expect(nextGridIndex({ index: 2, count, columns, dir: 'right' })).toBe(3);
    expect(nextGridIndex({ index: 2, count, columns, dir: 'left' })).toBe(1);
    expect(nextGridIndex({ index: 0, count, columns, dir: 'left' })).toBe(0);
    expect(nextGridIndex({ index: 6, count, columns, dir: 'right' })).toBe(6);
  });

  it('down moves a row; stays put when no tile below', () => {
    expect(nextGridIndex({ index: 1, count, columns, dir: 'down' })).toBe(5);
    expect(nextGridIndex({ index: 3, count, columns, dir: 'down' })).toBe(3); // index 7 would be out of range
  });

  it('up moves a row; stays put on the top row', () => {
    expect(nextGridIndex({ index: 5, count, columns, dir: 'up' })).toBe(1);
    expect(nextGridIndex({ index: 2, count, columns, dir: 'up' })).toBe(2);
  });

  it('clamps a bad index and a zero column count', () => {
    expect(nextGridIndex({ index: 99, count, columns, dir: 'left' })).toBe(5);
    expect(nextGridIndex({ index: 0, count, columns: 0, dir: 'down' })).toBe(1);
  });

  it('empty grid → 0', () => {
    expect(nextGridIndex({ index: 0, count: 0, columns: 4, dir: 'down' })).toBe(0);
  });
});
