import { describe, it, expect } from 'vitest';
import { DayPattern } from '../../../backend/src/2_domains/playback-hub/value-objects/DayPattern.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

// 2026-05-25 is a Monday. Build matches() fixtures referencing days of week.
const monday    = new Date(2026, 4, 25); // Mon
const tuesday   = new Date(2026, 4, 26); // Tue
const wednesday = new Date(2026, 4, 27); // Wed
const thursday  = new Date(2026, 4, 28); // Thu
const friday    = new Date(2026, 4, 29); // Fri
const saturday  = new Date(2026, 4, 30); // Sat
const sunday    = new Date(2026, 4, 31); // Sun

describe('DayPattern', () => {
  describe('string forms', () => {
    it('accepts "all"', () => {
      expect(new DayPattern('all').value).toBe('all');
    });
    it('accepts "weekdays"', () => {
      expect(new DayPattern('weekdays').value).toBe('weekdays');
    });
    it('accepts "weekends"', () => {
      expect(new DayPattern('weekends').value).toBe('weekends');
    });
    it('rejects unknown strings', () => {
      expect(() => new DayPattern('maybenever')).toThrow(ValidationError);
      expect(() => new DayPattern('always')).toThrow(ValidationError);
      expect(() => new DayPattern('')).toThrow(ValidationError);
    });
    it('rejects uppercase string forms', () => {
      expect(() => new DayPattern('All')).toThrow(ValidationError);
      expect(() => new DayPattern('WEEKDAYS')).toThrow(ValidationError);
    });
  });

  describe('array forms', () => {
    it('accepts valid day arrays', () => {
      const p = new DayPattern(['mon', 'wed', 'fri']);
      expect(p.value).toEqual(['mon', 'wed', 'fri']);
    });
    it('accepts single-day arrays', () => {
      expect(new DayPattern(['sun']).value).toEqual(['sun']);
    });
    it('rejects empty array', () => {
      expect(() => new DayPattern([])).toThrow(ValidationError);
    });
    it('rejects arrays containing unknown days', () => {
      expect(() => new DayPattern(['mon', 'funday'])).toThrow(ValidationError);
      expect(() => new DayPattern(['monday'])).toThrow(ValidationError);
    });
    it('rejects mixed-case days', () => {
      expect(() => new DayPattern(['Mon'])).toThrow(ValidationError);
      expect(() => new DayPattern(['MON', 'TUE'])).toThrow(ValidationError);
    });
    it('rejects arrays with non-string entries', () => {
      expect(() => new DayPattern(['mon', 1])).toThrow(ValidationError);
    });
  });

  describe('rejects non-string-non-array', () => {
    it('rejects null', () => {
      expect(() => new DayPattern(null)).toThrow(ValidationError);
    });
    it('rejects undefined', () => {
      expect(() => new DayPattern(undefined)).toThrow(ValidationError);
    });
    it('rejects numbers', () => {
      expect(() => new DayPattern(42)).toThrow(ValidationError);
    });
    it('rejects objects', () => {
      expect(() => new DayPattern({ mon: true })).toThrow(ValidationError);
    });
  });

  describe('matches(date)', () => {
    it('"all" matches every day', () => {
      const p = new DayPattern('all');
      for (const d of [monday, tuesday, wednesday, thursday, friday, saturday, sunday]) {
        expect(p.matches(d)).toBe(true);
      }
    });
    it('"weekdays" matches Mon-Fri only', () => {
      const p = new DayPattern('weekdays');
      expect(p.matches(monday)).toBe(true);
      expect(p.matches(tuesday)).toBe(true);
      expect(p.matches(wednesday)).toBe(true);
      expect(p.matches(thursday)).toBe(true);
      expect(p.matches(friday)).toBe(true);
      expect(p.matches(saturday)).toBe(false);
      expect(p.matches(sunday)).toBe(false);
    });
    it('"weekends" matches Sat/Sun only', () => {
      const p = new DayPattern('weekends');
      expect(p.matches(saturday)).toBe(true);
      expect(p.matches(sunday)).toBe(true);
      expect(p.matches(monday)).toBe(false);
      expect(p.matches(friday)).toBe(false);
    });
    it('array form matches listed days', () => {
      const p = new DayPattern(['mon', 'wed', 'fri']);
      expect(p.matches(monday)).toBe(true);
      expect(p.matches(tuesday)).toBe(false);
      expect(p.matches(wednesday)).toBe(true);
      expect(p.matches(thursday)).toBe(false);
      expect(p.matches(friday)).toBe(true);
      expect(p.matches(saturday)).toBe(false);
      expect(p.matches(sunday)).toBe(false);
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new DayPattern('all'))).toBe(true);
    expect(Object.isFrozen(new DayPattern(['mon']))).toBe(true);
  });

  it('array value cannot be mutated externally', () => {
    const p = new DayPattern(['mon', 'wed']);
    expect(() => p.value.push('fri')).toThrow();
  });
});
