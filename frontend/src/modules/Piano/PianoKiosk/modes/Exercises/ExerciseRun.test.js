import { describe, expect, it } from 'vitest';
import { resolveExerciseRunAccess } from './authorization.js';

describe('ExerciseRun authorization', () => {
  it('allows guest practice but never downgrades a guest challenge into practice', () => {
    expect(resolveExerciseRunAccess('practice', 'guest')).toEqual({
      challenge: false, persistent: false, allowed: true,
    });
    expect(resolveExerciseRunAccess('challenge', 'guest')).toEqual({
      challenge: true, persistent: false, allowed: false,
    });
  });

  it('allows a persistent player to run either purpose', () => {
    expect(resolveExerciseRunAccess('practice', 'learner4')).toEqual({
      challenge: false, persistent: true, allowed: true,
    });
    expect(resolveExerciseRunAccess('challenge', 'learner4')).toEqual({
      challenge: true, persistent: true, allowed: true,
    });
  });
});
