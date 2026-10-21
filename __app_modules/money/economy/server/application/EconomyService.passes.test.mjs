import os from 'node:os';
import path from 'node:path';
import fs from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YamlEconomyDatastore } from "../adapters/persistence/YamlEconomyDatastore.mjs";
import { EconomyService } from "./EconomyService.mjs";
import { EconomyConfigProjection } from '../adapters/config/EconomyConfigProjection.mjs';
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

const USER = 'test-user';
const OTHER = 'other-user';
let USER_DIR;
let now;
let passes;
const earlyPass = (over = {}) => ({
  privileges: ['piano.games'], price: { silver: 3, gold: 1 },
  cap: { per: 'study-day', count: 1, across: 'all-passes' }, authorization: 'trust', refund_within_ms: 60000, ...over,
});
const configService = {
  getUserProfile: (id) => ([USER, OTHER].includes(id) ? { id } : null),
  getUserDir: (id) => path.join(USER_DIR, id),
  getHouseholdAppConfig: () => ({ mode: 'live', earn: {}, passes }),
};
const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const ds = () => new YamlEconomyDatastore({ configService });
const makeService = ({ datastore = ds(), logger = quiet() } = {}) => new EconomyService({
  datastore, configProjection: new EconomyConfigProjection({ configService }), logger, clock: () => now,
});
const ledger = (user = USER) => ds().readAllTransactions(user);
const at = (iso) => { now = new Date(iso); };
const DAY = '2026-10-20';
const PASS = `pass:${USER}:${DAY}`;
const fundSilver = (svc, n) => svc.deposit(USER, { amount: n });
const fundGold = (svc, n) => svc.mint(USER, { currency: 'gold', amount: n, ref: `gift:gold:${n}` });

beforeEach(() => {
  USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'econ-pass-'));
  passes = { 'early-pass': earlyPass() };
  at('2026-10-20T15:00:00.000Z');
});
afterEach(() => { fs.rmSync(USER_DIR, { recursive: true, force: true }); });

