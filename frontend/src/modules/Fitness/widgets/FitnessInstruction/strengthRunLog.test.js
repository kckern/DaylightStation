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
  mintSessionId,
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

/** A session the fitness app already has open. */
const liveSession = (sessionId = 'fs_20260811120000') => ({ sessionId });

/** The fitness app with no session running — the ordinary strapless-strength case. */
const dormantSession = () => ({ sessionId: null });

const RUN_START = new Date(2026, 7, 11, 12, 30, 0); // local time, as session ids are

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

describe('resolveRunSession — adopt, else ask the server to open one', () => {
  it('adopts a live session, and does NOT ask for one to be opened', () => {
    // The flag matters: an id the fitness app is holding really should exist, and a
    // 404 on it is a bug that has to stay visible rather than being papered over
    // with a freshly created record.
    expect(resolveRunSession(liveSession('fs_20260811120000'), RUN_START))
      .toEqual({ sessionId: 'fs_20260811120000', openSession: false });
  });

  it('mints the id the run would have had and asks for it to be opened', () => {
    expect(resolveRunSession(dormantSession(), RUN_START))
      .toEqual({ sessionId: '20260811123000', openSession: true });
  });

  it('does the same when there is no fitness app at all', () => {
    expect(resolveRunSession(null, RUN_START))
      .toEqual({ sessionId: '20260811123000', openSession: true });
  });

  it('mints ids the server can sanitise to 14 digits', () => {
    expect(mintSessionId(RUN_START)).toMatch(/^\d{14}$/);
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

  it('only sends openSession when it was actually asked for', async () => {
    const api = vi.fn(async () => ({ ok: true }));
    await postStrengthRun(args(api));
    expect(api.mock.calls[0][1]).not.toHaveProperty('openSession');

    api.mockClear();
    await postStrengthRun(args(api, { openSession: true, startedAt: '2026-08-11T12:00:00.000Z' }));
    expect(api.mock.calls[0][1].openSession).toBe(true);
    expect(api.mock.calls[0][1].startedAt).toBe('2026-08-11T12:00:00.000Z');
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
    startedAt: RUN_START,
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

  it('asks the server to open a session when the app has none', async () => {
    const api = vi.fn(async () => ({ ok: true, openedSession: true }));
    const res = await run(api, { session: dormantSession() });
    expect(res.ok).toBe(true);
    expect(res.openedSession).toBe(true);

    const [path, body] = api.mock.calls[0];
    expect(path).toBe(strengthPath('20260811123000'));
    expect(body.openSession).toBe(true);
    // The session starts when the RUN started, not when the last set was cleared —
    // otherwise the record collapses the whole workout to an instant.
    expect(body.startedAt).toBe(RUN_START.toISOString());
  });

  it('joins a live session instead of forking a second record', async () => {
    const api = vi.fn(async () => ({ ok: true }));
    const res = await run(api, { session: liveSession('fs_20260811090000') });
    expect(res.ok).toBe(true);
    expect(res.sessionId).toBe('fs_20260811090000');
    expect(api.mock.calls[0][1]).not.toHaveProperty('openSession');
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

  it('opens a session for a sessionless run instead of refusing it', async () => {
    // A strength workout is frequently done with no fitness session open; the
    // strength route mints one and flags openSession so the backend creates it
    // (see resolveRunSession). The old no_session refusal is retired.
    const api = vi.fn(async () => ({ ok: true }));
    const res = await run(api, { session: null });
    expect(res.ok).toBe(true);
    expect(res.sessionId).toBeTruthy();
    const [path, body] = api.mock.calls[0];
    expect(body.openSession).toBe(true);      // the "open this if it doesn't exist" flag
    expect(path).toContain(res.sessionId);    // minted id addresses the POST
  });

  it('reports a session the server would not open, in words a person can act on', async () => {
    const api = vi.fn(async () => { throw httpError(404, 'Not Found', { reason: 'unknown_session', error: 'nope' }); });
    const res = await run(api, { session: null });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unknown_session');
    expect(res.message).toBe(failureNotice({ reason: 'unknown_session' }));
    expect(res.message).toMatch(/session/i);
  });

  it('reports a failed POST as a failure, never as ok', async () => {
    const api = vi.fn(async () => { throw new Error('Failed to fetch'); });
    const res = await run(api);
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
  });
});
