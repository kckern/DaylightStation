import { describe, it, expect } from 'vitest';
import { isWithinWindow, wallClockMinutes } from './timeWindow.js';

// 2026-10-09 incident: the piano tablet's Android timezone was switched to
// America/Chicago from Settings. Curfew read the DEVICE clock, so the 19:00
// cut-off fired at 17:00 Pacific and closed a child's lesson. Windows are now
// evaluated in the household timezone the server hands the kiosk.
//
// 2026-10-10T00:15:00Z = 17:15 PDT = 19:15 CDT. A fixed instant, so these
// assertions hold whatever zone the test runner itself is in.
const instant = new Date(Date.UTC(2026, 9, 10, 0, 15, 0));
const curfew = { start: '19:00', end: '06:00' };

describe('wallClockMinutes', () => {
  it('reads the wall clock in the given IANA zone', () => {
    expect(wallClockMinutes(instant, 'America/Los_Angeles')).toBe(17 * 60 + 15);
    expect(wallClockMinutes(instant, 'America/Chicago')).toBe(19 * 60 + 15);
    expect(wallClockMinutes(instant, 'UTC')).toBe(15);
  });

  it('reports midnight as 0, never 24:00', () => {
    const midnightPacific = new Date(Date.UTC(2026, 9, 10, 7, 0, 0)); // 00:00 PDT
    expect(wallClockMinutes(midnightPacific, 'America/Los_Angeles')).toBe(0);
  });

  it('falls back to device-local time for a missing or invalid zone', () => {
    const local = instant.getHours() * 60 + instant.getMinutes();
    expect(wallClockMinutes(instant, undefined)).toBe(local);
    expect(wallClockMinutes(instant, null)).toBe(local);
    expect(wallClockMinutes(instant, '')).toBe(local);
    expect(wallClockMinutes(instant, 'Not/AZone')).toBe(local);
  });
});

describe('isWithinWindow with a household timezone', () => {
  it('17:15 Pacific is NOT curfew, even when the device is set to Chicago', () => {
    expect(isWithinWindow(instant, curfew, 'America/Los_Angeles')).toBe(false);
  });

  it('the same instant read on a Chicago clock IS inside 19:00–06:00 (the bug)', () => {
    expect(isWithinWindow(instant, curfew, 'America/Chicago')).toBe(true);
  });

  it('honours the inclusive start / exclusive end in the household zone', () => {
    const at = (utcH, utcM) => new Date(Date.UTC(2026, 9, 10, utcH, utcM, 0));
    // 19:00 PDT = 02:00Z next day; 06:00 PDT = 13:00Z.
    expect(isWithinWindow(at(1, 59), curfew, 'America/Los_Angeles')).toBe(false); // 18:59
    expect(isWithinWindow(at(2, 0), curfew, 'America/Los_Angeles')).toBe(true);  // 19:00
    expect(isWithinWindow(at(12, 59), curfew, 'America/Los_Angeles')).toBe(true); // 05:59
    expect(isWithinWindow(at(13, 0), curfew, 'America/Los_Angeles')).toBe(false); // 06:00
  });

  it('fails open to device-local time on an invalid zone (today\'s behaviour)', () => {
    expect(isWithinWindow(instant, curfew, 'Not/AZone')).toBe(isWithinWindow(instant, curfew));
  });

  it('still returns false for an unset or malformed window', () => {
    expect(isWithinWindow(instant, null, 'America/Los_Angeles')).toBe(false);
    expect(isWithinWindow(instant, { start: 'x', end: '06:00' }, 'America/Los_Angeles')).toBe(false);
  });
});
