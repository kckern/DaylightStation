import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import yaml from 'js-yaml';
import { YamlEconomyDatastore } from "../adapters/persistence/YamlEconomyDatastore.mjs";
import { EconomyService } from "./EconomyService.mjs";
import { EconomyConfigProjection } from '../adapters/config/EconomyConfigProjection.mjs';

const USER = 'test-user';
const USER_DIR = path.join(os.tmpdir(),'econ-svc-test-user');
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
  configProjection: new EconomyConfigProjection({ configService }),
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
  // A caller whose own policy prices the completion (a school unit declares
  // `reward.amount`) has to be able to say so, or the field is decoration.
  it('earn honours an explicit amount over the policy reward', async () => {
    const svc = makeService();
    const res = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1', amount: 8 });
    expect(res.earned).toBe(8);
    expect(res.balance).toBe(8);
  });
  it('an explicit amount is still bounded by the household daily_cap', async () => {
    const svc = makeService();
    const res = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1', amount: 40 });
    expect(res.earned).toBe(10);
    expect(res.capped).toBe(true);
  });
  it.each([
    ['null', null], ['zero', 0], ['negative', -3], ['fractional', 2.5], ['a string', '9'],
  ])('falls back to the policy reward when the amount is %s', async (_label, amount) => {
    const svc = makeService();
    const res = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1', amount });
    expect(res.earned).toBe(5);
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
  it('earn no-ops (does not throw) when the install has no economy config', async () => {
    const svc = new EconomyService({
      datastore: new YamlEconomyDatastore({ configService }),
      configProjection: new EconomyConfigProjection({ configService: { ...configService, getHouseholdAppConfig: () => null } }), // no economy/config.yml
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
    const res = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    expect(res.earned).toBe(0);
    expect(res.skipped).toBe(true);
    expect(res.balance).toBe(0);
  });
  // The catalog file ships `earn: {}` (prices live in earn-rules.yml now), and
  // `{}` is truthy: the always-on piano hook must still skip, not throw.
  it('earn skips an action an empty earn map does not price', async () => {
    const svc = new EconomyService({
      datastore: new YamlEconomyDatastore({ configService }),
      configProjection: new EconomyConfigProjection({ configService: { ...configService, getHouseholdAppConfig: () => ({ mode: 'dry-run', earn: {}, spend: {} }) } }),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
    const res = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    expect(res).toMatchObject({ earned: 0, skipped: true, reason: 'not-priced', txnId: null, balance: 0 });
    expect(new YamlEconomyDatastore({ configService }).readAllTransactions(USER)).toEqual([]);
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
  it('adjust is lifetime-idempotent, bypasses caps, and negative debt is repaid by later earnings', async () => {
    const svc = makeService();
    const first = await svc.adjust(USER, { delta: -7, source: 'school-grade', ref: 'adjustment:one', note: 'grade reversed' });
    expect(first.balance).toBe(0);
    expect((await svc.adjust(USER, { delta: -7, source: 'school-grade', ref: 'adjustment:one' })).duplicate).toBe(true);
    expect((await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'later' })).balance).toBe(0);
    expect((await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'later-2' })).balance).toBe(3);
  });
});

describe('multi-currency balances', () => {
  const ledgerDir = () => path.join(USER_DIR, 'apps', 'economy', 'ledger');
  const writeDay = (day, txns) => {
    fs.mkdirSync(ledgerDir(), { recursive: true });
    fs.writeFileSync(path.join(ledgerDir(), `${day}.yml`), yaml.dump(txns));
  };

  it('getBalance returns balances alongside the silver balance', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 4 });
    const res = await svc.getBalance(USER);
    expect(res).toMatchObject({ userId: USER, balance: 4, balances: { silver: 4, gold: 0, gems: 0 }, session: null });
  });

  it('legacy entries without a currency count as silver', async () => {
    writeDay('2026-07-17', [
      { id: 'txn_old', at: '2026-07-17T10:00:00.000Z', kind: 'deposit', delta: 10, action: 'parent-deposit', source: 'admin', ref: null },
      { id: 'txn_gold', at: '2026-07-17T11:00:00.000Z', kind: 'convert', delta: 3, action: 'week-close', source: 'economy', ref: null, currency: 'gold' },
    ]);
    const res = await makeService().getBalance(USER);
    expect(res.balance).toBe(10);
    expect(res.balances).toEqual({ silver: 10, gold: 3, gems: 0 });
  });

  it('the wallet snapshot carries balances, stamped by the injected clock', async () => {
    const svc = new EconomyService({
      datastore: new YamlEconomyDatastore({ configService }),
      configProjection: new EconomyConfigProjection({ configService }),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      clock: () => new Date('2026-10-19T15:00:00.000Z'),
    });
    await svc.deposit(USER, { amount: 6 });
    const wallet = new YamlEconomyDatastore({ configService }).readWallet(USER);
    expect(wallet).toEqual({ balance: 6, balances: { silver: 6, gold: 0, gems: 0 }, as_of: '2026-10-19T15:00:00.000Z', session: null });
    expect(fs.existsSync(path.join(ledgerDir(), '2026-10-19.yml'))).toBe(true);
  });

  it('getHistory lists entries newest first, optionally since a time, legacy ones as silver', async () => {
    writeDay('2026-10-17', [{ id: 'txn_1', at: '2026-10-17T10:00:00.000Z', kind: 'deposit', delta: 2, action: 'parent-deposit', source: 'admin', ref: null }]);
    writeDay('2026-10-18', [
      { id: 'txn_2', at: '2026-10-18T09:00:00.000Z', kind: 'earn', delta: 1, action: 'x', source: 't', ref: null, currency: 'silver' },
      { id: 'txn_3', at: '2026-10-18T12:00:00.000Z', kind: 'earn', delta: 1, action: 'x', source: 't', ref: null, currency: 'gems' },
    ]);
    const svc = makeService();
    const all = await svc.getHistory(USER);
    expect(all.map((t) => t.id)).toEqual(['txn_3', 'txn_2', 'txn_1']);
    expect(all[2].currency).toBe('silver');
    expect((await svc.getHistory(USER, { since: '2026-10-18T09:00:00.000Z' })).map((t) => t.id)).toEqual(['txn_3', 'txn_2']);
    await expect(svc.getHistory('nobody')).rejects.toThrow();
    await expect(svc.getHistory(USER, { since: 'not a date' })).rejects.toThrow(/since/);
  });

  it('getHistory keeps same-timestamp entries newest-appended first and keeps an unreadable time, logged', async () => {
    const at = '2026-10-18T09:00:00.000Z';
    writeDay('2026-10-18', [
      { id: 'txn_a', at, kind: 'earn', delta: 1, action: 'x', source: 't', ref: null },
      { id: 'txn_b', at, kind: 'earn', delta: 1, action: 'x', source: 't', ref: null },
      { id: 'txn_bad', at: 'garbled', kind: 'earn', delta: 1, action: 'x', source: 't', ref: null },
      { id: 'txn_c', at, kind: 'earn', delta: 1, action: 'x', source: 't', ref: null },
    ]);
    const warn = vi.fn();
    const svc = new EconomyService({
      datastore: new YamlEconomyDatastore({ configService }),
      configProjection: new EconomyConfigProjection({ configService }),
      logger: { info: () => {}, warn, error: () => {}, debug: () => {} },
    });
    expect((await svc.getHistory(USER)).map((t) => t.id)).toEqual(['txn_c', 'txn_b', 'txn_a', 'txn_bad']);
    expect(warn).toHaveBeenCalledWith('economy.history.unreadable-at', expect.objectContaining({ userId: USER, txnId: 'txn_bad' }));
  });
});

