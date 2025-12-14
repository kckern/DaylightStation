/**
 * Tests for Timestamp value object
 * @group Phase1
 */

import { Timestamp } from '../../domain/value-objects/Timestamp.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

describe('Phase1: Timestamp', () => {
  const TEST_DATE = new Date('2024-06-15T12:30:00.000Z');
  const TEST_ISO = '2024-06-15T12:30:00.000Z';
  const TEST_EPOCH_MS = TEST_DATE.getTime();

  describe('constructor', () => {
    it('should create from Date', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(ts.toISOString()).toBe(TEST_ISO);
    });

    it('should create from epoch milliseconds', () => {
      const ts = new Timestamp(TEST_EPOCH_MS);
      expect(ts.toISOString()).toBe(TEST_ISO);
    });

    it('should create from ISO string', () => {
      const ts = new Timestamp(TEST_ISO);
      expect(ts.toISOString()).toBe(TEST_ISO);
    });

    it('should create from another Timestamp', () => {
      const original = new Timestamp(TEST_DATE);
      const copy = new Timestamp(original);
      expect(copy.toISOString()).toBe(TEST_ISO);
    });

    it('should throw ValidationError for invalid date string', () => {
      expect(() => new Timestamp('invalid')).toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid value', () => {
      expect(() => new Timestamp(null)).toThrow(ValidationError);
      expect(() => new Timestamp({})).toThrow(ValidationError);
    });

    it('should be immutable', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(Object.isFrozen(ts)).toBe(true);
    });
  });

  describe('toDate', () => {
    it('should return copy of Date', () => {
      const ts = new Timestamp(TEST_DATE);
      const date = ts.toDate();
      
      expect(date).toEqual(TEST_DATE);
      expect(date).not.toBe(TEST_DATE); // Should be a copy
    });

    it('should return new Date each time', () => {
      const ts = new Timestamp(TEST_DATE);
      const date1 = ts.toDate();
      const date2 = ts.toDate();
      
      expect(date1).not.toBe(date2);
    });
  });

  describe('toEpochMs', () => {
    it('should return epoch milliseconds', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(ts.toEpochMs()).toBe(TEST_EPOCH_MS);
    });
  });

  describe('toEpochSec', () => {
    it('should return epoch seconds', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(ts.toEpochSec()).toBe(Math.floor(TEST_EPOCH_MS / 1000));
    });
  });

  describe('toISOString and toString', () => {
    it('toISOString should return ISO format', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(ts.toISOString()).toBe(TEST_ISO);
    });

    it('toString should return ISO format', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(ts.toString()).toBe(TEST_ISO);
    });
  });

  describe('toJSON', () => {
    it('should serialize to ISO string', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(ts.toJSON()).toBe(TEST_ISO);
    });

    it('should work with JSON.stringify', () => {
      const obj = { timestamp: new Timestamp(TEST_DATE) };
      expect(JSON.stringify(obj)).toBe(`{"timestamp":"${TEST_ISO}"}`);
    });
  });

  describe('format', () => {
    it('should format as ISO by default', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(ts.format()).toBe(TEST_ISO);
    });

    it('should format as date in specified timezone', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(ts.format('date', 'UTC')).toBe('2024-06-15');
    });
  });

  describe('equals', () => {
    it('should return true for equal timestamps', () => {
      const ts1 = new Timestamp(TEST_DATE);
      const ts2 = new Timestamp(TEST_DATE);
      expect(ts1.equals(ts2)).toBe(true);
    });

    it('should return false for different timestamps', () => {
      const ts1 = new Timestamp(TEST_DATE);
      const ts2 = new Timestamp(new Date(TEST_EPOCH_MS + 1000));
      expect(ts1.equals(ts2)).toBe(false);
    });

    it('should return false for non-Timestamp', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(ts.equals(TEST_DATE)).toBe(false);
    });
  });

  describe('isBefore and isAfter', () => {
    it('isBefore should compare correctly', () => {
      const earlier = new Timestamp(TEST_DATE);
      const later = new Timestamp(new Date(TEST_EPOCH_MS + 1000));
      
      expect(earlier.isBefore(later)).toBe(true);
      expect(later.isBefore(earlier)).toBe(false);
    });

    it('isAfter should compare correctly', () => {
      const earlier = new Timestamp(TEST_DATE);
      const later = new Timestamp(new Date(TEST_EPOCH_MS + 1000));
      
      expect(later.isAfter(earlier)).toBe(true);
      expect(earlier.isAfter(later)).toBe(false);
    });
  });

  describe('add', () => {
    it('should add milliseconds', () => {
      const ts = new Timestamp(TEST_DATE);
      const result = ts.add(500, 'ms');
      expect(result.toEpochMs()).toBe(TEST_EPOCH_MS + 500);
    });

    it('should add seconds', () => {
      const ts = new Timestamp(TEST_DATE);
      const result = ts.add(5, 's');
      expect(result.toEpochMs()).toBe(TEST_EPOCH_MS + 5000);
    });

    it('should add minutes', () => {
      const ts = new Timestamp(TEST_DATE);
      const result = ts.add(5, 'm');
      expect(result.toEpochMs()).toBe(TEST_EPOCH_MS + 5 * 60 * 1000);
    });

    it('should add hours', () => {
      const ts = new Timestamp(TEST_DATE);
      const result = ts.add(2, 'h');
      expect(result.toEpochMs()).toBe(TEST_EPOCH_MS + 2 * 60 * 60 * 1000);
    });

    it('should add days', () => {
      const ts = new Timestamp(TEST_DATE);
      const result = ts.add(3, 'd');
      expect(result.toEpochMs()).toBe(TEST_EPOCH_MS + 3 * 24 * 60 * 60 * 1000);
    });

    it('should throw for invalid unit', () => {
      const ts = new Timestamp(TEST_DATE);
      expect(() => ts.add(5, 'invalid')).toThrow(ValidationError);
    });

    it('should support negative values', () => {
      const ts = new Timestamp(TEST_DATE);
      const result = ts.add(-1, 'h');
      expect(result.isBefore(ts)).toBe(true);
    });
  });

  describe('diff', () => {
    it('should return difference in milliseconds', () => {
      const ts1 = new Timestamp(TEST_DATE);
      const ts2 = new Timestamp(new Date(TEST_EPOCH_MS + 5000));
      
      expect(ts2.diff(ts1)).toBe(5000);
      expect(ts1.diff(ts2)).toBe(-5000);
    });
  });

  describe('ageInMinutes', () => {
    it('should return age in minutes', () => {
      const fiveMinutesAgo = new Timestamp(Date.now() - 5 * 60 * 1000);
      const age = fiveMinutesAgo.ageInMinutes();
      
      // Allow for small timing differences
      expect(age).toBeGreaterThanOrEqual(4);
      expect(age).toBeLessThanOrEqual(6);
    });
  });

  describe('static methods', () => {
    it('now should return current timestamp', () => {
      const before = Date.now();
      const ts = Timestamp.now();
      const after = Date.now();
      
      expect(ts.toEpochMs()).toBeGreaterThanOrEqual(before);
      expect(ts.toEpochMs()).toBeLessThanOrEqual(after);
    });

    it('from should return same Timestamp', () => {
      const original = new Timestamp(TEST_DATE);
      expect(Timestamp.from(original)).toBe(original);
    });

    it('from should create from Date', () => {
      const ts = Timestamp.from(TEST_DATE);
      expect(ts.toISOString()).toBe(TEST_ISO);
    });

    it('parse should parse ISO string', () => {
      const ts = Timestamp.parse(TEST_ISO);
      expect(ts.toEpochMs()).toBe(TEST_EPOCH_MS);
    });

    it('fromEpochMs should create from milliseconds', () => {
      const ts = Timestamp.fromEpochMs(TEST_EPOCH_MS);
      expect(ts.toISOString()).toBe(TEST_ISO);
    });

    it('fromEpochSec should create from seconds', () => {
      const sec = Math.floor(TEST_EPOCH_MS / 1000);
      const ts = Timestamp.fromEpochSec(sec);
      expect(ts.toEpochSec()).toBe(sec);
    });
  });
});
