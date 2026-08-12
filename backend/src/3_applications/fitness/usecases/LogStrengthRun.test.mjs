// Tests for logging a finished strength run into the existing fitness session record.
import { describe, it, expect, beforeEach } from 'vitest';
import { LogStrengthRun } from './LogStrengthRun.mjs';
import { SessionService } from '../services/SessionService.mjs';
import { expandWorkout } from '#domains/fitness/workout/workout.mjs';

const HH = 'default';
const SESSION_ID = '20260811092020';

const WORKOUT = {
  id: 'full-body-friday-k3f9',
  title: 'Full Body Friday',
  author: 'test-user',
  groups: [
    { rounds: 1, exercises: [{ slug: 'barbell-bench-press', sets: 4, reps: 8, load: '135 lb', restSeconds: 90 }] },
    { rounds: 2, exercises: [{ slug: 'goblet-squat', sets: 1, reps: 12 }, { slug: 'dumbbell-row', sets: 1, reps: 10 }] },
  ],
};

const workSteps = (count) => expandWorkout(WORKOUT).filter((s) => s.kind === 'work').slice(0, count);

/** In-memory ISessionDatastore holding one already-open garage session. */
function makeStore(sessionDoc) {
  const saved = new Map();
  if (sessionDoc) saved.set(`${HH}:${sessionDoc.sessionId}`, sessionDoc);
  return {
    saved,
    rosterBuilds: 0,
    async save(session, householdId) {
      const data = typeof session.toJSON === 'function' ? session.toJSON() : session;
      saved.set(`${householdId}:${data.sessionId}`, data);
    },
    async findById(id, householdId) {
      const doc = saved.get(`${householdId}:${id}`);
      if (!doc) return null;
      // The real datastore synthesizes a DISPLAY roster on read. Mirrored here so a
      // regression that attributes from the roster (names, device placeholders) instead of
      // from the participants block shows up as a wrong record, not as a crash.
      this.rosterBuilds += 1;
      const roster = Object.entries(doc.participants || {}).map(([slug, entry]) => ({
        id: slug, name: entry?.display_name || slug, display_name: entry?.display_name || slug,
      }));
      return { ...doc, roster };
    },
    async findByDate() { return []; },
    async delete() {},
    getStoragePaths(id) { return { sessionFilePath: `/fake/${id}.yml` }; },
  };
}

function openSession(participants = { 'test-user': { display_name: 'Test User', is_primary: true } }) {
  return {
    version: 3,
    sessionId: SESSION_ID,
    session: { id: SESSION_ID, date: '2026-08-11', start: '2026-08-11 09:20:20' },
    timezone: 'America/Los_Angeles',
    participants,
    timeline: { series: { 'test-user:hr': '[[120,3]]' }, events: [], encoding: 'rle' },
  };
}

function makeUseCase({ store, workouts = { [WORKOUT.id]: WORKOUT }, now = () => Date.parse('2026-08-11T17:00:00.000Z') }) {
  const sessionService = new SessionService({ sessionStore: store, defaultHouseholdId: HH });
  const workoutRepository = { get: (id) => workouts[id] ?? null };
  return { useCase: new LogStrengthRun({ sessionService, workoutRepository, now }), sessionService };
}

