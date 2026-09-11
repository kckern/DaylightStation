import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  attemptsOnStudyDate,
  drillIdOf,
  drillStepFor,
  isDrillSpec,
  projectGateDrill,
  resolveGateDrill,
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

/** A banked rep: a completed CHALLENGE attempt clearing the set's rubric. */
function rep(setIndex, createdAt) {
  return {
    status: 'completed',
    purpose: 'challenge',
    created_at: createdAt,
    prompt: { exercise_id: PROGRAM.steps[setIndex].requirement.exercise_id },
    criteria: { completeness: 1, cleanliness: 1 },
  };
}

/**
 * A local-noon instant on a given calendar day, as an ISO string.
 *
 * Noon LOCAL matters: the study day starts at 4am local, so noon is
 * unambiguously inside it whatever the runner's timezone, while a midnight or a
 * literal "…T12:00:00Z" would land on either side of the boundary depending on
 * the offset and make these assertions a coin flip in CI.
 */
function localNoon(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

describe('drill spec recognition', () => {
  it('recognises a drill spec and defaults to the scale drill', () => {
    expect(isDrillSpec({ kind: 'drill' })).toBe(true);
    expect(isDrillSpec({ kind: 'exercise' })).toBe(false);
    expect(drillIdOf({ kind: 'drill' })).toBe('scale-drill-3x3');
    expect(drillIdOf({ kind: 'drill', drill: 'hanon-virtuoso-pianist' })).toBe('hanon-virtuoso-pianist');
  });
});

describe('the day boundary', () => {
  it('keeps only the attempts belonging to the study day', () => {
    const today = localNoon(2026, 9, 11);
    const kept = attemptsOnStudyDate(
      [rep(0, today), rep(0, localNoon(2026, 9, 10)), rep(0, localNoon(2026, 9, 12))],
      '2026-09-11',
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].created_at).toBe(today);
  });

  it('drops an attempt it cannot date rather than banking a rep nobody played today', () => {
    expect(attemptsOnStudyDate([{ ...rep(0, localNoon(2026, 9, 11)), created_at: undefined }], '2026-09-11'))
      .toHaveLength(0);
    expect(attemptsOnStudyDate(null, '2026-09-11')).toEqual([]);
  });

  /**
   * THE REASON THE DAY IS SCOPED AT ALL. `projectProgram` counts every attempt
   * a learner ever recorded, which would retire the drill permanently on its
   * ninth lifetime pass — and with it the gate's only ask.
   */
  it('yesterday\'s nine reps do not complete today\'s drill', () => {
    const yesterday = [0, 1, 2].flatMap((set) => [0, 1, 2].map(() => rep(set, localNoon(2026, 9, 10))));
    const projection = projectGateDrill({ program: PROGRAM, attempts: yesterday, studyDate: '2026-09-11' });
    expect(projection.complete).toBe(false);
    expect(projection.current_step.id).toBe('scale-set-1');
    expect(projection.current_step.pass_count).toBe(0);
  });
});

describe('where the drill stands', () => {
  const today = '2026-09-11';
  const at = () => localNoon(2026, 9, 11);

  it('opens at set one, rep one', () => {
    const projection = projectGateDrill({ program: PROGRAM, attempts: [], studyDate: today });
    expect(projection.current_step.id).toBe('scale-set-1');
    expect(projection.current_step.pass_count).toBe(0);
  });

  it('counts reps within a set without advancing it', () => {
    const projection = projectGateDrill({ program: PROGRAM, attempts: [rep(0, at()), rep(0, at())], studyDate: today });
    expect(projection.current_step.id).toBe('scale-set-1');
    expect(projection.current_step.pass_count).toBe(2);
  });

  it('advances to the next set — and next HAND — on the third rep', () => {
    const three = [rep(0, at()), rep(0, at()), rep(0, at())];
    const projection = projectGateDrill({ program: PROGRAM, attempts: three, studyDate: today });
    expect(projection.steps[0].passed).toBe(true);
    expect(projection.current_step.id).toBe('scale-set-2');
    expect(projection.current_step.display.hand).toBe('L');
  });

  it('is complete at nine, and then keeps asking the hardest set rather than erroring', () => {
    const nine = [0, 1, 2].flatMap((set) => [0, 1, 2].map(() => rep(set, at())));
    const projection = projectGateDrill({ program: PROGRAM, attempts: nine, studyDate: today });
    expect(projection.complete).toBe(true);
    expect(projection.current_step).toBeNull();
    expect(drillStepFor(projection).id).toBe('scale-set-3');
  });
});

