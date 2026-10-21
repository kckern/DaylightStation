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

  it('a listener that throws never fails the write', async () => {
    const svc = make({ coinsChanged: () => { throw new Error('bus down'); } });
    await expect(svc.mint(USER, { amount: 2, ref: 'line:1' })).resolves.toMatchObject({ minted: 2 });
  });

  it('with no events port, writes as before', async () => {
    await expect(make(null).mint(USER, { amount: 2, ref: 'line:1' })).resolves.toMatchObject({ minted: 2 });
  });

  it('publishes economy.coins-changed {userId} on the bus (internal publish)', async () => {
    const bus = { publish: vi.fn(), broadcast: vi.fn() };
    await make(new EventBusEconomyEvents({ eventBus: bus })).mint(USER, { amount: 2, ref: 'line:1' });
    expect(COINS_CHANGED_TOPIC).toBe('economy.coins-changed');
    expect(bus.publish).toHaveBeenCalledWith('economy.coins-changed', { userId: USER, reason: 'mint' });
    expect(bus.broadcast).not.toHaveBeenCalled();
  });
});