describe('EconomyService.buyPass', () => {
  it('writes the purchase marker and the spend, and returns the pass and balances', async () => {
    const svc = makeService();
    await fundSilver(svc, 5);
    const res = await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    expect(res.pass).toMatchObject({ passId: PASS, state: 'active', privilege: 'piano.games', coin: 'silver', price: 3, paid: 3, studyDay: DAY });
    expect(res.balances).toEqual({ silver: 2, gold: 0, gems: 0 });
    const [marker, spend] = ledger().slice(1);
    expect(marker).toMatchObject({ kind: 'pass', delta: 0, ref: PASS, action: 'early-pass', meta: { state: 'active', privilege: 'piano.games', boughtAt: now.toISOString() } });
    expect(spend).toMatchObject({ kind: 'spend', currency: 'silver', delta: -3, action: 'early-pass', ref: PASS });
    expect(ds().readWallet(USER).balances.silver).toBe(2);
  });
  it('two concurrent purchases make exactly one pass; the other gets PASS_CAP', async () => {
    const svc = makeService();
    await fundSilver(svc, 10);
    const results = await Promise.allSettled([
      svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' }),
      makeService().buyPass(USER, { privilege: 'piano.games', coin: 'silver' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ code: 'PASS_CAP' });
    expect(ledger().filter((t) => t.kind === 'spend')).toHaveLength(1);
    expect(ledger().filter((t) => t.kind === 'pass')).toHaveLength(1);
  });
  it('a gold purchase debits gold and leaves silver alone', async () => {
    const svc = makeService();
    await fundSilver(svc, 5);
    await fundGold(svc, 2);
    const res = await svc.buyPass(USER, { privilege: 'piano.games', coin: 'gold' });
    expect(res.balances).toEqual({ silver: 5, gold: 1, gems: 0 });
    expect(ledger().find((t) => t.kind === 'spend')).toMatchObject({ currency: 'gold', delta: -1 });
  });
  it('an unaffordable purchase writes nothing and says the shortfall', async () => {
    const logger = quiet();
    const svc = makeService({ logger });
    await fundSilver(svc, 2);
    const before = ledger();
    const err = await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ code: 'PASS_UNAFFORDABLE', details: { coin: 'silver', price: 3, balance: 2, shortfall: 1 } });
    expect(ledger()).toEqual(before);
    expect(logger.info).toHaveBeenCalledWith('economy.pass.refused', expect.objectContaining({ learnerId: USER, privilege: 'piano.games', coin: 'silver', price: 3, reason: 'PASS_UNAFFORDABLE' }));
  });
  it('affordability reads the ledger, not a stale wallet snapshot', async () => {
    const svc = makeService();
    await fundSilver(svc, 5);
    ds().writeWallet(USER, { balance: 0, balances: { silver: 0, gold: 0, gems: 0 }, session: null });
    await expect(svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' })).resolves.toMatchObject({ balances: { silver: 2 } });
  });
  it.each([
    ['a coin priced 0', { price: { silver: 0, gold: 1 } }, 'silver'],
    ['gems', { price: { silver: 3, gold: 1, gems: 1 } }, 'gems'],
    ['an unknown coin', {}, 'copper'],
  ])('refuses %s with PASS_NOT_SOLD', async (_label, over, coin) => {
    passes = { 'early-pass': earlyPass(over) };
    const svc = makeService();
    await fundSilver(svc, 5);
    await expect(svc.buyPass(USER, { privilege: 'piano.games', coin })).rejects.toMatchObject({ code: 'PASS_NOT_SOLD' });
    expect(ledger().filter((t) => t.kind !== 'deposit')).toEqual([]);
  });
  it('the shipped placeholder prices (both 0) sell nothing in either coin', async () => {
    passes = { 'early-pass': earlyPass({ price: { silver: 0, gold: 0 } }) };
    const svc = makeService();
    await fundSilver(svc, 50);
    await fundGold(svc, 50);
    for (const coin of ['silver', 'gold']) {
      await expect(svc.buyPass(USER, { privilege: 'piano.games', coin })).rejects.toMatchObject({ code: 'PASS_NOT_SOLD' });
    }
  });
  it('a privilege no pass lists is not sold; a missing privilege or coin is bad input', async () => {
    const svc = makeService();
    await expect(svc.buyPass(USER, { privilege: 'arcade', coin: 'silver' })).rejects.toMatchObject({ code: 'PASS_NOT_SOLD' });
    await expect(svc.buyPass(USER, { coin: 'silver' })).rejects.toThrow(ValidationError);
    await expect(svc.buyPass(USER, { privilege: 'piano.games' })).rejects.toThrow(ValidationError);
    await expect(svc.buyPass('nobody', { privilege: 'piano.games', coin: 'silver' })).rejects.toThrow(EntityNotFoundError);
  });
  it('a refunded pass still uses up the day', async () => {
    const svc = makeService();
    await fundSilver(svc, 10);
    await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    await svc.refundPass(USER, { passId: PASS, playedMs: 1000, reason: 'crash' });
    await expect(svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' })).rejects.toMatchObject({ code: 'PASS_CAP' });
  });
  it('the cap is across all passes: another privilege\'s pass counts', async () => {
    passes = { 'early-pass': earlyPass(), arcade: earlyPass({ privileges: ['arcade'] }) };
    const svc = makeService();
    await fundSilver(svc, 10);
    await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    await expect(svc.buyPass(USER, { privilege: 'arcade', coin: 'silver' })).rejects.toMatchObject({ code: 'PASS_CAP' });
  });
  it('honours cap.count and a per-pass `across` as written', async () => {
    passes = {
      'early-pass': earlyPass({ cap: { per: 'study-day', count: 2, across: 'this-pass' } }),
      arcade: earlyPass({ privileges: ['arcade'], cap: { per: 'study-day', count: 1, across: 'this-pass' } }),
    };
    const svc = makeService();
    await fundSilver(svc, 20);
    const first = await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    const second = await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    expect([first.pass.passId, second.pass.passId]).toEqual([PASS, `${PASS}.2`]);
    await expect(svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' })).rejects.toMatchObject({ code: 'PASS_CAP' });
    await expect(svc.buyPass(USER, { privilege: 'arcade', coin: 'silver' })).resolves.toMatchObject({ pass: { passId: `${PASS}.3` } });
  });
  it('a cap it cannot read sells nothing', async () => {
    passes = { 'early-pass': earlyPass({ cap: { per: 'week', count: 1, across: 'all-passes' } }) };
    const svc = makeService();
    await fundSilver(svc, 5);
    await expect(svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' })).rejects.toMatchObject({ code: 'PASS_NOT_SOLD' });
  });
  it('a spend that fails after the marker leaves an unpaid pass, never coins gone with no pass', async () => {
    const datastore = ds();
    const append = datastore.appendTransaction.bind(datastore);
    datastore.appendTransaction = async (userId, txn) => {
      if (txn.kind === 'spend') throw Object.assign(new Error('disk full'), { code: 'DISK_FULL' });
      return append(userId, txn);
    };
    const svc = makeService({ datastore });
    await fundSilver(svc, 5);
    await expect(svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' })).rejects.toMatchObject({ code: 'DISK_FULL' });
    expect(ds().readWallet(USER).balances.silver).toBe(5);
    const fresh = makeService();
    expect(await fresh.activePass(USER, { privilege: 'piano.games' })).toMatchObject({ state: 'active', paid: 0 });
    // Refunding an unpaid pass hands back nothing.
    const res = await fresh.refundPass(USER, { passId: PASS, playedMs: 0 });
    expect(res).toMatchObject({ refunded: 0, pass: { state: 'refunded' } });
    expect(ledger().filter((t) => t.kind === 'earn')).toEqual([]);
  });
  it('when the spend and the snapshot both throw, the caller sees the spend error', async () => {
    const logger = quiet();
    const datastore = ds();
    const svc = makeService({ datastore, logger });
    await fundSilver(svc, 5);
    const append = datastore.appendTransaction.bind(datastore);
    datastore.appendTransaction = async (userId, txn) => {
      if (txn.kind === 'spend') throw new Error('disk full');
      return append(userId, txn);
    };
    datastore.writeWallet = () => { throw new Error('wallet unwritable'); };
    await expect(svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' })).rejects.toThrow('disk full');
    expect(logger.error).toHaveBeenCalledWith('economy.pass.snapshot-failed', expect.objectContaining({ ref: PASS }));
  });
});

describe('EconomyService.activePass', () => {
  it('returns today\'s active pass for the privilege, else null', async () => {
    const svc = makeService();
    expect(await svc.activePass(USER, { privilege: 'piano.games' })).toBeNull();
    await fundSilver(svc, 5);
    await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    expect(await svc.activePass(USER, { privilege: 'piano.games' })).toMatchObject({ passId: PASS, state: 'active' });
    expect(await svc.activePass(USER, { privilege: 'arcade' })).toBeNull();
    await svc.consumePass(USER, { passId: PASS, playedMs: 300000 });
    expect(await svc.activePass(USER, { privilege: 'piano.games' })).toBeNull();
  });
  it('expires at the next 4 am: bought at 03:59, gone at 04:01, and a new day sells again', async () => {
    const svc = makeService();
    await fundSilver(svc, 10);
    at('2026-10-21T03:59:00.000Z');
    const bought = await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    expect(bought.pass.studyDay).toBe(DAY);
    expect(await svc.activePass(USER, { privilege: 'piano.games' })).toMatchObject({ passId: PASS });
    at('2026-10-21T04:01:00.000Z');
    expect(await svc.activePass(USER, { privilege: 'piano.games' })).toBeNull();
    await expect(svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' }))
      .resolves.toMatchObject({ pass: { passId: `pass:${USER}:2026-10-21` } });
  });
  it('the 4 am boundary is the household\'s, not UTC\'s', async () => {
    const svc = new EconomyService({
      datastore: ds(), configProjection: new EconomyConfigProjection({ configService }), logger: quiet(),
      clock: () => now, timezone: 'America/Los_Angeles',
    });
    at('2026-10-20T10:59:00.000Z'); // 03:59 PDT
    expect(svc.currentStudyDay()).toBe('2026-10-19');
    at('2026-10-20T11:01:00.000Z'); // 04:01 PDT
    expect(svc.currentStudyDay()).toBe(DAY);
  });
});

describe('EconomyService.consumePass / refundPass', () => {
  const bought = async (svc = makeService()) => {
    await fundSilver(svc, 5);
    await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    return svc;
  };
  const later = (ms) => at(new Date(Date.parse('2026-10-20T15:00:00.000Z') + ms).toISOString());

  it('consume marks it consumed with a new marker entry; a second consume is a no-op', async () => {
    const logger = quiet();
    const svc = await bought(makeService({ logger }));
    const first = await svc.consumePass(USER, { passId: PASS, playedMs: 240000 });
    expect(first).toMatchObject({ duplicate: false, pass: { state: 'consumed', playedMs: 240000 } });
    expect(await svc.consumePass(USER, { passId: PASS, playedMs: 999 })).toMatchObject({ duplicate: true, pass: { state: 'consumed', playedMs: 240000 } });
    const markers = ledger().filter((t) => t.kind === 'pass');
    expect(markers.map((t) => t.ref)).toEqual([PASS, `${PASS}:consumed`]);
    expect(markers[0].meta.state).toBe('active');
    expect(logger.info).toHaveBeenCalledWith('economy.pass.consumed', expect.objectContaining({ learnerId: USER, privilege: 'piano.games', coin: 'silver', price: 3 }));
  });
  it('a refund at 59 s hands the price back; at 61 s it is refused', async () => {
    const svc = await bought();
    later(59000);
    await expect(svc.refundPass(USER, { passId: PASS, playedMs: 61000 })).rejects.toMatchObject({ code: 'PASS_REFUND_CLOSED' });
    const res = await svc.refundPass(USER, { passId: PASS, playedMs: 59000, reason: 'crash' });
    expect(res).toMatchObject({ refunded: 3, duplicate: false, balances: { silver: 5 }, pass: { state: 'refunded', reason: 'crash' } });
    expect(ledger().find((t) => t.kind === 'earn')).toMatchObject({ currency: 'silver', delta: 3, action: 'early-pass-refund', ref: `${PASS}:refund` });
  });
  it('the server bounds the window too: playedMs 0 an hour later is refused', async () => {
    const svc = await bought();
    later(60 * 60_000);
    await expect(svc.refundPass(USER, { passId: PASS, playedMs: 0 })).rejects.toMatchObject({ code: 'PASS_REFUND_CLOSED' });
    expect(ledger().filter((t) => t.kind === 'earn')).toEqual([]);
  });
  it('a pass from an earlier study day cannot be refunded', async () => {
    const svc = await bought();
    at('2026-10-21T04:00:30.000Z');
    await expect(svc.refundPass(USER, { passId: PASS, playedMs: 0 })).rejects.toMatchObject({ code: 'PASS_REFUND_CLOSED' });
  });
  it('a refund twice refunds once', async () => {
    const svc = await bought();
    await svc.refundPass(USER, { passId: PASS, playedMs: 5000 });
    expect(await svc.refundPass(USER, { passId: PASS, playedMs: 5000 })).toMatchObject({ refunded: 0, duplicate: true });
    expect(ledger().filter((t) => t.kind === 'earn')).toHaveLength(1);
    expect((await svc.getBalance(USER)).balances.silver).toBe(5);
  });
  it('a consumed pass cannot be refunded', async () => {
    const svc = await bought();
    await svc.consumePass(USER, { passId: PASS, playedMs: 10000 });
    await expect(svc.refundPass(USER, { passId: PASS, playedMs: 10000 })).rejects.toMatchObject({ code: 'PASS_NOT_ACTIVE' });
    expect(ledger().filter((t) => t.kind === 'earn')).toEqual([]);
  });
  it('a refunded pass cannot be consumed', async () => {
    const svc = await bought();
    await svc.refundPass(USER, { passId: PASS, playedMs: 10000 });
    await expect(svc.consumePass(USER, { passId: PASS, playedMs: 10000 })).rejects.toMatchObject({ code: 'PASS_NOT_ACTIVE' });
    expect(ledger().filter((t) => t.kind === 'pass').map((t) => t.ref)).toEqual([PASS, `${PASS}:refunded`]);
  });
  it.each([['consume first', 0], ['refund first', 1]])('concurrent consume and refund: the first wins (%s)', async (_label, order) => {
    const svc = await bought();
    const calls = [
      () => svc.consumePass(USER, { passId: PASS, playedMs: 10000 }),
      () => makeService().refundPass(USER, { passId: PASS, playedMs: 10000 }),
    ];
    if (order) calls.reverse();
    const [a, b] = await Promise.allSettled(calls.map((c) => c()));
    expect(a.status).toBe('fulfilled');
    expect(b).toMatchObject({ status: 'rejected', reason: { code: 'PASS_NOT_ACTIVE' } });
    const transitions = ledger().filter((t) => t.kind === 'pass' && t.ref !== PASS);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].ref).toBe(order ? `${PASS}:refunded` : `${PASS}:consumed`);
    expect(ledger().filter((t) => t.kind === 'earn')).toHaveLength(order ? 1 : 0);
  });
  it('a refund whose marker failed after the coins landed is finished, not repaid, on retry', async () => {
    const datastore = ds();
    const svc = await bought(makeService({ datastore }));
    const append = datastore.appendTransaction.bind(datastore);
    datastore.appendTransaction = async (userId, txn) => {
      if (txn.kind === 'pass' && txn.ref.endsWith(':refunded')) throw new Error('disk full');
      return append(userId, txn);
    };
    await expect(svc.refundPass(USER, { passId: PASS, playedMs: 1000 })).rejects.toThrow('disk full');
    expect(ds().readWallet(USER).balances.silver).toBe(5);
    const fresh = makeService();
    await expect(fresh.consumePass(USER, { passId: PASS, playedMs: 1000 })).rejects.toMatchObject({ code: 'PASS_NOT_ACTIVE' });
    expect(await fresh.refundPass(USER, { passId: PASS, playedMs: 1000 })).toMatchObject({ refunded: 0, duplicate: true, pass: { state: 'refunded' } });
    expect(ledger().filter((t) => t.kind === 'earn')).toHaveLength(1);
    expect(ledger().filter((t) => t.ref === `${PASS}:refunded`)).toHaveLength(1);
  });
  it('an unknown pass, or another learner\'s, is not found; bad playedMs is bad input', async () => {
    const svc = await bought();
    await expect(svc.consumePass(USER, { passId: `pass:${USER}:2026-10-01`, playedMs: 0 })).rejects.toThrow(EntityNotFoundError);
    await expect(svc.consumePass(USER, { passId: 'nonsense', playedMs: 0 })).rejects.toThrow(EntityNotFoundError);
    await expect(svc.refundPass(OTHER, { passId: PASS, playedMs: 0 })).rejects.toThrow(EntityNotFoundError);
    await expect(svc.refundPass(USER, { passId: PASS, playedMs: -1 })).rejects.toThrow(ValidationError);
    await expect(svc.refundPass(USER, { passId: PASS })).rejects.toThrow(ValidationError);
    await expect(svc.consumePass(USER, { passId: PASS, playedMs: 'long' })).rejects.toThrow(ValidationError);
  });
});
