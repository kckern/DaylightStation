import { describe, it, expect } from '@jest/globals';
import { deriveLogDate } from '#apps/nutribot/lib/deriveLogDate.mjs';

describe('deriveLogDate', () => {
  it('returns meal.date when present', () => {
    const log = { meal: { date: '2026-04-16' }, createdAt: '2026-04-16 12:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('falls back to date portion of createdAt when meal.date is missing', () => {
    const log = { meal: { time: 'morning' }, createdAt: '2026-04-16 12:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('falls back to date portion of createdAt when meal is entirely missing', () => {
    const log = { createdAt: '2026-04-16 12:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('handles ISO-format createdAt with T separator', () => {
    const log = { createdAt: '2026-04-16T19:00:00Z' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('throws when both meal.date and createdAt are missing', () => {
    expect(() => deriveLogDate({}, 'America/Los_Angeles')).toThrow(/cannot derive date/i);
  });

  it('throws when createdAt is not a parseable date string', () => {
    expect(() => deriveLogDate({ createdAt: 'not-a-date' }, 'America/Los_Angeles')).toThrow(/cannot derive date/i);
  });

  it('never returns current wall-clock date as fallback', () => {
    // Pathological input: use arbitrary past createdAt, ensure output matches, not today
    const log = { createdAt: '2020-01-01 00:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2020-01-01');
  });

  it('slices createdAt prefix without timezone reprojection (late-evening case)', () => {
    // createdAt stored in user-local time as "YYYY-MM-DD HH:mm:ss" — slicing must NOT
    // Date-parse-then-reproject, which would flip the day for late-evening times when
    // the server's system TZ differs from the user's TZ.
    const log = { createdAt: '2026-04-16 23:30:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('slices createdAt prefix for early-morning case (day does not flip backward)', () => {
    const log = { createdAt: '2026-04-16 02:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('falls through to createdAt when meal.date is malformed (not YYYY-MM-DD)', () => {
    const log = { meal: { date: '2026/04/16' }, createdAt: '2026-04-17 10:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-17');
  });
});