describe('resolveGateDrill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pianoLearningApi.program.mockResolvedValue({ ok: true, status: 200, data: PROGRAM });
    pianoLearningApi.attempts.mockResolvedValue({ ok: true, status: 200, data: { attempts: [] } });
  });

  it('hands back a plain exercise spec plus the drill coordinates', async () => {
    const resolved = await resolveGateDrill({ spec: { kind: 'drill' }, learnerId: 'test-learner', studyDate: '2026-09-11' });
    expect(resolved.ok).toBe(true);
    // The whole gesture, fifteen notes — never `direction=up`.
    expect(resolved.spec).toEqual({
      kind: 'exercise',
      instanceId: 'scales/modes@root=G,mode=ionian,direction=up-then-down,span_octaves=1,hand=R',
    });
    expect(resolved.programId).toBe('scale-drill-3x3');
    expect(resolved.stepId).toBe('scale-set-1');
    expect(resolved.complete).toBe(false);
  });

  it('serves the set the learner is actually on', async () => {
    pianoLearningApi.attempts.mockResolvedValue({
      ok: true,
      status: 200,
      data: { attempts: [0, 1, 2].map(() => rep(0, localNoon(2026, 9, 11))) },
    });
    const resolved = await resolveGateDrill({ spec: { kind: 'drill' }, learnerId: 'test-learner', studyDate: '2026-09-11' });
    expect(resolved.stepId).toBe('scale-set-2');
    expect(resolved.spec.instanceId).toContain('root=D');
    expect(resolved.spec.instanceId).toContain('hand=L');
  });

  it('a guest is never put on the wire, and stands at set one', async () => {
    const resolved = await resolveGateDrill({ spec: { kind: 'drill' }, learnerId: null, studyDate: '2026-09-11' });
    expect(pianoLearningApi.attempts).not.toHaveBeenCalled();
    expect(resolved.ok).toBe(true);
    expect(resolved.stepId).toBe('scale-set-1');
  });

  /**
   * The two halves of the gate's decline policy, which is the whole reason
   * these carry different words: a typo SUBSTITUTES, an outage fails OPEN.
   */
  it('a drill that does not exist is a config mistake', async () => {
    pianoLearningApi.program.mockResolvedValue({ ok: false, status: 404, data: null });
    const resolved = await resolveGateDrill({ spec: { kind: 'drill', drill: 'nope' }, learnerId: 'test-learner' });
    expect(resolved).toEqual({ ok: false, error: 'drill-unknown' });
  });

  it('a program endpoint that could not be reached is an outage', async () => {
    pianoLearningApi.program.mockResolvedValue({ ok: false, status: 502, data: null });
    const resolved = await resolveGateDrill({ spec: { kind: 'drill' }, learnerId: 'test-learner' });
    expect(resolved).toEqual({ ok: false, error: 'instance-unavailable' });
  });

  it('a thrown fetch is an outage, not an exception', async () => {
    pianoLearningApi.program.mockRejectedValue(new Error('network down'));
    await expect(resolveGateDrill({ spec: { kind: 'drill' }, learnerId: 'test-learner' }))
      .resolves.toEqual({ ok: false, error: 'instance-unavailable' });
  });

  /**
   * An unreadable ledger costs a child their POSITION, not their game. The
   * scale still gets played; only the pills are wrong, and they heal on the
   * next launch.
   */
  it('an unreadable attempt ledger still serves a scale', async () => {
    pianoLearningApi.attempts.mockResolvedValue({ ok: false, status: 502, data: null });
    const resolved = await resolveGateDrill({ spec: { kind: 'drill' }, learnerId: 'test-learner' });
    expect(resolved.ok).toBe(true);
    expect(resolved.stepId).toBe('scale-set-1');
  });
});
