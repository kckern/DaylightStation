import { describe, it, expect } from 'vitest';
import { nextZoomLevel } from './chartZoom.js';

describe('nextZoomLevel', () => {
  const base = { xBaseS: 30, yBaseM: 250, threshold: 0.9 };
  it('stays at level 0 early in a race', () => {
    expect(nextZoomLevel(0, { leaderDistanceM: 50, elapsedS: 5, ...base })).toBe(0);
  });
  it('doubles when distance crosses 90% of the Y window', () => {
    expect(nextZoomLevel(0, { leaderDistanceM: 240, elapsedS: 5, ...base })).toBe(1);
  });
  it('doubles when elapsed crosses 90% of the X window', () => {
    expect(nextZoomLevel(0, { leaderDistanceM: 10, elapsedS: 28, ...base })).toBe(1);
  });
  it('multi-steps when the data leaps past several windows', () => {
    expect(nextZoomLevel(0, { leaderDistanceM: 2000, elapsedS: 5, ...base })).toBe(4);
  });
  it('is monotonic — never drops below the previous level', () => {
    expect(nextZoomLevel(3, { leaderDistanceM: 10, elapsedS: 1, ...base })).toBe(3);
  });
});
