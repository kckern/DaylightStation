import { describe, it, expect, vi } from 'vitest';

// The module reads DaylightAPI as a DEFAULT for its `api` seam, and every test
// below injects its own. The mock exists so importing the module does not drag in
// the real fetch client (and so a test that forgets to inject fails loudly with
// "no api injected" rather than quietly hitting the network).
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: () => { throw new Error('no api injected'); }
}));

import {
  completedWorkSteps,
  parseApiFailure,
  isRetryable,
  failureNotice,
  ensureWorkoutOnShelf,
  resolveRunSession,
  postStrengthRun,
  logStrengthRun,
  strengthPath
} from './strengthRunLog.js';

/** A DaylightAPI-shaped throw: status line + the JSON body on the end. */
const httpError = (status, statusText, body) =>
  new Error(`HTTP ${status}: ${statusText} - ${JSON.stringify(body)}`);

/** A workout as the container holds it after Build handed it over. */
const PLAN = {
  id: 'leg-day',
  title: 'Leg Day',
  groups: [{ rounds: 1, exercises: [{ slug: 'back-squat', sets: 3, reps: 5 }] }]
};

const WORK = (groupIndex, slug) => ({ kind: 'work', groupIndex, slug, setNumber: 1, totalSets: 3 });
const REST = (groupIndex) => ({ kind: 'rest', groupIndex, seconds: 60 });

/** A session that already has one open. */
const liveSession = (sessionId = 'fs_20260811120000') => ({
  sessionId,
  ensureStarted: vi.fn(),
  saveNow: vi.fn()
});

/** A session with nothing open, which opens on `ensureStarted({force:true})`. */
const dormantSession = (opensTo = 'fs_20260811130000') => {
  const s = {
    sessionId: null,
    saveNow: vi.fn(async () => { s.saved = true; }),
    saved: false,
    ensureStarted: vi.fn((opts) => { s.startedWith = opts; s.sessionId = opensTo; })
  };
  return s;
};

describe('completedWorkSteps', () => {
  it('keeps the finished work steps and drops rest', () => {
    expect(completedWorkSteps([WORK(0, 'a'), REST(0), WORK(0, 'b')]))
      .toEqual([
        { groupIndex: 0, slug: 'a', kind: 'work' },
        { groupIndex: 0, slug: 'b', kind: 'work' }
      ]);
  });

  it('is empty for a non-array, and for nothing finished', () => {
    expect(completedWorkSteps(null)).toEqual([]);
    expect(completedWorkSteps([REST(0), REST(1)])).toEqual([]);
  });
});

describe('parseApiFailure', () => {
  it('recovers the server reason and message from the thrown text', () => {
    const parsed = parseApiFailure(httpError(404, 'Not Found', {
      ok: false, error: 'unknown workout "zz"', reason: 'unknown_workout'
    }));
    expect(parsed).toEqual({ status: 404, reason: 'unknown_workout', message: 'unknown workout "zz"' });
  });

  it('degrades to the raw message when there is no JSON tail', () => {
    expect(parseApiFailure(new Error('Failed to fetch')))
      .toEqual({ status: null, reason: null, message: 'Failed to fetch' });
  });
});

describe('isRetryable', () => {
  it('retries a session the server has not seen yet — the write may still be landing', () => {
    expect(isRetryable({ status: 404, reason: 'unknown_session' })).toBe(true);
  });

  it('does not retry a settled refusal', () => {
    expect(isRetryable({ status: 404, reason: 'unknown_workout' })).toBe(false);
    expect(isRetryable({ status: 422, reason: 'nothing_completed' })).toBe(false);
  });

  it('retries network faults and 5xx, not other 4xx', () => {
    expect(isRetryable({ status: null, reason: null })).toBe(true);
    expect(isRetryable({ status: 503, reason: null })).toBe(true);
    expect(isRetryable({ status: 400, reason: null })).toBe(false);
  });
});

describe('ensureWorkoutOnShelf', () => {
  it('uses the id a saved plan already has, and saves nothing', async () => {
    const api = vi.fn();
    expect(await ensureWorkoutOnShelf(PLAN, { api }))
      .toEqual({ ok: true, workoutId: 'leg-day', saved: false });
    expect(api).not.toHaveBeenCalled();
  });

  it('saves an unsaved plan so the run has a plan to be measured against', async () => {
    const api = vi.fn(async () => ({ id: 'workout-aug-11', created: true }));
    const res = await ensureWorkoutOnShelf({ ...PLAN, id: null }, { api });
    expect(res).toEqual({ ok: true, workoutId: 'workout-aug-11', saved: true });
    expect(api).toHaveBeenCalledWith(
      'api/v1/fitness/workouts',
      { title: 'Leg Day', groups: PLAN.groups },
      'POST'
    );
  });

  it('reports save_failed rather than pretending an id exists', async () => {
    const api = vi.fn(async () => { throw httpError(400, 'Bad Request', { error: 'unknown slug' }); });
    const res = await ensureWorkoutOnShelf({ ...PLAN, id: null }, { api });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('save_failed');
  });

  it('refuses an empty plan', async () => {
    const api = vi.fn();
    expect((await ensureWorkoutOnShelf({ id: null, groups: [] }, { api })).reason).toBe('unknown_workout');
    expect(api).not.toHaveBeenCalled();
  });
});

