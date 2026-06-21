import { describe, it, expect } from '@jest/globals';
import { NewsReporterJobExecutor } from '#apps/newsreporter/NewsReporterJobExecutor.mjs';

const nullLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

describe('NewsReporterJobExecutor', () => {
  it('canHandle is true for a known reporter id and false otherwise', () => {
    const executor = new NewsReporterJobExecutor({
      newsReporterService: { run: async () => ({ status: 'ok' }) },
      reporterIdProvider: () => new Set(['world-cup-reporter']),
      logger: nullLogger,
    });
    expect(executor.canHandle('world-cup-reporter')).toBe(true);
    expect(executor.canHandle('nope')).toBe(false);
  });

  it('re-reads the provider on each canHandle call', () => {
    let ids = new Set(['a']);
    const executor = new NewsReporterJobExecutor({
      newsReporterService: { run: async () => ({}) },
      reporterIdProvider: () => ids,
      logger: nullLogger,
    });
    expect(executor.canHandle('b')).toBe(false);
    ids = new Set(['a', 'b']);
    expect(executor.canHandle('b')).toBe(true);
  });

  it('execute delegates to service.run and returns its result', async () => {
    const calls = [];
    const executor = new NewsReporterJobExecutor({
      newsReporterService: {
        run: async (id) => {
          calls.push(id);
          return { status: 'ok', sourceCounts: { matches: 3 } };
        },
      },
      reporterIdProvider: () => new Set(['world-cup-reporter']),
      logger: nullLogger,
    });
    const result = await executor.execute('world-cup-reporter', {}, { executionId: 'x1' });
    expect(calls).toEqual(['world-cup-reporter']);
    expect(result).toMatchObject({ status: 'ok', sourceCounts: { matches: 3 } });
  });

  it('execute rethrows when service.run throws', async () => {
    const executor = new NewsReporterJobExecutor({
      newsReporterService: { run: async () => { throw new Error('boom'); } },
      reporterIdProvider: () => new Set(['r']),
      logger: nullLogger,
    });
    await expect(executor.execute('r', {}, {})).rejects.toThrow('boom');
  });
});
