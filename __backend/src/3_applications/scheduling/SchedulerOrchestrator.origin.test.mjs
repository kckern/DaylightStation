import { describe, expect, it, vi } from 'vitest';
import { SchedulerOrchestrator } from './SchedulerOrchestrator.mjs';
import { runWithOrigin, currentOrigin } from '#system/runtime/aiContext.mjs';

function orchestrator(extra = {}) {
  const seen = [];
  const applicationExecutor = {
    canHandle: () => true,
    execute: vi.fn(async () => { await new Promise((r) => setTimeout(r, 1)); seen.push(currentOrigin()); }),
  };
  const o = new SchedulerOrchestrator({
    schedulerService: {}, timestampCodec: { format: String }, newExecutionId: () => 'e1',
    scheduler: { withDeadline: (work) => work }, jobStore: {}, stateStore: {},
    harvesterExecutor: { canHandle: () => false }, applicationExecutor, ...extra,
  });
  return { o, seen };
}

const job = { id: 'weekly-review', timeout: 1000, options: {} };

describe('SchedulerOrchestrator job context', () => {
  it('runs the job under the context composition supplies (job:<id>)', async () => {
    const { o, seen } = orchestrator({ runInJobContext: (jobId, work) => runWithOrigin(`job:${jobId}`, work) });
    const execution = await o.executeJob(job, 'e1', false, '2026-09-25T00:00:00Z');
    expect(execution.status).toBe('success');
    expect(seen).toEqual(['job:weekly-review']);
  });

  it('still runs, and still reports failures, without a context hook', async () => {
    const { o, seen } = orchestrator();
    await o.executeJob(job, 'e1', false, '2026-09-25T00:00:00Z');
    expect(seen).toEqual([null]);

    const failing = orchestrator({ runInJobContext: (jobId, work) => runWithOrigin(`job:${jobId}`, work) });
    failing.o.applicationExecutor.execute = async () => { throw new Error('boom'); };
    const execution = await failing.o.executeJob(job, 'e1', false, '2026-09-25T00:00:00Z');
    expect(execution.status).toBe('failed');
  });
});
