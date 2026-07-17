import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  it('earn dedups a replayed ref within the day (pays out once)', async () => {
    const svc = makeService();
    const first = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    expect(first.earned).toBe(5);
    const replay = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    expect(replay.earned).toBe(0);
    expect(replay.duplicate).toBe(true);
    expect(replay.balance).toBe(5);
    // a different ref still pays out
    const other = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:2' });
    expect(other.earned).toBe(5);
    expect(other.balance).toBe(10);
  });
  it('deposit validates amount is a positive integer', async () => {
    const svc = makeService();
    await expect(svc.deposit(USER, { amount: -5 })).rejects.toThrow();
    await expect(svc.deposit(USER, { amount: 2.5 })).rejects.toThrow();
  });
});

describe('metered sessions', () => {
  it('openSession requires positive balance and no existing session', async () => {
    const svc = makeService();
    await expect(svc.openSession(USER, { action: 'arcade-play', source: 'emulator' })).rejects.toThrow(/balance/i);
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    expect(s.sessionId).toMatch(/^ses_/);
    expect(s.balance).toBe(10);
    expect(s.drainPerSecond).toBeCloseTo(2 / 600);
    await expect(svc.openSession(USER, { action: 'arcade-play', source: 'emulator' })).rejects.toThrow(/session/i);
  });
  it('openSession blocks during blackout windows', async () => {
    ECONOMY_CONFIG.spend['arcade-play'].blackout = ['00:00-23:59'];
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    await expect(svc.openSession(USER, { action: 'arcade-play', source: 'emulator' })).rejects.toThrow(/blackout/i);
    ECONOMY_CONFIG.spend['arcade-play'].blackout = [];
  });
  it('settle appends one spend txn and clamps to balance', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 5 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    const r1 = await svc.settleSession(USER, { sessionId: s.sessionId, coins: 2 });
    expect(r1.balance).toBe(3);
    const r2 = await svc.settleSession(USER, { sessionId: s.sessionId, coins: 99 }); // over-report clamps
    expect(r2.balance).toBe(0);
    expect(r2.depleted).toBe(true);
  });
  it('settle is idempotent — cumulative coins are a high-water mark, not an increment', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    // client reports cumulative=2 consumed, then RETRIES the same cumulative
    const first = await svc.settleSession(USER, { sessionId: s.sessionId, coins: 2 });
    expect(first.balance).toBe(8);
    const retry = await svc.settleSession(USER, { sessionId: s.sessionId, coins: 2 });
    expect(retry.balance).toBe(8); // no double-charge
    // cumulative advances to 5 → only the 3 newly-crossed coins are charged
    const advance = await svc.settleSession(USER, { sessionId: s.sessionId, coins: 5 });
    expect(advance.balance).toBe(5);
    const txns = new YamlEconomyDatastore({ configService }).readAllTransactions(USER);
    expect(txns.filter((t) => t.kind === 'spend')).toHaveLength(2); // 2 then 3, retry added nothing
  });
  it('settle never charges sub-coin cumulatives (fraction carries until a whole coin is crossed)', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    await svc.settleSession(USER, { sessionId: s.sessionId, coins: 0.2 });
    await svc.settleSession(USER, { sessionId: s.sessionId, coins: 0.9 });
    expect((await svc.getBalance(USER)).balance).toBe(10); // still nothing charged
    const crossed = await svc.settleSession(USER, { sessionId: s.sessionId, coins: 1.4 });
    expect(crossed.balance).toBe(9); // first whole coin crossed
  });
  it('closeSession settles the tail and clears the session', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    const r = await svc.closeSession(USER, { sessionId: s.sessionId, coins: 1 });
    expect(r.balance).toBe(9);
    expect((await svc.getBalance(USER)).session).toBeNull();
  });
  it('closeSession on an already-reaped session is a no-op success', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    // reap it
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
      await svc.getBalance(USER); // triggers stale reap → session cleared
      const r = await svc.closeSession(USER, { sessionId: s.sessionId, coins: 3 });
      expect(r.balance).toBe(10); // no error, no extra charge
    } finally { vi.useRealTimers(); }
  });
  it('settle with zero coins is a no-op ledger-wise', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    await svc.settleSession(USER, { sessionId: s.sessionId, coins: 0 });
    const txns = new YamlEconomyDatastore({ configService }).readAllTransactions(USER);
    expect(txns.filter((t) => t.kind === 'spend')).toHaveLength(0);
  });
  it('stale session is reaped on next getBalance', async () => {
    vi.useFakeTimers();
    try {
      const svc = makeService();
      await svc.deposit(USER, { amount: 10 });
      await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
      vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
      expect((await svc.getBalance(USER)).session).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