describe('resolveRunSession — adopt, else open', () => {
  it('adopts a live session and never starts a second one', async () => {
    const session = liveSession('fs_20260811120000');
    expect(await resolveRunSession(session))
      .toEqual({ sessionId: 'fs_20260811120000', opened: false });
    expect(session.ensureStarted).not.toHaveBeenCalled();
    expect(session.saveNow).not.toHaveBeenCalled();
  });

  it('opens one when there is none, and waits for it to be written', async () => {
    const session = dormantSession('fs_20260811130000');
    const res = await resolveRunSession(session);
    expect(res).toEqual({ sessionId: 'fs_20260811130000', opened: true });
    expect(session.startedWith).toEqual({ force: true, reason: 'strength_run' });
    // Without this await the run posts against a session the server has never been
    // told about and the route 404s it.
    expect(session.saveNow).toHaveBeenCalled();
  });

  it('reports no session rather than throwing when there is no fitness app', async () => {
    expect(await resolveRunSession(null)).toEqual({ sessionId: null, opened: false });
    expect(await resolveRunSession({})).toEqual({ sessionId: null, opened: false });
  });

  it('reports no session when the session refuses to open', async () => {
    const session = { sessionId: null, ensureStarted: () => {} };
    expect(await resolveRunSession(session)).toEqual({ sessionId: null, opened: false });
  });
});

describe('postStrengthRun', () => {
  const args = (api, extra = {}) => ({
    sessionId: 'fs_20260811120000',
    workoutId: 'leg-day',
    completedSteps: [{ groupIndex: 0, slug: 'back-squat', kind: 'work' }],
    api,
    sleep: async () => {},
    ...extra
  });

  it('posts to the session strength route and reports success', async () => {
    const api = vi.fn(async () => ({ ok: true, strength: { runs: [{}] } }));
    const res = await postStrengthRun(args(api, { completedAt: '2026-08-11T12:00:00.000Z' }));
    expect(res.ok).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(
      strengthPath('fs_20260811120000'),
      {
        workoutId: 'leg-day',
        completedSteps: [{ groupIndex: 0, slug: 'back-squat', kind: 'work' }],
        completedAt: '2026-08-11T12:00:00.000Z'
      },
      'POST'
    );
  });

  it('retries a dropped request and succeeds on the second attempt', async () => {
    let n = 0;
    const api = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('Failed to fetch');
      return { ok: true };
    });
    const res = await postStrengthRun(args(api));
    expect(res.ok).toBe(true);
    expect(res.attempt).toBe(2);
  });

  it('gives up on a settled refusal without burning retries', async () => {
    const api = vi.fn(async () => { throw httpError(404, 'Not Found', { reason: 'unknown_workout', error: 'nope' }); });
    const res = await postStrengthRun(args(api));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unknown_workout');
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('reports failure after exhausting retries — never a silent success', async () => {
    const api = vi.fn(async () => { throw new Error('Failed to fetch'); });
    const res = await postStrengthRun(args(api));
    expect(res.ok).toBe(false);
    expect(api).toHaveBeenCalledTimes(3);
  });
});

describe('logStrengthRun — the whole job', () => {
  const run = (api, over = {}) => logStrengthRun({
    workout: PLAN,
    completedSteps: [WORK(0, 'back-squat'), REST(0), WORK(0, 'back-squat')],
    session: liveSession(),
    api,
    sleep: async () => {},
    now: () => new Date('2026-08-11T12:34:56.000Z'),
    ...over
  });

  it('files the COMPLETED sets, not the plan', async () => {
    const api = vi.fn(async () => ({ ok: true }));
    const res = await run(api);
    expect(res.ok).toBe(true);
    expect(res.sets).toBe(2);

    const [path, body] = api.mock.calls[0];
    expect(path).toBe(strengthPath('fs_20260811120000'));
    // Two finished work steps out of a plan that prescribes three: the record has
    // to read 2, and the rest step must not be counted as work.
    expect(body.completedSteps).toHaveLength(2);
    expect(body.completedSteps.every((s) => s.kind === 'work')).toBe(true);
    expect(body.workoutId).toBe('leg-day');
    expect(body.completedAt).toBe('2026-08-11T12:34:56.000Z');
  });

  it('opens a session when there is none, and says so', async () => {
    const api = vi.fn(async () => ({ ok: true }));
    const session = dormantSession();
    const res = await run(api, { session });
    expect(res.ok).toBe(true);
    expect(res.openedSession).toBe(true);
    expect(session.ensureStarted).toHaveBeenCalled();
  });

  it('saves an unsaved plan first, then files against it', async () => {
    const api = vi.fn(async (path) => (
      path === 'api/v1/fitness/workouts' ? { id: 'saved-1' } : { ok: true }
    ));
    const res = await run(api, { workout: { ...PLAN, id: null } });
    expect(res.ok).toBe(true);
    expect(res.savedWorkout).toBe(true);
    expect(api.mock.calls[1][1].workoutId).toBe('saved-1');
  });

  it('refuses an empty report instead of filing a workout nobody did', async () => {
    const api = vi.fn();
    const res = await run(api, { completedSteps: [REST(0)] });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('nothing_completed');
    expect(api).not.toHaveBeenCalled();
  });

  it('reports no_session with words a person can act on', async () => {
    const api = vi.fn();
    const res = await run(api, { session: null });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no_session');
    expect(res.message).toBe(failureNotice({ reason: 'no_session' }));
    expect(res.message).toMatch(/session/i);
  });

  it('reports a failed POST as a failure, never as ok', async () => {
    const api = vi.fn(async () => { throw new Error('Failed to fetch'); });
    const res = await run(api);
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
  });
});
