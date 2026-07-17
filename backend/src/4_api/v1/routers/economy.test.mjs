// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import express from 'express';
import request from 'supertest';
import { YamlEconomyDatastore } from '#adapters/persistence/yaml/YamlEconomyDatastore.mjs';
import { EconomyService } from '#apps/economy/EconomyService.mjs';
import { createEconomyRouter } from './economy.mjs';

const USER = 'test-user';
const USER_DIR = '/tmp/econ-router-test-user';
const configService = {
  getUserProfile: (id) => (id === USER ? { id } : null),
  getUserDir: () => USER_DIR,
  getHouseholdAppConfig: () => ({
    currency: { name: 'coins' },
    earn: { 'piano-lesson-complete': { reward: 5, per: 'completion' } },
    spend: { 'arcade-play': { cost: 2, per: '10min', blackout: [] } },
  }),
};

const clean = () => { try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch {} };

const makeApp = () => {
  const economyService = new EconomyService({
    datastore: new YamlEconomyDatastore({ configService }),
    configService,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/economy', createEconomyRouter({ economyService }));
  return app;
};

beforeEach(clean);
afterEach(clean);

describe('economy router', () => {
  it('wallet starts empty; deposit then earn then metered session round-trip', async () => {
    const app = makeApp();

    expect((await request(app).get(`/api/v1/economy/users/${USER}/wallet`)).body.balance).toBe(0);

    await request(app).post(`/api/v1/economy/users/${USER}/deposit`).send({ amount: 10 }).expect(200);

    const earn = await request(app)
      .post(`/api/v1/economy/users/${USER}/earn`)
      .send({ action: 'piano-lesson-complete', source: 'piano' });
    expect(earn.body.balance).toBe(15);

    const open = await request(app)
      .post(`/api/v1/economy/users/${USER}/sessions`)
      .send({ action: 'arcade-play', source: 'emulator' });
    expect(open.body.sessionId).toMatch(/^ses_/);

    // coins are CUMULATIVE consumed: settle 3 → charge 3 → 15-3 = 12.
    const settle = await request(app)
      .post(`/api/v1/economy/users/${USER}/sessions/${open.body.sessionId}/settle`)
      .send({ coins: 3 });
    expect(settle.body.balance).toBe(12);

    // close with cumulative 4 → charge 1 more → 12-1 = 11, session cleared.
    const close = await request(app)
      .post(`/api/v1/economy/users/${USER}/sessions/${open.body.sessionId}/close`)
      .send({ coins: 4 })
      .expect(200);
    expect(close.body.balance).toBe(11);

    const after = await request(app).get(`/api/v1/economy/users/${USER}/wallet`);
    expect(after.body.session).toBeNull();
    expect(after.body.balance).toBe(11);
  });

  it('maps domain errors to non-200s', async () => {
    const app = makeApp();

    // Opening a session with zero balance → ValidationError (insufficient balance) → 4xx.
    const res = await request(app)
      .post(`/api/v1/economy/users/${USER}/sessions`)
      .send({ action: 'arcade-play', source: 'emulator' });
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Unknown user → EntityNotFoundError → 4xx.
    const unknown = await request(app).get('/api/v1/economy/users/nobody/wallet');
    expect(unknown.status).toBeGreaterThanOrEqual(400);
  });
});
