/**
 * WebSocketContentAdapter - Content control via WebSocket broadcast
 *
 * Implements IContentControl port for devices connected via WebSocket.
 * Broadcasts structured CommandEnvelopes (shared-contracts §6.2) to a topic
 * the target device is subscribed to.
 *
 * @module adapters/devices
 */

import { randomUUID } from 'node:crypto';
import { buildCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { CONTENT_ID_KEYS, resolveContentId } from '../../3_applications/devices/contentIdKeys.mjs';

export class WebSocketContentAdapter {
  #topic;
  #deviceId;
  #wsBus;
  #daylightHost;
  #logger;
  #metrics;

  constructor(config, deps = {}) {
    if (!deps.wsBus) {
      throw new InfrastructureError('WebSocketContentAdapter requires wsBus', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'wsBus',
      });
    }
    if (!config?.deviceId) {
      throw new InfrastructureError('WebSocketContentAdapter requires deviceId', {
        code: 'MISSING_CONFIG',
        field: 'deviceId',
      });
    }

    this.#topic = config.topic;
    this.#deviceId = config.deviceId;
    this.#wsBus = deps.wsBus;
    this.#daylightHost = config.daylightHost;
    this.#logger = deps.logger || console;

    this.#metrics = { startedAt: Date.now(), loads: 0, errors: 0 };
  }

  async prepareForContent() {
    return { ok: true };
  }

  async load(path, query = {}) {
    const startTime = Date.now();
    this.#metrics.loads++;

    const resolved = resolveContentId(query);

    if (!resolved) {
      this.#metrics.errors++;
      const error = `WebSocketContentAdapter.load: no contentId could be resolved from query keys ${CONTENT_ID_KEYS.join(', ')}`;
      this.#logger.error?.('websocket.load.missing-contentId', {
        topic: this.#topic,
        deviceId: this.#deviceId,
        queryKeys: Object.keys(query),
      });
      return { ok: false, topic: this.#topic, error };
    }

    const { contentId, resolvedKey } = resolved;
    const options = { ...query };
    delete options[resolvedKey];

    try {
      const commandId = randomUUID();
      const envelope = buildCommandEnvelope({
        targetDevice: this.#deviceId,
        command: 'queue',
        commandId,
        // Spread options FIRST so a caller-supplied `op` or `contentId` can't
        // clobber the canonical values we set below.
        params: { ...options, op: 'play-now', contentId },
      });

      this.#logger.info?.('websocket.load', {
        topic: this.#topic,
        deviceId: this.#deviceId,
        commandId,
        contentId,
        optionKeys: Object.keys(options),
      });

      await this.#wsBus.broadcast(this.#topic, envelope);

      return {
        ok: true,
        topic: this.#topic,
        commandId,
        loadTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('websocket.load.error', {
        topic: this.#topic,
        deviceId: this.#deviceId,
        error: error.message,
      });
      return { ok: false, topic: this.#topic, error: error.message };
    }
  }

  async getStatus() {
    const subscribers = this.#wsBus.getSubscribers?.(this.#topic) || [];
    return {
      ready: subscribers.length > 0,
      provider: 'websocket',
      topic: this.#topic,
      subscriberCount: subscribers.length,
    };
  }

  getMetrics() {
    return {
      provider: 'websocket',
      topic: this.#topic,
      deviceId: this.#deviceId,
      uptime: Date.now() - this.#metrics.startedAt,
      loads: this.#metrics.loads,
      errors: this.#metrics.errors,
    };
  }
}

export default WebSocketContentAdapter;
