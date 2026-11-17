import { describe, it, expect } from 'vitest';
import { angleForProgress, lapDirection, ringArcs } from './zoneRingMotion.js';

describe('angleForProgress', () => {
  it('maps the meter onto the top half, 9 o\'clock to 3 o\'clock', () => {
    expect(angleForProgress(0)).toBe(180);
    expect(angleForProgress(0.5)).toBe(270);
    expect(angleForProgress(1)).toBe(360);
    expect(angleForProgress(4)).toBe(360);
  });
});

describe('lapDirection', () => {
  it('laps clockwise up a zone and counter-clockwise down one', () => {
    expect(lapDirection('warm', 'hot')).toBe(1);
    expect(lapDirection('Hot', 'warm')).toBe(-1);
    expect(lapDirection('fire', 'hot')).toBe(-1);
  });

  it('does not lap into Fire, from nothing, or within a zone', () => {
    expect(lapDirection('hot', 'fire')).toBe(0);
    expect(lapDirection(null, 'warm')).toBe(0);
    expect(lapDirection('warm', 'warm')).toBe(0);
    expect(lapDirection('warm', 'turbo')).toBe(0);
  });
});

describe('ringArcs', () => {
  it('outside a lap: one arc from 3 o\'clock round the bottom to the dot', () => {
    expect(ringArcs(270)).toEqual({ current: [0, 270], previous: null });
  });

  describe('up a zone (clockwise, angle runs past 360)', () => {
    it('the old zone finishes its meter first', () => {
      expect(ringArcs(350, 1)).toEqual({ current: null, previous: [0, 350] });
    });

    it('then the new colour repaints the bottom behind the dot; the old top is gone', () => {
      expect(ringArcs(360 + 90, 1)).toEqual({ current: [0, 90], previous: [90, 180] });
    });

    it('and climbs into the new meter once past 9 o\'clock', () => {
      expect(ringArcs(360 + 200, 1)).toEqual({ current: [0, 200], previous: null });
    });
  });

  describe('down a zone (counter-clockwise, angle runs below 0)', () => {
    it('the meter empties back to 9 o\'clock in the old colour', () => {
      expect(ringArcs(190, -1)).toEqual({ current: null, previous: [0, 190] });
    });

    it('then the lower colour repaints the bottom behind the dot', () => {
      expect(ringArcs(90, -1)).toEqual({ current: [90, 180], previous: [0, 90] });
    });

    it('and past 3 o\'clock the lower zone shows its (nearly full) meter', () => {
      expect(ringArcs(-20, -1)).toEqual({ current: [0, 340], previous: null });
    });
  });
});
