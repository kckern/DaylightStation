// Tests for the strength-run block a finished workout leaves on the session record.
import { describe, it, expect } from 'vitest';
import {
  presentParticipantIds,
  makeStrengthRun,
  appendStrengthRun,
} from './strengthLog.mjs';
import { expandWorkout } from './workout.mjs';

/** Straight sets: 4 sets of bench, then 3 rounds of a squat/row superset. */
const WORKOUT = {
  id: 'full-body-friday-k3f9',
  title: 'Full Body Friday',
  author: 'test-user',
  groups: [
    { rounds: 1, exercises: [{ slug: 'barbell-bench-press', sets: 4, reps: 8, load: '135 lb', restSeconds: 90 }] },
    {
      rounds: 3,
      exercises: [
        { slug: 'goblet-squat', sets: 1, reps: 12 },
        { slug: 'dumbbell-row', sets: 1, seconds: 45 },
      ],
    },
  ],
};

/** The first `count` WORK steps of the plan — what a runner that got that far reports. */
function workStepsThrough(count) {
  return expandWorkout(WORKOUT).filter((s) => s.kind === 'work').slice(0, count);
}

describe('presentParticipantIds', () => {
  it('returns the stable ids in block order', () => {
    expect(presentParticipantIds({
      'test-user': { display_name: 'Test User', is_primary: true },
      'test-guest': { display_name: 'Guest', is_guest: true },
    })).toEqual(['test-user', 'test-guest']);
  });

  it('returns ids, never display names — the join key downstream is the id', () => {
    const ids = presentParticipantIds({ 'test-user': { display_name: 'Test User' } });
    expect(ids).toEqual(['test-user']);
    expect(ids).not.toContain('Test User');
  });

  it('keeps a participant with no heart-rate strap (strength work rarely has one)', () => {
    expect(presentParticipantIds({ 'test-user': { display_name: 'Test User' } }))
      .toEqual(['test-user']);
  });

  it('drops unclaimed device placeholders — they match no real person', () => {
    expect(presentParticipantIds({
      'test-user': { display_name: 'Test User' },
      'device:40475': { display_name: 'Strap 40475' },
    })).toEqual(['test-user']);
  });

  it('survives a malformed or absent block', () => {
    expect(presentParticipantIds(null)).toEqual([]);
    expect(presentParticipantIds([])).toEqual([]);
    expect(presentParticipantIds({ '': {}, ghost: null })).toEqual([]);
  });
});

