import { jest } from '@jest/globals';
import { createLogger } from '#backend/lib/logging/logger.js';
import { initializeLogging, resetLogging, getDispatcher } from '#backend/lib/logging/dispatcher.js';

describe('sampled logging', () => {
  let dispatchSpy;

  beforeEach(() => {
    resetLogging();
    initializeLogging({ defaultLevel: 'debug' });
    dispatchSpy = jest.spyOn(getDispatcher(), 'dispatch');
  });

  afterEach(() => {
    resetLogging();
  });

  test('logs normally when under rate limit', () => {
    const logger = createLogger({ source: 'test', app: 'test' });

    // Log 5 events (under default 20/min limit)
    for (let i = 0; i < 5; i++) {
      logger.sampled('test.event', { count: i });
    }

    expect(dispatchSpy).toHaveBeenCalledTimes(5);
  });

  test('stops logging after exceeding rate limit', () => {
    const logger = createLogger({ source: 'test', app: 'test' });

    // Log 25 events (over 20/min limit)
    for (let i = 0; i < 25; i++) {
      logger.sampled('test.event', { count: i }, { maxPerMinute: 20 });
    }

    // Should only have 20 dispatched (the first 20)
    expect(dispatchSpy).toHaveBeenCalledTimes(20);
  });

  test('emits aggregate summary when window expires', () => {
    const logger = createLogger({ source: 'test', app: 'test' });

    // Log 25 events in first window
    for (let i = 0; i < 25; i++) {
      logger.sampled('test.event', { count: 1, topic: 'fitness' }, { maxPerMinute: 20 });
    }

    // 20 sampled logs
    expect(dispatchSpy).toHaveBeenCalledTimes(20);

    // Simulate window expiry by manipulating time
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 61_000);

    // Log one more to trigger flush
    logger.sampled('test.event', { count: 1, topic: 'fitness' }, { maxPerMinute: 20 });

    jest.useRealTimers();

    // Should have: 20 sampled + 1 aggregate + 1 new = 22
    expect(dispatchSpy).toHaveBeenCalledTimes(22);

    // Check aggregate was emitted
    const aggregateCall = dispatchSpy.mock.calls[20][0];
    expect(aggregateCall.event).toBe('test.event.aggregated');
    expect(aggregateCall.data.sampledCount).toBe(20);
    expect(aggregateCall.data.skippedCount).toBe(5);
    expect(aggregateCall.data.aggregated.count).toBe(5); // sum of skipped
    expect(aggregateCall.data.aggregated.topic.fitness).toBe(5);
  });

  test('caps unique string values at 20', () => {
    const logger = createLogger({ source: 'test', app: 'test' });

    // Log 50 events with different topics (30 over limit)
    for (let i = 0; i < 50; i++) {
      logger.sampled('test.event', { topic: `topic-${i}` }, { maxPerMinute: 20 });
    }

    // Trigger flush
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 61_000);
    logger.sampled('test.event', { topic: 'final' }, { maxPerMinute: 20 });
    jest.useRealTimers();

    const aggregateCall = dispatchSpy.mock.calls[20][0];
    const topicCounts = aggregateCall.data.aggregated.topic;

    // Should have 20 unique topics + __other__
    expect(Object.keys(topicCounts).length).toBeLessThanOrEqual(21);
    expect(topicCounts['__other__']).toBeGreaterThan(0);
  });
});
