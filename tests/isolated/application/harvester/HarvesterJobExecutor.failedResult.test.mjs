import { describe, expect, it, vi } from 'vitest';
import { HarvesterJobExecutor } from '#apps/harvester/HarvesterJobExecutor.mjs';

function executorReturning(result) {
  const logger = { info: vi.fn(), error: vi.fn() };
  const executor = new HarvesterJobExecutor({
    harvesterService: { harvest: async () => result },
    logger,
  });
  return { executor, logger };
}

describe('HarvesterJobExecutor harvest results', () => {
  it('rejects when the harvest returns status error', async () => {
    const { executor, logger } = executorReturning({
      count: 0, status: 'error', reason: 'auth_failed', error: 'invalid refresh_token',
    });
    await expect(executor.execute('withings', {}, { executionId: 'x' }))
      .rejects.toThrow('auth_failed: invalid refresh_token');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('harvester.executor.failed', {
      serviceId: 'withings', executionId: 'x', reason: 'auth_failed: invalid refresh_token',
    });
    expect(logger.info).not.toHaveBeenCalledWith('harvester.executor.complete', expect.anything());
  });

  it('resolves with the result for success and skipped harvests', async () => {
    const ok = { count: 3, status: 'success' };
    await expect(executorReturning(ok).executor.execute('withings')).resolves.toBe(ok);
    const skipped = { count: 0, status: 'skipped', reason: 'cooldown' };
    await expect(executorReturning(skipped).executor.execute('withings')).resolves.toBe(skipped);
  });

  it('logs and rethrows a thrown harvest error once', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const executor = new HarvesterJobExecutor({
      harvesterService: { harvest: async () => { throw new Error('boom'); } },
      logger,
    });
    await expect(executor.execute('withings', {}, { executionId: 'x' })).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('harvester.executor.error', {
      serviceId: 'withings', executionId: 'x', error: 'boom',
    });
  });
});
