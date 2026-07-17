// frontend/src/modules/Life/lib/format.test.jsx
import { describe, it, expect } from 'vitest';
import { formatDate, formatDateRange, formatPeriodLabel, humanize } from './format.js';

describe('life format helpers', () => {
  it('formats an ISO date to a human month/day/year', () => {
    expect(formatDate('2026-07-17')).toBe('Jul 17, 2026');
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
  });
  it('formats a date range', () => {
    expect(formatDateRange('2026-07-13', '2026-07-19')).toBe('Jul 13 – Jul 19, 2026');
  });
  it('labels a cadence position without leaking the periodId', () => {
    expect(formatPeriodLabel({ level: 'unit', periodId: '2026-07-17' })).toBe('Unit · Jul 17');
    expect(formatPeriodLabel({ alias: 'Day', level: 'unit', periodId: '2026-07-17' })).toBe('Day · Jul 17');
  });
  it('humanizes an internal id', () => {
    expect(humanize('family_time')).toBe('Family time');
    expect(humanize('health')).toBe('Health');
  });
});
