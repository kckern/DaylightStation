// backend/src/3_applications/fitness/usecases/PrepareWorkoutRun.test.mjs
//
// The repository and the library are stubs — this use case's job is the expansion and the
// join, not files. The EXPANSION is asserted against `expandWorkout`'s real output rather
// than a hand-written fixture: a fixture would be a second copy of the ordering rule, free
// to drift from the domain, which is the exact bug the domain module exists to prevent.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expandWorkout } from '#domains/fitness/workout/workout.mjs';
import { PrepareWorkoutRun } from './PrepareWorkoutRun.mjs';

// Null-prototype, exactly as the real repository keys its slug maps: corpus slugs are
// third-party strings, so a plain literal would answer `CORPUS['__proto__']` with
// Object.prototype and the stub would report a hostile slug as a known exercise.
const CORPUS = Object.assign(Object.create(null), {
  'back-squat': { slug: 'back-squat', name: 'Barbell Back Squat', image: 'media/library/exercise/assets/squat.gif' },
  'barbell-row': { slug: 'barbell-row', name: 'Barbell Row', image: 'media/library/exercise/assets/row.gif' },
  plank: { slug: 'plank', name: 'Plank', image: null },
});

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

let library;
let repository;
let shelf;

function makeUseCase(overrides = {}) {
  return new PrepareWorkoutRun({
    workoutRepository: repository,
    exerciseLibrary: library,
    logger: silentLogger,
    ...overrides,
  });
}

/** Straight sets: one exercise, 3 sets, no rest -> A A A. */
const STRAIGHT = {
  id: 'leg-day',
  title: 'Leg Day',
  groups: [{ rounds: 1, exercises: [{ slug: 'back-squat', sets: 3, reps: 5, load: '225 lb' }] }],
};

/** Superset: two exercises, sets 1, rounds 3 -> A B A B A B. */
const SUPERSET = {
  id: 'push-pull',
  title: 'Push Pull',
  groups: [{
    rounds: 3,
    exercises: [
      { slug: 'back-squat', sets: 1, reps: 8 },
      { slug: 'barbell-row', sets: 1, reps: 10 },
    ],
  }],
};

/** Circuit: three exercises, sets 1, rounds 2 -> A B C A B C, with rest between. */
const CIRCUIT = {
  id: 'circuit',
  title: 'Circuit',
  groups: [{
    rounds: 2,
    exercises: [
      { slug: 'back-squat', sets: 1, reps: 8, restSeconds: 30 },
      { slug: 'barbell-row', sets: 1, reps: 10, restSeconds: 30 },
      { slug: 'plank', sets: 1, seconds: 45, restSeconds: 30 },
    ],
  }],
};

beforeEach(() => {
  shelf = new Map([
    ['leg-day', STRAIGHT],
    ['push-pull', SUPERSET],
    ['circuit', CIRCUIT],
  ]);
  library = { getExercise: vi.fn((slug) => CORPUS[slug] ?? null) };
  repository = { get: vi.fn((id) => shelf.get(id) ?? null) };
});

