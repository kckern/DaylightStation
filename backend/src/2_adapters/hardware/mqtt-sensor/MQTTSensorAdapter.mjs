/**
 * MQTTSensorAdapter - MQTT sensor subscription and monitoring
 *
 * Provides MQTT broker connection for vibration sensors.
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Sensor payload validation
 * - Topic-based equipment mapping
 * - Throttled message broadcast
 * - Graceful shutdown
 *
 * @module adapters/hardware/mqtt-sensor
 */

import mqtt from 'mqtt';

/**
 * @typedef {Object} MQTTConfig
 * @property {string} host - MQTT broker host
 * @property {number} [port=1883] - MQTT broker port
 * @property {number} [reconnectIntervalMs=5000] - Initial reconnect interval
 * @property {number} [maxReconnectAttempts=10] - Max reconnect attempts
 * @property {number} [reconnectBackoffMultiplier=1.5] - Backoff multiplier
 * @property {number} [maxReconnectIntervalMs=60000] - Max reconnect interval
 * @property {number} [broadcastThrottleMs=50] - Throttle interval for broadcasts
 */

/**
 * @typedef {Object} Equipment
 * @property {string} id - Equipment identifier
 * @property {string} name - Equipment name
 * @property {string} type - Equipment type
 * @property {Object} [sensor] - Sensor configuration
 * @property {string} [sensor.type] - Sensor type (e.g., 'vibration')
 * @property {string} [sensor.mqtt_topic] - MQTT topic for this sensor
 * @property {Object} [thresholds] - Alert thresholds {low, medium, high}
 */

/**
 * @typedef {Object} VibrationPayload
 * @property {boolean} vibration - Vibration detected flag
 * @property {number} [x_axis] - X-axis acceleration
 * @property {number} [y_axis] - Y-axis acceleration
 * @property {number} [z_axis] - Z-axis acceleration
 * @property {number} [battery] - Battery percentage (0-100)
 * @property {boolean} [battery_low] - Low battery flag
 * @property {number} [linkquality] - Signal quality
 */

// Default constants
const DEFAULTS = {
  RECONNECT_INTERVAL_MS: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
  RECONNECT_BACKOFF_MULTIPLIER: 1.5,
  MAX_RECONNECT_INTERVAL_MS: 60000,
  BROADCAST_THROTTLE_MS: 50
};

export class MQTTSensorAdapter {
  #host;
  #port;
  #client;
  #sensorTopicMap;
  #reconnectAttempts;
  #reconnectTimeout;
  #isShuttingDown;
  #lastBroadcastTime;
  #onMessage;
  #logger;

  // Config
  #reconnectIntervalMs;
  #maxReconnectAttempts;
  #reconnectBackoffMultiplier;
  #maxReconnectIntervalMs;
  #broadcastThrottleMs;

  /**
   * @param {MQTTConfig} config
   * @param {Object} [options]
   * @param {Function} [options.onMessage] - Callback for validated messages
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#host = config.host;
    this.#port = config.port || 1883;
    this.#client = null;
    this.#sensorTopicMap = new Map();
    this.#reconnectAttempts = 0;
    this.#reconnectTimeout = null;
    this.#isShuttingDown = false;
    this.#lastBroadcastTime = new Map();
    this.#onMessage = options.onMessage;
    this.#logger = options.logger || console;

    // Config with defaults
    this.#reconnectIntervalMs = config.reconnectIntervalMs || DEFAULTS.RECONNECT_INTERVAL_MS;
    this.#maxReconnectAttempts = config.maxReconnectAttempts || DEFAULTS.MAX_RECONNECT_ATTEMPTS;
    this.#reconnectBackoffMultiplier = config.reconnectBackoffMultiplier || DEFAULTS.RECONNECT_BACKOFF_MULTIPLIER;
    this.#maxReconnectIntervalMs = config.maxReconnectIntervalMs || DEFAULTS.MAX_RECONNECT_INTERVAL_MS;
    this.#broadcastThrottleMs = config.broadcastThrottleMs || DEFAULTS.BROADCAST_THROTTLE_MS;
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.#host);
  }

  /**
   * Check if connected to broker
   * @returns {boolean}
   */
  isConnected() {
    return this.#client?.connected || false;
  }

