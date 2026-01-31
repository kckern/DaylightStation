// tests/unit/infrastructure/logging/logger.test.mjs
import { jest } from '@jest/globals';
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
      const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
      const logger = createLogger({ app: 'test' });

      logger.info('test.event', { data: 1 });

      expect(stdoutWrite).toHaveBeenCalled();
      stdoutWrite.mockRestore();
    });

    test('writes errors to stderr', () => {
      const stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
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
      mockTransport = { name: 'mock', send: jest.fn() };
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
      mockTransport = { name: 'mock', send: jest.fn() };
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
