import { describe, expect, it } from 'vitest';
import { SchedulerOrchestrator } from './SchedulerOrchestrator.mjs';

const job = { id: 'withings', timeout: 1000, options: {} };
const START = '2026-10-20T12:00:00.000Z';

function orchestrator(result, end = '2026-10-20T12:00:05.000Z') {
  return new SchedulerOrchestrator({
    schedulerService: {}, timestampCodec: { format: (d) => d.toISOString() },
    newExecutionId: () => 'x', scheduler: { withDeadline: (work) => work },
    jobStore: {}, stateStore: {},
    harvesterExecutor: { canHandle: () => true, execute: async () => result },
    clock: () => new Date(end),
  });
}

describe('SchedulerOrchestrator harvest results', () => {
  it('marks a harvest that returns status error as failed', async () => {
    const ex = await orchestrator({ count: 0, status: 'error', reason: 'auth_failed', error: 'invalid refresh_token' })
      .executeJob(job, 'x', false, START);
    expect(ex.status).toBe('failed');
    expect(ex.error).toBe('auth_failed: invalid refresh_token');
  });
  it('keeps success and skipped harvests as success, with real duration', async () => {
    const ok = await orchestrator({ count: 3, status: 'success' }).executeJob(job, 'x', false, START);
    expect(ok.status).toBe('success');
    expect(ok.durationMs).toBe(5000);
    const skipped = await orchestrator({ count: 0, status: 'skipped', reason: 'cooldown' }).executeJob(job, 'x', false, START);
    expect(skipped.status).toBe('success');
  });
  it('times a thrown failure from start to end', async () => {
    const o = new SchedulerOrchestrator({
      schedulerService: {}, timestampCodec: { format: (d) => d.toISOString() },
      newExecutionId: () => 'x', scheduler: { withDeadline: (work) => work }, jobStore: {}, stateStore: {},
      harvesterExecutor: { canHandle: () => true, execute: async () => { throw new Error('boom'); } },
      clock: () => new Date('2026-10-20T12:00:02.000Z'),
    });
    const ex = await o.executeJob(job, 'x', false, START);
    expect(ex.status).toBe('failed');
    expect(ex.durationMs).toBe(2000);
  });
});
