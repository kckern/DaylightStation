/**
 * SetDailyCoachingUseCase tests (F-001 persistence path)
 *
 * Round-trips through an in-memory fake healthStore so we can verify
 * - validation goes through DailyCoachingEntry before any I/O
 * - the coaching field is set on the day entry without clobbering siblings
 * - new date entries are created when missing
 * - null clears the coaching field
 * - bad inputs (date format, unknown keys, wrong types) throw before save
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SetDailyCoachingUseCase } from '#apps/health/SetDailyCoachingUseCase.mjs';

/**
 * Build an in-memory fake datastore that captures save calls.
 *
 * @param {Object} [seed] initial healthData keyed by date
 */
function makeFakeStore(seed = {}) {
  const state = {
    healthData: { ...seed },
    saveCalls: [],
    loadCalls: [],
  };

  return {
    state,
    loadHealthData: vi.fn(async (userId) => {
      state.loadCalls.push({ userId });
      // Return a deep-ish copy to make sure the use case doesn't rely on aliasing
      return JSON.parse(JSON.stringify(state.healthData));
    }),
    saveHealthData: vi.fn(async (userId, data) => {
      state.saveCalls.push({ userId, data: JSON.parse(JSON.stringify(data)) });
      state.healthData = JSON.parse(JSON.stringify(data));
    }),
  };
}

const USER = 'test-user';
const DATE = '2026-05-01';

// Schema mirroring the F-001 fixture playbook so the existing assertion
// shapes (post_workout_protein, daily_strength_micro, daily_note) keep
// working under the new playbook-driven entity.
const FIXTURE_SCHEMA = [
  {
    key: 'post_workout_protein',
    type: 'boolean',
    fields: {
      taken: { type: 'boolean', required: true },
      timestamp: { type: 'string', required: false },
      source: { type: 'string', required: false },
    },
  },
  {
    key: 'daily_strength_micro',
    type: 'numeric',
    fields: {
      movement: { type: 'string', required: true },
      reps: { type: 'integer', required: true, min: 0 },
    },
    average_field: 'reps',
  },
  {
    key: 'daily_note',
    type: 'text',
    fields: {
      value: { type: 'string', required: true, max_length: 200 },
    },
  },
];

function makeFixtureLoader() {
  return {
    loadPlaybook: vi.fn(async () => ({ coaching_dimensions: FIXTURE_SCHEMA })),
  };
}

