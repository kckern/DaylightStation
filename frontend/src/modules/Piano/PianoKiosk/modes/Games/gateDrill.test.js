import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  describeDrillStep,
  drillIdOf,
  drillStanding,
  drillStepFor,
  isDrillSpec,
  isRungDrillSpec,
  needsDrillResolution,
  projectDrill,
  resolveGateDrill,
  rungDrillProgram,
} from './gateDrill.js';

vi.mock('../Exercises/pianoLearningApi.js', () => ({
  pianoLearningApi: { program: vi.fn(), attempts: vi.fn() },
}));
const { pianoLearningApi } = await import('../Exercises/pianoLearningApi.js');

/** The shape `GET /programs/scale-drill-3x3` actually serves (verified live). */
const PROGRAM = {
  id: 'scale-drill-3x3',
  title: 'Scale drill',
  steps: [
    {
      id: 'scale-set-1',
      title: 'G major — right hand',
      display: { key: 'G major', hand: 'R', hand_label: 'right hand', reps: 3 },
      requirement: {
        exercise_id: 'scales/modes@root=G,mode=ionian,direction=up-then-down,span_octaves=1,hand=R',
        mode: 'free',
        rubric: { id: 'scale-clean-v1', version: '1', criteria: { completeness: 1, cleanliness: 0.9 } },
        required_passes: 3,
      },
    },
    {
      id: 'scale-set-2',
      title: 'D major — left hand',
      display: { key: 'D major', hand: 'L', hand_label: 'left hand', reps: 3 },
      requirement: {
        exercise_id: 'scales/modes@root=D,mode=ionian,direction=up-then-down,span_octaves=1,hand=L',
        mode: 'free',
        rubric: { id: 'scale-clean-v1', version: '1', criteria: { completeness: 1, cleanliness: 0.9 } },
        required_passes: 3,
      },
    },
    {
      id: 'scale-set-3',
      title: 'A major — both hands',
      display: { key: 'A major', hand: 'RL', hand_label: 'both hands', reps: 3 },
      requirement: {
        exercise_id: 'scales/modes@root=A,mode=ionian,direction=up-then-down,span_octaves=1,hand=RL',
        mode: 'free',
        rubric: { id: 'scale-clean-v1', version: '1', criteria: { completeness: 1, cleanliness: 0.9 } },
        required_passes: 3,
      },
    },
  ],
};

/** `count` banked reps of a set: the exercise ids the gate passed, in order. */
function reps(setIndex, count) {
  return Array.from({ length: count }, () => PROGRAM.steps[setIndex].requirement.exercise_id);
}

describe('drill spec recognition', () => {
  it('recognises a drill spec and defaults to the scale drill', () => {
    expect(isDrillSpec({ kind: 'drill' })).toBe(true);
    expect(isDrillSpec({ kind: 'exercise', instanceId: 'x' })).toBe(false);
    expect(drillIdOf({ kind: 'drill' })).toBe('scale-drill-3x3');
    expect(drillIdOf({ kind: 'drill', drill: 'other-drill' })).toBe('other-drill');
  });
});

describe('where the drill stands — the reps passed at THIS gate', () => {
  it('opens at set one, rep one', () => {
    const projection = projectDrill(PROGRAM, []);
    expect(drillStepFor(projection).id).toBe('scale-set-1');
    expect(projection.steps[0].pass_count).toBe(0);
    expect(projection.complete).toBe(false);
    expect(drillStanding(projection)).toEqual({ banked: 0, total: 9 });
  });

  it('counts reps within a set without advancing it', () => {
    const projection = projectDrill(PROGRAM, reps(0, 2));
    expect(drillStepFor(projection).id).toBe('scale-set-1');
    expect(projection.steps[0].pass_count).toBe(2);
    expect(drillStanding(projection)).toEqual({ banked: 2, total: 9 });
  });

  it('advances to the next set — and next HAND — on the third rep', () => {
    const projection = projectDrill(PROGRAM, reps(0, 3));
    const step = drillStepFor(projection);
    expect(step.id).toBe('scale-set-2');
    expect(step.requirement.exercise_id).toContain('hand=L');
    expect(projection.steps[0].passed).toBe(true);
    expect(projection.steps[1].state).toBe('current');
  });

  it('is complete at nine, and then keeps naming the hardest set rather than erroring', () => {
    const projection = projectDrill(PROGRAM, [...reps(0, 3), ...reps(1, 3), ...reps(2, 3)]);
    expect(projection.complete).toBe(true);
    expect(projection.current_step).toBeNull();
    expect(drillStepFor(projection).id).toBe('scale-set-3');
    expect(drillStanding(projection)).toEqual({ banked: 9, total: 9 });
  });

  it('a rep of a set that is not being asked is not banked to the set that is', () => {
    // Two G majors and then a D major: the D goes to set two, and set one is
    // still the current set, one rep short.
    const projection = projectDrill(PROGRAM, [...reps(0, 2), ...reps(1, 1)]);
    expect(drillStepFor(projection).id).toBe('scale-set-1');
    expect(projection.steps[0].pass_count).toBe(2);
    expect(projection.steps[1].pass_count).toBe(1);
  });
});

