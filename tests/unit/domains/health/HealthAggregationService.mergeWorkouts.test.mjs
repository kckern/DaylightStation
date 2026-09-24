/**
 * mergeWorkouts pairs a Strava activity with the SAME activity from
 * FitnessSyncer. Real shapes from 2026-09-08 and 2026-08-28 (strava.yml,
 * fitness.yml), where duration-only matching went wrong both ways.
 */
import { describe, it, expect } from 'vitest';
import { HealthAggregator } from '#domains/health/services/HealthAggregationService.mjs';

const merged = (s, f) => HealthAggregator.mergeWorkouts(s, f).map(w => [w.title, w.calories]);

describe('HealthAggregator.mergeWorkouts', () => {
  it('pairs by start time, not by a coincidentally similar duration', () => {
    const strava = [
      { title: 'Game Cycling—F-Zero GX', type: 'Ride', minutes: 35.22, calories: 198, startTime: '08:02 pm' },
      { title: 'Chop Wood Carry Water—Tempo Strength', type: 'WeightTraining', minutes: 38.42, calories: 282, startTime: '12:50 pm' },
    ];
    const fitness = [
      { title: 'Strength Training', minutes: 38.42, calories: 282, startTime: '12:50 pm' },
      { title: 'Cycling', minutes: 35.21, calories: 198, startTime: '08:02 pm' },
    ];
    expect(merged(strava, fitness)).toEqual([['Game Cycling—F-Zero GX', 198], ['Chop Wood Carry Water—Tempo Strength', 282]]);
  });

  it('merges one run logged as moving time on Strava and elapsed time on the watch', () => {
    const strava = [{ title: 'Lunch Run', type: 'Run', minutes: 42.47, calories: 517, startTime: '12:54 pm' }];
    const fitness = [{ title: 'Running', minutes: 87.18, calories: 518, startTime: '12:54 pm' }];
    const out = HealthAggregator.mergeWorkouts(strava, fitness);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'Lunch Run', calories: 518 });
  });

  it('keeps two genuinely separate activities of similar length apart', () => {
    const strava = [{ title: 'Morning ride', minutes: 30, calories: 200, startTime: '07:00 am' }];
    const fitness = [{ title: 'Cycling', minutes: 31, calories: 210, startTime: '06:30 pm' }];
    expect(HealthAggregator.mergeWorkouts(strava, fitness)).toHaveLength(2);
  });

  it('falls back to duration when start times are missing', () => {
    const out = HealthAggregator.mergeWorkouts([{ title: 'Ride', minutes: 30, calories: 200 }], [{ title: 'Cycling', minutes: 31, calories: 220 }]);
    expect(out).toHaveLength(1);
    expect(out[0].calories).toBe(220);
  });
});
