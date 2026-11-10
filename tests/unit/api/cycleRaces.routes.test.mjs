import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from "../../../__app_modules/wellness/fitness/server/api/fitness.mjs";
import { CycleRaceService } from "../../../__app_modules/wellness/fitness/server/application/services/CycleRaceService.mjs";
import { CycleRaceApiService } from "../../../__app_modules/wellness/fitness/server/application/services/CycleRaceApiService.mjs";

const makeApp = ({ withServices = true, withApi = true } = {}) => {
  const store = new Map();
  const poolCalls = [];
  // Stands in for CycleRaceApiService, to see what the route hands it and how
  // the route answers a failure that is not a bad request. What the real
  // services accept and reject is tested below, through the real services.
  const cycleRaceApi = {
    rivalPool: async (query) => {
      poolCalls.push(query);
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
    ...(withServices ? { cycleRaceService, ...(withApi ? { cycleRaceApi } : {}) } : {}),
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
    it('answers any other failure as a 500, not a 400', async () => {
      const res = await request(makeApp()).get('/cycle-races/rival-pool').query({ winCondition: 'distance', goalM: 666 });
      expect(res.status).toBe(500);
    });
    // /cycle-races/:raceId answers 503 { error: 'cycle races unavailable' } for the
    // same request when nothing is wired, and 404 when only the race service is:
    // both bodies below come from the rival-pool handler alone.
    it('503s with its own body when cycle races are not wired', async () => {
      const res = await request(makeApp({ withServices: false })).get('/cycle-races/rival-pool').query({ winCondition: 'distance', goalM: 3000 });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'cycle race rival pool unavailable' });
    });
    it('503s with its own body when the race service is wired without the rival-pool projection', async () => {
      const res = await request(makeApp({ withApi: false })).get('/cycle-races/rival-pool').query({ winCondition: 'distance', goalM: 3000 });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'cycle race rival pool unavailable' });
    });
  });

  // The router over the real CycleRaceApiService + CycleRaceService, with only the
  // datastore faked: a rename of the bad-query error code, or a change to what the
  // services accept, shows up here as a wrong status.
  describe('GET /cycle-races/rival-pool through the real services', () => {
    const participant = (userId, over = {}) => ({ userId, isGhost: false, stopped: false, final_time_s: 300, final_distance_m: 3000, placement: 1, ...over });
    const ROWS = [
      { id: '20260602143012', date: '2026-06-02', course_id: null, win_condition: 'distance', goal_m: 3000, time_cap_s: null, incomplete: false,
        participants: [participant('rider-a'), participant('ghost:20260601080000:rider-a', { isGhost: true, final_time_s: null, final_distance_m: 2900, placement: 2 })] },
      { id: '20260603090000', date: '2026-06-03', course_id: null, win_condition: 'distance', goal_m: 3000, time_cap_s: null, incomplete: true,
        participants: [participant('user_1')] },
      { id: '20260604090000', date: '2026-06-04', course_id: null, win_condition: 'distance', goal_m: 1500, time_cap_s: null, incomplete: false,
        participants: [participant('user_1', { final_distance_m: 1500 })] },
      { id: '20260605090000', date: '2026-06-05', course_id: null, win_condition: 'time', goal_m: null, time_cap_s: 300, incomplete: false,
        participants: [participant('user_1', { final_time_s: null, final_distance_m: 2100, stopped: true })] }
    ];
    const BAD_QUERY = { error: 'winCondition (distance|time) and a positive goalM or timeCapS required' };
    const makeRealApp = () => {
      const indexReads = [];
      const datastore = { listIndexEntries: async (householdId) => { indexReads.push(householdId); return ROWS; } };
      const cycleRaceService = new CycleRaceService({ datastore });
      const cycleRaceApi = new CycleRaceApiService({ races: cycleRaceService, config: null });
      const app = express();
      app.use(express.json());
      app.use('/', createFitnessRouter({ cycleRaceService, cycleRaceApi, defaultHouseholdId: 'household',
        logger: { error() {}, info() {}, warn() {} } }));
      app.indexReads = indexReads;
      return app;
    };
    const get = (app, query) => request(app).get('/cycle-races/rival-pool').query(query);

    it('200s with the light rows of a distance race of that length', async () => {
      const app = makeRealApp();
      const res = await get(app, { winCondition: 'distance', goalM: '3000' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ entries: [{ raceId: '20260602143012', date: '2026-06-02', winCondition: 'distance', goalM: 3000,
        participants: [
          { id: 'rider-a', isGhost: false, stopped: false, finalTimeS: 300, finalDistanceM: 3000, placement: 1 },
          { id: 'ghost:20260601080000:rider-a', isGhost: true, stopped: false, finalTimeS: null, finalDistanceM: 2900, placement: 2 }
        ] }] });
      expect(app.indexReads).toEqual(['household']);
    });
    it('200s with the light rows of a time race of that cap, for the named household', async () => {
      const app = makeRealApp();
      const res = await get(app, { winCondition: 'time', timeCapS: '300', household: 'other' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ entries: [{ raceId: '20260605090000', date: '2026-06-05', winCondition: 'time', timeCapS: 300,
        participants: [{ id: 'user_1', isGhost: false, stopped: true, finalTimeS: null, finalDistanceM: 2100, placement: 1 }] }] });
      expect(app.indexReads).toEqual(['other']);
    });
    it('200s with no entries for a length nobody has raced', async () => {
      const res = await get(makeRealApp(), { winCondition: 'distance', goalM: '4000' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ entries: [] });
    });
    it.each([
      ['a length that is not a number', { winCondition: 'distance', goalM: 'abc' }],
      ['no length', { winCondition: 'distance' }],
      ['an unknown race type', { winCondition: 'laps', goalM: '3000' }],
      ['no race type', { goalM: '3000' }],
      ['a time cap for a distance race', { winCondition: 'distance', timeCapS: '300' }],
      ['a goal for a time race', { winCondition: 'time', goalM: '3000' }],
      ['a zero length', { winCondition: 'time', timeCapS: '0' }],
      ['an exponent length', { winCondition: 'distance', goalM: '1e3' }],
      ['a hex length', { winCondition: 'distance', goalM: '0x10' }],
      ['a padded length', { winCondition: 'distance', goalM: ' 3000 ' }],
      ['a repeated length', { winCondition: 'distance', goalM: ['3000', '1500'] }]
    ])('400s on %s, without reading the index', async (_label, query) => {
      const app = makeRealApp();
      const res = await get(app, query);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(BAD_QUERY);
      expect(app.indexReads).toEqual([]);
    });
  });
});
