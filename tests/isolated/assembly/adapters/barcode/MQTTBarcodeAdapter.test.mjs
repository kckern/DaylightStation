import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { MQTTBarcodeAdapter } from '#adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs';

const KNOWN_ACTIONS = ['queue', 'play', 'open'];

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('MQTTBarcodeAdapter', () => {
  describe('constructor', () => {
    it('reports configured when host is provided', () => {
      const adapter = new MQTTBarcodeAdapter(
        { host: 'mosquitto', port: 1883, topic: 'daylight/scanner/barcode' },
        { knownActions: KNOWN_ACTIONS, logger }
      );
      expect(adapter.isConfigured()).toBe(true);
    });

    it('reports not configured when host is missing', () => {
      const adapter = new MQTTBarcodeAdapter(
        { host: '', topic: 'daylight/scanner/barcode' },
        { knownActions: KNOWN_ACTIONS, logger }
      );
      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('validateMessage', () => {
    let adapter;
    beforeEach(() => {
      adapter = new MQTTBarcodeAdapter(
        { host: 'mosquitto', topic: 'daylight/scanner/barcode' },
        { knownActions: KNOWN_ACTIONS, logger }
      );
    });

    it('accepts a valid barcode message', () => {
      const result = adapter.validateMessage({
        barcode: 'plex:12345',
        timestamp: '2026-03-30T01:00:00Z',
        device: 'scanner-1',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects when barcode is missing', () => {
      const result = adapter.validateMessage({
        timestamp: '2026-03-30T01:00:00Z',
        device: 'scanner-1',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('barcode must be a non-empty string');
    });

    it('rejects when device is missing', () => {
      const result = adapter.validateMessage({
        barcode: 'plex:12345',
        timestamp: '2026-03-30T01:00:00Z',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('device must be a non-empty string');
    });

    it('rejects when timestamp is missing', () => {
      const result = adapter.validateMessage({
        barcode: 'plex:12345',
        device: 'scanner-1',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('timestamp must be a non-empty string');
    });

    it('rejects non-object payloads', () => {
      const result = adapter.validateMessage(null);
      expect(result.valid).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns adapter status', () => {
      const adapter = new MQTTBarcodeAdapter(
        { host: 'mosquitto', topic: 'test/topic' },
        { knownActions: KNOWN_ACTIONS, logger }
      );
      const status = adapter.getStatus();
      expect(status.configured).toBe(true);
      expect(status.connected).toBe(false);
      expect(status.topic).toBe('test/topic');
    });
  });
});
