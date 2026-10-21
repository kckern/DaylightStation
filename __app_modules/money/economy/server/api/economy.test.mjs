// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from "../../../../../tests/_lib/memory-http/request.mjs";
import { YamlEconomyDatastore } from "../adapters/persistence/YamlEconomyDatastore.mjs";
import { EconomyService } from "../application/EconomyService.mjs";
import { EconomyConfigProjection } from '../adapters/config/EconomyConfigProjection.mjs';
import { BankService } from "../application/BankService.mjs";
import { createEconomyRouter } from "./economy.mjs";

const USER = 'test-user';
const USER_DIR = path.join(os.tmpdir(), 'econ-router-test-user');
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
    configProjection: new EconomyConfigProjection({ configService }),
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

  it('deposit and earn ignore a body source: no caller can write a payout-sourced entry', async () => {
    const app = makeApp();
    await request(app).post(`/api/v1/economy/users/${USER}/deposit`).send({ amount: 10, source: 'payout' }).expect(200);
    await request(app).post(`/api/v1/economy/users/${USER}/earn`).send({ action: 'piano-lesson-complete', source: 'week-close' }).expect(200);
    const sources = new YamlEconomyDatastore({ configService }).readAllTransactions(USER).map((t) => [t.kind, t.source]);
    expect(sources).toEqual([['deposit', 'admin'], ['earn', 'api']]);
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

describe('economy router: bank and passes', () => {
  let dir;
  let passes;
  const now = new Date('2026-10-20T15:00:00.000Z');
  const PASS = `pass:${USER}:2026-10-20`;
  const svcConfig = {
    getUserProfile: (id) => ([USER, 'other-user'].includes(id) ? { id } : null),
    getUserDir: (id) => path.join(dir, id),
    getHouseholdAppConfig: () => ({ mode: 'live', earn: {}, week_close: { cron: '30 23 * * 0' }, passes }),
  };
  const quietLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const build = () => {
    const configProjection = new EconomyConfigProjection({ configService: svcConfig });
    const economyService = new EconomyService({
      datastore: new YamlEconomyDatastore({ configService: svcConfig }), configProjection, logger: quietLog, clock: () => now,
    });
    const bankService = new BankService({ economy: economyService, config: configProjection, clock: () => now, logger: quietLog });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/economy', createEconomyRouter({ economyService, bankService }));
    return { app, economyService };
  };
  const base = `/api/v1/economy/users/${USER}`;
  const buy = (app, body) => request(app).post(`${base}/passes`).send(body);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'econ-router-pass-'));
    passes = { 'early-pass': { privileges: ['piano.games'], price: { silver: 3, gold: 1 }, cap: { per: 'study-day', count: 1, across: 'all-passes' }, authorization: 'trust', refund_within_ms: 60000 } };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('GET /bank: balances, plain-words history, today\'s pass, offers and weekEndsAt', async () => {
    const { app, economyService } = build();
    await economyService.deposit(USER, { amount: 5 });
    await buy(app, { privilege: 'piano.games', coin: 'silver' }).expect(200);
    const res = await request(app).get(`${base}/bank`).expect(200);
    expect(res.body).toMatchObject({
      balances: { silver: 2, gold: 0, gems: 0 },
      pass: { 'piano.games': { passId: PASS, state: 'active', privilege: 'piano.games', capUsed: true } },
      offers: { 'piano.games': [{ coin: 'silver', price: 3, affordable: false }, { coin: 'gold', price: 1, affordable: false }] },
      weekEndsAt: '2026-10-25T23:30:00.000Z',
    });
    expect(res.body.history.map((l) => l.text)).toEqual(['−3 silver · early pass', '+5 silver · deposit']);
    expect((await request(app).get('/api/v1/economy/users/nobody/bank')).status).toBe(404);
  });

  it('POST /passes buys; a second is 409 PASS_CAP; short of coins is 402 with the shortfall', async () => {
    const { app, economyService } = build();
    expect((await buy(app, { privilege: 'piano.games', coin: 'gold' })).body)
      .toMatchObject({ code: 'PASS_UNAFFORDABLE', coin: 'gold', price: 1, balance: 0, shortfall: 1 });
    expect((await buy(app, { privilege: 'piano.games', coin: 'gold' })).status).toBe(402);
    await economyService.deposit(USER, { amount: 5 });
    const ok = await buy(app, { privilege: 'piano.games', coin: 'silver', source: 'payout' }).expect(200);
    expect(ok.body).toMatchObject({ pass: { passId: PASS, state: 'active' }, balances: { silver: 2 } });
    const again = await buy(app, { privilege: 'piano.games', coin: 'silver' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PASS_CAP');
    // The body's `source` is ignored: the ledger says the pass wrote it.
    const sources = new YamlEconomyDatastore({ configService: svcConfig }).readAllTransactions(USER).filter((t) => t.ref === PASS).map((t) => t.source);
    expect(sources).toEqual(['pass', 'pass']);
  });

  it('POST /passes: not sold is 409, bad input is 400', async () => {
    passes['early-pass'].price = { silver: 0, gold: 0 };
    const { app } = build();
    const notSold = await buy(app, { privilege: 'piano.games', coin: 'silver' });
    expect([notSold.status, notSold.body.code]).toEqual([409, 'PASS_NOT_SOLD']);
    expect((await buy(app, { privilege: 'piano.games', coin: 'gems' })).status).toBe(409);
    expect((await buy(app, { coin: 'silver' })).status).toBe(400);
  });

  it('consume and refund by pass id; unknown pass 404, closed refund 409, bad playedMs 400', async () => {
    const { app, economyService } = build();
    await economyService.deposit(USER, { amount: 5 });
    await buy(app, { privilege: 'piano.games', coin: 'silver' }).expect(200);
    const id = encodeURIComponent(PASS);
    expect((await request(app).post(`${base}/passes/${id}/refund`).send({ playedMs: 'x' })).status).toBe(400);
    expect((await request(app).post(`${base}/passes/${id}/refund`).send({ playedMs: 70000 })).body.code).toBe('PASS_REFUND_CLOSED');
    const refund = await request(app).post(`${base}/passes/${id}/refund`).send({ playedMs: 20000, reason: 'crash' }).expect(200);
    expect(refund.body).toMatchObject({ refunded: 3, balances: { silver: 5 }, pass: { state: 'refunded' } });
    const consume = await request(app).post(`${base}/passes/${id}/consume`).send({ playedMs: 20000 });
    expect([consume.status, consume.body.code]).toEqual([409, 'PASS_NOT_ACTIVE']);
    expect((await request(app).post(`${base}/passes/${encodeURIComponent(`pass:${USER}:2026-01-01`)}/consume`).send({})).status).toBe(404);
  });

  it('another learner\'s pass id is 404, and writes nothing', async () => {
    const { app, economyService } = build();
    await economyService.deposit(USER, { amount: 5 });
    await buy(app, { privilege: 'piano.games', coin: 'silver' }).expect(200);
    const id = encodeURIComponent(PASS);
    expect((await request(app).post(`/api/v1/economy/users/other-user/passes/${id}/consume`).send({ playedMs: 0 })).status).toBe(404);
    expect((await request(app).post(`/api/v1/economy/users/other-user/passes/${id}/refund`).send({ playedMs: 0 })).status).toBe(404);
    expect(new YamlEconomyDatastore({ configService: svcConfig }).readAllTransactions(USER).filter((t) => t.kind === 'pass')).toHaveLength(1);
  });

  it('a second-pass id (`….2`) round-trips through the route params, encoded', async () => {
    passes['early-pass'].cap.count = 2;
    const { app, economyService } = build();
    await economyService.deposit(USER, { amount: 10 });
    await buy(app, { privilege: 'piano.games', coin: 'silver' }).expect(200);
    const second = (await buy(app, { privilege: 'piano.games', coin: 'silver' }).expect(200)).body.pass.passId;
    expect(second).toBe(`${PASS}.2`);
    const res = await request(app).post(`${base}/passes/${encodeURIComponent(second)}/consume`).send({ playedMs: 1 }).expect(200);
    expect(res.body.pass).toMatchObject({ passId: second, state: 'consumed' });
  });

  it('consume marks the pass consumed; a repeat is a no-op', async () => {
    const { app, economyService } = build();
    await economyService.deposit(USER, { amount: 5 });
    await buy(app, { privilege: 'piano.games', coin: 'silver' }).expect(200);
    const id = encodeURIComponent(PASS);
    expect((await request(app).post(`${base}/passes/${id}/consume`).send({ playedMs: 300000 }).expect(200)).body)
      .toMatchObject({ duplicate: false, pass: { state: 'consumed' } });
    expect((await request(app).post(`${base}/passes/${id}/consume`).send({ playedMs: 300000 }).expect(200)).body.duplicate).toBe(true);
  });
});
