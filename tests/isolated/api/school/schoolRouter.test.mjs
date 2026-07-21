// @vitest-environment node
//
// The repo's default vitest environment is a happy-dom shim (see
// vitest.config.mjs + tests/_infrastructure/frontend-env.mjs) so React
// component tests get a DOM. happy-dom's `fetch` enforces browser-style
// same-origin/CORS rules, which rejects plain cross-port requests to our
// ephemeral test server. This router test needs the real Node `fetch`
// (undici, no CORS) to talk to a real `http.Server`, so it opts out of the
// shared DOM environment.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createSchoolRouter } from '#api/v1/routers/school.mjs';
import { GuestForbiddenError, SessionGoneError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { PersistenceError } from '#system/utils/errors/index.mjs';

const svc = {
  getRoster: () => [{ id: 'kid1', name: 'KID1' }],
  listBanks: ({ audience } = {}) => (audience === 'generic' ? [{ id: 'animals' }] : [{ id: 'animals' }, { id: 'caps' }]),
  getBank: (id) => { if (id !== 'caps') throw new EntityNotFoundError('nope'); return { id: 'caps', items: [] }; },
  openSession: ({ userId, bankId }) => {
    if (bankId === 'assigned-bank' && userId == null) throw new GuestForbiddenError('no');
    if (bankId === 'nope') throw new EntityNotFoundError('no bank');
    return { sessionId: 'ses_1' };
  },
  answer: ({ sessionId, selfGrade }) => {
    if (sessionId === 'ses_gone') throw new SessionGoneError('gone');
    if (selfGrade !== undefined) throw new ValidationError('selfGrade is not accepted on a quiz session');
    if (sessionId === 'ses_boom') throw new Error('disk full');
    return { correct: true, expected: 'x', attemptId: 'att_1' };
  },
  getResults: () => ({ bankId: 'caps' }),
};

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({ schoolService: svc, logger: { error: () => {} } }));
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}/api/v1/school`;
});
afterAll(() => new Promise((res) => server.close(res)));

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('school router status mapping', () => {
  it('GET /roster 200', async () => {
    const r = await fetch(`${base}/roster`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([{ id: 'kid1', name: 'KID1' }]);
  });
  it('GET /banks honours audience filter', async () => {
    const r = await fetch(`${base}/banks?audience=generic`);
    expect((await r.json())).toHaveLength(1);
  });
  it('GET /banks/:id 404 on unknown', async () => {
    expect((await fetch(`${base}/banks/nope`)).status).toBe(404);
  });
  it('POST /sessions: 403 guest-on-assigned, 404 unknown bank, 200 ok', async () => {
    expect((await post('/sessions', { bankId: 'assigned-bank', mode: 'quiz' })).status).toBe(403);
    expect((await post('/sessions', { userId: 'kid1', bankId: 'nope', mode: 'quiz' })).status).toBe(404);
    expect((await post('/sessions', { userId: 'kid1', bankId: 'caps', mode: 'quiz' })).status).toBe(200);
  });
  it('POST answer: 410 gone, 400 mode-mismatch, 500 append failure, 200 ok', async () => {
    expect((await post('/sessions/ses_gone/answer', { itemId: 'q1', given: 'x' })).status).toBe(410);
    expect((await post('/sessions/ses_1/answer', { itemId: 'q1', selfGrade: 'correct' })).status).toBe(400);
    expect((await post('/sessions/ses_boom/answer', { itemId: 'q1', given: 'x' })).status).toBe(500);
    const ok = await post('/sessions/ses_1/answer', { itemId: 'q1', given: 'x' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ correct: true, attemptId: 'att_1' });
  });
});

describe('school router: attempt append failure (PersistenceError) -> 500', () => {
  let persistServer, persistBase;
  const persistSvc = {
    ...svc,
    answer: ({ sessionId }) => {
      if (sessionId === 'ses_persist_fail') {
        throw new PersistenceError('write', 'attempt not recorded for user kid1 (session ses_persist_fail)', {
          userId: 'kid1', sessionId,
        });
      }
      return svc.answer({ sessionId });
    },
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/school', createSchoolRouter({ schoolService: persistSvc, logger: { error: () => {} } }));
    await new Promise((res) => { persistServer = app.listen(0, res); });
    persistBase = `http://127.0.0.1:${persistServer.address().port}/api/v1/school`;
  });
  afterAll(() => new Promise((res) => persistServer.close(res)));

  it('a real PersistenceError from answer() maps to 500, not the shared 503', async () => {
    const r = await fetch(`${persistBase}/sessions/ses_persist_fail/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: 'q1', given: 'x' }),
    });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'internal' });
  });
});
