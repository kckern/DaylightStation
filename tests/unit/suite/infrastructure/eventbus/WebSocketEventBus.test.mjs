// tests/unit/infrastructure/eventbus/WebSocketEventBus.test.mjs
import { jest } from '@jest/globals';
import { WebSocketEventBus } from '#backend/src/0_infrastructure/eventbus/WebSocketEventBus.mjs';

describe('WebSocketEventBus', () => {
  let bus;
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    bus = new WebSocketEventBus({ logger: mockLogger, path: '/ws' });
  });

  afterEach(async () => {
    if (bus.isRunning()) {
      await bus.stop();
    }
  });

  describe('constructor', () => {
    test('creates instance with default path', () => {
      const defaultBus = new WebSocketEventBus();
      expect(defaultBus).toBeDefined();
      expect(defaultBus.isRunning()).toBe(false);
    });

    test('creates instance with custom path', () => {
      expect(bus).toBeDefined();
      expect(bus.isRunning()).toBe(false);
    });
  });

  describe('subscribe (internal)', () => {
    test('adds subscriber for topic', () => {
      bus.subscribe('topic1', () => {});
      expect(bus.getSubscriberCount('topic1')).toBe(1);
    });

    test('supports multiple subscribers per topic', () => {
      bus.subscribe('topic1', () => {});
      bus.subscribe('topic1', () => {});
      expect(bus.getSubscriberCount('topic1')).toBe(2);
    });

    test('returns unsubscribe function', () => {
      const unsubscribe = bus.subscribe('topic1', () => {});
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
      expect(bus.getSubscriberCount('topic1')).toBe(0);
    });
  });

  describe('unsubscribe', () => {
    test('removes subscriber', () => {
      const handler = () => {};
      bus.subscribe('topic1', handler);
      bus.unsubscribe('topic1', handler);
      expect(bus.getSubscriberCount('topic1')).toBe(0);
    });

    test('only removes specific handler', () => {
      const handler1 = () => {};
      const handler2 = () => {};
      bus.subscribe('topic1', handler1);
      bus.subscribe('topic1', handler2);
      bus.unsubscribe('topic1', handler1);
      expect(bus.getSubscriberCount('topic1')).toBe(1);
    });
  });

  describe('publish (internal only)', () => {
    test('calls subscriber with payload', () => {
      const handler = jest.fn();
      bus.subscribe('topic1', handler);
      bus.publish('topic1', { data: 'test' });
      expect(handler).toHaveBeenCalledWith({ data: 'test' }, 'topic1');
    });

    test('calls all subscribers for topic', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      bus.subscribe('topic1', handler1);
      bus.subscribe('topic1', handler2);
      bus.publish('topic1', 'data');
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    test('does not call subscribers for other topics', () => {
      const handler = jest.fn();
      bus.subscribe('topic1', handler);
      bus.publish('topic2', 'data');
      expect(handler).not.toHaveBeenCalled();
    });

    test('continues if handler throws', () => {
      const handler1 = jest.fn(() => { throw new Error('fail'); });
      const handler2 = jest.fn();
      bus.subscribe('topic1', handler1);
      bus.subscribe('topic1', handler2);
      bus.publish('topic1', 'data');
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('getTopics', () => {
    test('returns topics with subscribers', () => {
      bus.subscribe('topic1', () => {});
      bus.subscribe('topic2', () => {});
      expect(bus.getTopics()).toContain('topic1');
      expect(bus.getTopics()).toContain('topic2');
    });

    test('returns empty array when no subscribers', () => {
      expect(bus.getTopics()).toEqual([]);
    });
  });

  describe('getMetrics', () => {
    test('returns metrics object', () => {
      const metrics = bus.getMetrics();
      expect(metrics).toHaveProperty('running');
      expect(metrics).toHaveProperty('uptime');
      expect(metrics).toHaveProperty('clients');
      expect(metrics).toHaveProperty('messages');
      expect(metrics).toHaveProperty('topics');
    });

    test('running is false before start', () => {
      expect(bus.getMetrics().running).toBe(false);
    });
  });

  describe('client count', () => {
    test('returns 0 when no clients connected', () => {
      expect(bus.getClientCount()).toBe(0);
    });
  });

  describe('getClientMeta', () => {
    test('returns null for unknown client', () => {
      expect(bus.getClientMeta('unknown-client-id')).toBeNull();
    });
  });

  describe('event handlers registration', () => {
    test('onClientConnection accepts handler', () => {
      expect(() => bus.onClientConnection(() => {})).not.toThrow();
    });

    test('onClientDisconnection accepts handler', () => {
      expect(() => bus.onClientDisconnection(() => {})).not.toThrow();
    });

    test('onClientMessage accepts handler', () => {
      expect(() => bus.onClientMessage(() => {})).not.toThrow();
    });
  });

  describe('sendToClient', () => {
    test('returns false for unknown client', () => {
      expect(bus.sendToClient('unknown-id', { test: 'message' })).toBe(false);
    });
  });
});