describe('LogStrengthRun', () => {
  let store;
  let useCase;

  const stored = () => store.saved.get(`${HH}:${SESSION_ID}`);

  beforeEach(() => {
    store = makeStore(openSession());
    ({ useCase } = makeUseCase({ store }));
  });

  it('writes the strength block onto the existing session record', async () => {
    const result = await useCase.execute({
      sessionId: SESSION_ID,
      workoutId: WORKOUT.id,
      completedSteps: workSteps(2),
      householdId: HH,
    });

    expect(result.ok).toBe(true);
    expect(stored().strength).toEqual({
      runs: [{
        workoutId: 'full-body-friday-k3f9',
        title: 'Full Body Friday',
        completedAt: '2026-08-11T17:00:00.000Z',
        participants: ['test-user'],
        setsCompleted: 2,
        setsPlanned: 4,
        groups: [{
          index: 0,
          kind: 'sets',
          exercises: [{
            slug: 'barbell-bench-press',
            setsCompleted: 2,
            setsPlanned: 4,
            reps: 8,
            load: '135 lb',
          }],
        }],
      }],
    });
  });

  it('records sets ACTUALLY completed — a bail at two of four reads as two', async () => {
    await useCase.execute({ sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: workSteps(2), householdId: HH });
    const [run] = stored().strength.runs;
    expect(run.setsCompleted).toBe(2);
    expect(run.groups[0].exercises[0].setsCompleted).toBe(2);
    expect(run.groups[0].exercises[0].setsPlanned).toBe(4); // the plan, kept beside it
  });

  it('reports only the groups completed', async () => {
    await useCase.execute({ sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: workSteps(6), householdId: HH });
    const [run] = stored().strength.runs;
    expect(run.groups.map((g) => g.index)).toEqual([0, 1]);
    expect(run.groups[1].exercises.map((e) => e.setsCompleted)).toEqual([1, 1]);
    expect(run.groups[1].exercises.map((e) => e.setsPlanned)).toEqual([2, 2]);
  });

  it('attributes the run to the session participant IDS, not display names', async () => {
    await useCase.execute({ sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: workSteps(1), householdId: HH });
    const [run] = stored().strength.runs;
    expect(run.participants).toEqual(['test-user']);
    expect(run.participants).not.toContain('Test User');
  });

  it('drops unclaimed device placeholders from attribution', async () => {
    store = makeStore(openSession({
      'test-user': { display_name: 'Test User', is_primary: true },
      'device:40475': { display_name: 'Strap 40475' },
    }));
    ({ useCase } = makeUseCase({ store }));

    await useCase.execute({ sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: workSteps(1), householdId: HH });
    expect(stored().strength.runs[0].participants).toEqual(['test-user']);
  });

  it('leaves everything else in the record untouched', async () => {
    const before = { ...stored() };
    await useCase.execute({ sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: workSteps(1), householdId: HH });
    const after = stored();

    expect(after.session).toEqual(before.session);
    expect(after.participants).toEqual(before.participants);
    // The timeline is written back in its stored (already run-length encoded) form — a
    // re-encode here would corrupt every heart-rate series in the session.
    expect(after.timeline.series).toEqual({ 'test-user:hr': '[[120,3]]' });
    expect(after.timeline.encoding).toBe('rle');
    // The strength block is the ONLY new key.
    expect(Object.keys(after).filter((k) => !Object.keys(before).includes(k))).toEqual(['strength']);
  });

  it('keeps a restart alongside the bailed run instead of replacing it', async () => {
    await useCase.execute({
      sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: workSteps(2), householdId: HH,
      completedAt: '2026-08-11T17:00:00.000Z',
    });
    await useCase.execute({
      sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: workSteps(4), householdId: HH,
      completedAt: '2026-08-11T17:40:00.000Z',
    });

    const runs = stored().strength.runs;
    expect(runs.map((r) => r.setsCompleted)).toEqual([2, 4]);
  });

  it('is idempotent for a retried post of the same run', async () => {
    const args = {
      sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: workSteps(2), householdId: HH,
      completedAt: '2026-08-11T17:00:00.000Z',
    };
    await useCase.execute(args);
    await useCase.execute(args);
    expect(stored().strength.runs).toHaveLength(1);
  });

  it('refuses an unknown workout rather than logging a plan it cannot read', async () => {
    const result = await useCase.execute({
      sessionId: SESSION_ID, workoutId: 'nope', completedSteps: workSteps(2), householdId: HH,
    });
    expect(result).toMatchObject({ ok: false, reason: 'unknown_workout' });
    expect(stored().strength).toBeUndefined();
  });

  it('refuses an unknown session rather than fabricating one', async () => {
    const result = await useCase.execute({
      sessionId: '20260811999999', workoutId: WORKOUT.id, completedSteps: workSteps(2), householdId: HH,
    });
    expect(result).toMatchObject({ ok: false, reason: 'unknown_session' });
  });

  it('writes nothing when no set was completed', async () => {
    const result = await useCase.execute({
      sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: [], householdId: HH,
    });
    expect(result).toMatchObject({ ok: false, reason: 'nothing_completed' });
    expect(stored().strength).toBeUndefined();
    expect('strength' in stored()).toBe(false);
  });

  it('requires a sessionId and a workoutId', async () => {
    expect(await useCase.execute({ workoutId: WORKOUT.id, completedSteps: workSteps(1) }))
      .toMatchObject({ ok: false, reason: 'missing_session' });
    expect(await useCase.execute({ sessionId: SESSION_ID, completedSteps: workSteps(1) }))
      .toMatchObject({ ok: false, reason: 'missing_workout' });
  });

  it('derives the block from the STORED plan, not from counts the client sends', async () => {
    // A client claiming 9 planned sets for an exercise the workout prescribes 4 of.
    const lying = workSteps(1).map((s) => ({ ...s, totalSets: 9, setsPerRound: 9 }));
    await useCase.execute({ sessionId: SESSION_ID, workoutId: WORKOUT.id, completedSteps: lying, householdId: HH });
    expect(stored().strength.runs[0].groups[0].exercises[0].setsPlanned).toBe(4);
  });
});
