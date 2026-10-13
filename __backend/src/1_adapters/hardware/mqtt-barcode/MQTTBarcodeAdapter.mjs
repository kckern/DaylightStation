/**
 * MQTTBarcodeAdapter - MQTT subscription for barcode scanner events.
 *
 * Subscribes to a barcode MQTT topic, validates incoming messages,
 * parses barcode strings via BarcodePayload, and emits parsed payloads
 * via an onScan callback.
 *
 * @module adapters/hardware/mqtt-barcode
 */

import mqtt from 'mqtt';
import { BarcodePayload } from '#domains/barcode/BarcodePayload.mjs';

const DEFAULTS = {
  RECONNECT_INTERVAL_MS: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
  RECONNECT_BACKOFF_MULTIPLIER: 1.5,
  MAX_RECONNECT_INTERVAL_MS: 60000,
};

export class MQTTBarcodeAdapter {
  #host;
  #port;
  #topic;
  #client;
  #knownActions;
  #knownCommands;
  #reconnectAttempts;
  #reconnectTimeout;
  #isShuttingDown;
  #onScan;
  #logger;

  // Config
  #reconnectIntervalMs;
  #maxReconnectAttempts;
  #reconnectBackoffMultiplier;
  #maxReconnectIntervalMs;

  /**
   * @param {Object} config
   * @param {string} config.host - MQTT broker host
   * @param {number} [config.port=1883] - MQTT broker port
   * @param {string} config.topic - MQTT topic to subscribe to
   * @param {Object} [options]
   * @param {string[]} [options.knownActions] - Valid barcode action names
   * @param {Function} [options.onScan] - Callback for parsed BarcodePayload
   * @param {Object} [options.logger]
   */
  constructor(config, options = {}) {
    let host = config.host || '';
    let port = config.port || 1883;

    if (host) {
      try {
        const url = new URL(host.includes('://') ? host : `mqtt://${host}`);
        host = url.hostname;
        if (url.port && !config.port) port = parseInt(url.port, 10);
      } catch {
        const parts = host.split(':');
        host = parts[0];
        if (parts[1] && !config.port) port = parseInt(parts[1], 10);
      }
    }

    this.#host = host;
    this.#port = port;
    this.#topic = config.topic || 'daylight/scanner/barcode';
    this.#client = null;
    this.#knownActions = options.knownActions || [];
    this.#knownCommands = options.knownCommands || [];
    this.#reconnectAttempts = 0;
    this.#reconnectTimeout = null;
    this.#isShuttingDown = false;
    this.#onScan = options.onScan || null;
    this.#logger = options.logger || console;

    this.#reconnectIntervalMs = config.reconnectIntervalMs || DEFAULTS.RECONNECT_INTERVAL_MS;
    this.#maxReconnectAttempts = config.maxReconnectAttempts || DEFAULTS.MAX_RECONNECT_ATTEMPTS;
    this.#reconnectBackoffMultiplier = config.reconnectBackoffMultiplier || DEFAULTS.RECONNECT_BACKOFF_MULTIPLIER;
    this.#maxReconnectIntervalMs = config.maxReconnectIntervalMs || DEFAULTS.MAX_RECONNECT_INTERVAL_MS;
  }

  isConfigured() {
    return Boolean(this.#host);
  }

  isConnected() {
    return this.#client?.connected || false;
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      connected: this.isConnected(),
      reconnectAttempts: this.#reconnectAttempts,
      topic: this.#topic,
    };
  }

  /**
   * Validate raw MQTT message shape.
   * @param {Object} data
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateMessage(data) {
    const errors = [];
    if (data === null || typeof data !== 'object') {
      return { valid: false, errors: ['Payload must be an object'] };
    }
    if (!data.barcode || typeof data.barcode !== 'string') {
      errors.push('barcode must be a non-empty string');
    }
    if (!data.device || typeof data.device !== 'string') {
      errors.push('device must be a non-empty string');
    }
    if (!data.timestamp || typeof data.timestamp !== 'string') {
      errors.push('timestamp must be a non-empty string');
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Set scan callback.
   * @param {Function} callback
   */
  setScanCallback(callback) {
    this.#onScan = callback;
  }

