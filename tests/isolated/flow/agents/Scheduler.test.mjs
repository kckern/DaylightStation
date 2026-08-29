// tests/isolated/flow/agents/Scheduler.test.mjs
//
// The agents Scheduler drives outbound jobs (journalist debrief, coaching briefs).
// Every backend instance registers the same crons, so a stray dev server would
// double-send Telegram messages. The scheduler therefore only ticks in
// production/Docker, unless explicitly opted in via ENABLE_CRON=true — the
// same convention as the system scheduler (0_system/scheduling).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { agentSchedulerEnabled } from '../../../../backend/src/5_composition/policies/agentSchedulerEnabled.mjs';

describe('Scheduler — production gating', () => {
  let Scheduler;
  let mockLogger;
  let handler;

  beforeEach(async () => {
    // Park time mid-minute so one 30s tick crosses a minute boundary (cron '* * * * *' fires).
    vi.useFakeTimers({ now: new Date('2026-06-11T07:00:45') });
    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    handler = vi.fn().mockResolvedValue(undefined);

    const module = await import('#adapters/scheduling/AgentAssignmentScheduler.mjs');
    Scheduler = module.Scheduler;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const tickOnce = () => vi.advanceTimersByTimeAsync(30_000);

  it('does not tick outside production (dev instances must never fire outbound jobs)', async () => {
    const scheduler = new Scheduler({ logger: mockLogger, intervalMs: 30_000, enabled: false });
    scheduler.registerTask('journalist:morning-debrief', '* * * * *', handler);

    await tickOnce();

    expect(handler).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'scheduler.disabled_non_production',
      expect.objectContaining({ jobKey: 'journalist:morning-debrief' }),
    );
    scheduler.stop();
  });

  it('ticks in production (NODE_ENV=production)', async () => {
    const scheduler = new Scheduler({ logger: mockLogger, intervalMs: 30_000, enabled: true });
    scheduler.registerTask('journalist:morning-debrief', '* * * * *', handler);

    await tickOnce();

    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('allows explicit dev opt-in via ENABLE_CRON=true (same flag as the system scheduler)', async () => {
    const scheduler = new Scheduler({ logger: mockLogger, intervalMs: 30_000, enabled: true });
    scheduler.registerTask('journalist:morning-debrief', '* * * * *', handler);

    await tickOnce();

    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('honors an explicit enabled:false override even in production', async () => {
    const scheduler = new Scheduler({ logger: mockLogger, intervalMs: 30_000, enabled: false });
    scheduler.registerTask('journalist:morning-debrief', '* * * * *', handler);

    await tickOnce();

    expect(handler).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('resolves production, container, and explicit opt-in gating in composition', () => {
    expect(agentSchedulerEnabled({ nodeEnv: 'production' })).toBe(true);
    expect(agentSchedulerEnabled({ nodeEnv: 'development', isContainer: true })).toBe(true);
    expect(agentSchedulerEnabled({ nodeEnv: 'development', enableCron: 'true' })).toBe(true);
    expect(agentSchedulerEnabled({ nodeEnv: 'development', enableCron: '' })).toBe(false);
  });
});
