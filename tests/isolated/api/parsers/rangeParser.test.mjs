// tests/isolated/api/parsers/rangeParser.test.mjs
import { describe, it, expect } from 'vitest';
import { parseDuration, parseTime, parseRange } from '#api/v1/parsers/rangeParser.mjs';

describe('rangeParser', () => {
  describe('parseDuration', () => {
    it('parses plain seconds', () => {
      expect(parseDuration('30')).toEqual({ value: 30 });
    });

    it('parses minutes', () => {
      expect(parseDuration('3m')).toEqual({ value: 180 });
    });

    it('parses hours', () => {
      expect(parseDuration('1h')).toEqual({ value: 3600 });
    });

    it('parses combined hours and minutes', () => {
      expect(parseDuration('1h30m')).toEqual({ value: 5400 });
    });

    it('parses range with both bounds', () => {
      expect(parseDuration('3m..10m')).toEqual({ from: 180, to: 600 });
    });

    it('parses open-ended range (max only)', () => {
      expect(parseDuration('..5m')).toEqual({ from: null, to: 300 });
    });

    it('parses open-ended range (min only)', () => {
      expect(parseDuration('30m..')).toEqual({ from: 1800, to: null });
    });

    it('returns null for invalid input', () => {
      expect(parseDuration('invalid')).toBeNull();
    });
  });

  describe('parseTime', () => {
    it('parses year', () => {
      const result = parseTime('2025');
      expect(result.from).toBe('2025-01-01');
      expect(result.to).toBe('2025-12-31');
    });

    it('parses year-month', () => {
      const result = parseTime('2025-06');
      expect(result.from).toBe('2025-06-01');
      expect(result.to).toBe('2025-06-30');
    });

    it('parses full date as a same-day range', () => {
      const result = parseTime('2025-06-15');
      expect(result.from).toBe('2025-06-15');
      expect(result.to).toBe('2025-06-16');
    });

    test('single full date returns a same-day range (from..next day)', () => {
      expect(parseTime('2025-12-25')).toEqual({ from: '2025-12-25', to: '2025-12-26' });
    });

    test('single full date crossing month boundary increments correctly', () => {
      expect(parseTime('2025-01-31')).toEqual({ from: '2025-01-31', to: '2025-02-01' });
    });

    test('single full date crossing year boundary increments correctly', () => {
      expect(parseTime('2025-12-31')).toEqual({ from: '2025-12-31', to: '2026-01-01' });
    });

    test('calendar-illegal full date does not throw and is not treated as a range', () => {
      const result = parseTime('2025-02-30');
      expect(result).not.toHaveProperty('from');
    });

    it('parses year range', () => {
      const result = parseTime('2024..2025');
      expect(result.from).toBe('2024-01-01');
      expect(result.to).toBe('2025-12-31');
    });

    it('parses summer as June-August', () => {
      const result = parseTime('summer');
      expect(result.from).toContain('-06-01');
      expect(result.to).toContain('-08-31');
    });
  });

  describe('parseRange', () => {
    it('parses range with both bounds', () => {
      expect(parseRange('a..b')).toEqual({ from: 'a', to: 'b' });
    });

    it('parses single value', () => {
      expect(parseRange('value')).toEqual({ value: 'value' });
    });

    it('parses open-ended from', () => {
      expect(parseRange('..b')).toEqual({ from: null, to: 'b' });
    });

    it('parses open-ended to', () => {
      expect(parseRange('a..')).toEqual({ from: 'a', to: null });
    });
  });
});