describe('a scale rung that names sets and reps', () => {
  const RUNG = {
    kind: 'exercise', collection: 'scales', roots: ['G', 'D'], direction: 'up-then-down', sets: 3, reps: 3,
  };
  const G = 'scales/modes@root=G,mode=ionian,direction=up-then-down,span_octaves=1';
  const D = 'scales/modes@root=D,mode=ionian,direction=up-then-down,span_octaves=1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is recognised only until it has been resolved to one instance', () => {
    expect(isRungDrillSpec(RUNG)).toBe(true);
    expect(needsDrillResolution(RUNG)).toBe(true);
    expect(isRungDrillSpec({ kind: 'exercise', instanceId: G })).toBe(false);
    expect(isRungDrillSpec({ kind: 'exercise', collection: 'scales', roots: ['G'] })).toBe(false);
    expect(isRungDrillSpec({ kind: 'exercise', collection: 'scales', roots: [], sets: 3 })).toBe(false);
  });

  it('deals one set per root, cycling a list shorter than its sets, and names none of them', () => {
    const program = rungDrillProgram(RUNG, 'L2');
    expect(program.id).toBe('rung:L2');
    expect(program.steps.map((step) => step.requirement.exercise_id)).toEqual([G, D, G]);
    expect(program.steps.map((step) => step.requirement.required_passes)).toEqual([3, 3, 3]);
    expect(program.steps.every((step) => step.display.key === undefined)).toBe(true);
  });

  it('deals passes of a repeated key out in set order, never banking two sets at once', () => {
    const program = rungDrillProgram(RUNG, 'L2');
    const projection = projectDrill(program, [G, G, G, G]);
    expect(projection.steps.map((step) => step.pass_count)).toEqual([3, 0, 1]);
    expect(drillStepFor(projection).id).toBe('set-2');
  });

  it('resolves to set one without touching the network — the rung IS the program', async () => {
    const resolved = await resolveGateDrill({ spec: RUNG, levelId: 'L2' });
    expect(resolved.ok).toBe(true);
    expect(resolved.spec).toEqual({ kind: 'exercise', instanceId: G });
    expect(resolved.programId).toBe('rung:L2');
    expect(resolved.stepId).toBe('set-1');
    expect(resolved.complete).toBe(false);
    expect(resolved.program.steps).toHaveLength(3);
    expect(pianoLearningApi.program).not.toHaveBeenCalled();
    expect(pianoLearningApi.attempts).not.toHaveBeenCalled();
  });
});

describe('resolveGateDrill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pianoLearningApi.program.mockResolvedValue({ ok: true, status: 200, data: PROGRAM });
  });

  it('hands back a plain exercise spec, the drill coordinates, and the program itself', async () => {
    const resolved = await resolveGateDrill({ spec: { kind: 'drill' } });
    expect(resolved.ok).toBe(true);
    expect(resolved.spec).toEqual({
      kind: 'exercise',
      instanceId: 'scales/modes@root=G,mode=ionian,direction=up-then-down,span_octaves=1,hand=R',
    });
    expect(resolved.programId).toBe('scale-drill-3x3');
    expect(resolved.stepId).toBe('scale-set-1');
    expect(resolved.projection.steps[0].state).toBe('current');
    expect(resolved.complete).toBe(false);
    // The gate re-projects after every rep from this, so it must travel.
    expect(resolved.program).toBe(PROGRAM);
  });

  it('never reads the attempt ledger: every gate starts at set one, rep one', async () => {
    pianoLearningApi.attempts.mockResolvedValue({ ok: true, status: 200, data: { attempts: [{ status: 'completed' }] } });
    const resolved = await resolveGateDrill({ spec: { kind: 'drill' }, learnerId: 'test-learner' });
    expect(resolved.stepId).toBe('scale-set-1');
    expect(pianoLearningApi.attempts).not.toHaveBeenCalled();
  });

  it('a drill that does not exist is a config mistake', async () => {
    pianoLearningApi.program.mockResolvedValue({ ok: false, status: 404, data: null });
    expect(await resolveGateDrill({ spec: { kind: 'drill', drill: 'nope' } })).toEqual({ ok: false, error: 'drill-unknown' });
  });

  it('a program endpoint that could not be reached is an outage', async () => {
    pianoLearningApi.program.mockResolvedValue({ ok: false, status: 502, data: null });
    expect(await resolveGateDrill({ spec: { kind: 'drill' } })).toEqual({ ok: false, error: 'instance-unavailable' });
  });

  it('a thrown fetch is an outage, not an exception', async () => {
    pianoLearningApi.program.mockRejectedValue(new Error('network'));
    expect(await resolveGateDrill({ spec: { kind: 'drill' } })).toEqual({ ok: false, error: 'instance-unavailable' });
  });

  it('a program with no steps is a config mistake', async () => {
    pianoLearningApi.program.mockResolvedValue({ ok: true, status: 200, data: { id: 'empty', steps: [] } });
    expect(await resolveGateDrill({ spec: { kind: 'drill', drill: 'empty' } })).toEqual({ ok: false, error: 'drill-unknown' });
  });
});

describe('describeDrillStep — what the coach calls the next rep', () => {
  it('names a rung step from its root and the instance it asks for', () => {
    const step = rungDrillProgram({ kind: 'exercise', collection: 'scales', roots: ['F#', 'Bb'], sets: 2, reps: 3 }, 'L9').steps;
    expect(describeDrillStep(step[0])).toEqual({ key: 'F♯ major', hand: null });
    expect(describeDrillStep(step[1])).toEqual({ key: 'B♭ major', hand: null });
  });

  it('prefers what a program step says about itself, hand included', () => {
    expect(describeDrillStep(PROGRAM.steps[1])).toEqual({ key: 'D major', hand: 'left hand' });
  });

  it('reads a minor mode as minor', () => {
    const step = { requirement: { exercise_id: 'scales/modes@root=A,mode=aeolian,direction=up', required_passes: 1 } };
    expect(describeDrillStep(step)).toEqual({ key: 'A minor', hand: null });
  });

  it('answers with nulls rather than throwing on a step it cannot read', () => {
    expect(describeDrillStep(null)).toEqual({ key: null, hand: null });
    expect(describeDrillStep({ requirement: {} })).toEqual({ key: null, hand: null });
  });
});
