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

describe('school router: materials framework', () => {
  describe('with materials use-cases wired', () => {
    let matServer, matBase, unitsCalls, progressCalls;

    beforeAll(async () => {
      unitsCalls = [];
      progressCalls = [];
      const getMaterialCatalog = {
        execute: async () => ({
          sections: [{ category: 'course', label: 'Courses' }],
          materials: [{ id: 'plex:1', title: 'Shakespeare', category: 'course' }],
        }),
      };
      const getMaterialUnits = {
        execute: async ({ materialId, userId }) => {
          unitsCalls.push({ materialId, userId });
          if (materialId === 'plex:missing') throw new EntityNotFoundError('material', materialId);
          return { material: { id: materialId }, units: [{ id: 'plex:u1', completed: false }] };
        },
      };
      const materialProgressStore = {
        record: (args) => { progressCalls.push(args); return { ...args }; },
      };

      const app = express();
      app.use(express.json());
      app.use('/api/v1/school', createSchoolRouter({
        schoolService: svc,
        getMaterialCatalog,
        getMaterialUnits,
        materialProgressStore,
        logger: { error: () => {}, warn: () => {} },
      }));
      await new Promise((res) => { matServer = app.listen(0, res); });
      matBase = `http://127.0.0.1:${matServer.address().port}/api/v1/school`;
    });
    afterAll(() => new Promise((res) => matServer.close(res)));

    it('GET /materials 200s with the catalog shape', async () => {
      const r = await fetch(`${matBase}/materials`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({
        sections: [{ category: 'course', label: 'Courses' }],
        materials: [{ id: 'plex:1', title: 'Shakespeare', category: 'course' }],
      });
    });

    it('GET /materials/:id/units?userId= passes materialId+userId through and returns the shape', async () => {
      const r = await fetch(`${matBase}/materials/plex:1/units?userId=kid1`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ material: { id: 'plex:1' }, units: [{ id: 'plex:u1', completed: false }] });
      expect(unitsCalls).toContainEqual({ materialId: 'plex:1', userId: 'kid1' });
    });

    it('GET /materials/:id/units without userId passes userId:undefined', async () => {
      await fetch(`${matBase}/materials/plex:1/units`);
      expect(unitsCalls).toContainEqual({ materialId: 'plex:1', userId: undefined });
    });

    it('GET /materials/:id/units 404s on an unknown materialId', async () => {
      const r = await fetch(`${matBase}/materials/plex:missing/units`);
      expect(r.status).toBe(404);
    });

    it('PUT progress with a userId writes via the store and returns {ok:true}', async () => {
      const r = await fetch(`${matBase}/materials/plex:1/units/plex:u1/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'kid1', percent: 50, playhead: 30, durationMs: 60000 }),
      });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
      expect(progressCalls).toContainEqual({ userId: 'kid1', plexId: 'plex:u1', percent: 50, seconds: 30, duration: 60 });
    });

    it('PUT progress without a userId (guest) does not write, returns recorded:false', async () => {
      const before = progressCalls.length;
      const r = await fetch(`${matBase}/materials/plex:1/units/plex:u1/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ percent: 50, playhead: 30, durationMs: 60000 }),
      });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, recorded: false });
      expect(progressCalls.length).toBe(before);
    });
  });

  describe('with no materials config wired (getMaterialCatalog/getMaterialUnits absent)', () => {
    let noConfigServer, noConfigBase, warnEvents;

    beforeAll(async () => {
      warnEvents = [];
      const app = express();
      app.use(express.json());
      app.use('/api/v1/school', createSchoolRouter({
        schoolService: svc,
        logger: { error: () => {}, warn: (event) => warnEvents.push(event) },
      }));
      await new Promise((res) => { noConfigServer = app.listen(0, res); });
      noConfigBase = `http://127.0.0.1:${noConfigServer.address().port}/api/v1/school`;
    });
    afterAll(() => new Promise((res) => noConfigServer.close(res)));

    it('GET /materials serves an empty catalog and warns school.materials.config-missing ONCE across repeated requests', async () => {
      const r1 = await fetch(`${noConfigBase}/materials`);
      expect(r1.status).toBe(200);
      expect(await r1.json()).toEqual({ sections: [], materials: [] });

      const r2 = await fetch(`${noConfigBase}/materials`);
      expect(r2.status).toBe(200);
      expect(await r2.json()).toEqual({ sections: [], materials: [] });

      expect(warnEvents.filter((e) => e === 'school.materials.config-missing')).toHaveLength(1);
    });

    it('GET /materials/:id/units 404s (no use-case wired)', async () => {
      const r = await fetch(`${noConfigBase}/materials/plex:1/units`);
      expect(r.status).toBe(404);
    });

    it('PUT progress with a userId but no store returns recorded:false, does not throw', async () => {
      const r = await fetch(`${noConfigBase}/materials/plex:1/units/plex:u1/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'kid1', percent: 50, playhead: 30, durationMs: 60000 }),
      });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, recorded: false });
    });
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
