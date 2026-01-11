import mqtt from 'mqtt';
import { broadcastToWebsockets } from '../routers/websocket.mjs';
import { createLogger } from './logging/logger.js';
import { MQTT_CONSTANTS } from './mqtt.constants.mjs';

const logger = createLogger({ source: 'backend', app: 'mqtt' });

let mqttClient = null;
let sensorTopicMap = new Map();
let reconnectAttempts = 0;
let reconnectTimeout = null;
let isShuttingDown = false;
const lastBroadcastTime = new Map();

/**
 * Validate vibration sensor payload schema
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateVibrationPayload(data) {
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

function shouldThrottle(topic) {
  const now = Date.now();
  const lastTime = lastBroadcastTime.get(topic) || 0;
  if (now - lastTime < MQTT_CONSTANTS.BROADCAST_THROTTLE_MS) {
    return true;
  }
  lastBroadcastTime.set(topic, now);
  return false;
}

/**
 * Build map of mqtt_topic -> equipment metadata
 * @param {Array} equipment
 * @returns {Map<string, object>}
 */
export function buildSensorTopicMap(equipment = []) {
  const map = new Map();

  if (!Array.isArray(equipment)) {
    logger.warn('mqtt.invalid_equipment', { message: 'Equipment config must be an array' });
    return map;
  }

  equipment.forEach((equip) => {
    if (equip?.sensor?.type === 'vibration' && equip.sensor.mqtt_topic) {
      map.set(equip.sensor.mqtt_topic, {
        id: equip.id,
        name: equip.name,
        type: equip.type,
        thresholds: equip.thresholds || { low: 5, medium: 15, high: 30 },
      });
    }
  });

  return map;
}

function scheduleReconnect(brokerUrl) {
  if (isShuttingDown) return;

  if (reconnectAttempts >= MQTT_CONSTANTS.MAX_RECONNECT_ATTEMPTS) {
    logger.error('mqtt.reconnect.exhausted', {
      attempts: reconnectAttempts,
      message: 'Max reconnection attempts reached, giving up',
    });
    return;
  }

  const backoffMs = Math.min(
    MQTT_CONSTANTS.RECONNECT_INTERVAL_MS * Math.pow(MQTT_CONSTANTS.RECONNECT_BACKOFF_MULTIPLIER, reconnectAttempts),
    MQTT_CONSTANTS.MAX_RECONNECT_INTERVAL_MS,
  );

  reconnectAttempts += 1;

  logger.info('mqtt.reconnect.scheduled', {
    attempt: reconnectAttempts,
    backoffMs,
    nextAttemptIn: `${(backoffMs / 1000).toFixed(1)}s`,
  });

  reconnectTimeout = setTimeout(() => {
    logger.info('mqtt.reconnect.attempting', { attempt: reconnectAttempts });
    connectToBroker(brokerUrl);
  }, backoffMs);
}

function connectToBroker(brokerUrl) {
  if (isShuttingDown) return;

  mqttClient = mqtt.connect(brokerUrl, {
    reconnectPeriod: 0,
    connectTimeout: 10000,
  });

  mqttClient.on('connect', () => {
    logger.info('mqtt.connected', { broker: brokerUrl });
    reconnectAttempts = 0;

    sensorTopicMap.forEach((equipConfig, topic) => {
      mqttClient.subscribe(topic, (err) => {
        if (err) {
          logger.error('mqtt.subscribe.failed', { topic, equipment: equipConfig.id, error: err.message });
        } else {
          logger.info('mqtt.subscribed', { topic, equipment: equipConfig.id });
        }
      });
    });
  });

  mqttClient.on('message', (topic, message) => {
    const equipConfig = sensorTopicMap.get(topic);
    if (!equipConfig) return;

    if (shouldThrottle(topic)) {
      logger.debug('mqtt.throttled', { topic, equipment: equipConfig.id });
      return;
    }

    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (parseErr) {
      logger.warn('mqtt.message.parse.failed', {
        topic,
        error: parseErr.message,
        rawMessage: message.toString().substring(0, 100),
      });
      return;
    }

    const validation = validateVibrationPayload(data);
    if (!validation.valid) {
      logger.warn('mqtt.message.validation.failed', {
        topic,
        equipment: equipConfig.id,
        errors: validation.errors,
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
          linkquality: data.linkquality ?? null,
        },
      };

      broadcastToWebsockets(payload);

      if (data.vibration) {
        logger.debug('mqtt.vibration.detected', {
          equipment: equipConfig.id,
          axes: { x: data.x_axis, y: data.y_axis, z: data.z_axis },
        });
      }
    } catch (err) {
      logger.error('mqtt.message.broadcast.failed', {
        topic,
        equipment: equipConfig.id,
        error: err.message,
      });
    }
  });

  mqttClient.on('error', (err) => {
    logger.error('mqtt.error', { error: err.message, code: err.code });
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      scheduleReconnect(brokerUrl);
    }
  });

  mqttClient.on('close', () => {
    if (isShuttingDown) {
      logger.info('mqtt.disconnected.shutdown');
      return;
    }
    logger.warn('mqtt.disconnected.unexpected');
    scheduleReconnect(brokerUrl);
  });

  mqttClient.on('offline', () => {
    logger.warn('mqtt.offline');
  });
}

/**
 * Initialize MQTT subscriber for vibration sensors
 * @param {Array} equipment
 * @returns {object|null}
 */
export function initMqttSubscriber(equipment = []) {
  const mqttConfig = process.env.mqtt || {};
  const { host, port = 1883 } = mqttConfig;

  if (!host) {
    logger.warn('mqtt.not_configured', { message: 'No mqtt.host configured, skipping MQTT subscriber' });
    return null;
  }

  const brokerUrl = `mqtt://${host}:${port}`;
  sensorTopicMap = buildSensorTopicMap(equipment);

  if (sensorTopicMap.size === 0) {
    logger.info('mqtt.no_vibration_sensors', { message: 'No vibration sensors configured in equipment' });
    return null;
  }

  logger.info('mqtt.initializing', { broker: brokerUrl, sensorCount: sensorTopicMap.size });

  isShuttingDown = false;
  reconnectAttempts = 0;
  connectToBroker(brokerUrl);
  return mqttClient;
}

export function closeMqttConnection() {
  isShuttingDown = true;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }

  lastBroadcastTime.clear();
  logger.info('mqtt.closed');
}

export function getMqttStatus() {
  return {
    connected: mqttClient?.connected || false,
    reconnectAttempts,
    sensorCount: sensorTopicMap.size,
    topics: Array.from(sensorTopicMap.keys()),
  };
}

export default {
  initMqttSubscriber,
  closeMqttConnection,
  getMqttStatus,
  buildSensorTopicMap,
  validateVibrationPayload,
};
