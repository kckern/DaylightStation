// tests/unit/infrastructure/eventbus/adapters/MqttAdapter.test.mjs
import { jest } from '@jest/globals';
import { MqttAdapter } from '@backend/src/0_infrastructure/eventbus/adapters/MqttAdapter.mjs';

describe('MqttAdapter', () => {
  let adapter;
  let mockLogger;
  let mockClient;

  beforeEach(() => {
    mockLogger = {
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    };
    mockClient = {
      connected: true,
      publish: jest.fn((topic, message, options, callback) => {
        if (callback) callback(null);
      })
    };
    adapter = new MqttAdapter({ logger: mockLogger });
  });

  describe('constructor', () => {
    test('initializes with name "mqtt"', () => {
      expect(adapter.name).toBe('mqtt');
    });

    test('uses default topic prefix', () => {
      expect(adapter.topicPrefix).toBe('daylight/');
    });

    test('accepts custom topic prefix', () => {
      const customAdapter = new MqttAdapter({ topicPrefix: 'custom/' });
      expect(customAdapter.topicPrefix).toBe('custom/');
    });

    test('uses default QoS of 0', () => {
      expect(adapter.qos).toBe(0);
    });

    test('accepts custom QoS', () => {
      const customAdapter = new MqttAdapter({ qos: 1 });
      expect(customAdapter.qos).toBe(1);
    });
  });

  describe('setClient', () => {
    test('sets the MQTT client', () => {
      adapter.setClient(mockClient);
      expect(adapter.client).toBe(mockClient);
    });
  });

  describe('broadcast', () => {
    test('logs warning when no client configured', () => {
      adapter.broadcast('test-topic', { data: 'test' });
      expect(mockLogger.warn).toHaveBeenCalledWith('mqtt-adapter.no_client', { topic: 'test-topic' });
    });

    test('logs warning when client not connected', () => {
      mockClient.connected = false;
      adapter.setClient(mockClient);
      adapter.broadcast('test-topic', { data: 'test' });
      expect(mockLogger.warn).toHaveBeenCalledWith('mqtt-adapter.not_connected', { topic: 'test-topic' });
    });

    test('publishes to correct MQTT topic with prefix', () => {
      adapter.setClient(mockClient);
      adapter.broadcast('fitness', { revolutions: 100 });

      expect(mockClient.publish).toHaveBeenCalledWith(
        'daylight/fitness',
        expect.any(String),
        expect.objectContaining({ qos: 0, retain: false }),
        expect.any(Function)
      );
    });

    test('includes topic and timestamp in message', () => {
      adapter.setClient(mockClient);
      adapter.broadcast('fitness', { revolutions: 100 });

      const publishedMessage = JSON.parse(mockClient.publish.mock.calls[0][1]);
      expect(publishedMessage.topic).toBe('fitness');
      expect(publishedMessage.revolutions).toBe(100);
      expect(publishedMessage.timestamp).toBeDefined();
    });

    test('logs debug on successful publish', () => {
      adapter.setClient(mockClient);
      adapter.broadcast('test', { data: 'value' });

      expect(mockLogger.debug).toHaveBeenCalledWith('mqtt-adapter.published', expect.objectContaining({
        topic: 'daylight/test'
      }));
    });

    test('logs error on publish failure', () => {
      mockClient.publish = jest.fn((topic, message, options, callback) => {
        callback(new Error('Connection failed'));
      });
      adapter.setClient(mockClient);
      adapter.broadcast('test', { data: 'value' });

      expect(mockLogger.error).toHaveBeenCalledWith('mqtt-adapter.publish_error', expect.objectContaining({
        topic: 'daylight/test',
        error: 'Connection failed'
      }));
    });

    test('uses custom QoS and retain settings', () => {
      const customAdapter = new MqttAdapter({
        qos: 2,
        retain: true,
        logger: mockLogger
      });
      customAdapter.setClient(mockClient);
      customAdapter.broadcast('important', { data: 'test' });

      expect(mockClient.publish).toHaveBeenCalledWith(
        'daylight/important',
        expect.any(String),
        expect.objectContaining({ qos: 2, retain: true }),
        expect.any(Function)
      );
    });
  });

  describe('isConnected', () => {
    test('returns false when no client', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    test('returns client connected status', () => {
      adapter.setClient(mockClient);
      expect(adapter.isConnected()).toBe(true);

      mockClient.connected = false;
      expect(adapter.isConnected()).toBe(false);
    });
  });
});
