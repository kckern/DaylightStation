import { describe, it, expect } from 'vitest';
import { studyDayFor, weekWindowFor, isInWindow, weekState } from './weeklyWindow.mjs';

const TZ = 'America/Los_Angeles';

describe('studyDayFor — the 4am boundary', () => {
  it('puts a 03:00 Monday session in Sunday, the week that is ending', () => {
    expect(studyDayFor('2026-08-31T10:00:00Z', { timezone: TZ })).toBe('2026-08-30');
  });

  it('puts a 05:00 Monday session in Monday, starting the new week', () => {
    expect(studyDayFor('2026-08-31T12:00:00Z', { timezone: TZ })).toBe('2026-08-31');
  });

  it('keeps an ordinary afternoon session on its own date', () => {
    expect(studyDayFor('2026-08-26T21:00:00Z', { timezone: TZ })).toBe('2026-08-26');
  });
});

describe('weekWindowFor — Monday to Sunday', () => {
  it('anchors on the containing Monday', () => {
    // 2026-08-26 is a Wednesday.
    expect(weekWindowFor('2026-08-26')).toEqual({ from: '2026-08-24', to: '2026-08-30' });
  });

  it('treats Monday as the first day of its own week', () => {
    expect(weekWindowFor('2026-08-24')).toEqual({ from: '2026-08-24', to: '2026-08-30' });
  });

  it('treats Sunday as the last day of that same week', () => {
    expect(weekWindowFor('2026-08-30')).toEqual({ from: '2026-08-24', to: '2026-08-30' });
  });

  it('rolls to the next week on Monday', () => {
    expect(weekWindowFor('2026-08-31')).toEqual({ from: '2026-08-31', to: '2026-09-06' });
  });
});

describe('isInWindow', () => {
  const win = weekWindowFor('2026-08-26');
  it('counts the weekend inside the current week', () => {
    expect(isInWindow('2026-08-29', win)).toBe(true);
    expect(isInWindow('2026-08-30', win)).toBe(true);
  });
  it('excludes the next Monday, which belongs to the following week', () => {
    expect(isInWindow('2026-08-31', win)).toBe(false);
  });
  it('excludes the previous Sunday', () => {
    expect(isInWindow('2026-08-23', win)).toBe(false);
  });
});

describe('weekState', () => {
  const win = weekWindowFor('2026-08-26'); // Mon 08-24 .. Sun 08-30

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

  it('is behind through the weekend, which makes it catch-up rather than payoff', () => {
    expect(weekState({ value: 40, target: 200, day: '2026-08-29', window: win })).toBe('behind');
    expect(weekState({ value: 40, target: 200, day: '2026-08-30', window: win })).toBe('behind');
  });
});
