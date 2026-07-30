import { describe, it, expect } from 'vitest';
import { offsetMinutesFor, isSameStudyDay } from '#domains/school/studyDay.mjs';

describe('offsetMinutesFor', () => {
  it('returns 0 for a null timezone', () => {
    expect(offsetMinutesFor(null, Date.UTC(2026, 6, 29, 12))).toBe(0);
  });
  it('tracks DST: America/Los_Angeles is -420 in July, -480 in January', () => {
    expect(offsetMinutesFor('America/Los_Angeles', Date.UTC(2026, 6, 15, 12))).toBe(-420);
    expect(offsetMinutesFor('America/Los_Angeles', Date.UTC(2026, 0, 15, 12))).toBe(-480);
  });
  it('returns 0 for an unknown zone rather than throwing', () => {
    expect(offsetMinutesFor('Not/AZone', Date.UTC(2026, 6, 15))).toBe(0);
  });
});

describe('isSameStudyDay', () => {
  const tz = 'America/Los_Angeles';
  // 2026-07-29 01:00 PDT = 08:00 UTC; boundary 4am → belongs to the 28th's study day
  const oneAm = Date.UTC(2026, 6, 29, 8, 0);
  const priorEvening = Date.UTC(2026, 6, 29, 3, 0);   // 20:00 PDT on the 28th
  const nextMorning = Date.UTC(2026, 6, 29, 16, 0);   // 09:00 PDT on the 29th
  it('1am belongs to the previous study day', () => {
    expect(isSameStudyDay(oneAm, priorEvening, { timezone: tz })).toBe(true);
    expect(isSameStudyDay(oneAm, nextMorning, { timezone: tz })).toBe(false);
  });
  it('same calendar afternoon is the same study day', () => {
    expect(isSameStudyDay(nextMorning, Date.UTC(2026, 6, 29, 23, 0), { timezone: tz })).toBe(true);
  });
  it('handles invalid inputs as not-same (never throws)', () => {
    expect(isSameStudyDay(NaN, nextMorning, { timezone: tz })).toBe(false);
  });
});
