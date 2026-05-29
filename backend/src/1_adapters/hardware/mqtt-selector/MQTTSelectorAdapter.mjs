/**
 * MQTTSelectorAdapter - MQTT subscription for rider-selector button events.
 *
 * Subscribes to one or more zigbee2mqtt selector topics (e.g. a Tuya 4-button
 * switch), maps the published `action` (e.g. "1_single") to a configured rider
 * claim {equipmentId, userId}, and emits it via an onSelect callback.
 *
 * Mirrors MQTTBarcodeAdapter's connection/reconnect behavior; only the message
 * handling differs (discrete action -> rider claim instead of barcode parse).
 *
 * @module adapters/hardware/mqtt-selector
 */

import mqtt from 'mqtt';

const DEFAULTS = {
  RECONNECT_INTERVAL_MS: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
  RECONNECT_BACKOFF_MULTIPLIER: 1.5,
  MAX_RECONNECT_INTERVAL_MS: 60000,
};

export class MQTTSelectorAdapter {
  #host;
  #port;
  #client;
  #topicMap;          // mqtt_topic -> { selectorId, equipmentId, buttons }
  #reconnectAttempts;
  #reconnectTimeout;
  #isShuttingDown;
  #onSelect;
  #logger;

  #reconnectIntervalMs;
  #maxReconnectAttempts;
  #reconnectBackoffMultiplier;
  #maxReconnectIntervalMs;

  /**
   * @param {Object} config
   * @param {string} config.host - MQTT broker host
   * @param {number} [config.port=1883] - MQTT broker port
   * @param {Object} [options]
   * @param {Array} [options.selectors] - Selector config: [{id, mqtt_topic, equipment, buttons}]
   * @param {Function} [options.onSelect] - Callback({selectorId, equipmentId, userId, action})
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
    this.#client = null;
    this.#topicMap = this.#buildTopicMap(options.selectors || []);
    this.#reconnectAttempts = 0;
    this.#reconnectTimeout = null;
    this.#isShuttingDown = false;
    this.#onSelect = options.onSelect || null;
    this.#logger = options.logger || console;

    this.#reconnectIntervalMs = config.reconnectIntervalMs || DEFAULTS.RECONNECT_INTERVAL_MS;
    this.#maxReconnectAttempts = config.maxReconnectAttempts || DEFAULTS.MAX_RECONNECT_ATTEMPTS;
    this.#reconnectBackoffMultiplier = config.reconnectBackoffMultiplier || DEFAULTS.RECONNECT_BACKOFF_MULTIPLIER;
    this.#maxReconnectIntervalMs = config.maxReconnectIntervalMs || DEFAULTS.MAX_RECONNECT_INTERVAL_MS;
  }

  #buildTopicMap(selectors) {
    const map = new Map();
    if (!Array.isArray(selectors)) return map;
    selectors.forEach((sel) => {
      if (sel?.mqtt_topic && sel.equipment && sel.buttons && typeof sel.buttons === 'object') {
        map.set(sel.mqtt_topic, {
          selectorId: sel.id || sel.equipment,
          equipmentId: sel.equipment,
          buttons: { ...sel.buttons },
        });
      }
    });
    return map;
  }

  isConfigured() {
    return Boolean(this.#host) && this.#topicMap.size > 0;
  }

  isConnected() {
    return this.#client?.connected || false;
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      connected: this.isConnected(),
      reconnectAttempts: this.#reconnectAttempts,
      topics: Array.from(this.#topicMap.keys()),
    };
  }

  /**
   * Pure mapping: resolve an incoming payload on a topic to a rider claim.
   * Returns null for unconfigured topics, missing/unmapped actions, and the
   * empty reset action.
   * @param {string} topic
   * @param {Object} data - Parsed payload (expects a string `action`)
   * @returns {{selectorId:string, equipmentId:string, userId:string, action:string}|null}
   */
  resolveSelection(topic, data) {
    const entry = this.#topicMap.get(topic);
    if (!entry) return null;
    const action = data && typeof data.action === 'string' ? data.action : '';
    if (!action) return null;
    const userId = entry.buttons[action];
    if (!userId) return null;
    return { selectorId: entry.selectorId, equipmentId: entry.equipmentId, userId, action };
  }

  setSelectCallback(callback) {
    this.#onSelect = callback;
  }

  init() {
    if (!this.#host) {
      this.#logger.warn?.('selector.mqtt.notConfigured', { message: 'No mqtt host configured' });
      return false;
    }
    if (this.#topicMap.size === 0) {
      this.#logger.info?.('selector.mqtt.noSelectors', { message: 'No selectors configured' });
      return false;
    }

    const brokerUrl = `mqtt://${this.#host}:${this.#port}`;
    this.#logger.info?.('selector.mqtt.initializing', { broker: brokerUrl, topics: Array.from(this.#topicMap.keys()) });

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
    this.#logger.info?.('selector.mqtt.closed');
  }

  // ─── Private ───────────────────────────────────────────

  #connectToBroker(brokerUrl) {
    if (this.#isShuttingDown) return;

    this.#client = mqtt.connect(brokerUrl, { reconnectPeriod: 0, connectTimeout: 10000 });

    this.#client.on('connect', () => {
      this.#logger.info?.('selector.mqtt.connected', { broker: brokerUrl });
      this.#reconnectAttempts = 0;
      this.#topicMap.forEach((_entry, topic) => {
        this.#client.subscribe(topic, (err) => {
          if (err) {
            this.#logger.error?.('selector.mqtt.subscribe.failed', { topic, error: err.message });
          } else {
            this.#logger.info?.('selector.mqtt.subscribed', { topic });
          }
        });
      });
    });

    this.#client.on('message', (topic, message) => {
      let data;
      try {
        data = JSON.parse(message.toString());
      } catch (parseErr) {
        this.#logger.warn?.('selector.mqtt.parseFailed', { topic, error: parseErr.message });
        return;
      }
      const selection = this.resolveSelection(topic, data);
      if (!selection) return;
      this.#logger.info?.('selector.mqtt.select', selection);
      if (this.#onSelect) this.#onSelect(selection);
    });

    this.#client.on('error', (err) => {
      this.#logger.error?.('selector.mqtt.error', { error: err.message, code: err.code });
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        this.#scheduleReconnect(brokerUrl);
      }
    });

    this.#client.on('close', () => {
      if (this.#isShuttingDown) {
        this.#logger.info?.('selector.mqtt.disconnected.shutdown');
        return;
      }
      this.#logger.warn?.('selector.mqtt.disconnected.unexpected');
      this.#scheduleReconnect(brokerUrl);
    });

    this.#client.on('offline', () => {
      this.#logger.warn?.('selector.mqtt.offline');
    });
  }

  #scheduleReconnect(brokerUrl) {
    if (this.#isShuttingDown) return;
    if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      this.#logger.error?.('selector.mqtt.reconnect.exhausted', { attempts: this.#reconnectAttempts });
      return;
    }
    const backoffMs = Math.min(
      this.#reconnectIntervalMs * Math.pow(this.#reconnectBackoffMultiplier, this.#reconnectAttempts),
      this.#maxReconnectIntervalMs
    );
    this.#reconnectAttempts += 1;
    this.#logger.info?.('selector.mqtt.reconnect.scheduled', { attempt: this.#reconnectAttempts, backoffMs });
    this.#reconnectTimeout = setTimeout(() => this.#connectToBroker(brokerUrl), backoffMs);
  }
}

export default MQTTSelectorAdapter;
