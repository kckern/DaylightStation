import { describe, expect, it, vi } from 'vitest';
import { HarvesterHealthMonitor } from '#apps/harvester/HarvesterHealthMonitor.mjs';

const memStore = () => { let s = null; return { load: () => s, save: (v) => { s = structuredClone(v); } }; };
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
    expect(m.report().withings).toMatchObject({ status: 'healthy', failures: 0 });
  });
  it('ignores skipped results and skipped services', async () => {
    const { m, sendPush } = monitor();
    for (let i = 0; i < 5; i++) await m.record({ serviceId: 'withings', result: { status: 'skipped', reason: 'cooldown' } });
    for (let i = 0; i < 5; i++) await m.record({ serviceId: 'withings', result: { skipped: true } });
    for (let i = 0; i < 5; i++) await m.record({ ...fail, serviceId: 'strava' });
    expect(sendPush).not.toHaveBeenCalled();
    expect(m.report().strava).toBeUndefined();
    expect(m.report().withings).toBeUndefined();
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
    expect(m.report().withings).toMatchObject({ status: 'stale', failures: 0 });
    expect(await m.record(ok('2026-10-19'))).toBe('recovered');
    expect(sendPush).toHaveBeenCalledTimes(3);
  });
  it('a push failure is logged, not thrown', async () => {
    const { m, logger } = monitor({ sendPush: vi.fn().mockRejectedValue(new Error('ha down')) });
    for (let i = 0; i < 2; i++) await m.record(fail);
    await expect(m.record(fail)).resolves.toBe('failing');
    expect(logger.warn).toHaveBeenCalledWith('harvester.health.push_failed', expect.objectContaining({ serviceId: 'withings' }));
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
});
