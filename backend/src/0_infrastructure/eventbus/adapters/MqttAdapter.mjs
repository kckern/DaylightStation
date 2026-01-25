/**
 * MQTT Adapter for EventBus
 *
 * Publishes EventBus events to an MQTT broker.
 */

import { nowTs } from '../../utils/index.mjs';

export class MqttAdapter {
  constructor(options = {}) {
    this.name = 'mqtt';
    this.client = options.client || null;
    this.topicPrefix = options.topicPrefix || 'daylight/';
    this.qos = options.qos || 0;
    this.retain = options.retain || false;
    this.logger = options.logger || console;
  }

  /**
   * Set the MQTT client instance
   * @param {MqttClient} client
   */
  setClient(client) {
    this.client = client;
  }

  /**
   * Broadcast an event to MQTT
   * @param {string} topic - Event topic
   * @param {Object} payload - Event payload
   */
  broadcast(topic, payload) {
    if (!this.client) {
      this.logger.warn?.('mqtt-adapter.no_client', { topic });
      return;
    }

    if (!this.client.connected) {
      this.logger.warn?.('mqtt-adapter.not_connected', { topic });
      return;
    }

    const mqttTopic = `${this.topicPrefix}${topic}`;
    const message = JSON.stringify({
      topic,
      timestamp: nowTs(),
      ...payload
    });

    this.client.publish(mqttTopic, message, {
      qos: this.qos,
      retain: this.retain
    }, (err) => {
      if (err) {
        this.logger.error?.('mqtt-adapter.publish_error', {
          topic: mqttTopic,
          error: err.message
        });
      } else {
        this.logger.debug?.('mqtt-adapter.published', {
          topic: mqttTopic,
          payloadSize: message.length
        });
      }
    });
  }

  /**
   * Check if MQTT client is connected
   */
  isConnected() {
    return this.client?.connected || false;
  }
}

export default MqttAdapter;
