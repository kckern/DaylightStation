import { describe, expect, it, vi } from 'vitest';
import { HarvesterHealthMonitor } from '#apps/harvester/HarvesterHealthMonitor.mjs';

const memStore = () => { let s = null; return { load: () => s, save: (v) => { s = structuredClone(v); } }; };
const asyncStore = () => { let s = null; const tick = () => new Promise((r) => setTimeout(r, 1));
  return { load: async () => { await tick(); return s && structuredClone(s); }, save: async (v) => { await tick(); s = structuredClone(v); } }; };
const fail = { serviceId: 'withings', result: { status: 'error', reason: 'auth_failed', error: 'invalid refresh_token' }, error: null };
const ok = (latestDate = '2026-10-20') => ({ serviceId: 'withings', result: { status: 'success', count: 1, latestDate }, error: null });

function monitor(over = {}) {
  const sendPush = vi.fn().mockResolvedValue();
  const logger = { warn: vi.fn(), info: vi.fn() };
  const m = new HarvesterHealthMonitor({ store: memStore(), sendPush, now: () => new Date('2026-10-20T19:00:00Z'),
    timezone: 'America/Los_Angeles', failureThreshold: 3, staleAfterDays: { withings: 7 }, skip: ['strava'], logger, ...over });
  return { m, sendPush, logger };
}

