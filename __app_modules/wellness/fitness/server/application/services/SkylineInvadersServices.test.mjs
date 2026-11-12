import { describe, expect, it, vi } from 'vitest';
import { SkylineInvadersRunService } from './SkylineInvadersRunService.mjs';
import { SkylineInvadersProgressService, buildWorldProgress } from './SkylineInvadersProgressService.mjs';

const record = (over = {}, rider = 'test-rider') => ({ schema: 'skyline-invaders-run/v1', run: { id: 'run-1', level_id: 'invaders-1-1', started_at: '2026-11-11T17:00:00.000Z', ended_at: '2026-11-11T17:03:00.000Z', status: 'completed', duration_s: 180, score: 340, kills: 12, stars: 2, ...over }, rider: { user_id: rider } });
const memoryRuns = () => { const rows = new Map(); return { rows, create: async (r) => { rows.set(r.run.id, r); return `${r.run.id}.yml`; }, findById: async (id) => rows.get(id) ?? null, findByDate: async () => [...rows.values()], findAll: async () => [...rows.values()] }; };
const memoryProgress = () => { const rows = new Map(); return { rows, find: async (id) => rows.get(id) ?? null, save: async (id, p) => { rows.set(id, p); } }; };
const world = { levels: [{ id: 'invaders-1-1', name: 'One' }, { id: 'invaders-1-2', name: 'Two' }, { id: 'invaders-1-3', name: 'Three' }] };
const nullLogger = { info() {}, warn() {} };

describe('SkylineInvadersRunService', () => {
  it('saves once, is idempotent by run id, and rejects a different record under the same id', async () => {
    const service = new SkylineInvadersRunService({ datastore: memoryRuns(), logger: nullLogger });
    expect((await service.save(record(), 'home')).created).toBe(true);
    expect((await service.save(record(), 'home')).created).toBe(false);
    await expect(service.save(record({ score: 999 }), 'home')).rejects.toMatchObject({ code: 'RUN_CONFLICT' });
  });
  it.each([[{ status: 'won' }], [{ stars: 4 }], [{ stars: -1 }], [{ stars: 1.5 }], [{ level_id: 'Bad Id' }], [{ id: '../escape' }], [{ started_at: 'never' }], [{ ended_at: 'never' }], [{ score: 'lots' }], [{ duration_s: null }]])('rejects an invalid run %j', async (over) => {
    const service = new SkylineInvadersRunService({ datastore: memoryRuns(), logger: nullLogger });
    await expect(service.save(record(over), 'home')).rejects.toMatchObject({ code: 'INVALID_RUN' });
  });
  it('rejects a record of another schema or without a rider', async () => {
    const service = new SkylineInvadersRunService({ datastore: memoryRuns(), logger: nullLogger });
    await expect(service.save({ ...record(), schema: 'skyline-glider-run/v1' }, 'home')).rejects.toMatchObject({ code: 'INVALID_RUN' });
    await expect(service.save({ ...record(), rider: {} }, 'home')).rejects.toMatchObject({ code: 'INVALID_RUN' });
    await expect(service.save(null, 'home')).rejects.toMatchObject({ code: 'INVALID_RUN' });
  });
  it('accepts failed and abandoned runs but only completed ones reach progress', async () => {
    const progress = { recordRun: vi.fn(async () => null) };
    const service = new SkylineInvadersRunService({ datastore: memoryRuns(), progress, logger: nullLogger });
    await service.save(record({ id: 'run-f', status: 'failed', stars: 0 }), 'home');
    expect(progress.recordRun).toHaveBeenCalledTimes(1); // the progress service filters by status
    expect((await service.save(record({ id: 'run-a', status: 'abandoned', stars: 0 }), 'home')).created).toBe(true);
  });
  it('a failing progress update never fails the save', async () => {
    const logger = { info() {}, warn: vi.fn() };
    const service = new SkylineInvadersRunService({ datastore: memoryRuns(), progress: { recordRun: async () => { throw new Error('disk'); } }, logger });
    expect((await service.save(record(), 'home')).created).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('fitness.skyline_invaders.progress.record_failed', { runId: 'run-1', error: 'disk' });
  });
  it('reads back by id, by date and in full', async () => {
    const service = new SkylineInvadersRunService({ datastore: memoryRuns(), logger: nullLogger });
    await service.save(record(), 'home');
    expect(await service.get('run-1', 'home')).toEqual(record());
    expect(await service.get('missing', 'home')).toBeNull();
    expect(await service.listByDate('2026-11-11', 'home')).toEqual([record()]);
    expect(await service.listAll('home')).toEqual([record()]);
  });
  it('requires a datastore', () => { expect(() => new SkylineInvadersRunService()).toThrow(/datastore/); });
});