describe('read-check-write under the user lock', () => {
  const holdQueue = () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const held = new YamlEconomyDatastore({ configService }).withUserLock(USER, () => gate);
    return { release, held };
  };

  it('two concurrent earns with one ref pay once', async () => {
    const svc = makeService();
    const { release, held } = holdQueue();
    const a = svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    const b = svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    await new Promise((r) => setTimeout(r, 10));
    release();
    await held;
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.earned).sort()).toEqual([0, 5]);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
    expect(new YamlEconomyDatastore({ configService }).readAllTransactions(USER)).toHaveLength(1);
  });

  it('concurrent earns respect the daily cap', async () => {
    const svc = makeService();
    const { release, held } = holdQueue();
    const runs = ['plex:1', 'plex:2', 'plex:3'].map((ref) => svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref }));
    await new Promise((r) => setTimeout(r, 10));
    release();
    await held;
    const results = await Promise.all(runs);
    expect(results.reduce((s, r) => s + r.earned, 0)).toBe(10);
    expect((await svc.getBalance(USER)).balance).toBe(10);
  });

  it('concurrent adjusts with one ref apply once', async () => {
    const svc = makeService();
    const { release, held } = holdQueue();
    const a = svc.adjust(USER, { delta: 4, source: 'school-grade', ref: 'adj:1' });
    const b = svc.adjust(USER, { delta: 4, source: 'school-grade', ref: 'adj:1' });
    release();
    await held;
    const results = await Promise.all([a, b]);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
    expect((await svc.getBalance(USER)).balance).toBe(4);
  });

  it('concurrent settles with one cumulative charge once', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    const { release, held } = holdQueue();
    const a = svc.settleSession(USER, { sessionId: s.sessionId, coins: 3 });
    const b = svc.settleSession(USER, { sessionId: s.sessionId, coins: 3 });
    release();
    await held;
    await Promise.all([a, b]);
    expect((await svc.getBalance(USER)).balance).toBe(7);
  });

  it('earn stamps the cap day and the ledger shard from one clock read', async () => {
    const ticks = ['2026-10-19T23:59:59.999Z', '2026-10-20T00:00:00.001Z'];
    let i = 0;
    const svc = new EconomyService({
      datastore: new YamlEconomyDatastore({ configService }),
      configProjection: new EconomyConfigProjection({ configService }),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      clock: () => new Date(ticks[Math.min(i++, 1)]),
    });
    const res = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    expect(res.earned).toBe(5);
    const txns = new YamlEconomyDatastore({ configService }).readAllTransactions(USER);
    expect(txns[0].at).toBe(ticks[0]);
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
