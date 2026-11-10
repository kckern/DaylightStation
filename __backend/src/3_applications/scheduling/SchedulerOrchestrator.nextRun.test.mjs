import { describe, expect, it, vi } from 'vitest';
import { SchedulerOrchestrator } from './SchedulerOrchestrator.mjs';
import { SchedulerService } from '#domains/scheduling/services/SchedulerService.mjs';
import { JobState } from '#domains/scheduling/entities/JobState.mjs';

const format = (d) => d.toISOString();

function build() {
  const saved = [];
  const logger = { debug: vi.fn() };
  const orchestrator = new SchedulerOrchestrator({
    schedulerService: new SchedulerService({ timezone: 'America/Los_Angeles' }),
    timestampCodec: { format },
    newExecutionId: () => 'execution-id',
    scheduler: { withDeadline: (work) => work },
    jobStore: {},
    stateStore: { saveState: async (id, st) => { saved.push(st.nextRun); } },
    applicationExecutor: { canHandle: () => true, execute: async () => ({ status: 'success' }) },
    logger,
  });
  const job = { id: 'budget', name: 'Budget', schedule: '30 * * * *', timeout: 1000, options: {} };
  return { orchestrator, job, saved, logger };
}

describe('SchedulerOrchestrator next run', () => {
  it('a run that starts before its slot schedules the following slot, not the same one', async () => {
    const { orchestrator, job, saved, logger } = build();
    const state = new JobState({ jobId: 'budget', nextRun: '2026-11-09T07:30:00.000Z' });
    await orchestrator.runJob(job, state, false, new Date('2026-11-09T07:29:59.005Z'));
    expect(saved[0]).toBe(format(new Date('2026-11-09T08:30:00.000Z')));
    expect(logger.debug).toHaveBeenCalledWith('scheduler.job.early_tick', { jobId: 'budget', msEarly: 995 });
  });
  it('a run that overran past its next slot schedules the slot after now', async () => {
    const { orchestrator, job, saved, logger } = build();
    const state = new JobState({ jobId: 'budget', nextRun: '2026-11-09T07:30:00.000Z' });
    await orchestrator.runJob(job, state, false, new Date('2026-11-09T08:31:00.000Z'));
    expect(saved[0]).toBe(format(new Date('2026-11-09T09:30:00.000Z')));
    expect(logger.debug).not.toHaveBeenCalled();
  });
  it('a run starting exactly at its slot schedules the following slot', async () => {
    const { orchestrator, job, saved, logger } = build();
    const state = new JobState({ jobId: 'budget', nextRun: '2026-11-09T07:30:00.000Z' });
    await orchestrator.runJob(job, state, false, new Date('2026-11-09T07:30:00.000Z'));
    expect(saved[0]).toBe(format(new Date('2026-11-09T08:30:00.000Z')));
    expect(logger.debug).not.toHaveBeenCalled();
  });
  it('a manual trigger leaves the schedule anchored on now', async () => {
    const { orchestrator, job, saved } = build();
    const state = new JobState({ jobId: 'budget', nextRun: '2026-11-09T08:30:00.000Z' });
    await orchestrator.runJob(job, state, true, new Date('2026-11-09T07:10:00.000Z'));
    expect(saved[0]).toBe(format(new Date('2026-11-09T07:30:00.000Z')));
  });
});
