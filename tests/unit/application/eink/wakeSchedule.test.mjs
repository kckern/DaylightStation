import { describe, it, expect } from 'vitest';
import { parseDurationSeconds, computeNextWakeSeconds } from '#apps/eink/wakeSchedule.mjs';

// A fixed local time helper: build a Date at HH:MM:SS today (local tz).
const at = (h, m = 0, s = 0) => { const d = new Date(2026, 5, 18, h, m, s); return d; };

describe('parseDurationSeconds', () => {
  it('parses unit-suffixed durations', () => {
    expect(parseDurationSeconds('30s')).toBe(30);
    expect(parseDurationSeconds('15min')).toBe(900);
    expect(parseDurationSeconds('4h')).toBe(14400);
    expect(parseDurationSeconds('2hr')).toBe(7200);
  });
  it('treats a bare number as minutes', () => {
    expect(parseDurationSeconds(15)).toBe(900);
    expect(parseDurationSeconds('15')).toBe(900);
  });
  it('returns the fallback for null/garbage', () => {
    expect(parseDurationSeconds(null, 1800)).toBe(1800);
    expect(parseDurationSeconds('soon', 1800)).toBe(1800);
    expect(parseDurationSeconds(undefined)).toBe(null);
  });
});

describe('computeNextWakeSeconds', () => {
  it('uses the flat interval when there is no schedule', () => {
    expect(computeNextWakeSeconds({ interval: '15min' }, at(12))).toBe(900);
  });

  it('defaults to 30 min when refresh is empty/malformed', () => {
    expect(computeNextWakeSeconds({}, at(12))).toBe(1800);
    expect(computeNextWakeSeconds({ interval: 'whenever' }, at(12))).toBe(1800);
  });

  it('clamps absurd intervals into the [60s, 24h] band', () => {
    expect(computeNextWakeSeconds({ interval: '5s' }, at(12))).toBe(60);
    expect(computeNextWakeSeconds({ interval: '100h' }, at(12))).toBe(86400);
  });

  it('picks the active daytime window cadence', () => {
    const refresh = { schedule: [
      { from: '06:00', to: '22:00', every: '15min' },
      { from: '22:00', to: '06:00', every: '4h' },
    ] };
    expect(computeNextWakeSeconds(refresh, at(9, 0))).toBe(900);   // mid-day -> 15 min
  });

  it('picks the overnight window cadence (wraps midnight)', () => {
    const refresh = { schedule: [
      { from: '06:00', to: '22:00', every: '15min' },
      { from: '22:00', to: '06:00', every: '4h' },
    ] };
    expect(computeNextWakeSeconds(refresh, at(2, 0))).toBe(14400); // 2am -> 4 h
    expect(computeNextWakeSeconds(refresh, at(23, 0))).toBe(14400); // 11pm -> 4 h
  });

  it('does not overshoot the end of a window', () => {
    const refresh = { schedule: [
      { from: '06:00', to: '22:00', every: '15min' },
      { from: '22:00', to: '06:00', every: '4h' },
    ] };
    // 21:58 in the 15-min window: only 120s left -> wake at 22:00, not 22:13.
    expect(computeNextWakeSeconds(refresh, at(21, 58, 0))).toBe(120);
    // 05:00 in the overnight window: 1h to the 06:00 boundary beats the 4h cadence.
    expect(computeNextWakeSeconds(refresh, at(5, 0, 0))).toBe(3600);
  });

  it('falls back to the interval when no window contains now', () => {
    const refresh = {
      interval: '20min',
      schedule: [{ from: '06:00', to: '09:00', every: '5min' }], // gap the rest of the day
    };
    expect(computeNextWakeSeconds(refresh, at(15, 0))).toBe(1200);
  });

  it('skips malformed windows and uses the next valid one', () => {
    const refresh = { schedule: [
      { from: 'nope', to: '09:00', every: '5min' },
      { from: '00:00', to: '23:59', every: '10min' },
    ] };
    expect(computeNextWakeSeconds(refresh, at(12))).toBe(600);
  });
});