  /**
   * Get adapter status
   * @returns {Object}
   */
  getStatus() {
    return {
      configured: this.isConfigured(),
      connected: this.isConnected(),
      reconnectAttempts: this.#reconnectAttempts,
      sensorCount: this.#sensorTopicMap.size,
      topics: Array.from(this.#sensorTopicMap.keys())
    };
  }

  /**
   * Initialize and connect to MQTT broker
   * @param {Equipment[]} equipment - Array of equipment with sensor configs
   * @returns {boolean} - True if initialized successfully
   */
  init(equipment = []) {
    if (!this.#host) {
      this.#logger.warn?.('mqtt.notConfigured', { message: 'No mqtt.host configured' });
      return false;
    }

    this.#sensorTopicMap = this.#buildSensorTopicMap(equipment);

    if (this.#sensorTopicMap.size === 0) {
      this.#logger.info?.('mqtt.noSensors', { message: 'No vibration sensors configured' });
      return false;
    }

    const brokerUrl = `mqtt://${this.#host}:${this.#port}`;
    this.#logger.info?.('mqtt.initializing', {
      broker: brokerUrl,
      sensorCount: this.#sensorTopicMap.size
    });

    this.#isShuttingDown = false;
    this.#reconnectAttempts = 0;
    this.#connectToBroker(brokerUrl);

