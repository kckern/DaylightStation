// tests/isolated/flow/agents/Scheduler.test.mjs
//
// The agents Scheduler drives outbound jobs (journalist debrief, coaching briefs).
// Every backend instance registers the same crons, so a stray dev server would
// double-send Telegram messages. The scheduler therefore only ticks in
// production/Docker, unless explicitly opted in via ENABLE_CRON=true — the
// same convention as the system scheduler (0_system/scheduling).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Scheduler — production gating', () => {
  let Scheduler;
  let mockLogger;
  let handler;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    // Park time mid-minute so one 30s tick crosses a minute boundary (cron '* * * * *' fires).
    vi.useFakeTimers({ now: new Date('2026-06-11T07:00:45') });
    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    handler = vi.fn().mockResolvedValue(undefined);

    const module = await import('#backend/src/3_applications/agents/framework/Scheduler.mjs');
    Scheduler = module.Scheduler;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const tickOnce = () => vi.advanceTimersByTimeAsync(30_000);

  it('does not tick outside production (dev instances must never fire outbound jobs)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_CRON', '');
    const scheduler = new Scheduler({ logger: mockLogger, intervalMs: 30_000 });
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
    vi.stubEnv('NODE_ENV', 'production');
    const scheduler = new Scheduler({ logger: mockLogger, intervalMs: 30_000 });
    scheduler.registerTask('journalist:morning-debrief', '* * * * *', handler);

    await tickOnce();

    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('allows explicit dev opt-in via ENABLE_CRON=true (same flag as the system scheduler)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_CRON', 'true');
    const scheduler = new Scheduler({ logger: mockLogger, intervalMs: 30_000 });
    scheduler.registerTask('journalist:morning-debrief', '* * * * *', handler);

    await tickOnce();

    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('honors an explicit enabled:false override even in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const scheduler = new Scheduler({ logger: mockLogger, intervalMs: 30_000, enabled: false });
    scheduler.registerTask('journalist:morning-debrief', '* * * * *', handler);

    await tickOnce();

    expect(handler).not.toHaveBeenCalled();
    scheduler.stop();
  });
});
