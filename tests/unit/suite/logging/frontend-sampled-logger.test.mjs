import { jest } from '@jest/globals';

// Mock the shared transport before importing Logger
const mockSend = jest.fn();
jest.unstable_mockModule('@frontend/lib/logging/sharedTransport.js', () => ({
  getSharedWsTransport: () => ({ send: mockSend })
}));

const { getLogger, configure, resetSamplingState } = await import('@frontend/lib/logging/Logger.js');

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
