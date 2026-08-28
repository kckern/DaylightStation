import { describe, expect, it } from 'vitest';
import { resolveExerciseRunAccess } from './authorization.js';
import { wrongEventState } from './ExerciseRun.jsx';

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

describe('ExerciseRun wrong-note state', () => {
  // `lastWrong` is `null | { midi, eventId }` — never a bare boolean. Every
  // matcher already emits both fields (assessmentAttempt.js wrong events), and
  // the played pitch is what the keyboard footer highlights.
  it('keeps the played midi and the event it was played against', () => {
    expect(wrongEventState({ type: 'wrong', midi: 61, eventId: 'first' }))
      .toEqual({ midi: 61, eventId: 'first' });
  });

  it('clears on any non-wrong event, and on no event at all', () => {
    expect(wrongEventState({ type: 'hit', eventId: 'first' })).toBeNull();
    expect(wrongEventState({ type: 'onset_complete', eventId: 'first' })).toBeNull();
    expect(wrongEventState(undefined)).toBeNull();
  });
});
