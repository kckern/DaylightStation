import { describe, it, expect } from 'vitest';
import { nearestEvent, SELECT_MAX_DIST } from './nearestEvent.js';

const events = [
  { x: 100, top: 0, bottom: 100 },
  { x: 200, top: 0, bottom: 100 },
];

describe('nearestEvent', () => {
  it('picks the nearest event by x-dominant distance', () => {
    expect(nearestEvent(events, 190, 50)).toBe(1);
    expect(nearestEvent(events, 110, 50)).toBe(0);
  });
  it('returns -1 when the tap is farther than maxDist from every event', () => {
    expect(nearestEvent(events, 900, 50, SELECT_MAX_DIST)).toBe(-1);
  });
  it('unlimited by default (seek taps keep tap-anywhere behavior)', () => {
    expect(nearestEvent(events, 900, 50)).toBe(1);
  });
  it('returns -1 for an empty event list', () => {
    expect(nearestEvent([], 10, 10)).toBe(-1);
  });
});
