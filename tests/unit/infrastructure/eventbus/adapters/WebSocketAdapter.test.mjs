// tests/unit/infrastructure/eventbus/adapters/WebSocketAdapter.test.mjs
import { jest } from '@jest/globals';
import { WebSocketAdapter } from '../../../../../backend/src/0_infrastructure/eventbus/adapters/WebSocketAdapter.mjs';

describe('WebSocketAdapter', () => {
  let adapter;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    };
    adapter = new WebSocketAdapter({ logger: mockLogger });
  });

  describe('constructor', () => {
    test('initializes with name "websocket"', () => {
      expect(adapter.name).toBe('websocket');
    });

    test('accepts custom broadcast function', () => {
      const mockFn = jest.fn();
      const adapterWithFn = new WebSocketAdapter({ broadcastFn: mockFn });
      expect(adapterWithFn.broadcastFn).toBe(mockFn);
    });
  });

  describe('setBroadcastFunction', () => {
    test('sets the broadcast function', () => {
      const mockFn = jest.fn();
      adapter.setBroadcastFunction(mockFn);
      expect(adapter.broadcastFn).toBe(mockFn);
    });
  });

  describe('setWebSocketServer', () => {
    test('sets the WebSocket server', () => {
      const mockWss = { clients: new Set() };
      adapter.setWebSocketServer(mockWss);
      expect(adapter.wss).toBe(mockWss);
    });
  });

  describe('broadcast', () => {
    test('logs warning when no server or function configured', () => {
      adapter.broadcast('test-topic', { data: 'test' });
      expect(mockLogger.warn).toHaveBeenCalledWith('websocket-adapter.no_server', { topic: 'test-topic' });
    });

    test('calls broadcastFn with formatted message', () => {
      const mockFn = jest.fn();
      adapter.setBroadcastFunction(mockFn);

      adapter.broadcast('fitness', { revolutions: 100 });

      expect(mockFn).toHaveBeenCalledWith(expect.objectContaining({
        topic: 'fitness',
        revolutions: 100,
        timestamp: expect.any(String)
      }));
    });

    test('broadcasts to WebSocket clients when wss is set', () => {
      const mockClient1 = {
        readyState: 1, // OPEN
        send: jest.fn(),
        _busMeta: { subscriptions: new Set(['*']) }
      };
      const mockClient2 = {
        readyState: 1,
        send: jest.fn(),
        _busMeta: { subscriptions: new Set(['fitness']) }
      };
      const mockWss = {
        clients: new Set([mockClient1, mockClient2])
      };

      adapter.setWebSocketServer(mockWss);
      adapter.broadcast('fitness', { revolutions: 50 });

      expect(mockClient1.send).toHaveBeenCalled();
      expect(mockClient2.send).toHaveBeenCalled();
    });

    test('respects topic subscriptions', () => {
      const mockClient1 = {
        readyState: 1,
        send: jest.fn(),
        _busMeta: { subscriptions: new Set(['fitness']) }
      };
      const mockClient2 = {
        readyState: 1,
        send: jest.fn(),
        _busMeta: { subscriptions: new Set(['midi']) }
      };
      const mockWss = {
        clients: new Set([mockClient1, mockClient2])
      };

      adapter.setWebSocketServer(mockWss);
      adapter.broadcast('fitness', { data: 'test' });

      expect(mockClient1.send).toHaveBeenCalled();
      expect(mockClient2.send).not.toHaveBeenCalled();
    });

    test('skips clients that are not open', () => {
      const mockClient = {
        readyState: 3, // CLOSED
        send: jest.fn(),
        _busMeta: { subscriptions: new Set(['*']) }
      };
      const mockWss = {
        clients: new Set([mockClient])
      };

      adapter.setWebSocketServer(mockWss);
      adapter.broadcast('test', { data: 'test' });

      expect(mockClient.send).not.toHaveBeenCalled();
    });
  });

  describe('getClientCount', () => {
    test('returns 0 when no wss', () => {
      expect(adapter.getClientCount()).toBe(0);
    });

    test('returns client count from wss', () => {
      const mockWss = {
        clients: new Set([{}, {}, {}])
      };
      adapter.setWebSocketServer(mockWss);
      expect(adapter.getClientCount()).toBe(3);
    });
  });
});