describe('makeStrengthRun', () => {
  it('records the sets ACTUALLY completed, not the sets planned', () => {
    // Bailed after two of four bench sets, never reached the superset.
    const run = makeStrengthRun({
      workout: WORKOUT,
      completedSteps: workStepsThrough(2),
      participants: ['test-user'],
      completedAt: '2026-08-11T17:00:00.000Z',
    });

    expect(run.groups).toHaveLength(1);
    const bench = run.groups[0].exercises[0];
    expect(bench.slug).toBe('barbell-bench-press');
    expect(bench.setsCompleted).toBe(2);   // the two he did
    expect(bench.setsPlanned).toBe(4);     // beside it, never in place of it
    expect(run.setsCompleted).toBe(2);
    expect(run.setsPlanned).toBe(4);
  });

  it('carries the workout id, title, participants and completion time', () => {
    const run = makeStrengthRun({
      workout: WORKOUT,
      completedSteps: workStepsThrough(1),
      participants: ['test-user', 'test-guest'],
      completedAt: '2026-08-11T17:00:00.000Z',
    });

    expect(run.workoutId).toBe('full-body-friday-k3f9');
    expect(run.title).toBe('Full Body Friday');
    expect(run.participants).toEqual(['test-user', 'test-guest']);
    expect(run.completedAt).toBe('2026-08-11T17:00:00.000Z');
  });

  it('reports only the groups completed', () => {
    // Everything: 4 bench sets + 3 rounds x 2 superset exercises.
    const full = makeStrengthRun({ workout: WORKOUT, completedSteps: workStepsThrough(10) });
    expect(full.groups.map((g) => g.index)).toEqual([0, 1]);
    expect(full.groups.map((g) => g.kind)).toEqual(['sets', 'superset']);
    expect(full.setsCompleted).toBe(10);
    expect(full.setsPlanned).toBe(10);

    // Group 1 untouched → absent, not present with zeros.
    const partial = makeStrengthRun({ workout: WORKOUT, completedSteps: workStepsThrough(4) });
    expect(partial.groups.map((g) => g.index)).toEqual([0]);
  });

  it('aggregates a superset exercise across its rounds', () => {
    // 4 bench + 2 full passes of the superset + one more goblet squat.
    const run = makeStrengthRun({ workout: WORKOUT, completedSteps: workStepsThrough(9) });
    const superset = run.groups.find((g) => g.index === 1);
    expect(superset.exercises).toEqual([
      { slug: 'goblet-squat', setsCompleted: 3, setsPlanned: 3, reps: 12 },
      { slug: 'dumbbell-row', setsCompleted: 2, setsPlanned: 3, seconds: 45 },
    ]);
  });

  it('carries the prescription (reps / seconds / load) for what was done', () => {
    const run = makeStrengthRun({ workout: WORKOUT, completedSteps: workStepsThrough(1) });
    expect(run.groups[0].exercises[0]).toEqual({
      slug: 'barbell-bench-press',
      setsCompleted: 1,
      setsPlanned: 4,
      reps: 8,
      load: '135 lb',
    });
  });

  it('ignores rest steps — they are not work', () => {
    const steps = expandWorkout(WORKOUT).slice(0, 4); // work, rest, work, rest
    const run = makeStrengthRun({ workout: WORKOUT, completedSteps: steps });
    expect(run.setsCompleted).toBe(2);
  });

  it('yields null when nothing was completed', () => {
    expect(makeStrengthRun({ workout: WORKOUT, completedSteps: [] })).toBeNull();
    expect(makeStrengthRun({ workout: WORKOUT, completedSteps: null })).toBeNull();
    expect(makeStrengthRun({})).toBeNull();
  });

  it('does not throw on a defective report', () => {
    const run = makeStrengthRun({
      workout: WORKOUT,
      completedSteps: [null, {}, { slug: '' }, { slug: 'barbell-bench-press' }, ...workStepsThrough(1)],
    });
    expect(run.setsCompleted).toBe(1); // only the one well-formed step counted
  });

  it('keeps work reported against a slug the plan no longer contains', () => {
    const run = makeStrengthRun({
      workout: WORKOUT,
      completedSteps: [...workStepsThrough(1), { kind: 'work', groupIndex: 0, slug: 'deleted-exercise' }],
    });
    const off = run.groups.find((g) => g.kind === 'unplanned');
    expect(off.exercises).toEqual([{ slug: 'deleted-exercise', setsCompleted: 1, setsPlanned: 0 }]);
    expect(run.setsCompleted).toBe(2);
  });

  it('does not clamp a report claiming more sets than were prescribed', () => {
    const extra = [...workStepsThrough(4), workStepsThrough(1)[0]]; // a 5th bench set
    const run = makeStrengthRun({ workout: WORKOUT, completedSteps: extra });
    expect(run.groups[0].exercises[0]).toMatchObject({ setsCompleted: 5, setsPlanned: 4 });
  });
});

describe('appendStrengthRun', () => {
  const runA = { workoutId: 'w1', completedAt: '2026-08-11T17:00:00.000Z', setsCompleted: 2 };
  const runB = { workoutId: 'w1', completedAt: '2026-08-11T17:40:00.000Z', setsCompleted: 4 };

  it('keeps a restarted run alongside the bailed one', () => {
    const block = appendStrengthRun(appendStrengthRun(null, runA), runB);
    expect(block.runs).toEqual([runA, runB]);
  });

  it('replaces a re-posted identical run rather than double-counting it', () => {
    const block = appendStrengthRun(appendStrengthRun(null, runA), { ...runA, setsCompleted: 2 });
    expect(block.runs).toHaveLength(1);
  });

  it('never mutates the block handed in', () => {
    const before = appendStrengthRun(null, runA);
    appendStrengthRun(before, runB);
    expect(before.runs).toHaveLength(1);
  });
});
