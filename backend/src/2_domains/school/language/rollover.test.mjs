/**
 * Rollover tests. A study day runs boundary-to-boundary (4am default), not
 * midnight-to-midnight, so a session running past midnight stays the same day.
 */
import { describe, it, expect } from 'vitest';
import { shouldRollDay, studyDayIndex } from './rollover.mjs';

const at = (iso) => Date.parse(iso);
const DONE = [{ done: true }, { done: true }];

describe('studyDayIndex', () => {
  it('keeps 1am on the same study day as the evening before', () => {
    // The learner who drills until 1am has not earned tomorrow's sentences.
    expect(studyDayIndex(at('2026-07-21T22:00:00Z')))
      .toBe(studyDayIndex(at('2026-07-22T01:00:00Z')));
  });

  it('starts a new study day at the boundary hour', () => {
    expect(studyDayIndex(at('2026-07-22T04:00:00Z')))
      .toBe(studyDayIndex(at('2026-07-22T03:59:00Z')) + 1);
  });

  it('honours a non-default boundary hour', () => {
    const opts = { boundaryHour: 0 };
    // At a midnight boundary, 1am IS the next day.
    expect(studyDayIndex(at('2026-07-22T01:00:00Z'), opts))
      .toBe(studyDayIndex(at('2026-07-21T22:00:00Z'), opts) + 1);
  });

  it('shifts with the local offset', () => {
    // 20:00 UTC is already 05:00 next day in Seoul (+540) — past the boundary.
    const utc = studyDayIndex(at('2026-07-21T20:00:00Z'), { offsetMinutes: 0 });
    const seoul = studyDayIndex(at('2026-07-21T20:00:00Z'), { offsetMinutes: 540 });
    expect(seoul).toBe(utc + 1);
  });
});

describe('shouldRollDay', () => {
  it('refuses while work is outstanding', () => {
    const result = shouldRollDay({
      queue: [{ done: true }, { done: false }],
      lastActivity: at('2026-07-20T10:00:00Z'),
      now: at('2026-07-22T10:00:00Z'),
    });
    expect(result).toEqual({ roll: false, reason: 'queue-incomplete' });
  });

  it('refuses before the boundary even when the queue is finished', () => {
    // Finishing early must not hand out tomorrow's sentences — otherwise a
    // keen learner burns the corpus in an afternoon and the spacing, which IS
    // the method, is gone.
    const result = shouldRollDay({
      queue: DONE,
      lastActivity: at('2026-07-21T09:00:00Z'),
      now: at('2026-07-21T14:00:00Z'),
    });
    expect(result).toEqual({ roll: false, reason: 'before-boundary' });
  });

  it('rolls once the queue is clear and the boundary has passed', () => {
    const result = shouldRollDay({
      queue: DONE,
      lastActivity: at('2026-07-21T09:00:00Z'),
      now: at('2026-07-22T09:00:00Z'),
    });
    expect(result).toEqual({ roll: true, reason: 'earned' });
  });

  it('treats an empty queue as complete so a finished learner is not stalled', () => {
    const result = shouldRollDay({
      queue: [],
      lastActivity: at('2026-07-21T09:00:00Z'),
      now: at('2026-07-22T09:00:00Z'),
    });
    expect(result.roll).toBe(true);
  });

  it('does not roll for a learner who has never studied', () => {
    // Day 1 is created by the service, not by a rollover.
    const result = shouldRollDay({ queue: [], lastActivity: null, now: at('2026-07-22T09:00:00Z') });
    expect(result).toEqual({ roll: false, reason: 'no-activity' });
  });
});
