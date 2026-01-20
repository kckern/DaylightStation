/**
 * MQTT Library - Bridge to new Hardware infrastructure
 *
 * This module provides backward-compatible exports while delegating
 * to the new MQTTSensorAdapter in 2_adapters/hardware.
 *
 * @module lib/mqtt
 */

import { broadcastToWebsockets } from '../routers/websocket.mjs';
import { createLogger } from './logging/logger.js';
import { MQTTSensorAdapter } from '../../src/2_adapters/hardware/mqtt-sensor/MQTTSensorAdapter.mjs';

const logger = createLogger({ source: 'backend', app: 'mqtt' });

// Lazy-initialized adapter
let mqttAdapter = null;

/**
 * Get or create MQTT adapter
 * @returns {MQTTSensorAdapter}
 */
function getMQTTAdapter() {
  if (mqttAdapter) return mqttAdapter;

  const mqttConfig = process.env.mqtt || {};

  mqttAdapter = new MQTTSensorAdapter({
    host: mqttConfig.host,
    port: mqttConfig.port || 1883
  }, {
    logger,
    onMessage: (payload) => {
      // Broadcast to websockets for backward compatibility
      broadcastToWebsockets(payload);
    }
  });

  logger.info('mqtt.adapter.initialized');
  return mqttAdapter;
}

/**
 * Validate vibration sensor payload schema
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateVibrationPayload(data) {
  return getMQTTAdapter().validatePayload(data);
}

/**
 * Build map of mqtt_topic -> equipment metadata
 * @param {Array} equipment
 * @returns {Map<string, object>}
 */
export function buildSensorTopicMap(equipment = []) {
  // This function is for internal use - the adapter builds the map internally
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

/**
 * Initialize MQTT subscriber for vibration sensors
 * @param {Array} equipment
 * @returns {object|null}
 */
export function initMqttSubscriber(equipment = []) {
  const adapter = getMQTTAdapter();
  const success = adapter.init(equipment);
  return success ? adapter : null;
}

/**
 * Close MQTT connection
 */
export function closeMqttConnection() {
  if (mqttAdapter) {
    mqttAdapter.close();
    mqttAdapter = null;
  }
}

/**
 * Get MQTT connection status
 * @returns {Object}
 */
export function getMqttStatus() {
  if (!mqttAdapter) {
    return {
      connected: false,
      reconnectAttempts: 0,
      sensorCount: 0,
      topics: []
    };
  }
  return mqttAdapter.getStatus();
}

export default {
  initMqttSubscriber,
  closeMqttConnection,
  getMqttStatus,
  buildSensorTopicMap,
  validateVibrationPayload,
};
