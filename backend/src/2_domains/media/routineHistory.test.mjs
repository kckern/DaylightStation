import { describe, it, expect } from 'vitest';
import { buildRoutineRun, appendRun, loadLabel, flagRoutines, ROUTINE_HISTORY_DEFAULTS } from './routineHistory.mjs';

const routine = { id: 'automation:kitchen_button_1', name: 'Kitchen Button 1: Morning Program' };
const AT = '2026-10-03T14:02:00.000Z';

describe('loadLabel', () => {
  it('names what a load asked for', () => {
    expect(loadLabel({ queue: 'morning-program', shuffle: '1' })).toEqual({ key: 'queue', value: 'morning-program', contentId: null });
    expect(loadLabel({ play: 'plex:123' })).toEqual({ key: 'play', value: 'plex:123', contentId: 'plex:123' });
    expect(loadLabel({ hymn: '113' })).toEqual({ key: 'hymn', value: '113', contentId: null });
    expect(loadLabel({})).toEqual({ key: null, value: null, contentId: null });
  });
});

describe('buildRoutineRun', () => {
  const base = { at: AT, routine, deviceId: 'fleet:livingroom-tv', screenName: 'Living Room TV', query: { queue: 'morning-program' } };
  it('a successful load is "started"', () => {
    expect(buildRoutineRun({ ...base, result: { ok: true, dispatchId: 'd1', totalElapsedMs: 2400 } })).toEqual({
      at: AT, routine, deviceId: 'fleet:livingroom-tv',
      what: { key: 'queue', value: 'morning-program', contentId: null },
      outcome: 'started', reason: null, failedStep: null, elapsedMs: 2400, dispatchId: 'd1',
    });
  });
  it('failures carry a plain reason naming the screen', () => {
    const reason = (result) => buildRoutineRun({ ...base, result }).reason;
    expect(reason({ ok: false, failedStep: 'power', error: 'x' })).toBe('Living Room TV did not turn on');
    expect(reason({ ok: false, failedStep: 'verify' })).toBe("Living Room TV turned on but didn't come up");
    expect(reason({ ok: false, failedStep: 'prepare' })).toBe('Living Room TV could not get ready');
    expect(reason({ ok: false, failedStep: 'load' })).toBe("Living Room TV didn't respond — it may be asleep or closed");
    expect(reason({ ok: false, failedStep: 'prewarm' })).toBe("Couldn't find morning-program");
    expect(reason({ ok: false, error: 'Device not found' })).toBe("Living Room TV isn't set up");
    expect(reason({ ok: false, failedStep: 'load', cancelled: true })).toBe('Cancelled');
    expect(buildRoutineRun({ ...base, result: { ok: false, failedStep: 'power' } }).outcome).toBe('failed');
  });
  it('a thrown error and a deduplicated repeat are recorded as such', () => {
    expect(buildRoutineRun({ ...base, error: new Error('boom') })).toMatchObject({ outcome: 'failed', reason: 'Something went wrong (boom)' });
    expect(buildRoutineRun({ ...base, result: { ok: true, deduplicated: true } })).toMatchObject({ outcome: 'deduplicated', reason: 'Already started a moment ago' });
  });
});

describe('appendRun', () => {
  it('keeps the newest runs within the retention window and the cap', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.parse(AT);
    const old = { at: new Date(now - (ROUTINE_HISTORY_DEFAULTS.retentionDays + 1) * day).toISOString() };
    const runs = appendRun([old, { at: new Date(now - day).toISOString() }], { at: AT }, { now, max: 2 });
    expect(runs.map((r) => r.at)).toEqual([new Date(now - day).toISOString(), AT]);
    expect(appendRun([{ at: 'a' }, { at: 'b' }], { at: AT }, { now, max: 2 }).length).toBe(2);
  });
});

describe('flagRoutines', () => {
  const now = Date.parse(AT);
  const screens = [
    { id: 'fleet:livingroom-tv', name: 'Living Room TV', kind: 'screen', wakeable: true, online: false, aliases: [] },
    { id: 'fleet:portal', name: 'Portal', kind: 'screen', wakeable: false, online: false, aliases: [] },
    { id: 'browser:kitchen', name: 'Kitchen tablet', kind: 'browser', wakeable: false, online: null, lastSeen: new Date(now - 60 * 60_000).toISOString(), aliases: ['browser:dup'] },
    { id: 'fleet:office-tv', name: 'Office Screen', kind: 'screen', wakeable: true, online: true, aliases: [] },
  ];
  const retired = [{ id: 'fleet:old-tv', name: 'Old TV', retiredAt: AT, aliases: [] }];
  const routines = [
    { id: 'a', name: 'Morning', targets: [{ deviceId: 'fleet:livingroom-tv' }] },
    { id: 'b', name: 'Portal story', targets: [{ deviceId: 'fleet:portal' }] },
    { id: 'c', name: 'Kitchen radio', targets: [{ deviceId: 'browser:dup' }] },
    { id: 'd', name: 'Old', targets: [{ deviceId: 'fleet:old-tv' }] },
    { id: 'e', name: 'Ghost', targets: [{ deviceId: 'fleet:ghost' }] },
    { id: 'f', name: 'Office', targets: [{ deviceId: 'fleet:office-tv' }] },
  ];
  const runs = [{ at: AT, routine: { id: 'f', name: 'Office' }, deviceId: 'fleet:office-tv', outcome: 'failed', reason: 'Office Screen did not turn on' }];

  it('flags routines pointed at screens that are off, unreachable, retired or unknown, and ones whose last start failed', () => {
    const flags = flagRoutines({ routines, screens, retired, runs, now });
    const by = Object.fromEntries(flags.map((f) => [f.routine.id, f]));
    expect(by.a).toMatchObject({ problem: 'off', severity: 'info', reason: 'Living Room TV is off; the routine will turn it on' });
    expect(by.b).toMatchObject({ problem: 'unreachable', severity: 'warn', reason: "Portal isn't reachable" });
    expect(by.c).toMatchObject({ problem: 'unreachable', deviceId: 'browser:kitchen', reason: "Kitchen tablet isn't open right now" });
    expect(by.d).toMatchObject({ problem: 'retired', reason: 'Points at Old TV, which was retired' });
    expect(by.e).toMatchObject({ problem: 'unknown-screen', reason: "Points at a screen the house doesn't know (fleet:ghost)" });
    expect(by.f).toMatchObject({ problem: 'last-start-failed', reason: 'Office Screen did not turn on' });
  });
});
