import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { YamlEconomyDatastore } from '#adapters/persistence/yaml/YamlEconomyDatastore.mjs';
import { EconomyService } from './EconomyService.mjs';

const USER = 'test-user';
const USER_DIR = '/tmp/econ-svc-test-user';
const ECONOMY_CONFIG = {
  currency: { name: 'coins' },
  earn: { 'piano-lesson-complete': { reward: 5, per: 'completion', daily_cap: 10 } },
  spend: { 'arcade-play': { cost: 2, per: '10min', self_serve: true, auth: 'identify', blackout: [] } },
  users: {},
};
const configService = {
  getUserProfile: (id) => (id === USER ? { id } : null),
  getUserDir: () => USER_DIR,
  getHouseholdAppConfig: () => ECONOMY_CONFIG,
};
const clean = () => { try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch {} };
const makeService = () => new EconomyService({
  datastore: new YamlEconomyDatastore({ configService }),
  configService,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
});

beforeEach(clean);
afterEach(clean);

describe('EconomyService', () => {
  it('starts at zero balance', async () => {
    expect((await makeService().getBalance(USER)).balance).toBe(0);
  });
  it('deposit increases balance and writes a ledger entry + wallet snapshot', async () => {
    const svc = makeService();
    const res = await svc.deposit(USER, { amount: 25, note: 'allowance' });
    expect(res.balance).toBe(25);
    expect((await svc.getBalance(USER)).balance).toBe(25);
    const wallet = new YamlEconomyDatastore({ configService }).readWallet(USER);
    expect(wallet.balance).toBe(25);
  });
  it('earn applies the policy reward', async () => {
    const svc = makeService();
    const res = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    expect(res.earned).toBe(5);
    expect(res.balance).toBe(5);
  });
  it('earn enforces daily_cap (10) and reports capped earns', async () => {
    const svc = makeService();
    await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:2' });
    const third = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:3' });
    expect(third.earned).toBe(0);
    expect(third.capped).toBe(true);
    expect(third.balance).toBe(10);
  });
  it('rejects unknown earn actions and unknown users', async () => {
    const svc = makeService();
    await expect(svc.earn(USER, { action: 'nope', source: 'x' })).rejects.toThrow();
    await expect(svc.getBalance('nobody')).rejects.toThrow();
  });
  it('deposit validates amount is a positive integer', async () => {
    const svc = makeService();
    await expect(svc.deposit(USER, { amount: -5 })).rejects.toThrow();
    await expect(svc.deposit(USER, { amount: 2.5 })).rejects.toThrow();
  });
});
