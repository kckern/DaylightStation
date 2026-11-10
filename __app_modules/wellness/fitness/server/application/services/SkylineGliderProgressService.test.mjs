import { describe, expect, it } from 'vitest';
import { SkylineGliderProgressService, buildWorldProgress } from "./SkylineGliderProgressService.mjs";

const world = { zones: [
  { id: 'alpine', name: 'Alpine', acts: [{ id: 'a1', act: 1 }, { id: 'a2', act: 2 }] },
  { id: 'space', name: 'Space', acts: [{ id: 's1', act: 1 }] },
] };
const run = (id, actId, rider, status = 'completed', bells = 1) => ({
  schema: 'skyline-glider-run/v1',
  run: { id, course_id: actId, status, ended_at: '2026-10-20T17:00:00.000Z' },
  rider: { user_id: rider },
  collectibles: Array.from({ length: bells }, (_, index) => `b${index}`),
});

function harness(runs = []) {
  const files = new Map();
  const progressStore = { find: async (rider) => files.get(rider) ?? null, save: async (rider, value) => { files.set(rider, structuredClone(value)); } };
  const runStore = { findAll: async () => runs };
  return { files, service: new SkylineGliderProgressService({ progressStore, runStore, logger: {} }) };
}

describe('buildWorldProgress', () => {
  it('opens only the first act for a new rider', () => {
    const view = buildWorldProgress(world);
    expect(view.zones.flatMap((zone) => zone.acts.map((act) => act.status))).toEqual(['open', 'locked', 'locked']);
    expect(view.next).toBe('a1');
  });

  it('opens the next zone once the previous zone is finished', () => {
    const view = buildWorldProgress(world, { completed: { a1: { bells: 3 }, a2: { bells: 1 } }, unlocked: [] });
    expect(view.zones[1].acts[0]).toMatchObject({ id: 's1', status: 'open' });
    expect(view.zones[0].acts[0]).toMatchObject({ status: 'completed', best: { bells: 3 } });
    expect(view.next).toBe('s1');
  });

  it('honors an admin unlock without opening the acts after it', () => {
    const view = buildWorldProgress(world, { completed: {}, unlocked: ['a2'] });
    expect(view.zones.flatMap((zone) => zone.acts.map((act) => act.status))).toEqual(['open', 'open', 'locked']);
  });
});

describe('SkylineGliderProgressService', () => {
  it('rebuilds a missing progress file from that rider\'s completed runs and keeps the best bell count', async () => {
    const { service, files } = harness([
      run('r1', 'a1', 'kid', 'completed', 2), run('r2', 'a1', 'kid', 'completed', 5),
      run('r3', 'a2', 'kid', 'abandoned'), run('r4', 'a2', 'dad'),
    ]);
    const progress = await service.get('kid', 'home');
    expect(progress.completed).toEqual({ a1: { at: '2026-10-20T17:00:00.000Z', bells: 5, run_id: 'r2' } });
    expect(files.get('kid')).toEqual(progress);
  });

  it('records a completed run and ignores abandoned ones', async () => {
    const { service, files } = harness();
    await service.recordRun(run('r1', 'a1', 'kid', 'abandoned'), 'home');
    expect(files.has('kid')).toBe(false);
    await service.recordRun(run('r2', 'a1', 'kid'), 'home');
    expect(files.get('kid').completed.a1.run_id).toBe('r2');
  });

  it('records who unlocked an act and rejects unsafe rider ids', async () => {
    const { service } = harness();
    const progress = await service.unlock('kid', 's1', 'dad', 'home');
    expect(progress.unlocked).toEqual(['s1']);
    expect(progress.unlocked_by.s1.user_id).toBe('dad');
    await expect(service.get('../etc', 'home')).rejects.toMatchObject({ code: 'INVALID_RIDER' });
  });
});
