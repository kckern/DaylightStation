/**
 * SessionControlService — HTTP→WS command bridge.
 *
 * Orchestrates the lifecycle of a single command envelope from an HTTP
 * request to a WebSocket-delivered screen device and back. Concretely:
 *
 *   1. validate the envelope against the media contract,
 *   2. enforce idempotency (same commandId replays return the cached ack;
 *      same commandId with a different payload is a conflict),
 *   3. short-circuit when the target device is offline (liveness-gated),
 *   4. arm an ack subscription on `device-ack:<deviceId>` BEFORE publishing
 *      to avoid racing with a very-fast device,
 *   5. publish on `screen:<deviceId>`,
 *   6. resolve with the ack payload (or a DEVICE_REFUSED timeout).
 *
 * Also exposes `getSnapshot` (proxy to DeviceLivenessService) and
 * `waitForStateChange` (one-shot wait on `device-state:<deviceId>`
 * predicated snapshot) — both used by the claim endpoint.
 *
 * Implements the ISessionControl port from
 * `#apps/devices/ports/ISessionControl.mjs`.
 *
 * @module applications/devices/services
 */

import {
  buildCommandEnvelope, // re-exported for consumers that construct inline
  validateCommandEnvelope,
} from '#shared-contracts/media/envelopes.mjs';
import {
  SCREEN_COMMAND_TOPIC,
  DEVICE_ACK_TOPIC,
  DEVICE_STATE_TOPIC,
} from '#shared-contracts/media/topics.mjs';
import { ERROR_CODES } from '#shared-contracts/media/errors.mjs';

export { buildCommandEnvelope };

const DEFAULT_ACK_TIMEOUT_MS       = 5000;
const DEFAULT_IDEMPOTENCY_TTL_MS   = 60000;

/**
 * @typedef {Object} AckResult
 * @property {boolean} ok
 * @property {string}  commandId
 * @property {string}  [appliedAt]
 * @property {string}  [error]
 * @property {string}  [code]
 */

/**
 * @typedef {Object} IdempotencyEntry
 * @property {number} recordedAt   - Epoch ms when recorded
 * @property {string} payloadHash  - Hash of the relevant envelope fields
 * @property {AckResult} result    - The ack result to replay
 */

export class SessionControlService {
  #eventBus;
  #livenessService;
  #logger;
  #clock;
  #ackTimeoutMs;
  #idempotencyTtlMs;

  /** @type {Map<string, IdempotencyEntry>} */
  #idempotency = new Map();

  /**
   * @param {Object} deps
   * @param {Object} deps.eventBus              - WebSocketEventBus-like (broadcast + subscribePattern)
   * @param {Object} deps.livenessService       - DeviceLivenessService
   * @param {Object} [deps.logger]              - Logger (defaults to console)
   * @param {Object} [deps.clock=Date]          - { now(): number }
   * @param {number} [deps.ackTimeoutMs=5000]
   * @param {number} [deps.idempotencyTtlMs=60000]
   */
  constructor(deps = {}) {
    if (!deps.eventBus) {
      throw new TypeError('SessionControlService requires eventBus');
    }
    if (!deps.livenessService) {
      throw new TypeError('SessionControlService requires livenessService');
    }
    this.#eventBus = deps.eventBus;
    this.#livenessService = deps.livenessService;
    this.#logger = deps.logger || console;
    this.#clock = deps.clock || Date;
    this.#ackTimeoutMs = Number.isFinite(deps.ackTimeoutMs) && deps.ackTimeoutMs > 0
      ? deps.ackTimeoutMs
      : DEFAULT_ACK_TIMEOUT_MS;
    this.#idempotencyTtlMs = Number.isFinite(deps.idempotencyTtlMs) && deps.idempotencyTtlMs > 0
      ? deps.idempotencyTtlMs
      : DEFAULT_IDEMPOTENCY_TTL_MS;
  }

