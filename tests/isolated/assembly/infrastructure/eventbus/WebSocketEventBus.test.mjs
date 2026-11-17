// tests/unit/infrastructure/eventbus/WebSocketEventBus.test.mjs
import { vi } from 'vitest';
import { WebSocketEventBus, isKnownTopic } from '#adapters/eventbus/WebSocketEventBus.mjs';

import { ClientIngressService } from '#apps/eventbus/ClientIngressService.mjs';
import { EventBusClientIngressAdapter } from '#adapters/eventbus/EventBusClientIngressAdapter.mjs';
import { createDataPathHealth, createFitnessDataBroadcaster } from '../../../../../__app_modules/wellness/fitness/satellites/fitness-controller/src/dataPathHealth.mjs';

describe('WebSocketEventBus', () => {
  let bus;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
      const handler = vi.fn();
      bus.subscribe('topic1', handler);
      bus.publish('topic1', { data: 'test' });
      expect(handler).toHaveBeenCalledWith({ data: 'test' }, 'topic1');
    });

    test('calls all subscribers for topic', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.subscribe('topic1', handler1);
      bus.subscribe('topic1', handler2);
      bus.publish('topic1', 'data');
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    test('does not call subscribers for other topics', () => {
      const handler = vi.fn();
      bus.subscribe('topic1', handler);
      bus.publish('topic2', 'data');
      expect(handler).not.toHaveBeenCalled();
    });

    test('continues if handler throws', () => {
      const handler1 = vi.fn(() => { throw new Error('fail'); });
      const handler2 = vi.fn();
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

test('synthetic source samples and diagnostics survive actual ingress and browser subscription routing', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const bus = new WebSocketEventBus({ logger });
  bus._testSetServerAttached();
  const browserPackets = [];
  let lastPacketAt = 10;
  const ws = { OPEN: 1, readyState: 1, send: (raw) => {
    const packet = JSON.parse(raw);
    browserPackets.push(packet);
    if (packet.topic === 'fitness') lastPacketAt = 20;
  } };
  bus._testSetClientPool(new Map([['browser', { ws, meta: { subscriptions: new Set(['fitness', 'fitness.transport.health']) } }]]));
  const adapter = new EventBusClientIngressAdapter({ eventBus: bus });
  adapter.attach(new ClientIngressService({ publications: adapter, logger }));
  const source = createDataPathHealth({ bootId: 'synthetic-source', now: () => 0 });
  const broadcast = createFitnessDataBroadcaster({ health: source, openState: 1,
    getSocket: () => ({ readyState: 1, send: (raw, done) => { bus._testHandleIncomingMessage('bridge', raw); done(); } }),
  });
  broadcast({ topic: 'fitness', source: 'fitness', type: 'synthetic-sample', data: {} });
  expect(browserPackets[0]).toMatchObject({ topic: 'fitness', bootId: 'synthetic-source', sourceSeq: 1 });
  const beforeHealthPacket = lastPacketAt;
  const health = { topic: 'fitness.transport.health', ...source.snapshot('open') };
  bus._testHandleIncomingMessage('bridge', health);
  expect(browserPackets).toHaveLength(2);
  expect(browserPackets[1]).toMatchObject(health);
  expect(lastPacketAt).toBe(beforeHealthPacket);
  bus._testHandleIncomingMessage('bridge', { ...health, source: 'fitness' });
  expect(browserPackets.filter((packet) => packet.topic === 'fitness')).toHaveLength(1);
  expect(browserPackets.filter((packet) => packet.topic === 'fitness.transport.health')).toHaveLength(2);
  expect(lastPacketAt).toBe(beforeHealthPacket);
  expect(isKnownTopic('fitness.transport.health')).toBe(true);
  bus._testSetClientPool(new Map());
  bus.broadcast('fitness.transport.health', health);
  expect(logger.warn).not.toHaveBeenCalledWith('bus.topic.unknown', expect.anything());
});
