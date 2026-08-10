import { describe, expect, it } from 'vitest';
import {
  createAdaptiveSchedule, presentNext, rateCurrent,
} from './ti86-adaptive-scheduler.mjs';

describe('TI-86 adaptive scheduler reference', () => {
  it('returns AGAIN only after two intervening presentations', () => {
    const schedule = createAdaptiveSchedule({ cardCount: 4, maxExposuresPerCard: 4 });
    expect(presentNext(schedule)).toBe(0);
    rateCurrent(schedule, 'again');
    expect(presentNext(schedule)).toBe(1); rateCurrent(schedule, 'know');
    expect(presentNext(schedule)).toBe(2); rateCurrent(schedule, 'know');
    expect(presentNext(schedule)).toBe(0);
    expect(schedule.cards[0].exposureCount).toBe(2);
  });

  it('returns HARD only after four intervening presentations', () => {
    const schedule = createAdaptiveSchedule({ cardCount: 7, maxExposuresPerCard: 4 });
    expect(presentNext(schedule)).toBe(0);
    rateCurrent(schedule, 'hard');
    for (const expected of [1, 2, 3, 4]) {
      expect(presentNext(schedule)).toBe(expected);
      rateCurrent(schedule, 'know');
    }
    expect(presentNext(schedule)).toBe(0);
  });

  it('fast-forwards to the earliest due card without a fake presentation', () => {
    const schedule = createAdaptiveSchedule({ cardCount: 1, maxExposuresPerCard: 4 });
    expect(presentNext(schedule)).toBe(0);
    rateCurrent(schedule, 'again');
    expect(presentNext(schedule)).toBe(0);
    expect(schedule.ordinal).toBe(4);
    expect(schedule.cards[0].exposureCount).toBe(2);
  });

  it('retires an unresolved card exactly at its authored exposure cap', () => {
    const schedule = createAdaptiveSchedule({ cardCount: 1, maxExposuresPerCard: 2 });
    presentNext(schedule); rateCurrent(schedule, 'again');
    presentNext(schedule); rateCurrent(schedule, 'hard');
    expect(schedule.cards[0]).toMatchObject({
      exposureCount: 2, rating: 'hard', retired: true,
    });
    expect(presentNext(schedule)).toBeNull();
  });
});