    return true;
  }

  /**
   * Close MQTT connection
   */
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

    this.#lastBroadcastTime.clear();
    this.#logger.info?.('mqtt.closed');
  }

  /**
   * Validate vibration sensor payload
   * @param {Object} data - Raw payload data
   * @returns {{valid: boolean, errors: string[]}}
   */
  validatePayload(data) {
    const errors = [];

    if (data === null || typeof data !== 'object') {
      return { valid: false, errors: ['Payload must be an object'] };
    }

    if (typeof data.vibration !== 'boolean') {
      errors.push('vibration must be a boolean');
    }

    const numericFields = ['x_axis', 'y_axis', 'z_axis', 'battery', 'voltage', 'linkquality'];
    numericFields.forEach((field) => {
      if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'number') {
        errors.push(`${field} must be a number if provided`);
      }
    });

    if (typeof data.battery === 'number' && (data.battery < 0 || data.battery > 100)) {
      errors.push('battery must be between 0 and 100');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Set message callback
   * @param {Function} callback - Function to call with validated messages
   */
  setMessageCallback(callback) {
    this.#onMessage = callback;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  #buildSensorTopicMap(equipment = []) {
    const map = new Map();

    if (!Array.isArray(equipment)) {
      this.#logger.warn?.('mqtt.invalidEquipment', { message: 'Equipment must be an array' });
      return map;
    }

    equipment.forEach((equip) => {
      if (equip?.sensor?.type === 'vibration' && equip.sensor.mqtt_topic) {
        map.set(equip.sensor.mqtt_topic, {
          id: equip.id,
          name: equip.name,
          type: equip.type,
          thresholds: equip.thresholds || { low: 5, medium: 15, high: 30 }
        });
      }
    });

    return map;
  }

  #shouldThrottle(topic) {
    const now = Date.now();
    const lastTime = this.#lastBroadcastTime.get(topic) || 0;
    if (now - lastTime < this.#broadcastThrottleMs) {
      return true;
    }
    this.#lastBroadcastTime.set(topic, now);
    return false;
  }

  #scheduleReconnect(brokerUrl) {
    if (this.#isShuttingDown) return;

    if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      this.#logger.error?.('mqtt.reconnect.exhausted', {
        attempts: this.#reconnectAttempts,
        message: 'Max reconnection attempts reached'
      });
      return;
    }

    const backoffMs = Math.min(
      this.#reconnectIntervalMs * Math.pow(this.#reconnectBackoffMultiplier, this.#reconnectAttempts),
      this.#maxReconnectIntervalMs
    );

    this.#reconnectAttempts += 1;

    this.#logger.info?.('mqtt.reconnect.scheduled', {
      attempt: this.#reconnectAttempts,
      backoffMs,
      nextAttemptIn: `${(backoffMs / 1000).toFixed(1)}s`
    });

    this.#reconnectTimeout = setTimeout(() => {
      this.#logger.info?.('mqtt.reconnect.attempting', { attempt: this.#reconnectAttempts });
      this.#connectToBroker(brokerUrl);
    }, backoffMs);
  }

  #connectToBroker(brokerUrl) {
    if (this.#isShuttingDown) return;

    this.#client = mqtt.connect(brokerUrl, {
      reconnectPeriod: 0,
      connectTimeout: 10000
    });

    this.#client.on('connect', () => {
      this.#logger.info?.('mqtt.connected', { broker: brokerUrl });
      this.#reconnectAttempts = 0;

      this.#sensorTopicMap.forEach((equipConfig, topic) => {
        this.#client.subscribe(topic, (err) => {
          if (err) {
            this.#logger.error?.('mqtt.subscribe.failed', {
              topic,
              equipment: equipConfig.id,
              error: err.message
            });
          } else {
            this.#logger.info?.('mqtt.subscribed', { topic, equipment: equipConfig.id });
          }
        });
      });
    });

    this.#client.on('message', (topic, message) => {
      const equipConfig = this.#sensorTopicMap.get(topic);
      if (!equipConfig) return;

      if (this.#shouldThrottle(topic)) {
        this.#logger.debug?.('mqtt.throttled', { topic, equipment: equipConfig.id });
        return;
      }

      let data;
      try {
        data = JSON.parse(message.toString());
      } catch (parseErr) {
        this.#logger.warn?.('mqtt.message.parseFailed', {
          topic,
          error: parseErr.message,
          rawMessage: message.toString().substring(0, 100)
        });
        return;
      }

      const validation = this.validatePayload(data);
      if (!validation.valid) {
        this.#logger.warn?.('mqtt.message.validationFailed', {
          topic,
          equipment: equipConfig.id,
          errors: validation.errors
        });
        return;
      }

      try {
        const payload = {
          topic: 'vibration',
          source: 'mqtt',
          equipmentId: equipConfig.id,
          equipmentName: equipConfig.name,
          equipmentType: equipConfig.type,
          thresholds: equipConfig.thresholds,
          timestamp: Date.now(),
          data: {
            vibration: data.vibration || false,
            x_axis: data.x_axis ?? null,
            y_axis: data.y_axis ?? null,
            z_axis: data.z_axis ?? null,
            battery: data.battery ?? null,
            battery_low: data.battery_low ?? false,
            linkquality: data.linkquality ?? null
          }
        };

        if (this.#onMessage) {
          this.#onMessage(payload);
        }

        if (data.vibration) {
          this.#logger.debug?.('mqtt.vibration.detected', {
            equipment: equipConfig.id,
            axes: { x: data.x_axis, y: data.y_axis, z: data.z_axis }
          });
        }
      } catch (err) {
        this.#logger.error?.('mqtt.message.broadcastFailed', {
          topic,
          equipment: equipConfig.id,
          error: err.message
        });
      }
    });

    this.#client.on('error', (err) => {
      this.#logger.error?.('mqtt.error', { error: err.message, code: err.code });
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        this.#scheduleReconnect(brokerUrl);
      }
    });

    this.#client.on('close', () => {
      if (this.#isShuttingDown) {
        this.#logger.info?.('mqtt.disconnected.shutdown');
        return;
      }
      this.#logger.warn?.('mqtt.disconnected.unexpected');
      this.#scheduleReconnect(brokerUrl);
    });

    this.#client.on('offline', () => {
      this.#logger.warn?.('mqtt.offline');
    });
  }
}

/**
 * Create an MQTTSensorAdapter from environment config
 * @param {Object} [options]
 * @returns {MQTTSensorAdapter}
 */
export function createMQTTSensorAdapter(options = {}) {
  const mqttConfig = process.env.mqtt || {};
  const host = mqttConfig.host || process.env.MQTT_HOST;
  const port = mqttConfig.port || process.env.MQTT_PORT || 1883;

  return new MQTTSensorAdapter({ host, port }, options);
}

export default MQTTSensorAdapter;
