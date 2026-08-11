import { describe, it, expect } from 'vitest';
import {
  makeWorkout,
  makeExerciseGroup,
  makeWorkoutExercise,
  groupKind,
  expandWorkout,
} from './workout.mjs';

/** Terse readers so ordering assertions stay literal and un-sorted. */
const slugsOf = (steps) => steps.map((s) => s.slug ?? `rest:${s.seconds}`);
const kindsOf = (steps) => steps.map((s) => s.kind);

describe('makeWorkoutExercise', () => {
  it('normalizes a raw entry', () => {
    const ex = makeWorkoutExercise({ slug: ' push-up ', sets: 3, reps: 10, load: '20 lb', restSeconds: 45 });
    expect(ex).toMatchObject({ slug: 'push-up', sets: 3, reps: 10, seconds: null, load: '20 lb', restSeconds: 45 });
  });

  it('defaults sets to 1 and restSeconds to 0', () => {
    const ex = makeWorkoutExercise({ slug: 'x' });
    expect(ex.sets).toBe(1);
    expect(ex.restSeconds).toBe(0);
  });

  it('keeps an explicit sets of 0 rather than defaulting it to 1', () => {
    expect(makeWorkoutExercise({ slug: 'x', sets: 0 }).sets).toBe(0);
  });

  it('leaves both targets null when neither reps nor seconds is authored', () => {
    const ex = makeWorkoutExercise({ slug: 'x' });
    expect(ex.reps).toBeNull();
    expect(ex.seconds).toBeNull();
  });

  it('resolves an entry authored with both targets to reps only', () => {
    const ex = makeWorkoutExercise({ slug: 'x', reps: 12, seconds: 60 });
    expect(ex.reps).toBe(12);
    expect(ex.seconds).toBeNull();
  });

  it('keeps a seconds-only entry timed', () => {
    const ex = makeWorkoutExercise({ slug: 'plank', seconds: 60 });
    expect(ex.seconds).toBe(60);
    expect(ex.reps).toBeNull();
  });

  it('coerces numeric text, floors fractions, and clamps negatives to zero', () => {
    const ex = makeWorkoutExercise({ slug: 'x', sets: '3', reps: 10.7, restSeconds: -5 });
    expect(ex.sets).toBe(3);
    expect(ex.reps).toBe(10);
    expect(ex.restSeconds).toBe(0);
  });

  it('falls back to the default when a count is unparseable', () => {
    expect(makeWorkoutExercise({ slug: 'x', sets: 'lots' }).sets).toBe(1);
  });

  it('is frozen', () => {
    const ex = makeWorkoutExercise({ slug: 'x' });
    expect(Object.isFrozen(ex)).toBe(true);
    expect(() => { ex.sets = 9; }).toThrow(TypeError);
  });

  it('tolerates a missing record without throwing', () => {
    expect(makeWorkoutExercise().slug).toBe('');
  });
});

describe('makeExerciseGroup', () => {
  it('defaults a missing collection to an empty array, never undefined', () => {
    const group = makeExerciseGroup({});
    expect(group.exercises).toEqual([]);
  });

  it('defaults rounds to 1 but keeps an explicit 0', () => {
    expect(makeExerciseGroup({}).rounds).toBe(1);
    expect(makeExerciseGroup({ rounds: 0 }).rounds).toBe(0);
  });

  it('normalizes its members through makeWorkoutExercise', () => {
    const group = makeExerciseGroup({ exercises: [{ slug: 'a' }] });
    expect(group.exercises[0].sets).toBe(1);
    expect(group.exercises[0].restSeconds).toBe(0);
  });

  it('drops blank members', () => {
    const group = makeExerciseGroup({ exercises: [{ slug: 'a' }, null, undefined] });
    expect(group.exercises).toHaveLength(1);
  });

  it('copies the input array rather than aliasing the raw record', () => {
    const raw = { exercises: [{ slug: 'a' }] };
    const group = makeExerciseGroup(raw);
    raw.exercises.push({ slug: 'b' });
    expect(group.exercises).toHaveLength(1);
  });

  it('is frozen, array included', () => {
    const group = makeExerciseGroup({ exercises: [{ slug: 'a' }] });
    expect(Object.isFrozen(group)).toBe(true);
    expect(() => group.exercises.push({ slug: 'b' })).toThrow(TypeError);
  });
});