describe('HarvesterHealthMonitor', () => {
  it('pushes once when failures reach the threshold', async () => {
    const { m, sendPush } = monitor();
    await m.record(fail); await m.record(fail);
    expect(sendPush).not.toHaveBeenCalled();
    expect(await m.record(fail)).toBe('failing');
    await m.record(fail);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0].title).toMatch(/Withings stopped syncing/);
  });
  it('counts thrown errors as failures', async () => {
    const { m } = monitor();
    const thrown = { serviceId: 'withings', result: null, error: new Error('ETIMEDOUT') };
    await m.record(thrown); await m.record(thrown);
    expect(await m.record(thrown)).toBe('failing');
  });
  it('a success resets the count and pushes recovered after failing', async () => {
    const { m, sendPush } = monitor();
    for (let i = 0; i < 3; i++) await m.record(fail);
    expect(await m.record(ok())).toBe('recovered');
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect((await m.report()).withings).toMatchObject({ status: 'healthy', failures: 0 });
  });
  it('ignores skipped results and skipped services', async () => {
    const { m, sendPush } = monitor();
    for (let i = 0; i < 5; i++) await m.record({ serviceId: 'withings', result: { status: 'skipped', reason: 'cooldown' } });
    for (let i = 0; i < 5; i++) await m.record({ serviceId: 'withings', result: { skipped: true } });
    for (let i = 0; i < 5; i++) await m.record({ ...fail, serviceId: 'strava' });
    expect(sendPush).not.toHaveBeenCalled();
    expect((await m.report()).strava).toBeUndefined();
    expect((await m.report()).withings).toBeUndefined();
  });
  it('flags stale data and recovers when fresh data arrives', async () => {
    const { m } = monitor();
    expect(await m.record(ok('2026-10-01'))).toBe('stale');
    expect(await m.record(ok('2026-10-01'))).toBe(null);
    expect(await m.record(ok('2026-10-19'))).toBe('recovered');
  });
  it('failing then a success with old data goes stale, then recovers on fresh data', async () => {
    const { m, sendPush } = monitor();
    for (let i = 0; i < 3; i++) await m.record(fail);
    expect(await m.record(ok('2026-10-01'))).toBe('stale');
    expect((await m.report()).withings).toMatchObject({ status: 'stale', failures: 0 });
    expect(await m.record(ok('2026-10-19'))).toBe('recovered');
    expect(sendPush).toHaveBeenCalledTimes(3);
  });
  it('a push failure is logged, not thrown', async () => {
    const { m, logger } = monitor({ sendPush: vi.fn().mockRejectedValue(new Error('ha down')) });
    for (let i = 0; i < 2; i++) await m.record(fail);
    await expect(m.record(fail)).resolves.toBe('failing');
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith('harvester.health.push_failed', expect.objectContaining({ serviceId: 'withings' })));
  });
  it('a store failure is logged, not thrown', async () => {
    const sendPush = vi.fn().mockResolvedValue();
    const broken = { load: () => { throw new Error('disk gone'); }, save: () => { throw new Error('disk gone'); } };
    const { m, logger } = monitor({ store: broken, sendPush });
    await expect(m.record(fail)).resolves.toBe(null);
    expect(logger.warn).toHaveBeenCalledWith('harvester.health.store_failed', expect.objectContaining({ serviceId: 'withings' }));
    expect(sendPush).not.toHaveBeenCalled();
  });
  it('a save failure is logged, not thrown, and no push goes out', async () => {
    const sendPush = vi.fn().mockResolvedValue();
    const store = { load: () => null, save: () => { throw new Error('read-only'); } };
    const { m, logger } = monitor({ store, sendPush, failureThreshold: 1 });
    await expect(m.record(fail)).resolves.toBe(null);
    expect(logger.warn).toHaveBeenCalledWith('harvester.health.store_failed', expect.anything());
    expect(sendPush).not.toHaveBeenCalled();
  });
  it('serializes concurrent records against an async store', async () => {
    const { m, sendPush } = monitor({ store: asyncStore() });
    const failA = fail;
    const failB = { ...fail, serviceId: 'fitsync' };
    for (let i = 0; i < 3; i++) await Promise.all([m.record(failA), m.record(failB)]);
    const r = await m.report();
    expect(r.withings).toMatchObject({ status: 'failing', failures: 3 });
    expect(r.fitsync).toMatchObject({ status: 'failing', failures: 3 });
    expect(sendPush).toHaveBeenCalledTimes(2);
  });
  it('stale counts whole local calendar days', async () => {
    const at = (iso) => monitor({ now: () => new Date(iso) }).m;
    expect(await at('2026-10-20T06:00:00Z').record(ok('2026-10-13'))).toBe(null); // Oct 19 local: 6 days
    expect(await at('2026-10-21T08:00:00Z').record(ok('2026-10-13'))).toBe('stale'); // Oct 21 local: 8 days
  });
  it('accepts a timestamp latestDate by its date and ignores unparseable ones', async () => {
    expect(await monitor().m.record(ok('2026-10-01T23:59:00Z'))).toBe('stale');
    expect(await monitor().m.record(ok('last week'))).toBe(null);
  });
  it('a service without staleAfterDays never goes stale', async () => {
    const { m } = monitor();
    expect(await m.record({ serviceId: 'fitsync', result: { status: 'success', latestDate: '2020-01-01' } })).toBe(null);
    expect((await m.report()).fitsync).toMatchObject({ status: 'healthy' });
  });
  it('report() returns {} when the store cannot load', async () => {
    const { m, logger } = monitor({ store: { load: () => { throw new Error('disk gone'); }, save: () => {} } });
    expect(await m.report()).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith('harvester.health.store_failed', expect.anything());
  });
  it('a hung push does not block later records', async () => {
    const sendPush = vi.fn(() => new Promise(() => {}));
    const { m } = monitor({ sendPush });
    for (let i = 0; i < 2; i++) await m.record(fail);
    await expect(m.record(fail)).resolves.toBe('failing');
    await expect(m.record(ok())).resolves.toBe('recovered');
    await m.record({ ...fail, serviceId: 'fitsync' });
    const r = await m.report();
    expect(r.withings).toMatchObject({ status: 'healthy', failures: 0 });
    expect(r.fitsync).toMatchObject({ failures: 1 });
    expect(sendPush).toHaveBeenCalledTimes(2);
  });
  it('exactly staleAfterDays old is not stale yet', async () => {
    const { m } = monitor();
    expect(await m.record(ok('2026-10-13'))).toBe(null);
    expect((await m.report()).withings).toMatchObject({ status: 'healthy' });
  });
  describe('watch', () => {
    const service = () => { const listeners = []; return { listeners, onResult: vi.fn((l) => { listeners.push(l); return () => {}; }) }; };
    it('subscribes to harvest results when this copy owns the data', async () => {
      const { m, sendPush } = monitor();
      const harvesterService = service();
      expect(m.watch(harvesterService, { enabled: true })).toBe(true);
      for (let i = 0; i < 3; i++) harvesterService.listeners[0](fail);
      await vi.waitFor(() => expect(sendPush).toHaveBeenCalledTimes(1));
    });
    it('stays off elsewhere and logs once', () => {
      const { m, logger } = monitor();
      const harvesterService = service();
      expect(m.watch(harvesterService, { enabled: false })).toBe(false);
      expect(harvesterService.onResult).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('harvester.health.disabled_non_production', expect.anything());
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });
});

