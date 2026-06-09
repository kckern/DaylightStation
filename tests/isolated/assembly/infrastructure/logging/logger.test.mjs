// tests/unit/infrastructure/logging/logger.test.mjs
import { vi } from 'vitest';
import { createLogger } from '#backend/src/0_system/logging/logger.mjs';
import {
  initializeLogging,
  resetLogging,
  getDispatcher
} from '#backend/src/0_system/logging/dispatcher.mjs';

describe('createLogger', () => {
  beforeEach(() => {
    resetLogging();
  });

  afterEach(() => {
    resetLogging();
  });

  describe('when dispatcher not initialized', () => {
    test('falls back to console output', () => {
      const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => {});
      const logger = createLogger({ app: 'test' });

      logger.info('test.event', { data: 1 });

      expect(stdoutWrite).toHaveBeenCalled();
      stdoutWrite.mockRestore();
    });

    test('writes errors to stderr', () => {
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => {});
      const logger = createLogger({ app: 'test' });

      logger.error('test.error', { data: 1 });

      expect(stderrWrite).toHaveBeenCalled();
      stderrWrite.mockRestore();
    });
  });

  describe('when dispatcher initialized', () => {
    let dispatcher;
    let mockTransport;

    beforeEach(() => {
      dispatcher = initializeLogging({ defaultLevel: 'debug' });
      mockTransport = { name: 'mock', send: vi.fn() };
      dispatcher.addTransport(mockTransport);
    });

    test('dispatches info events', () => {
      const logger = createLogger({ app: 'myApp' });
      logger.info('user.login', { userId: 123 });

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'user.login',
          level: 'info',
          data: { userId: 123 }
        })
      );
    });

    test('dispatches debug events', () => {
      const logger = createLogger({ app: 'myApp' });
      logger.debug('cache.hit', { key: 'x' });

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'cache.hit',
          level: 'debug'
        })
      );
    });

    test('dispatches warn events', () => {
      const logger = createLogger({ app: 'myApp' });
      logger.warn('rate.limit', { remaining: 5 });

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'rate.limit',
          level: 'warn'
        })
      );
    });

    test('dispatches error events', () => {
      const logger = createLogger({ app: 'myApp' });
      logger.error('db.connection.failed', { error: 'timeout' });

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'db.connection.failed',
          level: 'error'
        })
      );
    });

    test('includes context in events', () => {
      const logger = createLogger({
        source: 'backend',
        app: 'myApp',
        context: { version: '1.0.0' }
      });
      logger.info('app.start', {});

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            source: 'backend',
            app: 'myApp',
            version: '1.0.0'
          })
        })
      );
    });

    test('generic log method works', () => {
      const logger = createLogger({ app: 'myApp' });
      logger.log('warn', 'custom.event', { x: 1 });

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'custom.event',
          level: 'warn'
        })
      );
    });
  });

  describe('child logger', () => {
    let dispatcher;
    let mockTransport;

    beforeEach(() => {
      dispatcher = initializeLogging({ defaultLevel: 'debug' });
      mockTransport = { name: 'mock', send: vi.fn() };
      dispatcher.addTransport(mockTransport);
    });

    test('inherits parent context', () => {
      const parent = createLogger({ app: 'myApp', context: { version: '1.0' } });
      const child = parent.child({ requestId: 'abc123' });

      child.info('request.handled', {});

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            app: 'myApp',
            version: '1.0',
            requestId: 'abc123'
          })
        })
      );
    });

    test('child context overrides parent', () => {
      const parent = createLogger({ app: 'myApp', context: { env: 'prod' } });
      const child = parent.child({ env: 'test' });

      child.info('test.event', {});

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            env: 'test'
          })
        })
      );
    });
  });

  describe('sampled logging', () => {
    let dispatcher;
    let mockTransport;

    beforeEach(() => {
      vi.useFakeTimers();
      dispatcher = initializeLogging({ defaultLevel: 'debug' });
      mockTransport = { name: 'mock', send: vi.fn() };
      dispatcher.addTransport(mockTransport);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const sentEvents = () => mockTransport.send.mock.calls.map(([e]) => e);

    test('logs at info level up to maxPerMinute within a window', () => {
      const logger = createLogger({ app: 'test' });

      logger.sampled('scroll.tick', { ms: 5 }, { maxPerMinute: 3 });
      logger.sampled('scroll.tick', { ms: 6 }, { maxPerMinute: 3 });
      logger.sampled('scroll.tick', { ms: 7 }, { maxPerMinute: 3 });

      expect(mockTransport.send).toHaveBeenCalledTimes(3);
      expect(sentEvents()[0]).toMatchObject({ level: 'info', event: 'scroll.tick', data: { ms: 5 } });
    });

    test('drops events over budget within the same window', () => {
      const logger = createLogger({ app: 'test' });

      for (let i = 0; i < 10; i++) {
        logger.sampled('scroll.tick', { ms: i }, { maxPerMinute: 2 });
      }

      expect(mockTransport.send).toHaveBeenCalledTimes(2);
    });

    test('emits an .aggregated summary when a new window opens after skips', () => {
      const logger = createLogger({ app: 'test' });

      logger.sampled('scroll.tick', { ms: 10, route: 'a' }, { maxPerMinute: 1 });
      logger.sampled('scroll.tick', { ms: 20, route: 'a' }, { maxPerMinute: 1 }); // skipped
      logger.sampled('scroll.tick', { ms: 30, route: 'b' }, { maxPerMinute: 1 }); // skipped

      vi.advanceTimersByTime(60_001);
      logger.sampled('scroll.tick', { ms: 40, route: 'c' }, { maxPerMinute: 1 });

      const aggregated = sentEvents().find((e) => e.event === 'scroll.tick.aggregated');
      expect(aggregated).toBeDefined();
      expect(aggregated.data).toEqual({
        sampledCount: 1,
        skippedCount: 2,
        window: '60s',
        aggregated: {
          ms: 50,              // numbers summed across skipped events
          route: { a: 1, b: 1 } // strings counted
        }
      });

      // The new window's first event is also logged
      expect(sentEvents().some((e) => e.event === 'scroll.tick' && e.data.ms === 40)).toBe(true);
    });

    test('does not emit an aggregate when nothing was skipped', () => {
      const logger = createLogger({ app: 'test' });

      logger.sampled('scroll.tick', { ms: 1 }, { maxPerMinute: 5 });
      vi.advanceTimersByTime(60_001);
      logger.sampled('scroll.tick', { ms: 2 }, { maxPerMinute: 5 });

      expect(sentEvents().every((e) => e.event === 'scroll.tick')).toBe(true);
    });

    test('aggregate: false drops over-budget events without a summary', () => {
      const logger = createLogger({ app: 'test' });

      logger.sampled('scroll.tick', { ms: 1 }, { maxPerMinute: 1, aggregate: false });
      logger.sampled('scroll.tick', { ms: 2 }, { maxPerMinute: 1, aggregate: false }); // skipped silently

      vi.advanceTimersByTime(60_001);
      logger.sampled('scroll.tick', { ms: 3 }, { maxPerMinute: 1, aggregate: false });

      expect(sentEvents().filter((e) => e.event.endsWith('.aggregated'))).toHaveLength(0);
      expect(mockTransport.send).toHaveBeenCalledTimes(2);
    });

    test('caps distinct string values at 20 and overflows into __other__', () => {
      const logger = createLogger({ app: 'test' });

      logger.sampled('scroll.tick', { route: 'first' }, { maxPerMinute: 1 });
      for (let i = 1; i <= 23; i++) {
        logger.sampled('scroll.tick', { route: `route-${i}` }, { maxPerMinute: 1 }); // all skipped
      }

      vi.advanceTimersByTime(60_001);
      logger.sampled('scroll.tick', { route: 'next-window' }, { maxPerMinute: 1 });

      const aggregated = sentEvents().find((e) => e.event === 'scroll.tick.aggregated');
      const routeCounts = aggregated.data.aggregated.route;
      // 20 distinct values are tracked individually; the rest spill into __other__
      expect(Object.keys(routeCounts)).toHaveLength(21);
      expect(routeCounts.__other__).toBe(3);
    });

    test('different event names have independent budgets', () => {
      const logger = createLogger({ app: 'test' });

      logger.sampled('event.a', {}, { maxPerMinute: 1 });
      logger.sampled('event.a', {}, { maxPerMinute: 1 }); // skipped
      logger.sampled('event.b', {}, { maxPerMinute: 1 }); // own budget → logged

      expect(mockTransport.send).toHaveBeenCalledTimes(2);
    });

    test('uses defaults of maxPerMinute 20 with aggregation enabled', () => {
      const logger = createLogger({ app: 'test' });

      for (let i = 0; i < 25; i++) {
        logger.sampled('scroll.tick', { ms: 1 });
      }
      expect(mockTransport.send).toHaveBeenCalledTimes(20);

      vi.advanceTimersByTime(60_001);
      logger.sampled('scroll.tick', { ms: 1 });

      const aggregated = sentEvents().find((e) => e.event === 'scroll.tick.aggregated');
      expect(aggregated.data.skippedCount).toBe(5);
    });
  });

  describe('getContext', () => {
    test('returns current context', () => {
      const logger = createLogger({
        source: 'backend',
        app: 'myApp',
        context: { custom: 'value' }
      });

      const ctx = logger.getContext();
      expect(ctx.source).toBe('backend');
      expect(ctx.app).toBe('myApp');
      expect(ctx.custom).toBe('value');
    });
  });
});
