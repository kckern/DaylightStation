import { describe, it, expect } from 'vitest';
import { formatFitnessDate } from './dateFormatter.js';

describe('formatFitnessDate', () => {
  it('formats a Date as "<Short DOW>, <Short Month> <Day>"', () => {
    // Monday Apr 20 2026 at noon UTC.
    const d = new Date(Date.UTC(2026, 3, 20, 12, 0, 0));
    expect(formatFitnessDate(d)).toBe('Mon, Apr 20');
  });

  it('accepts ISO strings', () => {
    expect(formatFitnessDate('2026-04-20T12:00:00Z')).toBe('Mon, Apr 20');
  });

  it('accepts numeric timestamps', () => {
    expect(formatFitnessDate(Date.UTC(2026, 3, 20, 12, 0, 0))).toBe('Mon, Apr 20');
  });

  it('returns empty string for null/undefined/empty/invalid input', () => {
    expect(formatFitnessDate(null)).toBe('');
    expect(formatFitnessDate(undefined)).toBe('');
    expect(formatFitnessDate('')).toBe('');
    expect(formatFitnessDate('not-a-date')).toBe('');
  });

  it('honors custom Intl options when provided', () => {
    const d = new Date(Date.UTC(2026, 3, 20, 12, 0, 0));
    expect(formatFitnessDate(d, { year: 'numeric', month: 'long' })).toBe('April 2026');
  });
});
