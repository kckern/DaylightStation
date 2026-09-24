import { describe, it, expect } from 'vitest';
import { shouldSendExerciseReaction, toReactionActivity } from '../../../backend/src/3_applications/fitness/webhookCoachingPolicy.mjs';

describe('exercise reaction policy (fetched Strava activity)', () => {
  const now = new Date('2026-09-24T18:00:00Z'); // 11am PDT
  const opts = { now, timezone: 'America/Los_Angeles' };

  it('reacts to a >200 cal workout that started today (local)', () => {
    expect(shouldSendExerciseReaction({ calories: 420, start_date: '2026-09-24T15:00:00Z' }, opts)).toBe(true);
  });

  it('stays silent for a small workout, a missing calorie figure, or yesterday', () => {
    expect(shouldSendExerciseReaction({ calories: 150, start_date: '2026-09-24T15:00:00Z' }, opts)).toBe(false);
    expect(shouldSendExerciseReaction({ start_date: '2026-09-24T15:00:00Z' }, opts)).toBe(false);
    // 2026-09-24T05:00Z is 10pm on 09-23 in Pacific time
    expect(shouldSendExerciseReaction({ calories: 600, start_date: '2026-09-24T05:00:00Z' }, opts)).toBe(false);
  });

  it('honours a configured threshold', () => {
    expect(shouldSendExerciseReaction({ calories: 250, start_date: '2026-09-24T15:00:00Z' }, { ...opts, minCalories: 300 })).toBe(false);
  });

  it('maps the activity to the reaction shape', () => {
    expect(toReactionActivity({ id: 9, sport_type: 'Ride', moving_time: 2700, calories: 419.6 }))
      .toEqual({ id: 9, type: 'Ride', durationMin: 45, caloriesBurned: 420 });
  });
});