describe('makeWorkout', () => {
  it('normalizes a raw workout', () => {
    const w = makeWorkout({ id: 'w1', title: ' Leg Day ', author: 'kc', groups: [{ exercises: [{ slug: 'a' }] }] });
    expect(w.id).toBe('w1');
    expect(w.title).toBe('Leg Day');
    expect(w.author).toBe('kc');
    expect(w.groups[0].rounds).toBe(1);
  });

  it('defaults groups to an empty array, never undefined', () => {
    expect(makeWorkout({ id: 'w1' }).groups).toEqual([]);
  });

  it('defaults missing scalars to null', () => {
    const w = makeWorkout({});
    expect(w.id).toBeNull();
    expect(w.title).toBeNull();
    expect(w.author).toBeNull();
  });

  it('is frozen, groups array included', () => {
    const w = makeWorkout({ id: 'w1', groups: [{ exercises: [] }] });
    expect(Object.isFrozen(w)).toBe(true);
    expect(() => w.groups.push({})).toThrow(TypeError);
  });

  it('tolerates a missing record without throwing', () => {
    expect(makeWorkout().groups).toEqual([]);
  });
});

describe('groupKind', () => {
  it('calls a one-exercise group straight sets', () => {
    expect(groupKind(makeExerciseGroup({ exercises: [{ slug: 'a' }] }))).toBe('sets');
  });

  it('calls a two-exercise group a superset', () => {
    expect(groupKind(makeExerciseGroup({ exercises: [{ slug: 'a' }, { slug: 'b' }] }))).toBe('superset');
  });

  it('calls a three-exercise group a circuit', () => {
    expect(groupKind(makeExerciseGroup({ exercises: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] }))).toBe('circuit');
  });

  it('still calls a five-exercise group a circuit', () => {
    const exercises = ['a', 'b', 'c', 'd', 'e'].map((slug) => ({ slug }));
    expect(groupKind(makeExerciseGroup({ exercises }))).toBe('circuit');
  });

  it('reads a raw group, not just a normalized one', () => {
    expect(groupKind({ exercises: [{ slug: 'a' }, { slug: 'b' }] })).toBe('superset');
  });

  it('degrades an empty or missing group to sets rather than throwing', () => {
    expect(groupKind(makeExerciseGroup({}))).toBe('sets');
    expect(groupKind(undefined)).toBe('sets');
  });
});

describe('expandWorkout — straight sets', () => {
  it('turns one exercise with 3 sets and 1 round into 3 steps of that exercise', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 1, exercises: [{ slug: 'squat', sets: 3, reps: 5 }] }],
    });
    expect(kindsOf(steps)).toEqual(['work', 'work', 'work']);
    expect(slugsOf(steps)).toEqual(['squat', 'squat', 'squat']);
  });

  it('numbers each set against the total for the runner to render', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 1, exercises: [{ slug: 'squat', sets: 3, reps: 5 }] }],
    });
    expect(steps.map((s) => [s.setNumber, s.totalSets])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('keeps counting sets across rounds instead of restarting each round', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 2, exercises: [{ slug: 'squat', sets: 2 }] }],
    });
    expect(steps.map((s) => s.setNumber)).toEqual([1, 2, 3, 4]);
    expect(steps.map((s) => s.totalSets)).toEqual([4, 4, 4, 4]);
    expect(steps.map((s) => [s.round, s.set])).toEqual([[1, 1], [1, 2], [2, 1], [2, 2]]);
    expect(steps.map((s) => [s.totalRounds, s.setsPerRound])).toEqual([[2, 2], [2, 2], [2, 2], [2, 2]]);
  });

  it('carries the rep target, load and group kind on every work step', () => {
    const [step] = expandWorkout({
      groups: [{ rounds: 1, exercises: [{ slug: 'squat', sets: 1, reps: 5, load: '135 lb' }] }],
    });
    expect(step).toMatchObject({
      kind: 'work', slug: 'squat', reps: 5, seconds: null, load: '135 lb',
      groupIndex: 0, groupKind: 'sets', round: 1, totalRounds: 1,
    });
  });

  it('carries a duration target instead of reps for a timed exercise', () => {
    const [step] = expandWorkout({ groups: [{ exercises: [{ slug: 'plank', seconds: 60 }] }] });
    expect(step.seconds).toBe(60);
    expect(step.reps).toBeNull();
  });
});

describe('expandWorkout — superset', () => {
  it('alternates A B A B A B for 2 exercises of 1 set over 3 rounds', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 3, exercises: [{ slug: 'a', sets: 1 }, { slug: 'b', sets: 1 }] }],
    });
    expect(slugsOf(steps)).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
  });

  it('advances the round only after both exercises are done', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 3, exercises: [{ slug: 'a', sets: 1 }, { slug: 'b', sets: 1 }] }],
    });
    expect(steps.map((s) => `${s.slug}${s.round}`)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
  });

  it('stamps the group as a superset', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 2, exercises: [{ slug: 'a' }, { slug: 'b' }] }],
    });
    expect(steps.every((s) => s.groupKind === 'superset')).toBe(true);
  });

  it('does back-to-back sets at one station before rotating when sets exceeds 1', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 2, exercises: [{ slug: 'a', sets: 2 }, { slug: 'b', sets: 2 }] }],
    });
    expect(slugsOf(steps)).toEqual(['a', 'a', 'b', 'b', 'a', 'a', 'b', 'b']);
    expect(steps.map((s) => s.setNumber)).toEqual([1, 2, 1, 2, 3, 4, 3, 4]);
    expect(steps.every((s) => s.totalSets === 4)).toBe(true);
  });
});

