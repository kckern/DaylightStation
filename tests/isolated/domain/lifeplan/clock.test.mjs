import { describe, it, expect, beforeEach } from 'vitest';
import { Clock, parseDuration } from '#system/clock/Clock.mjs';

describe('Clock', () => {
  let clock;

  beforeEach(() => {
    clock = new Clock();
  });

  describe('now()', () => {
    it('returns current time when not frozen', () => {
      const before = Date.now();
      const result = clock.now().getTime();
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe('today()', () => {
    it('returns YYYY-MM-DD string', () => {
      const result = clock.today();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('freeze()', () => {
    it('freezes time at given date string', () => {
      clock.freeze('2025-06-15T10:30:00Z');
      expect(clock.today()).toBe('2025-06-15');
      expect(clock.isFrozen()).toBe(true);
    });

    it('freezes time at given Date object', () => {
      clock.freeze(new Date('2025-06-15'));
      expect(clock.today()).toBe('2025-06-15');
    });

    it('returns same time on repeated calls', () => {
      clock.freeze('2025-06-15T10:30:00Z');
      const first = clock.now().getTime();
      const second = clock.now().getTime();
      expect(first).toBe(second);
    });
  });

  describe('advance()', () => {
    it('advances frozen clock by days', () => {
      clock.freeze('2025-06-15');
      clock.advance('3 days');
      expect(clock.today()).toBe('2025-06-18');
    });

    it('advances frozen clock by hours', () => {
      clock.freeze('2025-06-15T10:00:00Z');
      clock.advance('5 hours');
      expect(clock.now().toISOString()).toContain('T15:00:00');
    });

    it('advances by weeks', () => {
      clock.freeze('2025-06-01');
      clock.advance('2 weeks');
      expect(clock.today()).toBe('2025-06-15');
    });

    it('advances by months (30 days)', () => {
      clock.freeze('2025-06-01');
      clock.advance('1 month');
      expect(clock.today()).toBe('2025-07-01');
    });
  });

  describe('reset()', () => {
    it('unfreezes the clock', () => {
      clock.freeze('2025-06-15');
      clock.reset();
      expect(clock.isFrozen()).toBe(false);
      expect(clock.today()).not.toBe('2025-06-15');
    });
  });

  describe('parseDuration()', () => {
    it('parses days', () => {
      expect(parseDuration('1 day')).toBe(86400000);
      expect(parseDuration('3 days')).toBe(3 * 86400000);
    });

    it('parses hours', () => {
      expect(parseDuration('2 hours')).toBe(2 * 3600000);
    });

    it('parses weeks', () => {
      expect(parseDuration('1 week')).toBe(604800000);
    });

    it('throws on invalid format', () => {
      expect(() => parseDuration('abc')).toThrow('Invalid duration');
    });

    it('throws on unknown unit', () => {
      expect(() => parseDuration('5 fortnights')).toThrow('Unknown duration unit');
    });
  });
});
