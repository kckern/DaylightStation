import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from "../../../__app_modules/wellness/fitness/server/api/fitness.mjs";

const makeApp = ({ withServices = true } = {}) => {
  const store = new Map();
  const poolCalls = [];
  // Stands in for CycleRaceApiService: the pool of one race type + length.
  const cycleRaceApi = {
    rivalPool: async (query) => {
      poolCalls.push(query);
      if (query.winCondition !== 'distance' && query.winCondition !== 'time') {
        const err = new Error('invalid rival pool query');
        err.code = 'BAD_RIVAL_POOL_QUERY';
        throw err;
      }
      if (query.goalM === '666') throw new Error('index unreadable');
      return [{ raceId: '20260602143012', date: '2026-06-02', winCondition: 'distance', goalM: 3000,
        participants: [{ id: 'rider-a', isGhost: false, stopped: false, finalTimeS: 300, finalDistanceM: 3000, placement: 1 }] }];
    }
  };
  const cycleRaceService = {
    save: async (rec) => { store.set(rec.race.id, rec); return `/x/${rec.race.id}.yml`; },
    get: async (id) => store.get(id) || null,
    listByDate: async () => [...store.values()],
    listDates: async () => ['2026-06-02'],
    findGhostCandidates: async ({ courseId }) => [...store.values()].filter(r => r.race.course_id === courseId)
  };
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({
    ...(withServices ? { cycleRaceService, cycleRaceApi } : {}),
    defaultHouseholdId: 'household',
    logger: { error() {}, info() {}, warn() {} }
  }));
  app.poolCalls = poolCalls;
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

  describe('GET /cycle-races/rival-pool', () => {
    it('returns the light entries for a race type and length, passing the query through', async () => {
      const app = makeApp();
      const res = await request(app).get('/cycle-races/rival-pool').query({ winCondition: 'distance', goalM: 3000 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ entries: [{ raceId: '20260602143012', date: '2026-06-02', winCondition: 'distance', goalM: 3000,
        participants: [{ id: 'rider-a', isGhost: false, stopped: false, finalTimeS: 300, finalDistanceM: 3000, placement: 1 }] }] });
      expect(app.poolCalls).toEqual([{ winCondition: 'distance', goalM: '3000', timeCapS: null, householdId: 'household' }]);
    });
    it('is not swallowed by /cycle-races/:raceId', async () => {
      const res = await request(makeApp()).get('/cycle-races/rival-pool').query({ winCondition: 'distance', goalM: 3000 });
      expect(res.body).not.toHaveProperty('race');
      expect(res.body).toHaveProperty('entries');
    });
    it('passes a time cap and an explicit household', async () => {
      const app = makeApp();
      const res = await request(app).get('/cycle-races/rival-pool').query({ winCondition: 'time', timeCapS: 300, household: 'other' });
      expect(res.status).toBe(200);
      expect(app.poolCalls).toEqual([{ winCondition: 'time', goalM: null, timeCapS: '300', householdId: 'other' }]);
    });
    it('400s on a query the service rejects (missing or unknown race type, unusable length)', async () => {
      const app = makeApp();
      const missing = await request(app).get('/cycle-races/rival-pool').query({ goalM: 3000 });
      expect(missing.status).toBe(400);
      expect(missing.body).toEqual({ error: 'winCondition (distance|time) and a positive goalM or timeCapS required' });
      expect((await request(app).get('/cycle-races/rival-pool').query({ winCondition: 'sprint', goalM: 3000 })).status).toBe(400);
    });
    it('answers any other failure as a 500, not a 400', async () => {
      const res = await request(makeApp()).get('/cycle-races/rival-pool').query({ winCondition: 'distance', goalM: 666 });
      expect(res.status).toBe(500);
    });
    it('503s when cycle races are not wired', async () => {
      const res = await request(makeApp({ withServices: false })).get('/cycle-races/rival-pool').query({ winCondition: 'distance', goalM: 3000 });
      expect(res.status).toBe(503);
    });
  });
});
