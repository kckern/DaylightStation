import { describe, it, expect } from 'vitest';
import { weekOf } from './calendar.mjs';

describe('weekOf', () => {
  it('addresses Monday in the series timezone across DST and years', () => {
    expect(weekOf({ instant: '2026-11-16T07:59:59Z', timezone: 'America/Los_Angeles' })).toBe('2026-11-09');
    expect(weekOf({ instant: '2026-11-16T08:00:00Z', timezone: 'America/Los_Angeles' })).toBe('2026-11-16');
    expect(weekOf({ instant: '2027-01-01T12:00:00Z', timezone: 'America/Los_Angeles' })).toBe('2026-12-28');
  });
});