describe('expandWorkout — circuit', () => {
  it('rotates A B C A B C for 3 exercises of 1 set over 2 rounds', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 2, exercises: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] }],
    });
    expect(slugsOf(steps)).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    expect(steps.every((s) => s.groupKind === 'circuit')).toBe(true);
  });

  it('honours a per-exercise set count inside the rotation', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 2, exercises: [{ slug: 'a' }, { slug: 'b', sets: 2 }, { slug: 'c' }] }],
    });
    expect(slugsOf(steps)).toEqual(['a', 'b', 'b', 'c', 'a', 'b', 'b', 'c']);
  });
});

describe('expandWorkout — rest', () => {
  it('interleaves a rest step after each work step that authored one', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 2, exercises: [{ slug: 'a', restSeconds: 30 }, { slug: 'b', restSeconds: 60 }] }],
    });
    expect(slugsOf(steps)).toEqual(['a', 'rest:30', 'b', 'rest:60', 'a', 'rest:30', 'b']);
  });

  it('drops the final rest so the workout never ends by telling you to rest', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 1, exercises: [{ slug: 'a', sets: 2, restSeconds: 30 }] }],
    });
    expect(kindsOf(steps)).toEqual(['work', 'rest', 'work']);
    expect(steps.at(-1).kind).toBe('work');
  });

  it('keeps rest between groups while still dropping the last one', () => {
    const steps = expandWorkout({
      groups: [
        { rounds: 1, exercises: [{ slug: 'a', restSeconds: 90 }] },
        { rounds: 1, exercises: [{ slug: 'b', restSeconds: 90 }] },
      ],
    });
    expect(slugsOf(steps)).toEqual(['a', 'rest:90', 'b']);
  });

  it('emits no rest step when restSeconds is zero', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 1, exercises: [{ slug: 'a', sets: 3, restSeconds: 0 }] }],
    });
    expect(kindsOf(steps)).toEqual(['work', 'work', 'work']);
  });

  it('tells a rest step what it follows and what comes next', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 1, exercises: [{ slug: 'a', restSeconds: 30 }, { slug: 'b' }] }],
    });
    const rest = steps[1];
    expect(rest).toMatchObject({ kind: 'rest', seconds: 30, afterSlug: 'a', nextSlug: 'b' });
  });
});

describe('expandWorkout — degenerate input', () => {
  it('yields no steps for a zero-round group rather than throwing', () => {
    expect(expandWorkout({ groups: [{ rounds: 0, exercises: [{ slug: 'a' }] }] })).toEqual([]);
  });

  it('yields no steps for a group with no exercises', () => {
    expect(expandWorkout({ groups: [{ rounds: 3, exercises: [] }] })).toEqual([]);
  });

  it('yields no steps for an exercise with zero sets, keeping its neighbours', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 1, exercises: [{ slug: 'a', sets: 0 }, { slug: 'b' }] }],
    });
    expect(slugsOf(steps)).toEqual(['b']);
  });

  it('yields no steps for an empty or missing workout', () => {
    expect(expandWorkout({ groups: [] })).toEqual([]);
    expect(expandWorkout()).toEqual([]);
  });
});

describe('expandWorkout — flat list mechanics', () => {
  it('concatenates groups in authored order, stamping each with its position', () => {
    const steps = expandWorkout({
      groups: [
        { rounds: 1, exercises: [{ slug: 'a' }] },
        { rounds: 1, exercises: [{ slug: 'b' }, { slug: 'c' }] },
      ],
    });
    expect(slugsOf(steps)).toEqual(['a', 'b', 'c']);
    expect(steps.map((s) => s.groupIndex)).toEqual([0, 1, 1]);
    expect(steps.map((s) => s.groupKind)).toEqual(['sets', 'superset', 'superset']);
  });

  it('numbers every step sequentially against the total, rests included', () => {
    const steps = expandWorkout({
      groups: [{ rounds: 2, exercises: [{ slug: 'a', restSeconds: 30 }] }],
    });
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(steps.every((s) => s.totalSteps === 3)).toBe(true);
  });

  it('accepts a raw workout and normalizes it on the way in', () => {
    const steps = expandWorkout({ groups: [{ exercises: [{ slug: 'a', sets: '2' }] }] });
    expect(slugsOf(steps)).toEqual(['a', 'a']);
  });

  it('does not mutate the workout it was handed', () => {
    const raw = { groups: [{ rounds: 2, exercises: [{ slug: 'a', sets: 1 }] }] };
    const before = JSON.stringify(raw);
    expandWorkout(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
