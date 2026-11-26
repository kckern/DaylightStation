import { describe, it, expect } from 'vitest';
import { stampEpoch } from './stampEpoch.mjs';

const LA = 'America/Los_Angeles';

describe('stampEpoch', () => {
  it('reads zoned stamps as their instant', () => {
    expect(stampEpoch('2026-11-26T20:00:00.000Z', LA)).toBe(Date.UTC(2026, 10, 26, 20));
    expect(stampEpoch('2026-11-26T12:00:00.000-08:00', LA)).toBe(Date.UTC(2026, 10, 26, 20));
  });

  it('reads bare stamps in the household zone', () => {
    expect(stampEpoch('2026-11-26 12:00:00', LA)).toBe(Date.UTC(2026, 10, 26, 20));
    expect(stampEpoch('2026-07-01 12:00:00', LA)).toBe(Date.UTC(2026, 6, 1, 19));
  });

  it('a UTC ISO stamp and a local stamp of the same moment are equal', () => {
    expect(stampEpoch('2026-11-26T20:00:00.000Z', LA)).toBe(stampEpoch('2026-11-26 12:00:00', LA));
  });

  it('DST fall-back: the repeated hour reads as the earlier instant, and order holds across it', () => {
    // 2026-11-01 01:30 happens twice in Los Angeles: 08:30Z (PDT) then 09:30Z (PST).
    expect(stampEpoch('2026-11-01 01:30:00', LA)).toBe(Date.UTC(2026, 10, 1, 8, 30));
    // A report heard at 01:10 PST (09:10Z) is after a stored 01:30 (earlier reading).
    expect(stampEpoch('2026-11-01T01:10:00-08:00', LA)).toBeGreaterThan(stampEpoch('2026-11-01 01:30:00', LA));
    expect(stampEpoch('2026-11-01 02:00:00', LA)).toBe(Date.UTC(2026, 10, 1, 10));
  });

  it('DST spring-forward gap: a wall time that never happened lands after the gap', () => {
    // 2026-03-08 02:30 does not exist in Los Angeles.
    const at = stampEpoch('2026-03-08 02:30:00', LA);
    expect(at).toBeGreaterThanOrEqual(Date.UTC(2026, 2, 8, 9, 30));
    expect(at).toBeLessThanOrEqual(Date.UTC(2026, 2, 8, 10, 30));
  });

  it('is null for nonsense', () => {
    expect(stampEpoch('yesterday', LA)).toBeNull();
    expect(stampEpoch(null, LA)).toBeNull();
  });
});
