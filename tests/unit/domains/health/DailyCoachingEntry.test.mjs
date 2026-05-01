import { describe, it, expect } from 'vitest';
import { DailyCoachingEntry } from '../../../../backend/src/2_domains/health/entities/DailyCoachingEntry.mjs';

describe('DailyCoachingEntry', () => {
  it('parses object with all three sections (post_workout_protein, daily_strength_micro, daily_note)', () => {
    const entry = new DailyCoachingEntry({
      post_workout_protein: { taken: true, timestamp: '07:15', source: 'shake_brand' },
      daily_strength_micro: { movement: 'pull_up', reps: 5 },
      daily_note: 'felt heavy',
    });
    expect(entry.postWorkoutProtein).toEqual({ taken: true, timestamp: '07:15', source: 'shake_brand' });
    expect(entry.dailyStrengthMicro).toEqual({ movement: 'pull_up', reps: 5 });
    expect(entry.dailyNote).toBe('felt heavy');
  });

  it('accepts post_workout_protein with just { taken: true } — timestamp/source optional', () => {
    const entry = new DailyCoachingEntry({
      post_workout_protein: { taken: true },
    });
    expect(entry.postWorkoutProtein).toEqual({ taken: true });
    expect(entry.dailyStrengthMicro).toBeNull();
    expect(entry.dailyNote).toBeNull();
  });

  it('accepts daily_note as a single string', () => {
    const entry = new DailyCoachingEntry({ daily_note: 'just a quick note' });
    expect(entry.dailyNote).toBe('just a quick note');
    expect(entry.postWorkoutProtein).toBeNull();
    expect(entry.dailyStrengthMicro).toBeNull();
  });

  it('accepts an empty coaching object (all sections optional)', () => {
    const entry = new DailyCoachingEntry({});
    expect(entry.postWorkoutProtein).toBeNull();
    expect(entry.dailyStrengthMicro).toBeNull();
    expect(entry.dailyNote).toBeNull();
    expect(entry.serialize()).toEqual({});
  });

  it('rejects unknown top-level keys (defense against typos)', () => {
    expect(() => new DailyCoachingEntry({ post_workout_protien: { taken: true } })).toThrow(/unknown top-level key/);
    expect(() => new DailyCoachingEntry({ daily_notes: 'oops' })).toThrow(/unknown top-level key/);
  });

  it('daily_note is trimmed', () => {
    const entry = new DailyCoachingEntry({ daily_note: '   felt heavy   ' });
    expect(entry.dailyNote).toBe('felt heavy');
  });

  it('daily_strength_micro.reps must be a non-negative integer (rejects -1, rejects 1.5, rejects "three")', () => {
    expect(
      () => new DailyCoachingEntry({ daily_strength_micro: { movement: 'pull_up', reps: -1 } })
    ).toThrow(/reps/);
    expect(
      () => new DailyCoachingEntry({ daily_strength_micro: { movement: 'pull_up', reps: 1.5 } })
    ).toThrow(/reps/);
    expect(
      () => new DailyCoachingEntry({ daily_strength_micro: { movement: 'pull_up', reps: 'three' } })
    ).toThrow(/reps/);
    // sanity: 0 is allowed (non-negative)
    const ok = new DailyCoachingEntry({ daily_strength_micro: { movement: 'pull_up', reps: 0 } });
    expect(ok.dailyStrengthMicro.reps).toBe(0);
  });

  it('post_workout_protein.taken accepts boolean only — strict (rejects string "true"/"false")', () => {
    expect(
      () => new DailyCoachingEntry({ post_workout_protein: { taken: 'true' } })
    ).toThrow(/taken/);
    expect(
      () => new DailyCoachingEntry({ post_workout_protein: { taken: 'false' } })
    ).toThrow(/taken/);
    expect(
      () => new DailyCoachingEntry({ post_workout_protein: {} })
    ).toThrow(/taken/);
    const ok = new DailyCoachingEntry({ post_workout_protein: { taken: false } });
    expect(ok.postWorkoutProtein).toEqual({ taken: false });
  });

  it('serialize() returns the shape ready for YAML write', () => {
    const entry = new DailyCoachingEntry({
      post_workout_protein: { taken: true, timestamp: '07:15', source: 'shake_brand' },
      daily_strength_micro: { movement: 'pull_up', reps: 5 },
      daily_note: 'felt heavy',
    });
    expect(entry.serialize()).toEqual({
      post_workout_protein: { taken: true, timestamp: '07:15', source: 'shake_brand' },
      daily_strength_micro: { movement: 'pull_up', reps: 5 },
      daily_note: 'felt heavy',
    });

    // Partial entry only serializes present sections
    const partial = new DailyCoachingEntry({ daily_note: 'only note' });
    expect(partial.serialize()).toEqual({ daily_note: 'only note' });

    // Empty entry serializes to {}
    const empty = new DailyCoachingEntry({});
    expect(empty.serialize()).toEqual({});
  });
});
