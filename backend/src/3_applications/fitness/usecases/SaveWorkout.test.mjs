// backend/src/3_applications/fitness/usecases/SaveWorkout.test.mjs
//
// The library and the repository are stubs — this use case's whole job is the decision
// between them, so the tests are about which decision was made and what reached the
// repository, never about files.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SaveWorkout } from './SaveWorkout.mjs';

const KNOWN = new Set(['back-squat', 'plank', 'barbell-row', 'push-up']);

let library;
let repository;
let saved;
let suffixes;

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeUseCase(overrides = {}) {
  return new SaveWorkout({
    workoutRepository: repository,
    exerciseLibrary: library,
    logger: silentLogger,
    makeSuffix: () => suffixes.shift() ?? 'zzzz',
    ...overrides,
  });
}

beforeEach(() => {
  saved = [];
  suffixes = ['a1b2'];
  library = {
    getExercise: vi.fn((slug) => (KNOWN.has(slug) ? { slug, name: slug } : null)),
  };
  repository = {
    save: vi.fn((workout, householdId) => {
      saved.push({ workout, householdId });
      return {
        id: workout.id,
        createdAt: '2026-08-11T10:00:00.000Z',
        updatedAt: '2026-08-11T10:00:00.000Z',
        created: true,
      };
    }),
    exists: vi.fn(() => false),
  };
});

describe('SaveWorkout — unknown slugs are refused', () => {
  it('refuses a workout referencing an unknown exercise and never persists it', () => {
    const result = makeUseCase().execute({
      workout: {
        title: 'Bad Plan',
        groups: [{ rounds: 1, exercises: [{ slug: 'back-squat' }, { slug: 'bench-pres' }] }],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.unknownSlugs).toEqual(['bench-pres']);
    expect(result.error).toContain('bench-pres');
    // The point of the whole check: nothing reached storage.
    expect(repository.save).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('reports EVERY bad slug, across every group, in one response', () => {
    const result = makeUseCase().execute({
      workout: {
        title: 'Three Typos',
        groups: [
          { rounds: 1, exercises: [{ slug: 'bench-pres' }, { slug: 'back-squat' }, { slug: 'dead-lft' }] },
          { rounds: 2, exercises: [{ slug: 'plank' }, { slug: 'lat-pulldwn' }] },
        ],
      },
    });

    expect(result.ok).toBe(false);
    // All three, in first-appearance order — a first-failure-wins implementation
    // returns ['bench-pres'] and a per-group one stops after the first group.
    expect(result.unknownSlugs).toEqual(['bench-pres', 'dead-lft', 'lat-pulldwn']);
    expect(result.error).toContain('bench-pres');
    expect(result.error).toContain('dead-lft');
    expect(result.error).toContain('lat-pulldwn');
    // And every slug was actually looked up, including the ones after the first failure.
    expect(library.getExercise.mock.calls.map(([slug]) => slug))
      .toEqual(['bench-pres', 'back-squat', 'dead-lft', 'plank', 'lat-pulldwn']);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('names a repeated bad slug once', () => {
    const result = makeUseCase().execute({
      workout: {
        groups: [
          { exercises: [{ slug: 'wrong-name' }] },
          { exercises: [{ slug: 'wrong-name' }] },
        ],
      },
    });

    expect(result.unknownSlugs).toEqual(['wrong-name']);
    expect(result.error).toBe('unknown exercise slug: "wrong-name"');
  });

  it('reports a missing slug by position, since there is no name to quote', () => {
    const result = makeUseCase().execute({
      workout: {
        groups: [
          { exercises: [{ slug: 'plank' }] },
          { exercises: [{ slug: 'back-squat' }, { reps: 10 }] },
        ],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('group 2, exercise 2 is missing an exercise slug');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('refuses an id that could not be a filename', () => {
    const result = makeUseCase().execute({
      workout: { id: '../../etc/passwd', groups: [{ exercises: [{ slug: 'plank' }] }] },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid workout id');
    expect(repository.save).not.toHaveBeenCalled();
  });
});

describe('SaveWorkout — the happy path', () => {
  it('persists a fully known workout and hands back its id', () => {
    const result = makeUseCase().execute({
      workout: {
        title: 'Full Body Friday',
        author: 'kckern',
        groups: [{ rounds: 3, exercises: [{ slug: 'back-squat', sets: 2, reps: 8 }] }],
      },
      householdId: 'two',
    });

    expect(result).toMatchObject({ ok: true, id: 'full-body-friday-a1b2', created: true });
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(saved[0].householdId).toBe('two');
    expect(saved[0].workout.id).toBe('full-body-friday-a1b2');
    expect(saved[0].workout.title).toBe('Full Body Friday');
    expect(saved[0].workout.author).toBe('kckern');
    // Normalized before it left: the raw entry carried no restSeconds or load.
    expect(saved[0].workout.groups[0].exercises[0])
      .toEqual({ slug: 'back-squat', sets: 2, reps: 8, seconds: null, load: null, restSeconds: 0 });
  });

  it('treats a payload id as an update of that workout, not a request for a new one', () => {
    const result = makeUseCase().execute({
      workout: { id: 'leg-day-a1b2', title: 'Leg Day', groups: [{ exercises: [{ slug: 'plank' }] }] },
    });

    expect(result.ok).toBe(true);
    expect(result.id).toBe('leg-day-a1b2');
    expect(saved[0].workout.id).toBe('leg-day-a1b2');
    // No id was invented, so no collision probe was needed either.
    expect(repository.exists).not.toHaveBeenCalled();
  });

  it('generates a readable id from the title and retries past a collision', () => {
    suffixes = ['aaaa', 'bbbb'];
    repository.exists = vi.fn((id) => id === 'leg-day-aaaa');

    const result = makeUseCase().execute({
      workout: { title: 'Leg Day!', groups: [] },
    });

    expect(result.id).toBe('leg-day-bbbb');
    expect(repository.exists.mock.calls.map(([id]) => id)).toEqual(['leg-day-aaaa', 'leg-day-bbbb']);
  });

  it('falls back to a generic stem when there is no usable title', () => {
    const result = makeUseCase().execute({ workout: { groups: [] } });
    expect(result.id).toBe('workout-a1b2');
  });

  it('saves an empty draft — Build holds one while the author is still choosing', () => {
    const result = makeUseCase().execute({ workout: { title: 'Draft', groups: [] } });
    expect(result.ok).toBe(true);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(library.getExercise).not.toHaveBeenCalled();
  });
});

describe('SaveWorkout — construction', () => {
  it('will not construct without a library, since it could not validate anything', () => {
    expect(() => new SaveWorkout({ workoutRepository: repository })).toThrow(/exerciseLibrary/);
    expect(() => new SaveWorkout({ exerciseLibrary: library })).toThrow(/workoutRepository/);
  });
});
