import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };
const CFG = { cycle_game: { featured_courses: [
  { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 }
] } };

function buildApp({ ladder, pb } = {}) {
  const cycleRaceService = {
    getLadder: async ({ week }) => {
      if (week === 'garbage') { const e = new Error('invalid week'); e.code = 'BAD_WEEK'; throw e; }
      return ladder;
    },
    getPersonalBest: async () => pb,
    get: async (raceId) => (raceId === '20260629080000' ? { race: { id: raceId } } : null)
  };
  const router = createFitnessRouter({
    cycleRaceService,
    configService: { getDefaultHouseholdId: () => 'household' },
    fitnessConfigService: { loadRawConfig: () => CFG },
    logger: silentLogger
  });
  const app = express();
  app.use('/api/fitness', router);
  return app;
}

const LADDER = { course: CFG.cycle_game.featured_courses[0], week: { start: '2026-06-29', end: '2026-07-06' },
  standings: [{ userId: 'dad', bestValue: 150, raceId: '20260629080000', attempts: 1 }], allTimeRecord: null };

describe('GET /cycle-races/ladder', () => {
  it('returns the ladder', async () => {
    const res = await request(buildApp({ ladder: LADDER })).get('/api/fitness/cycle-races/ladder');
    expect(res.status).toBe(200);
    expect(res.body.standings[0].userId).toBe('dad');
  });
  it('is NOT swallowed by /cycle-races/:raceId (route-order regression)', async () => {
    const res = await request(buildApp({ ladder: LADDER })).get('/api/fitness/cycle-races/ladder');
    expect(res.body).not.toHaveProperty('race'); // :raceId handler shape
    expect(res.body).toHaveProperty('standings');
  });
  it('404 when no featured courses; 400 on bad week', async () => {
    expect((await request(buildApp({ ladder: null })).get('/api/fitness/cycle-races/ladder')).status).toBe(404);
    expect((await request(buildApp({ ladder: LADDER })).get('/api/fitness/cycle-races/ladder?week=garbage')).status).toBe(400);
  });
});

describe('GET /cycle-races/personal-bests', () => {
  it('returns the PB and 400s on missing params', async () => {
    const pb = { userId: 'milo', courseId: 'sprint-1500m', best: null };
    const app = buildApp({ pb });
    const ok = await request(app).get('/api/fitness/cycle-races/personal-bests?userId=milo&courseId=sprint-1500m');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(pb);
    expect((await request(app).get('/api/fitness/cycle-races/personal-bests?userId=milo')).status).toBe(400);
    expect((await request(app).get('/api/fitness/cycle-races/personal-bests?courseId=x')).status).toBe(400);
  });
});
