import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from '#api/v1/routers/fitness.mjs';

const makeApp = () => {
  const store = new Map();
  const cycleRaceService = {
    save: async (rec) => { store.set(rec.race.id, rec); return `/x/${rec.race.id}.yml`; },
    get: async (id) => store.get(id) || null,
    listByDate: async () => [...store.values()],
    listDates: async () => ['2026-06-02'],
    findGhostCandidates: async ({ courseId }) => [...store.values()].filter(r => r.race.course_id === courseId)
  };
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({ cycleRaceService, logger: { error() {}, info() {}, warn() {} } }));
  return app;
};

const rec = (id = '20260602143012', over = {}) => ({ version: 1, race: { id, date: '2026-06-02', win_condition: 'distance', goal_m: 3000, course_id: 'alps_3k', ...over }, participants: {} });

describe('cycle-races routes', () => {
  it('POST saves a race', async () => {
    const app = makeApp();
    const res = await request(app).post('/cycle-races').send({ record: rec() });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.raceId).toBe('20260602143012');
  });
  it('GET /cycle-races/:id returns a saved race', async () => {
    const app = makeApp();
    await request(app).post('/cycle-races').send({ record: rec() });
    const res = await request(app).get('/cycle-races/20260602143012');
    expect(res.status).toBe(200);
    expect(res.body.race.race.id).toBe('20260602143012');
  });
  it('GET /cycle-races/:id 404s when missing', async () => {
    const res = await request(makeApp()).get('/cycle-races/nope');
    expect(res.status).toBe(404);
  });
  it('GET /cycle-races?date lists races', async () => {
    const app = makeApp();
    await request(app).post('/cycle-races').send({ record: rec() });
    const res = await request(app).get('/cycle-races').query({ date: '2026-06-02' });
    expect(res.status).toBe(200);
    expect(res.body.races).toHaveLength(1);
  });
  it('GET /cycle-races?courseId returns ghost candidates', async () => {
    const app = makeApp();
    await request(app).post('/cycle-races').send({ record: rec('20260602143012', { course_id: 'alps_3k' }) });
    await request(app).post('/cycle-races').send({ record: rec('20260602150000', { course_id: 'coastal' }) });
    const res = await request(app).get('/cycle-races').query({ courseId: 'alps_3k' });
    expect(res.body.races).toHaveLength(1);
  });
});
