import { describe, it, expect } from 'vitest';
import { nextZoomLevel, gridUnit, gridValues } from './chartZoom.js';

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

describe('gridUnit', () => {
  it('uses the base unit when its on-screen spacing clears the pixel floor', () => {
    expect(gridUnit(500, 600, 250, 32)).toBe(250);
  });
  it('coarsens (doubles) the unit when lines would crowd below the floor', () => {
    expect(gridUnit(8000, 600, 250, 32)).toBe(500);
  });
});

describe('gridValues', () => {
  it('returns ascending multiples of the unit up to the window span', () => {
    expect(gridValues(500, 250, 600, 32)).toEqual([0, 250, 500]);
  });
  it('uses the coarsened unit so values never crowd below the floor', () => {
    const v = gridValues(8000, 250, 600, 32);
    expect(v[0]).toBe(0);
    expect(v[1]).toBe(500);
    expect(v[v.length - 1]).toBe(8000);
  });
});
