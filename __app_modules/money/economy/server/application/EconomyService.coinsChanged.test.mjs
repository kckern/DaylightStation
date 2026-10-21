import os from 'node:os';
import path from 'node:path';
import fs from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YamlEconomyDatastore } from "../adapters/persistence/YamlEconomyDatastore.mjs";
import { EconomyService } from "./EconomyService.mjs";
import { EconomyConfigProjection } from '../adapters/config/EconomyConfigProjection.mjs';
import { EventBusEconomyEvents, COINS_CHANGED_TOPIC } from "../adapters/eventbus/EventBusEconomyEvents.mjs";

// After a write that moved coins or a pass, the economy says so once, so the
// Portal's bank strip can re-read. Nothing changed, nothing said.
const USER = 'test-user';
let USER_DIR;
let now;
const configService = {
  getUserProfile: (id) => (id === USER ? { id } : null),
  getUserDir: (id) => path.join(USER_DIR, id),
  getHouseholdAppConfig: () => ({
    mode: 'live', earn: {},
    passes: { 'early-pass': { privileges: ['piano.games'], price: { silver: 3 }, cap: { per: 'study-day', count: 1, across: 'all-passes' }, authorization: 'trust', refund_within_ms: 60000 } },
  }),
};
const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const make = (events) => new EconomyService({
  datastore: new YamlEconomyDatastore({ configService }),
  configProjection: new EconomyConfigProjection({ configService }),
  logger: quiet(), clock: () => now, events,
});
const recorder = () => { const facts = []; return { facts, coinsChanged: (fact) => facts.push(fact) }; };

beforeEach(() => {
  USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'econ-coins-'));
  now = new Date('2026-10-20T15:00:00.000Z');
});
afterEach(() => { fs.rmSync(USER_DIR, { recursive: true, force: true }); });

describe('EconomyService coins-changed', () => {
  it('says so after a live mint, and not for a duplicate', async () => {
    const events = recorder();
    const svc = make(events);
    await svc.mint(USER, { amount: 2, ref: 'line:1' });
    await svc.mint(USER, { amount: 2, ref: 'line:1' });
    expect(events.facts).toEqual([{ userId: USER, reason: 'mint' }]);
  });

  it('says so after a convert, and not after a dry run', async () => {
    const events = recorder();
    const svc = make(events);
    await svc.mint(USER, { amount: 12, ref: 'line:1' });
    events.facts.length = 0;
    const args = { from: 'silver', to: 'gold', rate: 1, ref: 'close:w1' };
    expect((await svc.convert(USER, { ...args, dryRun: true })).status).toBe('would-convert');
    expect(events.facts).toEqual([]);
    expect((await svc.convert(USER, args)).status).toBe('converted');
    expect(events.facts).toEqual([{ userId: USER, reason: 'convert' }]);
  });

  it('says so after a pass is bought, consumed and refunded, and not after a refusal', async () => {
    const events = recorder();
    const svc = make(events);
    await expect(svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' })).rejects.toMatchObject({ code: 'PASS_UNAFFORDABLE' });
    expect(events.facts).toEqual([]);
    await svc.deposit(USER, { amount: 10 });
    const { pass } = await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    await svc.refundPass(USER, { passId: pass.passId, playedMs: 1000 });
    expect(events.facts.map((f) => f.reason)).toEqual(['deposit', 'pass-bought', 'pass-refunded']);

    now = new Date('2026-10-21T15:00:00.000Z');
    events.facts.length = 0;
    const second = await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    await svc.consumePass(USER, { passId: second.pass.passId });
    await svc.consumePass(USER, { passId: second.pass.passId });
    expect(events.facts.map((f) => f.reason)).toEqual(['pass-bought', 'pass-consumed']);
  });

  it('says so after the per-user lock is released, never inside it', async () => {
    const datastore = new YamlEconomyDatastore({ configService });
    let held = 0;
    const lock = datastore.withUserLock.bind(datastore);
    datastore.withUserLock = (id, fn) => lock(id, async () => { held += 1; try { return await fn(); } finally { held -= 1; } });
    const heldWhenTold = [];
    const svc = new EconomyService({
      datastore, configProjection: new EconomyConfigProjection({ configService }), logger: quiet(), clock: () => now,
      events: { coinsChanged: () => heldWhenTold.push(held) },
    });
    await svc.deposit(USER, { amount: 10 });
    await svc.mint(USER, { amount: 2, ref: 'line:1' });
    const { pass } = await svc.buyPass(USER, { privilege: 'piano.games', coin: 'silver' });
    await svc.consumePass(USER, { passId: pass.passId });
    expect(heldWhenTold).toEqual([0, 0, 0, 0]);
  });

  it('a subscriber that writes the same ledger in reply does not deadlock', async () => {
    let svc;
    let replied = null;
    svc = make({ coinsChanged: ({ reason }) => { if (reason === 'mint') replied = svc.deposit(USER, { amount: 1 }); } });
    await svc.mint(USER, { amount: 2, ref: 'line:1' });
    await expect(replied).resolves.toMatchObject({ balance: 3 });
  });

  it('a listener that throws never fails the write', async () => {
    const svc = make({ coinsChanged: () => { throw new Error('bus down'); } });
    await expect(svc.mint(USER, { amount: 2, ref: 'line:1' })).resolves.toMatchObject({ minted: 2 });
  });

  it('with no events port, writes as before', async () => {
    await expect(make(null).mint(USER, { amount: 2, ref: 'line:1' })).resolves.toMatchObject({ minted: 2 });
  });

  it('a bus with no publish gets nothing (never broadcast), logged once', async () => {
    const bus = { broadcast: vi.fn() };
    const logger = quiet();
    const events = new EventBusEconomyEvents({ eventBus: bus, logger });
    events.coinsChanged({ userId: USER, reason: 'mint' });
    events.coinsChanged({ userId: USER, reason: 'mint' });
    expect(bus.broadcast).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('economy.coins-changed.no-publish', { topic: 'economy.coins-changed' });
  });

  it('publishes economy.coins-changed {userId} on the bus (internal publish)', async () => {
    const bus = { publish: vi.fn(), broadcast: vi.fn() };
    await make(new EventBusEconomyEvents({ eventBus: bus })).mint(USER, { amount: 2, ref: 'line:1' });
    expect(COINS_CHANGED_TOPIC).toBe('economy.coins-changed');
    expect(bus.publish).toHaveBeenCalledWith('economy.coins-changed', { userId: USER, reason: 'mint' });
    expect(bus.broadcast).not.toHaveBeenCalled();
  });
});
