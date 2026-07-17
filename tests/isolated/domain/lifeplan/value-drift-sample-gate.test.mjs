import { describe, it, expect } from 'vitest';
import { ValueDriftCalculator } from '#domains/lifeplan/services/ValueDriftCalculator.mjs';

const calc = new ValueDriftCalculator();
const values = (ids) => ids.map((id, i) => ({ id, rank: i + 1 }));

describe('ValueDriftCalculator small-sample gate', () => {
  it('returns insufficient_data with only 3 common values, even if anti-correlated', () => {
    const allocation = { a: 1, b: 2, c: 3 };            // observed order c,b,a
    const res = calc.calculateDrift(allocation, values(['a', 'b', 'c'])); // stated a,b,c
    expect(res.status).toBe('insufficient_data');
  });

  it('emits a real status once >= 4 common values exist', () => {
    const allocation = { a: 4, b: 3, c: 2, d: 1 };       // observed a,b,c,d
    const res = calc.calculateDrift(allocation, values(['a', 'b', 'c', 'd'])); // perfectly aligned
    expect(res.status).toBe('aligned');
  });
});
