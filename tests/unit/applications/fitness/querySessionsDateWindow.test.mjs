// tests/unit/applications/fitness/querySessionsDateWindow.test.mjs
//
// Task P2.4 (audit API-3): the fitness god-router's GET /sessions handler
// contained inline relative-date parsing for the `since` query param. That
// logic moved into QuerySessions as the exported pure function
// `resolveStartDate`. This suite pins the parser's exact behavior, derived
// from the original router code:
//
//   - relative days "Nd" (e.g. "30d") -> the date N days before `now`
//     (YYYY-MM-DD), via the /^(\d+)d$/ regex.
//   - anything else (absolute "YYYY-MM-DD", or an unrecognized token such as
//     "2w") is passed through UNCHANGED — the historical router only expanded
//     the day-notation and handed everything else to the store as-is.
import { describe, it, expect } from 'vitest';
import { resolveStartDate } from '#apps/fitness/usecases/QuerySessions.mjs';

describe('resolveStartDate (QuerySessions date-window parser)', () => {
  // Fixed reference "today" so the relative math is deterministic.
  const now = new Date('2026-07-07T12:00:00Z');

  it('expands relative-day notation "30d" to N days before now (YYYY-MM-DD)', () => {
    // 2026-07-07 minus 30 days = 2026-06-07
    expect(resolveStartDate('30d', { now })).toBe('2026-06-07');
  });

  it('expands a small day-count "2d" the same way', () => {
    // 2026-07-07 minus 2 days = 2026-07-05
    expect(resolveStartDate('2d', { now })).toBe('2026-07-05');
  });

  it('does NOT support week notation "2w" — passed through unchanged', () => {
    // "2w" fails the /^(\d+)d$/ regex, so it is handed to the store as-is.
    expect(resolveStartDate('2w', { now })).toBe('2w');
  });

  it('passes an absolute YYYY-MM-DD date through unchanged', () => {
    expect(resolveStartDate('2026-01-15', { now })).toBe('2026-01-15');
  });

  it('passes an invalid/unrecognized token through unchanged', () => {
    expect(resolveStartDate('garbage', { now })).toBe('garbage');
  });
});