describe('PrepareWorkoutRun — expansion', () => {
  it('matches expandWorkout for straight sets', () => {
    const result = makeUseCase().execute({ workoutId: 'leg-day' });
    expect(result.ok).toBe(true);
    expect(result.steps).toEqual(expandWorkout(STRAIGHT));
    expect(result.steps.map((s) => s.slug)).toEqual(['back-squat', 'back-squat', 'back-squat']);
    expect(result.steps.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(result.steps.every((s) => s.totalSets === 3)).toBe(true);
  });

  it('matches expandWorkout for a superset, and it really alternates A B A B A B', () => {
    const result = makeUseCase().execute({ workoutId: 'push-pull' });
    expect(result.steps).toEqual(expandWorkout(SUPERSET));
    expect(result.steps.map((s) => s.slug)).toEqual([
      'back-squat', 'barbell-row',
      'back-squat', 'barbell-row',
      'back-squat', 'barbell-row',
    ]);
    expect(result.steps.every((s) => s.groupKind === 'superset')).toBe(true);
  });

  it('matches expandWorkout for a circuit, rest steps and dropped trailing rest included', () => {
    const result = makeUseCase().execute({ workoutId: 'circuit' });
    expect(result.steps).toEqual(expandWorkout(CIRCUIT));
    expect(result.steps.filter((s) => s.kind === 'work').map((s) => s.slug)).toEqual([
      'back-squat', 'barbell-row', 'plank',
      'back-squat', 'barbell-row', 'plank',
    ]);
    // Every work step but the last is followed by a rest; the final rest is dropped.
    expect(result.steps.at(-1).kind).toBe('work');
    expect(result.steps.filter((s) => s.kind === 'rest')).toHaveLength(5);
    expect(result.steps.every((s) => s.groupKind === 'circuit')).toBe(true);
  });

  it('reports the workout identity beside the steps', () => {
    const result = makeUseCase().execute({ workoutId: 'push-pull' });
    expect(result.workout).toEqual({ id: 'push-pull', title: 'Push Pull' });
  });
});

describe('PrepareWorkoutRun — the display lookup', () => {
  it('resolves real names and images for every slug in the plan', () => {
    const result = makeUseCase().execute({ workoutId: 'circuit' });
    expect(result.exercises).toEqual({
      'back-squat': { name: 'Barbell Back Squat', image: 'media/library/exercise/assets/squat.gif' },
      'barbell-row': { name: 'Barbell Row', image: 'media/library/exercise/assets/row.gif' },
      plank: { name: 'Plank', image: null },
    });
    expect(result.missingSlugs).toEqual([]);
  });

  it('resolves each slug once, however many steps mention it', () => {
    makeUseCase().execute({ workoutId: 'push-pull' }); // 6 steps, 2 slugs
    expect(library.getExercise).toHaveBeenCalledTimes(2);
  });

  it('covers the slugs a REST step names on either side of it', () => {
    // A rest between two exercises carries afterSlug/nextSlug and the runner labels the
    // countdown with them. Building the lookup from work steps alone would leave those
    // labels as humanised slugs.
    const result = makeUseCase().execute({ workoutId: 'circuit' });
    const rests = result.steps.filter((s) => s.kind === 'rest');
    expect(rests.length).toBeGreaterThan(0);
    for (const rest of rests) {
      expect(result.exercises[rest.afterSlug]).toBeTruthy();
      if (rest.nextSlug) expect(result.exercises[rest.nextSlug]).toBeTruthy();
    }
  });

  it('does not ship the corpus body — only what a run screen draws', () => {
    const result = makeUseCase().execute({ workoutId: 'leg-day' });
    expect(Object.keys(result.exercises['back-squat']).sort()).toEqual(['image', 'name']);
  });
});

describe('PrepareWorkoutRun — degraded input', () => {
  it('answers unknown_workout for an id that names nothing', () => {
    const result = makeUseCase().execute({ workoutId: 'never-existed' });
    expect(result).toEqual({
      ok: false,
      reason: 'unknown_workout',
      error: 'unknown workout "never-existed"',
    });
  });

  it('answers missing_workout when neither an id nor a record was supplied', () => {
    const result = makeUseCase().execute({});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_workout');
  });

  it('still runs a workout whose slug has vanished from the corpus', () => {
    shelf.set('stale', {
      id: 'stale',
      title: 'Stale',
      groups: [{
        rounds: 2,
        exercises: [
          { slug: 'back-squat', sets: 1, reps: 5, restSeconds: 30 },
          { slug: 'retired-machine-fly', sets: 1, reps: 12, restSeconds: 30 },
        ],
      }],
    });

    const result = makeUseCase().execute({ workoutId: 'stale' });

    // The plan still expands in full — nobody standing at a rack loses their workout
    // because the corpus was rebuilt.
    expect(result.ok).toBe(true);
    expect(result.steps.filter((s) => s.kind === 'work').map((s) => s.slug)).toEqual([
      'back-squat', 'retired-machine-fly', 'back-squat', 'retired-machine-fly',
    ]);
    // The known slug still resolves; the vanished one is absent and named.
    expect(result.exercises['back-squat'].name).toBe('Barbell Back Squat');
    expect(result.exercises['retired-machine-fly']).toBeUndefined();
    expect(result.missingSlugs).toEqual(['retired-machine-fly']);
  });

  it('expands an empty plan to nothing rather than throwing', () => {
    shelf.set('empty', { id: 'empty', title: 'Empty', groups: [] });
    const result = makeUseCase().execute({ workoutId: 'empty' });
    expect(result.ok).toBe(true);
    expect(result.steps).toEqual([]);
    expect(result.exercises).toEqual({});
  });

  it('is safe for a hostile slug', () => {
    shelf.set('hostile', {
      id: 'hostile',
      title: 'Hostile',
      groups: [{ exercises: [{ slug: '__proto__', sets: 1 }] }],
    });
    const result = makeUseCase().execute({ workoutId: 'hostile' });
    expect(result.ok).toBe(true);
    expect(result.missingSlugs).toEqual(['__proto__']);
    expect({}.polluted).toBeUndefined();
  });
});

describe('PrepareWorkoutRun — unsaved drafts', () => {
  it('expands an inline record that was never saved, without touching the shelf', () => {
    const draft = {
      title: 'Draft at the rack',
      groups: [{
        rounds: 3,
        exercises: [
          { slug: 'back-squat', sets: 1, reps: 8 },
          { slug: 'barbell-row', sets: 1, reps: 10 },
        ],
      }],
    };

    const result = makeUseCase().execute({ workout: draft });

    expect(repository.get).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.workout).toEqual({ id: null, title: 'Draft at the rack' });
    expect(result.steps).toEqual(expandWorkout(draft));
    expect(result.steps.map((s) => s.slug)).toEqual([
      'back-squat', 'barbell-row',
      'back-squat', 'barbell-row',
      'back-squat', 'barbell-row',
    ]);
    expect(result.exercises['barbell-row'].name).toBe('Barbell Row');
  });

  it('prefers the draft in hand over the shelf copy of the same id', () => {
    // Build keeps editing after a save. The plan the person is about to perform is the
    // one they are holding, not the one last written to the shelf.
    const edited = {
      id: 'leg-day',
      title: 'Leg Day',
      groups: [{ rounds: 1, exercises: [{ slug: 'back-squat', sets: 5, reps: 5 }] }],
    };
    const result = makeUseCase().execute({ workoutId: 'leg-day', workout: edited });
    expect(repository.get).not.toHaveBeenCalled();
    expect(result.steps).toHaveLength(5);
  });
});

describe('PrepareWorkoutRun — construction', () => {
  it('refuses to be built without a repository or a library', () => {
    expect(() => new PrepareWorkoutRun({ exerciseLibrary: library })).toThrow(/workoutRepository/);
    expect(() => new PrepareWorkoutRun({ workoutRepository: repository })).toThrow(/exerciseLibrary/);
  });
});
