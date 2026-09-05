// @vitest-environment node
//
// The repo's default vitest environment is a happy-dom shim whose `fetch`
// enforces browser CORS rules and rejects plain cross-port requests to an
// ephemeral test server. Like schoolRouter.test.mjs, this opts out and uses the
// real Node fetch against a real http.Server.
//
// The use cases are stubbed to their RETURN SHAPES only. What is under test here
// is the boundary: which outcome becomes which HTTP status, that no route
// hand-rolls a 500 or a `success: false` envelope, and that an unwired use case
// 404s rather than half-answering.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createSchoolLifecycleTestRouter as createSchoolLifecycleRouter } from '../../../_lib/school/schoolLifecycleRouterTestSupport.mjs';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** Echoes back whatever status the test asked for, in a use-case result shape. */
const echo = (extra = {}) => ({
  execute: async (args = {}) => ({ status: args.status ?? args.code ?? 'ok', message: 'stubbed', ...extra, args }),
});

const reviewQueue = {
  listPending: async () => [{ sessionId: 'ses_1', itemId: 'q3', verdict: null }],
  listForSession: async (sessionId) => (sessionId === 'ses_1' ? [{ sessionId, itemId: 'q3' }] : []),
  resolve: async ({ sessionId, itemId, verdict, gradedBy, at }) => (
    itemId === 'ghost' ? null : { sessionId, itemId, verdict, gradedBy, gradedAt: at }
  ),
};

const assignments = {
  list: async () => [{ learnerId: 'kid1', courses: ['math-fractions'], units: [] }],
  get: async (learnerId) => (learnerId === 'kid1' ? { learnerId, courses: ['math-fractions'], units: [] } : null),
  put: async (record) => record,
};

/**
 * The two parent-only writes are use cases now, not raw store calls, because the
 * refusal has to survive the router being called directly. Stubbed here to their
 * ERROR NAMES so this file keeps testing the one thing it is for — which outcome
 * becomes which status — while `lifecycleParentWrites.test.mjs` wires the real
 * ones and proves the refusal itself.
 */
const named = (name, message) => Object.assign(new Error(message), { name });

const resolveReviewItem = {
  execute: async ({ sessionId, itemId, verdict, gradedBy, note = null, pin = null }) => {
    if (gradedBy === 'kid1') throw named('GuestForbiddenError', 'Only a grown-up can sign off schoolwork');
    if (verdict !== 'correct' && verdict !== 'incorrect') throw named('ValidationError', `verdict must be correct|incorrect, got: ${verdict}`);
    if (itemId === 'ghost') throw named('EntityNotFoundError', `review-item not found: ${sessionId}/${itemId}`);
    return { sessionId, itemId, verdict, gradedBy, note, pin, gradedAt: '2026-07-27T09:00:00.000Z' };
  },
};

const setAssignments = {
  execute: async ({ learnerId, courses, units, programs, assignedBy, pin = null, baseUpdatedAt = null }) => {
    if (assignedBy === 'kid1') throw named('GuestForbiddenError', 'Only a grown-up can change what a child is assigned');
    if (!Array.isArray(courses) || !Array.isArray(units)) throw named('ValidationError', 'courses and units must be arrays');
    return { learnerId, courses, units, programs, assignedBy, pin, baseUpdatedAt, updatedAt: '2026-07-27T09:00:00.000Z' };
  },
};

const curriculum = {
  listUnitSummaries: async () => [
    { unitId: 'math-fractions.03', title: 'Fractions Checkpoint', subject: 'math', objectives: ['add unlike denominators'] },
  ],
  getUnitSummary: async (unitId) => (
    unitId === 'math-fractions.03'
      ? { unitId, title: 'Fractions Checkpoint', subject: 'math', objectives: ['add unlike denominators'] }
      : null
  ),
};

const sessions = {
  listForLearner: async () => [{ sessionId: 'ses_1', state: 'issued' }],
  readEvents: async () => [{ type: 'created', seq: 1 }],
};