  /**
   * Initialize and connect to MQTT broker.
   * @returns {boolean}
   */
  init() {
    if (!this.#host) {
      this.#logger.warn?.('barcode.mqtt.notConfigured', { message: 'No mqtt host configured' });
      return false;
    }

    const brokerUrl = `mqtt://${this.#host}:${this.#port}`;
    this.#logger.info?.('barcode.mqtt.initializing', { broker: brokerUrl, topic: this.#topic });

    this.#isShuttingDown = false;
    this.#reconnectAttempts = 0;
    this.#connectToBroker(brokerUrl);

    return true;
  }

  close() {
    this.#isShuttingDown = true;
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }
    if (this.#client) {
      this.#client.end(true);
      this.#client = null;
    }
    this.#logger.info?.('barcode.mqtt.closed');
  }

  // ─── Private ───────────────────────────────────────────

  #connectToBroker(brokerUrl) {
    if (this.#isShuttingDown) return;

    this.#client = mqtt.connect(brokerUrl, {
      reconnectPeriod: 0,
      connectTimeout: 10000,
    });

    this.#client.on('connect', () => {
      this.#logger.info?.('barcode.mqtt.connected', { broker: brokerUrl });
      this.#reconnectAttempts = 0;

      this.#client.subscribe(this.#topic, (err) => {
        if (err) {
          this.#logger.error?.('barcode.mqtt.subscribe.failed', { topic: this.#topic, error: err.message });
        } else {
          this.#logger.info?.('barcode.mqtt.subscribed', { topic: this.#topic });
        }
      });
    });

    this.#client.on('message', (_topic, message) => {
      let data;
      try {
        data = JSON.parse(message.toString());
      } catch (parseErr) {
        this.#logger.warn?.('barcode.mqtt.parseFailed', { error: parseErr.message });
        return;
      }

      const validation = this.validateMessage(data);
      if (!validation.valid) {
        this.#logger.warn?.('barcode.mqtt.validationFailed', { errors: validation.errors });
        return;
      }

      const payload = BarcodePayload.parse(data, this.#knownActions, this.#knownCommands);
      if (!payload) {
        this.#logger.warn?.('barcode.mqtt.invalidBarcode', { barcode: data.barcode });
        return;
      }

      this.#logger.info?.('barcode.mqtt.scan', {
        type: payload.type,
        contentId: payload.contentId,
        command: payload.command,
        action: payload.action,
        options: payload.options,
        targetScreen: payload.targetScreen,
        device: payload.device,
      });

      if (this.#onScan) {
        this.#onScan(payload);
      }
    });

    this.#client.on('error', (err) => {
      this.#logger.error?.('barcode.mqtt.error', { error: err.message, code: err.code });
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        this.#scheduleReconnect(brokerUrl);
      }
    });

    this.#client.on('close', () => {
      if (this.#isShuttingDown) {
        this.#logger.info?.('barcode.mqtt.disconnected.shutdown');
        return;
      }
      this.#logger.warn?.('barcode.mqtt.disconnected.unexpected');
      this.#scheduleReconnect(brokerUrl);
    });

    this.#client.on('offline', () => {
      this.#logger.warn?.('barcode.mqtt.offline');
    });
  }

  #scheduleReconnect(brokerUrl) {
    if (this.#isShuttingDown) return;

    if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      this.#logger.error?.('barcode.mqtt.reconnect.exhausted', {
        attempts: this.#reconnectAttempts,
      });
      return;
    }

    const backoffMs = Math.min(
      this.#reconnectIntervalMs * Math.pow(this.#reconnectBackoffMultiplier, this.#reconnectAttempts),
      this.#maxReconnectIntervalMs
    );
    this.#reconnectAttempts += 1;

    this.#logger.info?.('barcode.mqtt.reconnect.scheduled', {
      attempt: this.#reconnectAttempts,
      backoffMs,
    });

    this.#reconnectTimeout = setTimeout(() => {
      this.#connectToBroker(brokerUrl);
    }, backoffMs);
  }
}
