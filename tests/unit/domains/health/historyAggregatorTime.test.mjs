import { describe, expect, it } from 'vitest';
import { rollUpHistory } from '#domains/health/services/HistoryAggregator.mjs';

const entry = (date) => ({ date, workouts: [], sessions: [] });

describe('HistoryAggregator explicit reference date', () => {
  it('requires a caller-supplied reference date', () => {
    expect(() => rollUpHistory([])).toThrow('today is required');
  });

  it('preserves daily, weekly, monthly, expired, and future boundaries', () => {
    const result = rollUpHistory([
      entry('2026-08-28'),
      entry('2026-05-30'), // exactly 90 days
      entry('2026-05-29'), // 91 days
      entry('2026-03-01'), // exactly 180 days
      entry('2026-02-28'), // 181 days
      entry('2024-08-28'), // exactly 730 days
      entry('2024-08-27'), // expired
      entry('2026-08-29'), // future
    ], { today: new Date('2026-08-28T23:59:59.999Z') });

    expect(result.daily.map(value => value.date)).toEqual(['2026-08-28', '2026-05-30']);
    expect(result.weekly.flatMap(value => [value.startDate, value.endDate])).toContain('2026-05-29');
    expect(result.weekly.flatMap(value => [value.startDate, value.endDate])).toContain('2026-03-01');
    expect(result.monthly.flatMap(value => [value.startDate, value.endDate])).toContain('2026-02-28');
    expect(result.monthly.flatMap(value => [value.startDate, value.endDate])).toContain('2024-08-28');
    expect(JSON.stringify(result)).not.toContain('2024-08-27');
    expect(JSON.stringify(result)).not.toContain('2026-08-29');
  });
});