// `GET .../agenda` now previews (dry run) and `POST .../agenda` mints — these
// arrays let the agenda tests below assert WHICH use case a given request
// reached without re-declaring the router per test.
const previewCalls = [];
const buildCalls = [];
const previewAgenda = {
  execute: async ({ learnerId, learnerName }) => {
    previewCalls.push({ learnerId, learnerName });
    return {
      learnerId, learnerName, sections: [], plan: { entries: [], errors: [] }, document: { id: `agenda-${learnerId}` },
    };
  },
};
const buildAgenda = {
  execute: async ({ learnerId, learnerName }) => {
    buildCalls.push({ learnerId, learnerName });
    return { learnerId, learnerName, offers: [], document: { id: `agenda-${learnerId}` } };
  },
};
const getLearnerDayCompletion = {
  execute: async ({ learnerId }) => ({
    learnerId,
    state: learnerId === 'kid1' ? 'complete' : 'no_work_today',
    excused: [],
  }),
};
/** Stub of `1_rendering`'s PNG receipt renderer — a fixed, tiny "PNG". */
const receiptPngRenderer = {
  createCanvas: async (document) => ({ canvas: { toBuffer: () => Buffer.from(`png:${document.id}`) } }),
};

let server, base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter({
    resolveScanAction: { execute: async ({ code }) => ({ status: code.replace('sch:', ''), message: 'stubbed', printed: true }) },
    buildAgenda,
    previewAgenda,
    getLearnerDayCompletion,
    receiptPngRenderer,
    issueDocument: { execute: async ({ sessionId }) => ({ status: sessionId === 'ses_bad' ? 'unavailable' : 'issued', sessionId, artifactId: 'art_1' }) },
    dispatchMedia: {
      selectableTargets: () => [{ id: 'living-room-tv', label: 'the TV', childSelectable: true }],
      execute: async ({ sessionId, target }) => ({ status: target === 'nope' ? 'unavailable' : 'dispatched', sessionId, target }),
    },
    recordMediaCompletion: {
      execute: async ({ dispatchId, sessionId }) => {
        if (dispatchId === 'ghost') return { status: 'uncorrelated', released: false };
        if (sessionId === 'ses_gated') {
          return { status: 'checkpoints_outstanding', released: false, outstanding: 2, seekCeiling: 120 };
        }
        return { status: 'completed', released: true };
      },
      checkStalled: async ({ sessionId, graceSec }) => ({ stalled: graceSec === 0, sessionId }),
    },
    submitPaperWork: {
      execute: async ({ sessionId, entries }) => ({ status: sessionId === 'ses_dup' ? 'duplicate' : 'submitted', sessionId, entries }),
      fromOmrSheet: async ({ sessionId, sheet }) => ({ status: 'submitted', sessionId, viaSheet: true, columns: sheet.marks.length }),
    },
    // `settle`/`settledBy` are echoed back on purpose. They are the ONLY thing
    // that makes a hand-settle cost a step-up, and the route is the one hop
    // that can drop them silently: without the destructure the use case sees
    // `settle: undefined`, asserts nothing, and answers 200 — a console that
    // looks like it works and gates nothing.
    gradeSubmission: { execute: async ({ sessionId, verdicts, settle, settledBy }) => ({ status: sessionId === 'ses_open' ? 'awaiting_review' : 'graded', percent: 100, verdicts, settle, settledBy }) },
    closeSessionOutcome: { execute: async ({ sessionId, signedOff }) => ({ status: sessionId === 'ses_done' ? 'already_settled' : 'settled', signedOff }) },
    openRemediation: { execute: async ({ sessionId }) => ({ status: sessionId === 'ses_open' ? 'already_opened' : 'opened' }) },
    replaceRemediation: {
      execute: async (args) => ({
        status: 'replaced',
        previousSessionId: args.currentSessionId,
        newSessionId: 'ses_corrected',
        reason: args.reason,
        replacedBy: args.replacedBy,
        idempotencyKey: args.idempotencyKey,
      }),
    },
    assignments,
    reviewQueue,
    curriculum,
    resolveReviewItem,
    setAssignments,
    sessions,
    // Window-aware sessions read: the route must delegate here (with the raw
    // `window` query) whenever the use case is wired, not filter inline.
    listLearnerSessions: {
      execute: async ({ learnerId, window }) => (
        window === 'today'
          ? [{ sessionId: 'ses_today', state: 'issued', learnerId }]
          : [{ sessionId: 'ses_1', state: 'issued' }]
      ),
    },
    logger: silent,
  }));
  app.use(errorHandlerMiddleware({ logger: silent, shape: 'string' }));
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}/api/v1/school/lifecycle`;
});

afterAll(() => new Promise((res) => server.close(res)));

const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
});
const put = (path, body) => fetch(base + path, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

describe('outcome → status mapping', () => {
  it.each([
    ['agenda_printed', 200],
    ['unknown', 404],
    ['expired', 410],
    ['already_done', 409],
    ['not_school', 400],
    ['print_failed', 502],
  ])('a %s scan answers %i', async (outcome, status) => {
    const r = await post('/scan', { code: `sch:${outcome}` });
    expect(r.status).toBe(status);
  });

  it('a refusal still carries the child-facing message', async () => {
    const r = await post('/scan', { code: 'sch:expired' });
    expect((await r.json()).message).toBe('stubbed');
  });

  it('never uses a success:false envelope', async () => {
    for (const code of ['sch:unknown', 'sch:expired', 'sch:already_done']) {
      // eslint-disable-next-line no-await-in-loop
      const body = await (await post('/scan', { code })).json();
      expect(body).not.toHaveProperty('success');
    }
  });
});

describe('agenda and sessions', () => {
  it('returns the read-only three-state learner-day completion with no caching', async () => {
    const r = await fetch(`${base}/learners/kid1/completion`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ learnerId: 'kid1', state: 'complete', excused: [] });
  });

  it('GET /agenda is a dry run: it previews (never mints) and returns a PNG, passing the display name through', async () => {
    const previewBefore = previewCalls.length;
    const buildBefore = buildCalls.length;
    const r = await fetch(`${base}/learners/kid1/agenda?name=Sam`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('content-disposition')).toContain('agenda-kid1');
    expect(previewCalls.length).toBe(previewBefore + 1);
    expect(previewCalls.at(-1)).toMatchObject({ learnerId: 'kid1', learnerName: 'Sam' });
    expect(buildCalls.length).toBe(buildBefore);
  });

  it('POST /agenda mints (buildAgenda, never previewAgenda) and returns the same PNG shape, name from the body', async () => {
    const previewBefore = previewCalls.length;
    const buildBefore = buildCalls.length;
    const r = await post('/learners/kid1/agenda', { name: 'Sam' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(buildCalls.length).toBe(buildBefore + 1);
    expect(buildCalls.at(-1)).toMatchObject({ learnerId: 'kid1', learnerName: 'Sam' });
    expect(previewCalls.length).toBe(previewBefore);
  });

  it('lists a learner\'s sessions and one session\'s events', async () => {
    expect(await (await fetch(`${base}/learners/kid1/sessions`)).json()).toMatchObject({ sessions: [{ sessionId: 'ses_1' }] });
    expect(await (await fetch(`${base}/sessions/ses_1/events`)).json()).toMatchObject({ events: [{ type: 'created' }] });
  });

  it('?window=today delegates to the windowed use case with the raw query value', async () => {
    expect(await (await fetch(`${base}/learners/kid1/sessions?window=today`)).json())
      .toMatchObject({ sessions: [{ sessionId: 'ses_today', learnerId: 'kid1' }] });
  });

  it('issues a document, and 404s an unissuable one', async () => {
    expect((await post('/sessions/ses_1/issue')).status).toBe(200);
    expect((await post('/sessions/ses_bad/issue')).status).toBe(404);
  });
});

describe('media', () => {
  it('lists only the targets a child may pick', async () => {
    expect(await (await fetch(`${base}/media/targets`)).json()).toEqual({
      targets: [{ id: 'living-room-tv', label: 'the TV', childSelectable: true }],
    });
  });

  it('dispatches, and 404s a target that is not on offer', async () => {
    expect((await post('/sessions/ses_1/media/dispatch', { target: 'living-room-tv' })).status).toBe(200);
    expect((await post('/sessions/ses_1/media/dispatch', { target: 'nope' })).status).toBe(404);
  });

  it('answers 204 for a completion no session is waiting on', async () => {
    const r = await post('/media/complete', { learnerId: 'kid1', dispatchId: 'ghost' });
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
  });

  it('does NOT answer 200 for a completion the checkpoint gate refused', async () => {
    const r = await post('/media/complete', { sessionId: 'ses_gated' });
    // A client that reads only the HTTP status must not conclude the child is done.
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ status: 'checkpoints_outstanding', released: false, outstanding: 2 });
  });

  it('passes an explicit grace of 0 through rather than defaulting it', async () => {
    expect(await (await post('/sessions/ses_1/media/check-stalled', { graceSec: 0 })).json())
      .toMatchObject({ stalled: true });
  });
});

describe('submission, grading and close-out', () => {
  it('takes entries', async () => {
    const r = await post('/sessions/ses_1/submit', { entries: { q1: 'C' } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ entries: { q1: 'C' } });
  });

  it('takes a bubble sheet down the OMR path instead', async () => {
    const r = await post('/sessions/ses_1/submit', { sheet: { marks: [1, 2] } });
    expect(await r.json()).toMatchObject({ viaSheet: true, columns: 2 });
  });

  it('409s a duplicate submission', async () => {
    expect((await post('/sessions/ses_dup/submit', { entries: {} })).status).toBe(409);
  });

  it('grades, and 200s work still awaiting a person', async () => {
    expect((await post('/sessions/ses_1/grade', { entries: { q1: 'C' } })).status).toBe(200);
    expect((await post('/sessions/ses_open/grade', {})).status).toBe(200);
  });

  it('carries a hand-settle claim through to the use case that gates it', async () => {
    expect(await (await post('/sessions/ses_1/grade', { settle: true, settledBy: 'parent' })).json())
      .toMatchObject({ settle: true, settledBy: 'parent' });
    // Coerced, not trusted: a truthy string must not buy the settle lane, and
    // an ordinary grade must not wander into it.
    expect(await (await post('/sessions/ses_1/grade', { settle: 'yes please' })).json())
      .toMatchObject({ settle: false });
    expect(await (await post('/sessions/ses_1/grade', { entries: {} })).json())
      .toMatchObject({ settle: false });
  });

  it('closes out, and 409s a second close', async () => {
    expect((await post('/sessions/ses_1/close', { signedOff: true })).status).toBe(200);
    expect((await post('/sessions/ses_done/close')).status).toBe(409);
  });

  it('coerces signedOff rather than trusting a truthy string', async () => {
    expect(await (await post('/sessions/ses_1/close', { signedOff: 'yes please' })).json())
      .toMatchObject({ signedOff: false });
  });

  it('opens a remediation, and 409s a second one', async () => {
    expect((await post('/sessions/ses_1/remediation')).status).toBe(200);
    expect((await post('/sessions/ses_open/remediation')).status).toBe(409);
  });

  it('forwards every audited field when replacing an unworked remediation', async () => {
    const response = await post('/sessions/ses_failed/remediation/replace', {
      currentSessionId: 'ses_retry',
      reason: 'corrected worksheet wording',
      replacedBy: 'parent',
      pin: '7410',
      idempotencyKey: 'repair-place-value-v2',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'replaced',
      previousSessionId: 'ses_retry',
      newSessionId: 'ses_corrected',
      reason: 'corrected worksheet wording',
      replacedBy: 'parent',
      idempotencyKey: 'repair-place-value-v2',
    });
  });
});

describe('the parent surface', () => {
  it('lists the pending review queue', async () => {
    expect(await (await fetch(`${base}/review`)).json()).toMatchObject({ items: [{ itemId: 'q3' }] });
  });

  it('records a verdict', async () => {
    const r = await post('/sessions/ses_1/review/q3', { verdict: 'correct', gradedBy: 'parent' });
    expect(await r.json()).toMatchObject({ verdict: 'correct', gradedBy: 'parent', gradedAt: '2026-07-27T09:00:00.000Z' });
  });

  it('passes a parent\'s note through to the use case', async () => {
    const r = await post('/sessions/ses_1/review/q3', { verdict: 'incorrect', gradedBy: 'parent', note: 'Check the denominator.' });
    expect(await r.json()).toMatchObject({ note: 'Check the denominator.' });
  });

  it('400s a verdict outside the closed set', async () => {
    expect((await post('/sessions/ses_1/review/q3', { verdict: 'maybe', gradedBy: 'parent' })).status).toBe(400);
  });

  it('404s a verdict on an item nobody queued', async () => {
    expect((await post('/sessions/ses_1/review/ghost', { verdict: 'correct', gradedBy: 'parent' })).status).toBe(404);
  });

  it('403s a sign-off the use case refused, the same status the print path returns', async () => {
    const r = await post('/sessions/ses_1/review/q3', { verdict: 'correct', gradedBy: 'kid1' });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/grown-up/i);
  });

  it('reads and writes assignments', async () => {
    expect((await fetch(`${base}/assignments`)).status).toBe(200);
    expect((await fetch(`${base}/assignments/kid1`)).status).toBe(200);
    expect((await fetch(`${base}/assignments/nobody`)).status).toBe(404);
    const programs = [{ programId: 'book-log', subject: 'english' }];
    const r = await put('/assignments/kid2', { courses: ['history'], units: [], programs, assignedBy: 'parent' });
    expect(await r.json()).toMatchObject({
      learnerId: 'kid2', courses: ['history'], programs,
      assignedBy: 'parent', updatedAt: '2026-07-27T09:00:00.000Z',
    });
  });

  it('400s an assignment that is not a pair of lists', async () => {
    expect((await put('/assignments/kid2', { courses: 'history', assignedBy: 'parent' })).status).toBe(400);
  });

  it('403s a planning write the use case refused', async () => {
    expect((await put('/assignments/kid2', { courses: [], units: [], assignedBy: 'kid1' })).status).toBe(403);
  });
});

describe('the curriculum, read-only', () => {
  it('lists the units a learner can be handed, with their titles and objectives', async () => {
    const r = await fetch(`${base}/curriculum/units`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      units: [{ unitId: 'math-fractions.03', title: 'Fractions Checkpoint', objectives: ['add unlike denominators'] }],
    });
  });

  it('reads one unit, and 404s one nobody published', async () => {
    expect((await fetch(`${base}/curriculum/units/math-fractions.03`)).status).toBe(200);
    expect((await fetch(`${base}/curriculum/units/no-such-unit`)).status).toBe(404);
  });

  it('offers no way to WRITE curriculum from here', async () => {
    expect((await put('/curriculum/units/math-fractions.03', { title: 'Nap Time' })).status).toBe(404);
    expect((await post('/curriculum/units', { unitId: 'nap' })).status).toBe(404);
  });
});

describe('fail closed', () => {
  it('registers nothing when no use case is wired', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter({ logger: silent }));
    const bare = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    const url = `http://127.0.0.1:${bare.address().port}/api/v1/school/lifecycle`;
    expect((await fetch(`${url}/review`)).status).toBe(404);
    expect((await fetch(`${url}/learners/kid1/agenda`)).status).toBe(404);
    expect((await fetch(`${url}/learners/kid1/completion`)).status).toBe(404);
    await new Promise((res) => bare.close(res));
  });
});