  /**
   * Send a command envelope to its target device and await the matching ack.
   * See module header for the full lifecycle.
   *
   * @param {Object} envelope - Structured command envelope (per §6.2).
   * @returns {Promise<AckResult>}
   */
  async sendCommand(envelope) {
    // 1. Validate envelope shape.
    const validation = validateCommandEnvelope(envelope);
    if (!validation.valid) {
      const firstError = validation.errors[0] || 'Invalid envelope';
      this.#logger.warn?.('session-control.invalid_envelope', {
        error: firstError,
        commandId: envelope?.commandId,
      });
      return {
        ok: false,
        code: 'INVALID_ENVELOPE',
        error: firstError,
      };
    }

    // 2. targetDevice is required for this transport.
    const targetDevice = envelope.targetDevice;
    if (!targetDevice || typeof targetDevice !== 'string') {
      return {
        ok: false,
        code: ERROR_CODES.DEVICE_NOT_FOUND,
        error: 'targetDevice is required',
      };
    }

    const commandId = envelope.commandId;

    // 3. Idempotency: replay recent identical, reject conflicting.
    const idem = this.#checkIdempotency(commandId, envelope);
    if (idem.status === 'replay') {
      this.#logger.info?.('session-control.idempotent_replay', { commandId });
      return idem.result;
    }
    if (idem.status === 'conflict') {
      this.#logger.warn?.('session-control.idempotency_conflict', { commandId });
      return {
        ok: false,
        code: ERROR_CODES.IDEMPOTENCY_CONFLICT,
        error: 'Same commandId with different payload',
      };
    }

    // 4. Liveness gate.
    const cached = this.#livenessService.getLastSnapshot?.(targetDevice) ?? null;
    if (cached && cached.online === false) {
      this.#logger.warn?.('session-control.device_offline', { targetDevice, commandId });
      return {
        ok: false,
        code: ERROR_CODES.DEVICE_OFFLINE,
        error: 'Device offline',
        lastKnown: cached.snapshot,
      };
    }

    // 5. Arm ack subscription BEFORE publishing to avoid races.
    const ackResult = await this.#publishAndAwaitAck(targetDevice, envelope);

    // 6. Record in idempotency cache regardless of outcome.
    this.#recordIdempotency(commandId, envelope, ackResult);

    return ackResult;
  }

  /**
   * Get the last known snapshot for a device. Passthrough to liveness.
   *
   * @param {string} deviceId
   * @returns {null | { snapshot: Object, lastSeenAt: string, online: boolean }}
   */
  getSnapshot(deviceId) {
    if (typeof this.#livenessService.getLastSnapshot !== 'function') {
      return null;
    }
    return this.#livenessService.getLastSnapshot(deviceId);
  }

  /**
   * Wait for the next `device-state:<deviceId>` broadcast whose snapshot
   * satisfies the predicate. Resolves with the snapshot, rejects on timeout.
   *
   * @param {string} deviceId
   * @param {(snapshot: Object) => boolean} predicate
   * @param {number} timeoutMs
   * @returns {Promise<Object>} the matching SessionSnapshot
   */
  waitForStateChange(deviceId, predicate, timeoutMs) {
    if (!deviceId || typeof deviceId !== 'string') {
      return Promise.reject(new Error('deviceId required'));
    }
    if (typeof predicate !== 'function') {
      return Promise.reject(new Error('predicate must be a function'));
    }
    const topic = DEVICE_STATE_TOPIC(deviceId);

    return new Promise((resolve, reject) => {
      let unsubscribe = null;
      let timer = null;

      const cleanup = () => {
        if (timer != null) { clearTimeout(timer); timer = null; }
        if (typeof unsubscribe === 'function') {
          try { unsubscribe(); } catch { /* noop */ }
          unsubscribe = null;
        }
      };

      const handler = (payload /* , incomingTopic */) => {
        if (!payload || typeof payload !== 'object') return;
        const snap = payload.snapshot;
        if (!snap) return;
        let matched = false;
        try {
          matched = !!predicate(snap);
        } catch (err) {
          this.#logger.warn?.('session-control.predicate_error', {
            deviceId,
            error: err?.message,
          });
          return;
        }
        if (!matched) return;
        cleanup();
        resolve(snap);
      };

      if (typeof this.#eventBus.subscribePattern !== 'function') {
        reject(new Error('eventBus lacks subscribePattern'));
        return;
      }
      unsubscribe = this.#eventBus.subscribePattern(
        (t) => t === topic,
        handler,
      );

      timer = setTimeout(() => {
        cleanup();
        const err = new Error(
          `waitForStateChange timed out after ${timeoutMs}ms for ${deviceId}`,
        );
        err.code = 'STATE_WAIT_TIMEOUT';
        reject(err);
      }, timeoutMs);
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Arm an ack subscription, publish the command, await the ack.
   * @private
   */
  #publishAndAwaitAck(targetDevice, envelope) {
    const commandId = envelope.commandId;
    const ackTopic = DEVICE_ACK_TOPIC(targetDevice);
    const screenTopic = SCREEN_COMMAND_TOPIC(targetDevice);

    return new Promise((resolve) => {
      let unsubscribe = null;
      let timer = null;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (timer != null) { clearTimeout(timer); timer = null; }
        if (typeof unsubscribe === 'function') {
          try { unsubscribe(); } catch { /* noop */ }
          unsubscribe = null;
        }
      };

      const handler = (payload /* , topic */) => {
        if (settled) return;
        if (!payload || typeof payload !== 'object') return;
        if (payload.commandId !== commandId) return;

        cleanup();
        // Shape the ack result — prefer the ack's own fields, but always
        // stamp commandId so callers can route replies.
        const result = {
          ok: payload.ok === true,
          commandId,
        };
        if (payload.appliedAt !== undefined) result.appliedAt = payload.appliedAt;
        if (payload.error !== undefined) result.error = payload.error;
        if (payload.code !== undefined) result.code = payload.code;
        resolve(result);
      };

      // Arm before publish.
      if (typeof this.#eventBus.subscribePattern !== 'function') {
        cleanup();
        resolve({
          ok: false,
          code: 'BUS_MISCONFIGURED',
          error: 'eventBus lacks subscribePattern',
        });
        return;
      }
      unsubscribe = this.#eventBus.subscribePattern(
        (t) => t === ackTopic,
        handler,
      );

      timer = setTimeout(() => {
        cleanup();
        this.#logger.warn?.('session-control.ack_timeout', {
          targetDevice,
          commandId,
          timeoutMs: this.#ackTimeoutMs,
        });
        resolve({
          ok: false,
          code: ERROR_CODES.DEVICE_REFUSED,
          error: 'Timeout waiting for ack',
          commandId,
        });
      }, this.#ackTimeoutMs);

      // Publish. Prefer broadcast (delivers both externally and via internal
      // publish), fall back to publish if the bus only exposes that.
      try {
        if (typeof this.#eventBus.broadcast === 'function') {
          this.#eventBus.broadcast(screenTopic, envelope);
        } else if (typeof this.#eventBus.publish === 'function') {
          this.#eventBus.publish(screenTopic, envelope);
        } else {
          cleanup();
          resolve({
            ok: false,
            code: 'BUS_MISCONFIGURED',
            error: 'eventBus has no broadcast/publish method',
          });
          return;
        }
        this.#logger.info?.('session-control.published', {
          topic: screenTopic,
          commandId,
          command: envelope.command,
        });
      } catch (err) {
        cleanup();
        this.#logger.error?.('session-control.publish_error', {
          topic: screenTopic,
          commandId,
          error: err?.message,
        });
        resolve({
          ok: false,
          code: 'BUS_PUBLISH_ERROR',
          error: err?.message || 'publish failed',
        });
      }
    });
  }

  /**
   * Serialize the "relevant" portion of an envelope for idempotency
   * comparison. Intentionally excludes `ts` so natural clock drift between
   * client retries doesn't register as a conflict.
   * @private
   */
  #envelopeFingerprint(envelope) {
    const fp = {
      command: envelope.command,
      targetDevice: envelope.targetDevice,
      targetScreen: envelope.targetScreen,
      params: envelope.params ?? {},
    };
    return JSON.stringify(fp);
  }

  /**
   * @private
   * @returns {{ status: 'fresh' | 'replay' | 'conflict', result?: AckResult }}
   */
  #checkIdempotency(commandId, envelope) {
    this.#evictExpiredIdempotency();
    const existing = this.#idempotency.get(commandId);
    if (!existing) return { status: 'fresh' };

    const hash = this.#envelopeFingerprint(envelope);
    if (existing.payloadHash === hash) {
      return { status: 'replay', result: existing.result };
    }
    return { status: 'conflict' };
  }

  /** @private */
  #recordIdempotency(commandId, envelope, result) {
    this.#idempotency.set(commandId, {
      recordedAt: this.#clock.now(),
      payloadHash: this.#envelopeFingerprint(envelope),
      result,
    });
  }

  /** @private */
  #evictExpiredIdempotency() {
    const now = this.#clock.now();
    for (const [commandId, entry] of this.#idempotency) {
      if (now - entry.recordedAt > this.#idempotencyTtlMs) {
        this.#idempotency.delete(commandId);
      }
    }
  }
}

export default SessionControlService;
