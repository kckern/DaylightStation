import { describe, expect, it } from 'vitest';
import { SchedulerOrchestrator } from './SchedulerOrchestrator.mjs';

const job = { id: 'withings', timeout: 1000, options: {} };
const START = '2026-10-20T12:00:00.000Z';

/**
 * Clock that reads START until the work has run, then START + elapsedMs.
 * Proves the end stamp is taken after the work, not before it.
 */
function clockAfterWork(elapsedMs) {
  const state = { ran: false };
  const clock = () => new Date(Date.parse(START) + (state.ran ? elapsedMs : 0));
  return { state, clock };
}

function orchestrator({ execute, withDeadline = (work) => work, elapsedMs = 5000 }) {
  const { state, clock } = clockAfterWork(elapsedMs);
  return new SchedulerOrchestrator({
    schedulerService: {}, timestampCodec: { format: (d) => d.toISOString() },
    newExecutionId: () => 'x', scheduler: { withDeadline: (work, opts) => { state.ran = true; return withDeadline(work, opts); } },
    jobStore: {}, stateStore: {},
    harvesterExecutor: {
      canHandle: () => true,
      execute: async (...args) => { state.ran = true; return execute(...args); },
    },
    clock,
  });
}

describe('SchedulerOrchestrator execution timing', () => {
  it('records a successful run with its real duration', async () => {
    const ex = await orchestrator({ execute: async () => ({ count: 3, status: 'success' }) })
      .executeJob(job, 'x', false, START);
    expect(ex.status).toBe('success');
    expect(ex.startTime).toBe(START);
    expect(ex.endTime).toBe('2026-10-20T12:00:05.000Z');
    expect(ex.durationMs).toBe(5000);
  });

  it('records a thrown failure, timed from start to end', async () => {
    const ex = await orchestrator({
      execute: async () => { throw new Error('auth_failed: invalid refresh_token'); },
      elapsedMs: 2000,
    }).executeJob(job, 'x', false, START);
    expect(ex.status).toBe('failed');
    expect(ex.error).toBe('auth_failed: invalid refresh_token');
    expect(ex.durationMs).toBe(2000);
  });

  it('records a deadline overrun as a timeout, timed from start to end', async () => {
    const ex = await orchestrator({
      execute: async () => ({ count: 0, status: 'success' }),
      withDeadline: () => Promise.reject(new Error('Job timeout after 1000ms')),
      elapsedMs: 1000,
    }).executeJob(job, 'x', false, START);
    expect(ex.status).toBe('timeout');
    expect(ex.durationMs).toBe(1000);
  });

  it('a provider error that mentions timeout is a failure, not a scheduler timeout', async () => {
    const ex = await orchestrator({
      execute: async () => { throw new Error('auth_failed: timeout of 10000ms exceeded'); },
    }).executeJob(job, 'x', false, START);
    expect(ex.status).toBe('failed');
    expect(ex.error).toBe('auth_failed: timeout of 10000ms exceeded');
  });

  it('the scheduler deadline error is a timeout', async () => {
    const ex = await orchestrator({
      execute: async () => ({ count: 0, status: 'success' }),
      withDeadline: (_work, { errorFactory }) => Promise.reject(errorFactory()),
    }).executeJob(job, 'x', false, START);
    expect(ex.status).toBe('timeout');
  });
});

