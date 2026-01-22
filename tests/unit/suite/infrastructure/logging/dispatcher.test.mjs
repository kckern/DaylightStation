// tests/unit/infrastructure/logging/dispatcher.test.mjs
import { jest } from '@jest/globals';
import {
  LogDispatcher,
  LEVEL_PRIORITY,
  initializeLogging,
  getDispatcher,
  isLoggingInitialized,
  resetLogging
} from '#backend/src/0_infrastructure/logging/dispatcher.js';

describe('LogDispatcher', () => {
  let dispatcher;

  beforeEach(() => {
    dispatcher = new LogDispatcher({ defaultLevel: 'info' });
  });

  describe('LEVEL_PRIORITY', () => {
    test('defines correct priority ordering', () => {
      expect(LEVEL_PRIORITY.debug).toBe(0);
      expect(LEVEL_PRIORITY.info).toBe(1);
      expect(LEVEL_PRIORITY.warn).toBe(2);
      expect(LEVEL_PRIORITY.error).toBe(3);
    });
  });

  describe('constructor', () => {
    test('initializes with default level', () => {
      const d = new LogDispatcher();
      expect(d.defaultLevel).toBe('info');
    });

    test('accepts custom default level', () => {
      const d = new LogDispatcher({ defaultLevel: 'debug' });
      expect(d.defaultLevel).toBe('debug');
    });

    test('initializes empty transports array', () => {
      expect(dispatcher.transports).toEqual([]);
    });

    test('initializes metrics', () => {
      expect(dispatcher.getMetrics()).toEqual({ sent: 0, dropped: 0, errors: 0 });
    });
  });

  describe('addTransport', () => {
    test('adds valid transport', () => {
      const transport = { name: 'test', send: jest.fn() };
      dispatcher.addTransport(transport);
      expect(dispatcher.getTransportNames()).toContain('test');
    });

    test('throws for transport without name', () => {
      expect(() => dispatcher.addTransport({ send: jest.fn() }))
        .toThrow('Invalid transport');
    });

    test('throws for transport without send function', () => {
      expect(() => dispatcher.addTransport({ name: 'test' }))
        .toThrow('Invalid transport');
    });
  });

  describe('removeTransport', () => {
    test('removes transport by name', () => {
      const transport = { name: 'test', send: jest.fn() };
      dispatcher.addTransport(transport);
      dispatcher.removeTransport('test');
      expect(dispatcher.getTransportNames()).not.toContain('test');
    });
  });

  describe('dispatch', () => {
    test('sends event to all transports', () => {
      const send1 = jest.fn();
      const send2 = jest.fn();
      dispatcher.addTransport({ name: 't1', send: send1 });
      dispatcher.addTransport({ name: 't2', send: send2 });

      dispatcher.dispatch({
        event: 'test.event',
        level: 'info',
        data: { foo: 'bar' }
      });

      expect(send1).toHaveBeenCalled();
      expect(send2).toHaveBeenCalled();
    });

    test('filters events below threshold', () => {
      const send = jest.fn();
      dispatcher.addTransport({ name: 'test', send });

      dispatcher.dispatch({
        event: 'debug.event',
        level: 'debug',
        data: {}
      });

      expect(send).not.toHaveBeenCalled();
      expect(dispatcher.getMetrics().dropped).toBe(1);
    });

    test('drops invalid events', () => {
      const send = jest.fn();
      dispatcher.addTransport({ name: 'test', send });

      dispatcher.dispatch({ data: {} }); // Missing event name

      expect(send).not.toHaveBeenCalled();
    });

    test('increments sent metric', () => {
      dispatcher.addTransport({ name: 'test', send: jest.fn() });
      dispatcher.dispatch({ event: 'test', level: 'info' });
      expect(dispatcher.getMetrics().sent).toBe(1);
    });
  });

  describe('isLevelEnabled', () => {
    test('returns true for levels at or above threshold', () => {
      expect(dispatcher.isLevelEnabled('info')).toBe(true);
      expect(dispatcher.isLevelEnabled('warn')).toBe(true);
      expect(dispatcher.isLevelEnabled('error')).toBe(true);
    });

    test('returns false for levels below threshold', () => {
      expect(dispatcher.isLevelEnabled('debug')).toBe(false);
    });

    test('respects component-level overrides', () => {
      const d = new LogDispatcher({
        defaultLevel: 'info',
        componentLevels: { 'myComponent': 'debug' }
      });
      expect(d.isLevelEnabled('debug', { source: 'myComponent' })).toBe(true);
    });
  });

  describe('validate', () => {
    test('normalizes valid event', () => {
      const result = dispatcher.validate({
        event: 'test.event',
        level: 'info',
        data: { x: 1 }
      });

      expect(result.event).toBe('test.event');
      expect(result.level).toBe('info');
      expect(result.data).toEqual({ x: 1 });
      expect(result.ts).toBeDefined();
    });

    test('returns null for missing event name', () => {
      expect(dispatcher.validate({})).toBeNull();
      expect(dispatcher.validate({ event: 123 })).toBeNull();
    });
  });

  describe('setLevel', () => {
    test('changes default level', () => {
      dispatcher.setLevel('debug');
      expect(dispatcher.defaultLevel).toBe('debug');
    });

    test('ignores invalid levels', () => {
      dispatcher.setLevel('invalid');
      expect(dispatcher.defaultLevel).toBe('info');
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    resetLogging();
  });

  afterEach(() => {
    resetLogging();
  });

  describe('initializeLogging', () => {
    test('creates dispatcher instance', () => {
      const d = initializeLogging();
      expect(d).toBeInstanceOf(LogDispatcher);
    });
  });

  describe('isLoggingInitialized', () => {
    test('returns false before initialization', () => {
      expect(isLoggingInitialized()).toBe(false);
    });

    test('returns true after initialization', () => {
      initializeLogging();
      expect(isLoggingInitialized()).toBe(true);
    });
  });

  describe('getDispatcher', () => {
    test('throws before initialization', () => {
      expect(() => getDispatcher()).toThrow('not initialized');
    });

    test('returns dispatcher after initialization', () => {
      initializeLogging();
      expect(getDispatcher()).toBeInstanceOf(LogDispatcher);
    });
  });

  describe('resetLogging', () => {
    test('clears dispatcher', () => {
      initializeLogging();
      resetLogging();
      expect(isLoggingInitialized()).toBe(false);
    });
  });
});