describe('SkylineInvadersProgressService', () => {
  const make = () => { const runStore = memoryRuns(); const progressStore = memoryProgress(); return { runStore, progressStore, service: new SkylineInvadersProgressService({ progressStore, runStore, logger: nullLogger }) }; };

  it('opens the first level, then each level after a completed one', () => {
    expect(buildWorldProgress(world)).toMatchObject({ next: 'invaders-1-1', levels: [{ status: 'open' }, { status: 'locked' }, { status: 'locked' }] });
    const progress = { completed: { 'invaders-1-1': { stars: 2, score: 340 } }, unlocked: ['invaders-1-3'] };
    expect(buildWorldProgress(world, progress)).toMatchObject({ next: 'invaders-1-2', levels: [{ status: 'completed', best: { stars: 2, score: 340 } }, { status: 'open' }, { status: 'open' }] });
  });
  it('keeps each level id and name, and has no next when every level is done or the world is empty', () => {
    const done = { completed: Object.fromEntries(world.levels.map(({ id }) => [id, { stars: 1, score: 10 }])) };
    const all = buildWorldProgress(world, done);
    expect(all.next).toBeNull();
    expect(all.levels[1]).toEqual({ id: 'invaders-1-2', name: 'Two', status: 'completed', best: { stars: 1, score: 10 } });
    expect(buildWorldProgress({ levels: [] })).toEqual({ levels: [], next: null });
  });
  it('records a completion and keeps the better of two', async () => {
    const { service } = make();
    await service.recordRun(record(), 'home');
    await service.recordRun(record({ id: 'run-2', stars: 1, score: 900 }), 'home');
    expect((await service.get('test-rider', 'home')).completed['invaders-1-1']).toMatchObject({ stars: 2, run_id: 'run-1' });
    await service.recordRun(record({ id: 'run-3', stars: 3, score: 100 }), 'home');
    expect((await service.get('test-rider', 'home')).completed['invaders-1-1']).toMatchObject({ stars: 3, run_id: 'run-3' });
  });
  it('with equal stars the higher score wins and a tie keeps the first', async () => {
    const { service } = make();
    await service.recordRun(record(), 'home');
    await service.recordRun(record({ id: 'run-tie' }), 'home');
    expect((await service.get('test-rider', 'home')).completed['invaders-1-1'].run_id).toBe('run-1');
    await service.recordRun(record({ id: 'run-more', score: 341 }), 'home');
    expect((await service.get('test-rider', 'home')).completed['invaders-1-1']).toEqual({ at: '2026-11-11T17:03:00.000Z', stars: 2, score: 341, run_id: 'run-more' });
  });
  it('ignores failed and abandoned runs', async () => {
    const { service } = make();
    expect(await service.recordRun(record({ status: 'failed', stars: 0 }), 'home')).toBeNull();
    expect(await service.recordRun(record({ status: 'abandoned', stars: 0 }), 'home')).toBeNull();
  });
  it('rebuilds a missing progress file from the run log', async () => {
    const { service, runStore, progressStore } = make();
    await runStore.create(record());
    await runStore.create(record({ id: 'run-x' }, 'someone-else'));
    await runStore.create(record({ id: 'run-f', level_id: 'invaders-1-2', status: 'failed', stars: 0 }));
    expect(Object.keys((await service.get('test-rider', 'home')).completed)).toEqual(['invaders-1-1']);
    expect(progressStore.rows.has('test-rider')).toBe(true);
  });
  it('builds the world for a rider, and for nobody', async () => {
    const { service } = make();
    await service.recordRun(record(), 'home');
    expect(await service.worldFor(world, 'test-rider', 'home')).toMatchObject({ next: 'invaders-1-2' });
    expect(await service.worldFor(world, null, 'home')).toMatchObject({ next: 'invaders-1-1' });
  });
  it('records an admin unlock once and rejects a bad rider id', async () => {
    const { service } = make();
    const first = await service.unlock('test-rider', 'invaders-1-3', 'admin', 'home');
    expect(first.unlocked).toEqual(['invaders-1-3']);
    expect(first.unlocked_by['invaders-1-3']).toMatchObject({ user_id: 'admin' });
    expect((await service.unlock('test-rider', 'invaders-1-3', 'admin', 'home')).unlocked).toEqual(['invaders-1-3']);
    await expect(service.get('../etc', 'home')).rejects.toMatchObject({ code: 'INVALID_RIDER' });
  });
  it('requires both stores', () => { expect(() => new SkylineInvadersProgressService({ progressStore: memoryProgress() })).toThrow(/progressStore and runStore/); });
});
