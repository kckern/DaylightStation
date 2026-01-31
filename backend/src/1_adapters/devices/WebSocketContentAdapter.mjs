/**
 * WebSocketContentAdapter - Content control via WebSocket broadcast
 *
 * Implements IContentControl port for devices connected via WebSocket.
 * Sends load commands to specific topics that devices subscribe to.
 *
 * @module adapters/devices
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class WebSocketContentAdapter {
  #topic;
  #wsBus;
  #daylightHost;
  #logger;
  #metrics;

  /**
   * @param {Object} config
   * @param {string} config.topic - WebSocket topic to broadcast to
   * @param {string} config.daylightHost - Base URL for content loading
   * @param {Object} deps
   * @param {Object} deps.wsBus - WebSocket broadcast service
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    if (!deps.wsBus) {
      throw new InfrastructureError('WebSocketContentAdapter requires wsBus', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'wsBus'
      });
    }

    this.#topic = config.topic;
    this.#wsBus = deps.wsBus;
    this.#daylightHost = config.daylightHost;
    this.#logger = deps.logger || console;

    this.#metrics = {
      startedAt: Date.now(),
      loads: 0,
      errors: 0
    };
  }

  // =============================================================================
  // IContentControl Implementation
  // =============================================================================

  /**
   * Prepare device for content loading
   * For WebSocket devices, this is typically a no-op
   * @returns {Promise<Object>}
   */
  async prepareForContent() {
    // WebSocket devices are always ready if connected
    return { ok: true };
  }

  /**
   * Load content by broadcasting to WebSocket topic
   * @param {string} path - Path to load
   * @param {Object} [query] - Query parameters
   * @returns {Promise<Object>}
   */
  async load(path, query = {}) {
    const startTime = Date.now();
    this.#metrics.loads++;

    try {
      // Build payload
      const payload = {
        action: 'load',
        path,
        query,
        url: `${this.#daylightHost}${path}`,
        timestamp: Date.now()
      };

      this.#logger.info?.('websocket.load', { topic: this.#topic, payload });

      // Broadcast to topic
      await this.#wsBus.broadcast(this.#topic, payload);

      return {
        ok: true,
        topic: this.#topic,
        url: payload.url,
        loadTimeMs: Date.now() - startTime
      };
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('websocket.load.error', { topic: this.#topic, error: error.message });
      return {
        ok: false,
        topic: this.#topic,
        error: error.message
      };
    }
  }

  /**
   * Get content control status
   * @returns {Promise<Object>}
   */
  async getStatus() {
    // Check if any clients are subscribed to this topic
    const subscribers = this.#wsBus.getSubscribers?.(this.#topic) || [];

    return {
      ready: subscribers.length > 0,
      provider: 'websocket',
      topic: this.#topic,
      subscriberCount: subscribers.length
    };
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      provider: 'websocket',
      topic: this.#topic,
      uptime: Date.now() - this.#metrics.startedAt,
      loads: this.#metrics.loads,
      errors: this.#metrics.errors
    };
  }
}

export default WebSocketContentAdapter;
