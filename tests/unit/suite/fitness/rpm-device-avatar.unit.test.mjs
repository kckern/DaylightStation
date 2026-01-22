import { describe, it, expect } from '@jest/globals';
import { calculateRpmProgress, getRpmZoneColor } from '#frontend/modules/Fitness/FitnessSidebar/RealtimeCards/rpmUtils.mjs';

describe('RpmDeviceAvatar utilities', () => {
  describe('calculateRpmProgress', () => {
    it('returns 0 when rpm is at or below min', () => {
      const progress = calculateRpmProgress(30, { min: 30, max: 100 });
      expect(progress).toBe(0);
    });

    it('returns 1 when rpm is at or above max', () => {
      const progress = calculateRpmProgress(100, { min: 30, max: 100 });
      expect(progress).toBe(1);
    });

    it('returns 0.5 when rpm is midway', () => {
      const progress = calculateRpmProgress(65, { min: 30, max: 100 });
      expect(progress).toBeCloseTo(0.5);
    });

    it('clamps negative rpm to 0', () => {
      const progress = calculateRpmProgress(-10, { min: 30, max: 100 });
      expect(progress).toBe(0);
    });
  });

  describe('getRpmZoneColor', () => {
    const thresholds = { min: 30, med: 60, high: 80, max: 100 };

    it('returns idle color below min', () => {
      expect(getRpmZoneColor(20, thresholds)).toBe('#666');
    });

    it('returns min color at min threshold', () => {
      expect(getRpmZoneColor(30, thresholds)).toBe('#3b82f6');
    });

    it('returns med color at med threshold', () => {
      expect(getRpmZoneColor(60, thresholds)).toBe('#22c55e');
    });

    it('returns high color at high threshold', () => {
      expect(getRpmZoneColor(80, thresholds)).toBe('#f59e0b');
    });

    it('returns max color at max threshold', () => {
      expect(getRpmZoneColor(100, thresholds)).toBe('#ef4444');
    });
  });
});
