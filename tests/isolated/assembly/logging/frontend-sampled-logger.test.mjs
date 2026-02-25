import { jest } from '@jest/globals';

// Mock the shared transport before importing Logger
const mockSend = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/sharedTransport.js', () => ({
  getSharedWsTransport: () => ({ send: mockSend })
}));

const { getLogger, configure, resetSamplingState } = await import('#frontend/lib/logging/Logger.js');

describe('frontend sampled logging', () => {
  beforeEach(() => {
    mockSend.mockClear();
    resetSamplingState();
    configure({ level: 'debug', consoleEnabled: false, websocketEnabled: true });
  });

  test('logs normally when under rate limit', () => {
    const logger = getLogger();

    for (let i = 0; i < 5; i++) {
      logger.sampled('test.event', { count: i });
    }

    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  test('stops logging after exceeding rate limit', () => {
    const logger = getLogger();

    for (let i = 0; i < 25; i++) {
      logger.sampled('test.event', { count: i }, { maxPerMinute: 20 });
    }

    expect(mockSend).toHaveBeenCalledTimes(20);
  });

  test('child logger sampled() includes child context (sessionLog)', () => {
    const child = getLogger().child({ app: 'fitness', sessionLog: true });

    child.sampled('test.child.event', { value: 42 });

    expect(mockSend).toHaveBeenCalledTimes(2); // session-log.start + sampled event
    const sampledCall = mockSend.mock.calls[1][0];
    expect(sampledCall.event).toBe('test.child.event');
    expect(sampledCall.context.sessionLog).toBe(true);
    expect(sampledCall.context.app).toBe('fitness');
  });

  test('child logger sampled() aggregated event includes child context', () => {
    const child = getLogger().child({ app: 'fitness', sessionLog: true });

    // Fill the rate limit window
    for (let i = 0; i < 25; i++) {
      child.sampled('test.agg.event', { count: 1 }, { maxPerMinute: 20 });
    }

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 61_000);

    child.sampled('test.agg.event', { count: 1 }, { maxPerMinute: 20 });

    jest.useRealTimers();

    // Find the aggregated event
    const aggCall = mockSend.mock.calls.find(c => c[0].event === 'test.agg.event.aggregated');
    expect(aggCall).toBeTruthy();
    expect(aggCall[0].context.sessionLog).toBe(true);
    expect(aggCall[0].context.app).toBe('fitness');
  });

  test('emits aggregate summary when window expires', () => {
    const logger = getLogger();

    for (let i = 0; i < 25; i++) {
      logger.sampled('test.event', { count: 1, topic: 'fitness' }, { maxPerMinute: 20 });
    }

    expect(mockSend).toHaveBeenCalledTimes(20);

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 61_000);

    logger.sampled('test.event', { count: 1, topic: 'fitness' }, { maxPerMinute: 20 });

    jest.useRealTimers();

    // 20 sampled + 1 aggregate + 1 new = 22
    expect(mockSend).toHaveBeenCalledTimes(22);

    const aggregateCall = mockSend.mock.calls[20][0];
    expect(aggregateCall.event).toBe('test.event.aggregated');
    expect(aggregateCall.data.sampledCount).toBe(20);
    expect(aggregateCall.data.skippedCount).toBe(5);
  });
});