describe('SetDailyCoachingUseCase', () => {
  let store;
  let useCase;

  beforeEach(() => {
    store = makeFakeStore();
    useCase = new SetDailyCoachingUseCase({
      healthStore: store,
      personalContextLoader: makeFixtureLoader(),
    });
  });

  it('validates input via DailyCoachingEntry — invalid input throws before any datastore call', async () => {
    await expect(
      useCase.execute({
        userId: USER,
        date: DATE,
        coaching: { post_workout_protein: { taken: 'yes' } }, // not a boolean
      }),
    ).rejects.toThrow(/taken must be a boolean/);

    expect(store.loadHealthData).not.toHaveBeenCalled();
    expect(store.saveHealthData).not.toHaveBeenCalled();
  });

  it('rejects unknown top-level coaching keys before saving', async () => {
    await expect(
      useCase.execute({
        userId: USER,
        date: DATE,
        coaching: { mystery_field: true },
      }),
    ).rejects.toThrow(/unknown top-level key/);

    expect(store.saveHealthData).not.toHaveBeenCalled();
  });

  it('loads existing health data, sets coaching field on the date entry, and saves back', async () => {
    store = makeFakeStore({
      [DATE]: { weight: { lbs: 175 } },
    });
    useCase = new SetDailyCoachingUseCase({
      healthStore: store,
      personalContextLoader: makeFixtureLoader(),
    });

    await useCase.execute({
      userId: USER,
      date: DATE,
      coaching: { daily_note: 'felt great' },
    });

    expect(store.loadHealthData).toHaveBeenCalledWith(USER);
    expect(store.saveHealthData).toHaveBeenCalledTimes(1);
    const saved = store.state.saveCalls[0].data;
    expect(saved[DATE].coaching).toEqual({ daily_note: 'felt great' });
    expect(saved[DATE].weight).toEqual({ lbs: 175 });
  });

  it('creates a new date entry if missing, with just the coaching field', async () => {
    expect(store.state.healthData[DATE]).toBeUndefined();

    await useCase.execute({
      userId: USER,
      date: DATE,
      coaching: {
        post_workout_protein: { taken: true, timestamp: '07:15' },
      },
    });

    const saved = store.state.saveCalls[0].data;
    expect(saved[DATE]).toEqual({
      coaching: { post_workout_protein: { taken: true, timestamp: '07:15' } },
    });
  });

  it('does NOT clobber existing fields on the date entry (weight, nutrition, workouts preserved)', async () => {
    store = makeFakeStore({
      [DATE]: {
        weight: { lbs: 180 },
        nutrition: { calories: 2100 },
        workouts: [{ id: 'w1' }],
      },
    });
    useCase = new SetDailyCoachingUseCase({
      healthStore: store,
      personalContextLoader: makeFixtureLoader(),
    });

    await useCase.execute({
      userId: USER,
      date: DATE,
      coaching: { daily_strength_micro: { movement: 'pull_up', reps: 5 } },
    });

    const saved = store.state.saveCalls[0].data;
    expect(saved[DATE].weight).toEqual({ lbs: 180 });
    expect(saved[DATE].nutrition).toEqual({ calories: 2100 });
    expect(saved[DATE].workouts).toEqual([{ id: 'w1' }]);
    expect(saved[DATE].coaching).toEqual({
      daily_strength_micro: { movement: 'pull_up', reps: 5 },
    });
  });

  it('serialized coaching matches DailyCoachingEntry.serialize() shape (snake_case keys, no nulls)', async () => {
    await useCase.execute({
      userId: USER,
      date: DATE,
      coaching: {
        post_workout_protein: { taken: true, timestamp: '07:15', source: 'shake_brand' },
        daily_strength_micro: { movement: 'pull_up', reps: 5 },
        daily_note: '  felt heavy  ', // entity trims
      },
    });

    const saved = store.state.saveCalls[0].data;
    expect(saved[DATE].coaching).toEqual({
      post_workout_protein: { taken: true, timestamp: '07:15', source: 'shake_brand' },
      daily_strength_micro: { movement: 'pull_up', reps: 5 },
      daily_note: 'felt heavy',
    });
    // No camelCase leakage from the entity
    expect(saved[DATE].coaching).not.toHaveProperty('postWorkoutProtein');
    expect(saved[DATE].coaching).not.toHaveProperty('dailyStrengthMicro');
    expect(saved[DATE].coaching).not.toHaveProperty('dailyNote');
  });

  it('passing coaching: null clears the coaching field on the date entry', async () => {
    store = makeFakeStore({
      [DATE]: {
        weight: { lbs: 175 },
        coaching: { daily_note: 'old note' },
      },
    });
    useCase = new SetDailyCoachingUseCase({
      healthStore: store,
      personalContextLoader: makeFixtureLoader(),
    });

    await useCase.execute({ userId: USER, date: DATE, coaching: null });

    const saved = store.state.saveCalls[0].data;
    expect(saved[DATE]).toBeDefined();
    expect(saved[DATE].weight).toEqual({ lbs: 175 });
    expect(saved[DATE]).not.toHaveProperty('coaching');
  });

  it('rejects invalid date formats (must be YYYY-MM-DD)', async () => {
    for (const bad of ['2026-5-1', '20260501', '2026/05/01', '', null, undefined, 'today']) {
      await expect(
        useCase.execute({ userId: USER, date: bad, coaching: { daily_note: 'x' } }),
      ).rejects.toThrow(/date|required/i);
    }
    expect(store.saveHealthData).not.toHaveBeenCalled();
  });

  it('requires userId', async () => {
    await expect(
      useCase.execute({ userId: '', date: DATE, coaching: { daily_note: 'x' } }),
    ).rejects.toThrow(/userId/);
    expect(store.saveHealthData).not.toHaveBeenCalled();
  });

  it('throws if constructed without a healthStore', () => {
    expect(() => new SetDailyCoachingUseCase({})).toThrow(/healthStore/);
  });
});
