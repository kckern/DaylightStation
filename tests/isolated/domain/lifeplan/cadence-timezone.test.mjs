import { describe, it, expect } from 'vitest';
import { CadenceService } from '#domains/lifeplan/services/CadenceService.mjs';

const TZ = 'America/Los_Angeles';

describe('CadenceService local-day semantics', () => {
  it('an 11pm PT instant resolves to the SAME local day as 7am PT that morning', () => {
    const svc = new CadenceService({ timezone: TZ });
    const morning = new Date('2025-01-08T15:00:00Z'); // 7am PST Jan 8
    const night   = new Date('2025-01-09T07:00:00Z'); // 11pm PST Jan 8
    expect(svc.resolve({}, night).unit.periodId).toBe(svc.resolve({}, morning).unit.periodId);
  });

  it('default cycles run Monday→Sunday in the household timezone', () => {
    const svc = new CadenceService({ timezone: TZ });
    // 2026-07-06 is a Monday
    const mon = svc.resolve({}, new Date('2026-07-06T20:00:00Z'));
    const sun = svc.resolve({}, new Date('2026-07-12T20:00:00Z'));
    const nextMon = svc.resolve({}, new Date('2026-07-13T20:00:00Z'));
    expect(mon.cycle.periodId).toBe(sun.cycle.periodId);
    expect(nextMon.cycle.periodId).not.toBe(sun.cycle.periodId);
    expect(svc.isCeremonyDue('end_of_cycle', {}, new Date('2026-07-12T20:00:00Z'), null)).toBe(true);  // Sunday
    expect(svc.isCeremonyDue('end_of_cycle', {}, new Date('2026-07-11T20:00:00Z'), null)).toBe(false); // Saturday
  });

  it('start_of_unit and end_of_unit are both due on the day (time gating is the scheduler concern)', () => {
    const svc = new CadenceService({ timezone: TZ });
    const t = new Date('2025-01-08T15:00:00Z');
    expect(svc.isCeremonyDue('start_of_unit', {}, t, null)).toBe(true);
    expect(svc.isCeremonyDue('end_of_unit', {}, t, null)).toBe(true);
  });

  it('periodId year comes from the local calendar (Dec 31 11pm PT is still the old year)', () => {
    const svc = new CadenceService({ timezone: TZ });
    const nyEvePT = new Date('2026-01-01T07:00:00Z'); // 11pm PST Dec 31 2025
    expect(svc.resolve({}, nyEvePT).unit.periodId.startsWith('2025')).toBe(true);
  });

  it('lastCeremonyDate in the current period marks not-due (dedupe unchanged)', () => {
    const svc = new CadenceService({ timezone: TZ });
    const t = new Date('2025-01-08T15:00:00Z');
    expect(svc.isCeremonyDue('start_of_unit', {}, t, '2025-01-08T14:00:00Z')).toBe(false);
  });

  it('DST spring-forward day (2026-03-08) is one unbroken unit period and stays in its cycle', () => {
    const svc = new CadenceService({ timezone: TZ });
    // 2026-03-08 is the US spring-forward Sunday (2am PST → 3am PDT)
    const beforeJump = new Date('2026-03-08T09:00:00Z'); // 1am PST Mar 8
    const afterJump  = new Date('2026-03-08T11:00:00Z'); // 4am PDT Mar 8
    const lateNight  = new Date('2026-03-09T06:00:00Z'); // 11pm PDT Mar 8
    const nextDay    = new Date('2026-03-09T08:00:00Z'); // 1am PDT Mar 9
    const dayUnit = svc.resolve({}, beforeJump).unit.periodId;
    expect(svc.resolve({}, afterJump).unit.periodId).toBe(dayUnit);
    expect(svc.resolve({}, lateNight).unit.periodId).toBe(dayUnit);
    expect(svc.resolve({}, nextDay).unit.periodId).not.toBe(dayUnit);
    // Mar 8 is the Sunday of the cycle starting Monday Mar 2
    const cycleMon = svc.resolve({}, new Date('2026-03-02T20:00:00Z')).cycle.periodId;
    expect(svc.resolve({}, lateNight).cycle.periodId).toBe(cycleMon);
    expect(svc.isCeremonyDue('end_of_cycle', {}, lateNight, null)).toBe(true);
  });

  it('accepts a custom epoch as string or Date (YAML parses bare dates to Date objects)', () => {
    const svc = new CadenceService({ timezone: TZ });
    // Tuesday epoch shifts cycle starts to Tuesdays
    const asString = { cycle: { epoch: '2025-01-07' } };
    const asDate = { cycle: { epoch: new Date('2025-01-07T00:00:00Z') } };
    const tue = new Date('2026-07-07T20:00:00Z'); // Tuesday local
    expect(svc.isCeremonyDue('start_of_cycle', asString, tue, null)).toBe(true);
    expect(svc.isCeremonyDue('start_of_cycle', asDate, tue, null)).toBe(true);
    expect(svc.resolve(asDate, tue).cycle.periodId).toBe(svc.resolve(asString, tue).cycle.periodId);
  });

  it('default constructor (no timezone) behaves as UTC and does not throw', () => {
    const svc = new CadenceService();
    const utcDay8 = new Date('2025-01-08T15:00:00Z');
    const utcDay9 = new Date('2025-01-09T07:00:00Z'); // still Jan 8 in PT, but Jan 9 UTC
    const r8 = svc.resolve({}, utcDay8);
    const r9 = svc.resolve({}, utcDay9);
    expect(r8.unit.periodId).not.toBe(r9.unit.periodId);
    expect(r8.unit.periodId.startsWith('2025')).toBe(true);
    // Monday alignment holds in UTC too: 2026-07-06 is a Monday
    expect(svc.isCeremonyDue('start_of_cycle', {}, new Date('2026-07-06T00:00:00Z'), null)).toBe(true);
  });
});
