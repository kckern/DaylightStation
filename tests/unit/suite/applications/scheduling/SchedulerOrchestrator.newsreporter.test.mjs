import { describe, it, expect } from '@jest/globals';
import { SchedulerOrchestrator } from '#apps/scheduling/SchedulerOrchestrator.mjs';

/**
 * Newsreporter dispatch in SchedulerOrchestrator.executeJob.
 *
 * Reporter jobs have NO `module` field — if they fell through to the legacy
 * dynamic-import branch they would throw INVALID_MODULE. The newsreporter
 * executor must be checked FIRST, before harvester/media/legacy.
 */

const TIMESTAMP = '2026-06-21T12:00:00.000Z';

const schedulerService = {
  // executeJob only needs JobExecution helpers; no scheduler-service calls here.
};

/** A minimal reporter Job: enabled, generous timeout, NO module. */
const reporterJob = (id = 'world-cup-reporter') => ({
  id,
  name: `newsreporter:${id}`,
  enabled: true,
  timeout: 120000,
  options: {},
});

describe('SchedulerOrchestrator newsreporter dispatch', () => {
  it('dispatches to newsReporterExecutor before harvester/media/legacy', async () => {
    const calls = { news: [], harvester: [] };
    const newsReporterExecutor = {
      canHandle: (id) => id === 'world-cup-reporter',
      execute: async (id, options, ctx) => { calls.news.push({ id, options, ctx }); return { status: 'ok' }; },
    };
    const harvesterExecutor = {
      canHandle: () => true, // would also claim it — proves order matters
      execute: async (id) => { calls.harvester.push(id); },
    };

    const orchestrator = new SchedulerOrchestrator({
      schedulerService,
      jobStore: { loadJobs: async () => [], getJob: async () => null },
      stateStore: { loadStates: async () => new Map() },
      harvesterExecutor,
      newsReporterExecutor,
    });

    const execution = await orchestrator.executeJob(reporterJob(), 'exec-1', false, TIMESTAMP);

    expect(execution.status).toBe('success');
    expect(calls.news).toHaveLength(1);
    expect(calls.news[0].id).toBe('world-cup-reporter');
    expect(calls.harvester).toHaveLength(0); // never reached the harvester branch
  });

  it('falls through to harvester when newsreporter does not own the job', async () => {
    const calls = { news: [], harvester: [] };
    const newsReporterExecutor = {
      canHandle: () => false,
      execute: async (id) => { calls.news.push(id); },
    };
    const harvesterExecutor = {
      canHandle: (id) => id === 'some-harvester',
      execute: async (id) => { calls.harvester.push(id); },
    };

    const orchestrator = new SchedulerOrchestrator({
      schedulerService,
      jobStore: { loadJobs: async () => [], getJob: async () => null },
      stateStore: { loadStates: async () => new Map() },
      harvesterExecutor,
      newsReporterExecutor,
    });

    const execution = await orchestrator.executeJob(reporterJob('some-harvester'), 'exec-2', false, TIMESTAMP);

    expect(execution.status).toBe('success');
    expect(calls.news).toHaveLength(0);
    expect(calls.harvester).toEqual(['some-harvester']);
  });
});
