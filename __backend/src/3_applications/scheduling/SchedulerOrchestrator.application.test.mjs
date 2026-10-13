import { describe, expect, it, vi } from 'vitest';
import { SchedulerOrchestrator } from './SchedulerOrchestrator.mjs';

describe('SchedulerOrchestrator application dispatch', () => {
  it('dispatches migrated jobs without loading their obsolete module reference', async () => {
    const applicationExecutor = {
      canHandle: vi.fn().mockReturnValue(true),
      execute: vi.fn().mockResolvedValue({ status: 'success' }),
    };
    const moduleLoader = {
      resolve: vi.fn(),
      load: vi.fn(() => { throw new Error('legacy loader must not run'); }),
    };
    const orchestrator = new SchedulerOrchestrator({
      schedulerService: {},
      timestampCodec: { format: String },
      newExecutionId: () => 'execution-id',
      scheduler: { withDeadline: (work) => work },
      jobStore: {},
      stateStore: {},
      moduleLoader,
      harvesterExecutor: { canHandle: () => false },
      applicationExecutor,
    });
    const job = {
      id: 'budget',
      name: 'Buxfer Budget Sync',
      module: '../lib/budget.mjs',
      timeout: 30_000,
      options: { skipCategorization: true },
    };

    const execution = await orchestrator.executeJob(
      job,
      'execution-id',
      false,
      '2026-08-30T12:00:00.000Z',
    );

    expect(execution.status).toBe('success');
    expect(applicationExecutor.execute).toHaveBeenCalledWith(
      'budget',
      { skipCategorization: true },
      { executionId: 'execution-id' },
    );
    expect(moduleLoader.load).not.toHaveBeenCalled();
  });
});
