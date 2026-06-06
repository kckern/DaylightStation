import { describe, it, expect } from 'vitest';
import { ActivityRegistry } from './ActivityRegistry.mjs';

const fakeGroup = { startTime: 100, endTime: 200, date: '2026-06-05' };

describe('ActivityRegistry', () => {
  it('enriches a group with activities from registered providers (only non-empty)', async () => {
    const reg = new ActivityRegistry()
      .register({ type: 'cycle-game', loadOverlapping: async () => [{ startMs: 110, endMs: 120 }, { startMs: 130, endMs: 140 }] })
      .register({ type: 'jumprope',  loadOverlapping: async () => [] });
    const acts = await reg.enrich(fakeGroup, 'household');
    expect(acts).toEqual([{ type: 'cycle-game', count: 2, items: [{ startMs: 110, endMs: 120 }, { startMs: 130, endMs: 140 }] }]);
  });

  it('returns [] when no providers match', async () => {
    const reg = new ActivityRegistry().register({ type: 'x', loadOverlapping: async () => [] });
    expect(await reg.enrich(fakeGroup, 'h')).toEqual([]);
  });

  it('does NOT enrich a non-cycling Strava activity (a run is not "N races")', async () => {
    const reg = new ActivityRegistry()
      .register({ type: 'cycle-game', loadOverlapping: async () => [{ startMs: 110, endMs: 120 }] });
    const run = { ...fakeGroup, strava: { name: 'Afternoon Run', sportType: 'Run' } };
    expect(await reg.enrich(run, 'h')).toEqual([]); // guarded out before any provider runs
    // a cycling Strava activity is still enriched
    const ride = { ...fakeGroup, strava: { name: 'Zwift', sportType: 'VirtualRide' } };
    expect((await reg.enrich(ride, 'h')).length).toBe(1);
  });
});
