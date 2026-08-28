import { describe, it, expect } from 'vitest';
import { currentPeriodId } from './currentPeriodId.js';

const P = (periodId, startsAt, endsAt) => ({ periodId, startsAt, endsAt });

describe('currentPeriodId', () => {
  const periods = [
    P('spring', '2026-01-05T00:00:00Z', '2026-06-12T00:00:00Z'),
    P('fall', '2026-08-01T00:00:00Z', '2026-12-19T00:00:00Z'),
  ];

  it('picks the period containing now', () => {
    expect(currentPeriodId(periods, Date.parse('2026-09-01T00:00:00Z'))).toBe('fall');
  });

  it('between terms falls back to the most recent STARTED period, never a future one', () => {
    expect(currentPeriodId(periods, Date.parse('2026-07-01T00:00:00Z'))).toBe('spring');
  });

  it('before everything, falls back to the first configured period', () => {
    expect(currentPeriodId(periods, Date.parse('2025-01-01T00:00:00Z'))).toBe('spring');
  });

  it('empty list yields null', () => {
    expect(currentPeriodId([], Date.now())).toBe(null);
  });
});
