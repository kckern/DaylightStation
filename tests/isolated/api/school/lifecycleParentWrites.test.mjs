// @vitest-environment node
//
// The security boundary, exercised the way an attack would exercise it: over
// HTTP, with no browser and no UI involved.
//
// Unlike `schoolLifecycleRouter.test.mjs`, which stubs the use cases to their
// return shapes to test the status mapping, this file wires the REAL
// `ResolveReviewItem` and `SetAssignments` over fake stores and a real roster.
// That is the point — the refusal must come from the application layer, so
// posting a child's id as `gradedBy` straight at the route has to fail even
// though the route itself does no checking at all.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createSchoolLifecycleRouter } from '#api/v1/routers/schoolLifecycle.mjs';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { GrownUpGate } from '#apps/school/GrownUpGate.mjs';
import { ResolveReviewItem } from '#apps/school/usecases/ResolveReviewItem.mjs';
import { SetAssignments } from '#apps/school/usecases/SetAssignments.mjs';
import { MarkSessionAbandoned } from '#apps/school/usecases/MarkSessionAbandoned.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const clock = () => new Date('2026-07-27T09:00:00.000Z');

const ROSTER = [
  { id: 'dad', name: 'Papa', birthyear: 1984 },
  { id: 'learner-1', name: 'Test Learner', birthyear: 2016 },
  { id: 'aunty', name: 'Aunty', birthyear: null },
];

/** In-memory stand-ins for the YAML stores — what was actually written matters. */
let queued;
let assigned;
let sessionRows;
let appendedEvents;

const sessionsStore = {
  listForLearner: async (learnerId) => sessionRows.filter((r) => r.learnerId === learnerId),
  appendEvent: async (sessionId, event) => { appendedEvents.push({ sessionId, ...event }); return event; },
};

const reviewQueue = {
  listPending: async () => queued.filter((i) => !i.verdict),
  listForSession: async (sessionId) => queued.filter((i) => i.sessionId === sessionId),
  resolve: async ({ sessionId, itemId, verdict, gradedBy, note = null, at }) => {
    const item = queued.find((i) => i.sessionId === sessionId && i.itemId === itemId);
    if (!item) return null;
    Object.assign(item, { verdict, gradedBy, note, gradedAt: at });
    return { ...item };
  },
};

const assignments = {
  list: async () => [...assigned.values()],
  get: async (learnerId) => assigned.get(learnerId) ?? null,
  put: async (record) => { assigned.set(record.learnerId, { ...record }); return { ...record }; },
};

let server;
let base;

