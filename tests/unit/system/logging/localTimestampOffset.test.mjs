/**
 * Log timestamps carry their UTC offset (2026-08-22).
 *
 * The backend used to stamp events as local wall-clock with the `Z` stripped
 * (`2026-08-22T15:00:58.668`). VictoriaLogs parses an offset-less ISO string as
 * UTC, so every backend event was filed 7 hours early while the frontend — which
 * sends real UTC with `Z` — was filed correctly. The two interleaved wrongly and
 * a `_time:2h` query returned ZERO backend events during a live school session,
 * which is what made the OMR incident look like "the backend stopped logging".
 *
 * The house is self-hosted and single-timezone, so local wall-clock is what a
 * human wants to read. Keeping it AND appending the true offset satisfies both
 * the reader and the store.
 */
import { describe, it, expect } from 'vitest';
import { formatLocalTimestamp } from '#system/logging/localTimestamp.mjs';

describe('formatLocalTimestamp', () => {
  it('keeps local wall-clock and appends the offset', () => {
    const ts = formatLocalTimestamp(new Date('2026-08-22T22:00:58.668Z'), 'America/Los_Angeles');
    expect(ts).toBe('2026-08-22T15:00:58.668-07:00');
  });

  it('round-trips to the same instant', () => {
    const at = new Date('2026-08-22T22:00:58.668Z');
    expect(new Date(formatLocalTimestamp(at, 'America/Los_Angeles')).getTime()).toBe(at.getTime());
  });

  it('uses +00:00 for UTC rather than a bare offset-less string', () => {
    expect(formatLocalTimestamp(new Date('2026-01-05T09:30:00.000Z'), 'UTC'))
      .toBe('2026-01-05T09:30:00.000+00:00');
  });

  it('tracks daylight saving rather than hard-coding an offset', () => {
    const winter = formatLocalTimestamp(new Date('2026-01-15T20:00:00.000Z'), 'America/Los_Angeles');
    const summer = formatLocalTimestamp(new Date('2026-07-15T20:00:00.000Z'), 'America/Los_Angeles');
    expect(winter.endsWith('-08:00')).toBe(true);
    expect(summer.endsWith('-07:00')).toBe(true);
  });

  it('handles a positive offset', () => {
    expect(formatLocalTimestamp(new Date('2026-03-10T00:30:00.000Z'), 'Europe/Berlin'))
      .toBe('2026-03-10T01:30:00.000+01:00');
  });

  it('always emits millisecond precision', () => {
    const ts = formatLocalTimestamp(new Date('2026-08-22T22:00:58.000Z'), 'America/Los_Angeles');
    expect(ts).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });

  it('never emits a trailing Z, which would claim the wall-clock is UTC', () => {
    const ts = formatLocalTimestamp(new Date(), 'America/Los_Angeles');
    expect(ts.endsWith('Z')).toBe(false);
  });

  it('falls back to the system zone when none is given', () => {
    expect(formatLocalTimestamp(new Date())).toMatch(/[+-]\d{2}:\d{2}$/);
  });
});
