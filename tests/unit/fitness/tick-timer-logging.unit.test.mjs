import { jest } from '@jest/globals';

const mockInfo = jest.fn();
const mockSampled = jest.fn();
jest.unstable_mockModule('../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ info: mockInfo, sampled: mockSampled, error: jest.fn() }),
  getLogger: () => ({ info: mockInfo, sampled: mockSampled, error: jest.fn() })
}));

describe('tick timer logging', () => {
  beforeEach(() => {
    mockInfo.mockClear();
    mockSampled.mockClear();
  });

  test('does not log stopped events for zero-tick short timers', async () => {
    const { FitnessSession } = await import('../../../frontend/src/hooks/fitness/FitnessSession.js');

    const session = new FitnessSession();
    session._tickTimerStartedAt = Date.now();
    session._tickTimerTickCount = 0;
    session._tickTimer = setInterval(() => {}, 5000);

    // Stop after 500ms with 0 ticks
    session._stopTickTimer();

    // Should NOT log stopped event (zero ticks, short duration)
    const stoppedCalls = mockInfo.mock.calls.filter(
      call => call[0] === 'fitness.tick_timer.stopped'
    );
    expect(stoppedCalls).toHaveLength(0);
  });

  test('logs stopped events when ticks occurred', async () => {
    const { FitnessSession } = await import('../../../frontend/src/hooks/fitness/FitnessSession.js');

    const session = new FitnessSession();
    session._tickTimerStartedAt = Date.now() - 10000;
    session._tickTimerTickCount = 2;
    session._tickTimer = setInterval(() => {}, 5000);

    session._stopTickTimer();

    const stoppedCalls = mockInfo.mock.calls.filter(
      call => call[0] === 'fitness.tick_timer.stopped'
    );
    expect(stoppedCalls).toHaveLength(1);
  });

  test('logs stopped events for zero-tick timers that ran >= 2 seconds', async () => {
    const { FitnessSession } = await import('../../../frontend/src/hooks/fitness/FitnessSession.js');

    const session = new FitnessSession();
    session._tickTimerStartedAt = Date.now() - 2500; // 2.5 seconds ago
    session._tickTimerTickCount = 0;
    session._tickTimer = setInterval(() => {}, 5000);

    session._stopTickTimer();

    // Should log because duration >= 2000ms even with zero ticks
    const stoppedCalls = mockInfo.mock.calls.filter(
      call => call[0] === 'fitness.tick_timer.stopped'
    );
    expect(stoppedCalls).toHaveLength(1);
  });

  test('uses sampled logging for timer start events', async () => {
    const { FitnessSession } = await import('../../../frontend/src/hooks/fitness/FitnessSession.js');

    const session = new FitnessSession();
    session.timeline = { timebase: { intervalMs: 5000 } };
    session._tickIntervalMs = 5000;

    session._startTickTimer();

    expect(mockSampled).toHaveBeenCalledWith(
      'fitness.tick_timer.started',
      expect.objectContaining({ intervalMs: 5000 }),
      expect.objectContaining({ maxPerMinute: expect.any(Number) })
    );

    session._stopTickTimer();
  });
});
