import { describe, it, expect } from 'vitest';
import { clampWager } from './WagerPanel.jsx';

describe('clampWager', () => {
  it('clamps to [5, max(score, roundMax)] and floors to integer', () => {
    expect(clampWager(0, { score: 1000, roundMax: 500 })).toBe(5);
    expect(clampWager(-50, { score: 1000, roundMax: 500 })).toBe(5);
    expect(clampWager(700.9, { score: 1000, roundMax: 500 })).toBe(700);
    expect(clampWager(5000, { score: 1000, roundMax: 500 })).toBe(1000);
    expect(clampWager(5000, { score: 200, roundMax: 500 })).toBe(500); // roundMax rescue for low scores
    expect(clampWager(NaN, { score: 200, roundMax: 500 })).toBe(5);
  });
});
