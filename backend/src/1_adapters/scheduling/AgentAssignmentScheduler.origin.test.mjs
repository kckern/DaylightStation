import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scheduler } from './AgentAssignmentScheduler.mjs';
import { currentOrigin } from '#system/runtime/aiContext.mjs';

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('agent Scheduler origin', () => {
  afterEach(() => vi.useRealTimers());

  it('runs a due task under job:<taskKey>', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-11T07:00:45') });
    const seen = [];
    const scheduler = new Scheduler({ logger, intervalMs: 30_000, enabled: true });
    scheduler.registerTask('journalist:morning-debrief', '* * * * *', async () => { await Promise.resolve(); seen.push(currentOrigin()); });
    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.stop();
    expect(seen).toEqual(['job:journalist:morning-debrief']);
  });

  it('runs a manual trigger under job:<agent>:<assignment>', async () => {
    const scheduler = new Scheduler({ logger });
    const orchestrator = { runAssignment: vi.fn(async () => currentOrigin()) };
    await expect(scheduler.trigger('health-coach:morning-brief', orchestrator)).resolves.toBe('job:health-coach:morning-brief');
    expect(currentOrigin()).toBeNull();
  });
});
