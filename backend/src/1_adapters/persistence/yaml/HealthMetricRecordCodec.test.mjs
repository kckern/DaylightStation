import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkoutEntry } from '#domains/health/entities/WorkoutEntry.mjs';
import { dehydrateWorkoutRecord } from './HealthMetricRecordCodec.mjs';

test('Strava-only workout preserves legacy omission of unrelated optional keys', () => {
  const strava = { id: 42, name: 'Morning Ride' };
  const stored = dehydrateWorkoutRecord(new WorkoutEntry({
    source: 'strava', title: 'Morning Ride', type: 'Ride', duration: 30,
    calories: 240, strava,
  }));

  assert.deepEqual(stored, {
    source: 'strava', title: 'Morning Ride', type: 'Ride', duration: 30,
    calories: 240, strava,
  });
  for (const key of ['avgHr', 'maxHr', 'distance', 'startTime', 'endTime', 'fitness']) {
    assert.equal(key in stored, false, `${key} must remain absent`);
  }
});
