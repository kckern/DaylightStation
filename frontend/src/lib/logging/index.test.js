import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import createLogger from './index';

function makeTransport() {
  return { name: 'capture', send: vi.fn() };
}

describe('createLogger — sampled()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes sampled on the logger and on child loggers', () => {
    const logger = createLogger({ transports: [makeTransport()] });
    expect(typeof logger.sampled).toBe('function');
    expect(typeof logger.child({ component: 'x' }).sampled).toBe('function');
  });

  it('emits up to maxPerMinute events, then suppresses within the window', () => {
    const transport = makeTransport();
    const logger = createLogger({ transports: [transport] });
    const eventName = `sampled-budget-${Date.now()}`;
    for (let i = 0; i < 10; i += 1) {
      logger.sampled(eventName, { n: i }, { maxPerMinute: 3 });
    }
    const emitted = transport.send.mock.calls.filter(([evt]) => evt.event === eventName);
    expect(emitted).toHaveLength(3);
  });

  it('flushes an aggregate summary when a new window opens after suppression', () => {
    const transport = makeTransport();
    const logger = createLogger({ transports: [transport] });
    const eventName = `sampled-agg-${Date.now()}`;
    for (let i = 0; i < 5; i += 1) {
      logger.sampled(eventName, { value: 1 }, { maxPerMinute: 2, aggregate: true });
    }
    vi.advanceTimersByTime(61000);
    logger.sampled(eventName, { value: 1 }, { maxPerMinute: 2, aggregate: true });
    const aggregated = transport.send.mock.calls
      .map(([evt]) => evt)
      .find((evt) => evt.event === `${eventName}.aggregated`);
    expect(aggregated).toBeDefined();
    expect(aggregated.data).toMatchObject({ sampledCount: 2, skippedCount: 3, window: '60s' });
  });
});
