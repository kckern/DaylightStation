import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StravaSyncHealth } from '#apps/fitness/StravaSyncHealth.mjs';

const HOUR = 3600_000;

describe('StravaSyncHealth', () => {
  let clock; let saved; let store; let sendPush; let jobs; let health;
  const make = () => new StravaSyncHealth({
    store, sendPush, hasWebhookJob: (id) => jobs.has(id), now: () => new Date(clock), timezone: 'America/Los_Angeles',
    logger: { info: vi.fn(), warn: vi.fn() },
  });
  beforeEach(() => {
    clock = Date.parse('2026-09-22T12:00:00Z');
    saved = null;
    store = { load: () => saved, save: (s) => { saved = JSON.parse(JSON.stringify(s)); } };
    sendPush = vi.fn().mockResolvedValue(undefined);
    jobs = new Set();
    health = make();
  });
  const tags = () => sendPush.mock.calls.map(([p]) => `${p.data.tag}:${p.title.startsWith('✅') ? 'ok' : 'stale'}`);

  it('stays quiet while every stage keeps succeeding', async () => {
    health.recordHarvest({ ok: true });
    health.recordSweep({ ok: true });
    clock += 2 * HOUR;
    await health.evaluate();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('pushes once when the sweep fails three times in a row, once more on recovery', async () => {
    health.recordHarvest({ ok: true });
    for (let i = 0; i < 3; i++) health.recordSweep({ ok: false, error: 'Request failed with status code 401' });
    await health.evaluate();
    await health.evaluate();
    expect(tags()).toEqual(['strava-sync-sweep:stale']);
    expect(sendPush.mock.calls[0][0].message).toContain('Strava sign-in expired');
    health.recordSweep({ ok: true });
    await health.evaluate();
    expect(tags()).toEqual(['strava-sync-sweep:stale', 'strava-sync-sweep:ok']);
  });

  it('flags a harvest with no success for more than 3 hours, even across a restart', async () => {
    health.recordHarvest({ ok: true });
    health.recordSweep({ ok: true });
    clock += 2 * HOUR;
    health = make(); // restart: state comes back from the store
    health.recordSweep({ ok: true });
    clock += 2 * HOUR;
    await health.evaluate();
    expect(tags()).toEqual(['strava-sync-harvest:stale']);
  });

  it('reports an activity the harvester saw an hour ago with no webhook job', async () => {
    const acts = [{ id: 20245291061, name: 'Spartan Sprint', startDate: '2026-09-22T09:00:00Z' }];
    health.recordHarvest({ ok: true, activities: acts });
    health.recordSweep({ ok: true });
    clock += 30 * 60_000;
    await health.evaluate();
    expect(sendPush).not.toHaveBeenCalled(); // inside the grace period
    clock += 40 * 60_000;
    health.recordHarvest({ ok: true, activities: acts });
    health.recordSweep({ ok: true });
    await health.evaluate();
    expect(tags()).toEqual(['strava-sync-webhook:stale']);
    expect(sendPush.mock.calls[0][0].message).toContain('“Spartan Sprint”');
    jobs.add('20245291061');
    await health.evaluate();
    expect(tags()).toEqual(['strava-sync-webhook:stale', 'strava-sync-webhook:ok']);
  });

  it('ignores activities too old to have had a webhook through this monitor', async () => {
    health.recordHarvest({ ok: true, activities: [{ id: 1, name: 'Old', startDate: '2026-09-10T09:00:00Z' }] });
    health.recordSweep({ ok: true });
    clock += 2 * HOUR;
    health.recordHarvest({ ok: true }); health.recordSweep({ ok: true });
    await health.evaluate();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('alerts when a Strava session stays flagged for a day, and keeps its first-seen time', async () => {
    const tick = (hours) => { clock += hours * HOUR; health.recordHarvest({ ok: true }); health.recordSweep({ ok: true, flagged: ['20260806110558'] }); };
    tick(0);
    tick(12);
    await health.evaluate();
    expect(sendPush).not.toHaveBeenCalled();
    tick(13);
    await health.evaluate();
    expect(tags()).toEqual(['strava-sync-integrity:stale']);
  });

  it('a failed sweep does not wipe the flagged list', () => {
    health.recordSweep({ ok: true, flagged: ['a'] });
    health.recordSweep({ ok: false, error: 'x' });
    expect(health.report().stages.integrity.flagged).toEqual(['a']);
  });

  it('counts dropped webhook types for the report', () => {
    health.recordDropped('activity/delete');
    health.recordDropped('activity/delete');
    expect(health.report().dropped).toEqual({ 'activity/delete': 2 });
  });

  it('a push failure is logged, not thrown, and not retried every tick', async () => {
    sendPush.mockRejectedValue(new Error('ha down'));
    for (let i = 0; i < 3; i++) health.recordSweep({ ok: false });
    health.recordHarvest({ ok: true });
    await expect(health.evaluate()).resolves.toBeTruthy();
    await health.evaluate();
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});