beforeAll(async () => {
  const grownUps = new GrownUpGate({ roster: () => ROSTER, clock, logger: silent });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter({
    // One use case is enough to get the router past its "nothing is wired" guard.
    buildAgenda: { execute: async () => ({ offers: [] }) },
    assignments,
    reviewQueue,
    resolveReviewItem: new ResolveReviewItem({ reviewQueue, grownUps, clock, logger: silent }),
    setAssignments: new SetAssignments({ assignments, grownUps, clock, logger: silent }),
    markSessionAbandoned: new MarkSessionAbandoned({
      sessions: sessionsStore,
      teacherGate: { assert: ({ userId }) => { if (userId !== 'dad') { const e = new Error('nope'); e.name = 'GuestForbiddenError'; throw e; } } },
      learnerDirectory: { listLearners: async () => [{ id: 'learner-1', name: 'Test Learner' }] },
      clock, logger: silent,
    }),
    clock,
    logger: silent,
  }));
  app.use(errorHandlerMiddleware({ logger: silent, shape: 'string' }));
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}/api/v1/school/lifecycle`;
});

afterAll(() => new Promise((res) => server.close(res)));

beforeEach(() => {
  sessionRows = [
    { sessionId: 'ses_stuck', learnerId: 'learner-1', unitId: 'frac.01', state: 'issued', terminal: false, updatedAt: '2026-07-01T09:00:00.000Z' },
    { sessionId: 'ses_done', learnerId: 'learner-1', unitId: 'frac.02', state: 'outcome_recorded', terminal: true, updatedAt: '2026-07-02T09:00:00.000Z' },
    { sessionId: 'ses_fresh', learnerId: 'learner-1', unitId: 'frac.03', state: 'issued', terminal: false, updatedAt: '2026-07-26T09:00:00.000Z' },
  ];
  appendedEvents = [];
  queued = [{
    sessionId: 'ses_a', itemId: 'q3', learnerId: 'learner-1', unitId: 'math-fractions.03',
    reason: 'free_response', given: 'because you flip it', verdict: null, gradedBy: null, gradedAt: null,
  }];
  assigned = new Map([['learner-1', { learnerId: 'learner-1', courses: ['math-fractions'], units: [] }]]);
});

const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
});
const put = (path, body) => fetch(base + path, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

describe('signing off over HTTP', () => {
  it('a grown-up signs off and the verdict lands', async () => {
    const r = await post('/sessions/ses_a/review/q3', { verdict: 'correct', gradedBy: 'dad' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ verdict: 'correct', gradedBy: 'dad', gradedAt: '2026-07-27T09:00:00.000Z' });
    expect(queued[0].verdict).toBe('correct');
  });

  it('THE ONE THAT MATTERS: a forged gradedBy is refused, 403, and nothing is written', async () => {
    const r = await post('/sessions/ses_a/review/q3', { verdict: 'correct', gradedBy: 'learner-1' });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/grown-up/i);
    expect(queued[0]).toMatchObject({ verdict: null, gradedBy: null, gradedAt: null });
  });

  it('refuses an id nobody in the house has', async () => {
    expect((await post('/sessions/ses_a/review/q3', { verdict: 'correct', gradedBy: 'mr-nobody' })).status).toBe(403);
    expect(queued[0].verdict).toBeNull();
  });

  it('refuses a roster member with no birthyear', async () => {
    expect((await post('/sessions/ses_a/review/q3', { verdict: 'correct', gradedBy: 'aunty' })).status).toBe(403);
    expect(queued[0].verdict).toBeNull();
  });

  it('refuses an omitted gradedBy — an anonymous mark is not a mark', async () => {
    expect((await post('/sessions/ses_a/review/q3', { verdict: 'correct' })).status).toBe(403);
    expect(queued[0].verdict).toBeNull();
  });

  it('still 400s a bad verdict from a real grown-up, and 404s an unqueued item', async () => {
    expect((await post('/sessions/ses_a/review/q3', { verdict: 'maybe', gradedBy: 'dad' })).status).toBe(400);
    expect((await post('/sessions/ses_a/review/ghost', { verdict: 'correct', gradedBy: 'dad' })).status).toBe(404);
  });

  it('never answers a refusal with a success:false envelope or a 500', async () => {
    const r = await post('/sessions/ses_a/review/q3', { verdict: 'correct', gradedBy: 'learner-1' });
    expect(r.status).toBe(403);
    expect(await r.json()).not.toHaveProperty('success');
  });
});

describe('assigning work over HTTP', () => {
  it('a grown-up reassigns, and the record says who did it', async () => {
    const r = await put('/assignments/learner-1', { courses: ['history'], units: [], assignedBy: 'dad' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ learnerId: 'learner-1', courses: ['history'], assignedBy: 'dad' });
  });

  it('a child cannot assign themselves easier work', async () => {
    const r = await put('/assignments/learner-1', { courses: ['nap-time'], units: [], assignedBy: 'learner-1' });
    expect(r.status).toBe(403);
    expect(assigned.get('learner-1').courses).toEqual(['math-fractions']);
  });

  it('an unsigned PUT is refused rather than accepted as anonymous', async () => {
    expect((await put('/assignments/learner-1', { courses: ['nap-time'], units: [] })).status).toBe(403);
    expect(assigned.get('learner-1').courses).toEqual(['math-fractions']);
  });

  it('reading assignments stays open — the gate is on the write', async () => {
    expect((await fetch(`${base}/assignments`)).status).toBe(200);
    expect((await fetch(`${base}/assignments/learner-1`)).status).toBe(200);
  });

  it('a stale save (someone else wrote since this was loaded) is refused 409, not 400 — a co-teacher\'s edit was NOT silently clobbered', async () => {
    const r = await put('/assignments/learner-1', {
      courses: ['history'], units: [], assignedBy: 'dad', baseUpdatedAt: 'an-updatedAt-nobody-wrote',
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/reload/i);
    expect(assigned.get('learner-1').courses).toEqual(['math-fractions']);
  });
});

describe('fail closed when the guarded use case is missing', () => {
  it('does not fall back to the raw store for either write', async () => {
    const app = express();
    app.use(express.json());
    // The stores ARE wired; only the guarded use cases are absent.
    app.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter({
      buildAgenda: { execute: async () => ({ offers: [] }) },
      assignments, reviewQueue, clock, logger: silent,
    }));
    app.use(errorHandlerMiddleware({ logger: silent, shape: 'string' }));
    const bare = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    const url = `http://127.0.0.1:${bare.address().port}/api/v1/school/lifecycle`;

    expect((await fetch(`${url}/sessions/ses_a/review/q3`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'correct', gradedBy: 'dad' }),
    })).status).toBe(404);
    expect((await fetch(`${url}/assignments/learner-1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courses: [], units: [], assignedBy: 'dad' }),
    })).status).toBe(404);
    // The reads are unaffected.
    expect((await fetch(`${url}/review`)).status).toBe(200);

    await new Promise((res) => bare.close(res));
  });
});

describe('the stale-work sweep over HTTP (admin advocacy A5)', () => {
  it('GET /sessions/stale lists non-terminal sessions older than the window, oldest first', async () => {
    const res = await fetch(`${base}/sessions/stale?olderThanDays=7`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // ses_stuck (26 days idle) qualifies; ses_done is terminal; ses_fresh is 1 day old.
    expect(body.sessions.map((s) => s.sessionId)).toEqual(['ses_stuck']);
    expect(body.sessions[0]).toMatchObject({ learnerId: 'learner-1', state: 'issued', unitId: 'frac.01', abandonable: true });
  });

  it('stamps `abandonable` per row, and the flag agrees with what POST /abandon actually does for the same state — a second copy of the rule is the bug this exists to prevent', async () => {
    sessionRows.push(
      // Past `submitted`, work settles through grading/close — never abandonment.
      { sessionId: 'ses_stuck_submitted', learnerId: 'learner-1', unitId: 'frac.05', state: 'submitted', terminal: false, updatedAt: '2026-07-01T09:00:00.000Z' },
      // A null state is not permission, even though it is non-terminal and stale.
      { sessionId: 'ses_stuck_null', learnerId: 'learner-1', unitId: 'frac.06', state: null, terminal: false, updatedAt: '2026-07-01T09:00:00.000Z' },
    );
    const res = await fetch(`${base}/sessions/stale?olderThanDays=7`);
    const body = await res.json();
    const bySessionId = Object.fromEntries(body.sessions.map((s) => [s.sessionId, s]));
    expect(bySessionId.ses_stuck.abandonable).toBe(true);
    expect(bySessionId.ses_stuck_submitted.abandonable).toBe(false);
    expect(bySessionId.ses_stuck_null.abandonable).toBe(false);

    // Pin: for each row, `abandonable` must predict whether POST /abandon
    // actually succeeds — drift between the two is exactly the defect this
    // task exists to close.
    for (const [sessionId, expectSuccess] of [
      ['ses_stuck', true], ['ses_stuck_submitted', false], ['ses_stuck_null', false],
    ]) {
      appendedEvents = [];
      // eslint-disable-next-line no-await-in-loop
      const r = await post(`/sessions/${sessionId}/abandon`, { learnerId: 'learner-1', decidedBy: 'dad', reason: 'checking agreement' });
      expect(r.ok).toBe(expectSuccess);
      expect(appendedEvents.length > 0).toBe(expectSuccess);
    }
  });

  it('POST /sessions/:id/abandon: gated, reason required, appends the terminal event with attribution', async () => {
    const refused = await post('/sessions/ses_stuck/abandon', { learnerId: 'learner-1', decidedBy: 'learner-1', reason: 'r' });
    expect(refused.status).toBe(403);
    expect(appendedEvents).toEqual([]);

    const noReason = await post('/sessions/ses_stuck/abandon', { learnerId: 'learner-1', decidedBy: 'dad' });
    expect(noReason.status).toBe(400);

    const ok = await post('/sessions/ses_stuck/abandon', { learnerId: 'learner-1', decidedBy: 'dad', reason: 'Paper lost over the summer' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sessionId: 'ses_stuck', state: 'abandoned' });
    expect(appendedEvents[0]).toMatchObject({ sessionId: 'ses_stuck', type: 'abandoned', reason: 'Paper lost over the summer', decidedBy: 'dad' });
  });

  it('refuses to abandon a settled session — settling real work is CloseSessionOutcome\'s job', async () => {
    const res = await post('/sessions/ses_done/abandon', { learnerId: 'learner-1', decidedBy: 'dad', reason: 'r' });
    expect(res.status).toBe(400);
  });

  it('refuses states where the event machine forbids abandoned — no anomalous append that "succeeds" and lies (M8 fix 2)', async () => {
    sessionRows.push({ sessionId: 'ses_submitted', learnerId: 'learner-1', unitId: 'frac.04', state: 'submitted', terminal: false, updatedAt: '2026-07-01T09:00:00.000Z' });
    const res = await post('/sessions/ses_submitted/abandon', { learnerId: 'learner-1', decidedBy: 'dad', reason: 'r' });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/grading/);
    expect(appendedEvents).toEqual([]);
  });
});
