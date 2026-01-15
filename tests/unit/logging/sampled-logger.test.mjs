import { jest } from '@jest/globals';
import { createLogger } from '../../../backend/lib/logging/logger.js';
import { initializeLogging, resetLogging, getDispatcher } from '../../../backend/lib/logging/dispatcher.js';

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
});
