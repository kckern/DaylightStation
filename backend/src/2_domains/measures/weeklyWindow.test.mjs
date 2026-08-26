import { describe, it, expect } from 'vitest';
import { studyDayFor, weekWindowFor, isInWindow, weekState } from './weeklyWindow.mjs';

const TZ = 'America/Los_Angeles';

describe('studyDayFor — the 4am boundary', () => {
  it('puts a 03:00 Sunday session in Saturday, the week that is ending', () => {
    expect(studyDayFor('2026-08-23T10:00:00Z', { timezone: TZ })).toBe('2026-08-22');
  });

  it('puts a 05:00 Sunday session in Sunday, starting the new week', () => {
    expect(studyDayFor('2026-08-23T12:00:00Z', { timezone: TZ })).toBe('2026-08-23');
  });

  it('keeps an ordinary afternoon session on its own date', () => {
    expect(studyDayFor('2026-08-26T21:00:00Z', { timezone: TZ })).toBe('2026-08-26');
  });
});

describe('weekWindowFor — Sunday to Saturday', () => {
  it('anchors on the containing Sunday', () => {
    // 2026-08-26 is a Wednesday.
    expect(weekWindowFor('2026-08-26')).toEqual({ from: '2026-08-23', to: '2026-08-29' });
  });

  it('treats Sunday as the FIRST day of its own week, not the last of the previous', () => {
    expect(weekWindowFor('2026-08-23')).toEqual({ from: '2026-08-23', to: '2026-08-29' });
  });

  it('treats Saturday as the last day of that same week', () => {
    expect(weekWindowFor('2026-08-29')).toEqual({ from: '2026-08-23', to: '2026-08-29' });
  });

  it('rolls to the next week the following Sunday — a rest-day walk head-starts it', () => {
    expect(weekWindowFor('2026-08-30')).toEqual({ from: '2026-08-30', to: '2026-09-05' });
  });
});

describe('isInWindow', () => {
  const win = weekWindowFor('2026-08-26');
  it('counts Saturday, because catch-up work is real work', () => {
    expect(isInWindow('2026-08-29', win)).toBe(true);
  });
  it('excludes the next Sunday, which belongs to the following week', () => {
    expect(isInWindow('2026-08-30', win)).toBe(false);
  });
  it('excludes the previous Saturday', () => {
    expect(isInWindow('2026-08-22', win)).toBe(false);
  });
});

describe('weekState', () => {
  const win = weekWindowFor('2026-08-26'); // Sun 08-23 .. Sat 08-29

  it('is untargeted when no quota is configured — every learner today', () => {
    expect(weekState({ value: 40, target: null, day: '2026-08-26', window: win })).toBe('untargeted');
  });

  it('is met once the target is reached, whatever day it is', () => {
    expect(weekState({ value: 200, target: 200, day: '2026-08-24', window: win })).toBe('met');
  });

  it('is on_track while the working window is still open', () => {
    expect(weekState({ value: 40, target: 200, day: '2026-08-26', window: win })).toBe('on_track');
  });

  it('is still on_track ON Friday — the deadline is end of Friday', () => {
    expect(weekState({ value: 40, target: 200, day: '2026-08-28', window: win })).toBe('on_track');
  });

  it('is behind on Saturday, which makes Saturday catch-up rather than payoff', () => {
    expect(weekState({ value: 40, target: 200, day: '2026-08-29', window: win })).toBe('behind');
  });
});
