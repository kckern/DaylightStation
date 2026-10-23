import { describe, expect, it } from 'vitest';
import { SkylineGliderRunService } from "./SkylineGliderRunService.mjs";

const record = (over = {}) => ({ schema: 'skyline-glider-run/v1', run: { id: 'run-1', course_id: 'mountain-pass', course_version: 1, started_at: '2026-10-06T17:00:00.000Z', ended_at: '2026-10-06T17:05:00.000Z', status: 'completed', duration_s: 300, collisions: 2, restarts: 0, ...over }, rider: { user_id: 'dad' }, collectibles: ['bell-1'] });

function harness() {
  const rows = new Map();
  const datastore = { findById: async (id) => rows.get(id) ?? null, create: async (row) => { rows.set(row.run.id, structuredClone(row)); return `/runs/${row.run.id}.yml`; }, findByDate: async () => [...rows.values()] };
  return { service: new SkylineGliderRunService({ datastore }), rows };
}

describe('SkylineGliderRunService', () => {
  it('creates once and treats identical retries as idempotent', async () => {
    const { service, rows } = harness();
    expect(await service.save(record(), 'home')).toMatchObject({ created: true, record: { run: { id: 'run-1' } } });
    expect(await service.save(record(), 'home')).toMatchObject({ created: false });
    expect(rows.size).toBe(1);
  });

  it('preserves optional fitness identity fields exactly', async () => {
    const { service, rows } = harness();
    const identified = record({ fitness_session_id: 'fs-1', equipment_id: 'niceday', calibration: { low_rpm: 30, high_rpm: 100 } });
    await service.save(identified, 'home');
    expect(rows.get('run-1').run).toMatchObject({ fitness_session_id: 'fs-1', equipment_id: 'niceday', calibration: { low_rpm: 30, high_rpm: 100 } });
  });

  it('conflicts when a reused run id has different content', async () => {
    const { service } = harness();
    await service.save(record(), 'home');
    await expect(service.save(record({ collisions: 3 }), 'home')).rejects.toMatchObject({ code: 'RUN_CONFLICT' });
  });

  it('rejects invalid records before persistence', async () => {
    const { service, rows } = harness();
    await expect(service.save({ run: { id: '../escape' } }, 'home')).rejects.toMatchObject({ code: 'INVALID_RUN' });
    expect(rows.size).toBe(0);
  });
  it('records progress after a save and never fails the save when progress does', async () => {
    const rows = new Map();
    const datastore = { findById: async (id) => rows.get(id) ?? null, create: async (row) => { rows.set(row.run.id, row); return 'f'; } };
    const recorded = [];
    const ok = new SkylineGliderRunService({ datastore, progress: { recordRun: async (row) => { recorded.push(row.run.id); } } });
    await ok.save(record(), 'home');
    expect(recorded).toEqual(['run-1']);
    const warnings = [];
    const failing = new SkylineGliderRunService({ datastore, logger: { info() {}, warn: (event) => warnings.push(event) }, progress: { recordRun: async () => { throw new Error('disk full'); } } });
    await expect(failing.save(record({ id: 'run-2' }), 'home')).resolves.toMatchObject({ created: true });
    expect(warnings).toEqual(['fitness.skyline_glider.progress.record_failed']);
  });
});