describe('pin forwarding (teacher-console wave 2)', () => {
  it('the review resolve forwards the body pin to the use case', async () => {
    const r = await post('/sessions/ses_1/review/q3', { verdict: 'correct', gradedBy: 'dad', pin: '7410' });
    expect(r.status).toBe(200);
    expect((await r.json()).pin).toBe('7410');
  });

  it('the assignments write forwards the body pin to the use case', async () => {
    const r = await put('/assignments/kid1', { courses: [], units: [], assignedBy: 'dad', pin: '7410' });
    expect(r.status).toBe(200);
    expect((await r.json()).pin).toBe('7410');
  });
});

describe('production error-handler statuses (object shape)', () => {
  // The PRODUCTION app mounts errorHandlerMiddleware() with its DEFAULT
  // object shape — not the string shape the suites above use. These pin that
  // a lifecycle refusal / missing-entity reaches a real 403/404 through that
  // exact path (it was a silent 500 until 2026-08-06).
  let server2; let base2;
  beforeAll(async () => {
    const { GuestForbiddenError } = await import('#domains/school/errors.mjs');
    const { EntityNotFoundError } = await import('#domains/core/errors/index.mjs');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter({
      buildAgenda: echo(),
      resolveReviewItem: {
        execute: async ({ gradedBy }) => {
          if (gradedBy === 'child') throw new GuestForbiddenError('Only a grown-up can do this.');
          throw new EntityNotFoundError('review-item', 'ghost');
        },
      },
      reviewQueue,
      logger: silent,
    }));
    const { errorHandlerMiddleware } = await import('#system/http/middleware/index.mjs');
    app.use(errorHandlerMiddleware()); // DEFAULT object shape — production wiring
    await new Promise((res) => { server2 = app.listen(0, res); });
    base2 = `http://127.0.0.1:${server2.address().port}/api/v1/school/lifecycle`;
  });
  afterAll(() => new Promise((res) => server2.close(res)));

  it('a refusal is 403 through the production handler, never 500', async () => {
    const res = await fetch(`${base2}/sessions/s/review/i`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'correct', gradedBy: 'child' }),
    });
    expect(res.status).toBe(403);
  });

  it('a missing entity is 404 through the production handler, never 500', async () => {
    const res = await fetch(`${base2}/sessions/s/review/i`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'correct', gradedBy: 'kckern' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('stale-save baseline (M6 gate 3)', () => {
  it('PUT /assignments forwards baseUpdatedAt to the use case', async () => {
    const r = await put('/assignments/kid1', { courses: [], units: [], assignedBy: 'dad', baseUpdatedAt: 'T9' });
    expect(r.status).toBe(200);
    // The stub echoes its args; pin/baseUpdatedAt ride through when present.
    const body = await r.json();
    expect(body.assignedBy).toBe('dad');
    expect(body.baseUpdatedAt).toBe('T9');
  });
});
