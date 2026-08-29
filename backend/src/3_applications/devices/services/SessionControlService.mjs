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

import { ERROR_CODES } from '#shared-contracts/media/errors.mjs';
import { ISessionControl } from '../ports/ISessionControl.mjs';
import { isDeviceTransportGateway } from '../ports/IDeviceTransportGateway.mjs';

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

export class SessionControlService extends ISessionControl {
  #transport;
  #livenessService;
  #logger;
  #clock;
  #ackTimeoutMs;
  #idempotencyTtlMs;

  /** @type {Map<string, IdempotencyEntry>} */
  #idempotency = new Map();

  /**
   * @param {Object} deps
   * @param {Object} deps.transportGateway      - Semantic device transport
   * @param {Object} deps.livenessService       - DeviceLivenessService
   * @param {Object} [deps.logger]              - Logger (defaults to console)
   * @param {Object} [deps.clock=Date]          - { now(): number }
   * @param {number} [deps.ackTimeoutMs=5000]
   * @param {number} [deps.idempotencyTtlMs=60000]
   */
  constructor(deps = {}) {
    super();
    if (!isDeviceTransportGateway(deps.transportGateway)) {
      throw new TypeError('SessionControlService requires transportGateway');
    }
    if (!deps.livenessService) {
      throw new TypeError('SessionControlService requires livenessService');
    }
    this.#transport = deps.transportGateway;
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
    const validation = this.#transport.validateCommand(envelope);
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
    const ackResult = await this.#transport.sendCommand(targetDevice, envelope, { timeoutMs: this.#ackTimeoutMs });

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

  transport(deviceId, { action, value, commandId }) {
    return this.sendCommand(this.#transport.buildCommand({ targetDevice: deviceId, command: 'transport', commandId,
      params: { action, ...(value !== undefined ? { value } : {}) } }));
  }

  queue(deviceId, commandId, params) {
    return this.sendCommand(this.#transport.buildCommand({ targetDevice: deviceId, command: 'queue', commandId, params }));
  }

  config(deviceId, { setting, value, commandId }) {
    return this.sendCommand(this.#transport.buildCommand({ targetDevice: deviceId, command: 'config', commandId,
      params: { setting, value } }));
  }

  adoptSnapshot(deviceId, commandId, snapshot) {
    return this.sendCommand(this.#transport.buildCommand({ targetDevice: deviceId, command: 'adopt-snapshot', commandId,
      params: { snapshot, autoplay: true } }));
  }

  /**
   * Claim the device for "Take Over" — stops the current session atomically
   * (spec §4.6). Captures the current snapshot first so the caller can offer
   * "Restore previous session" later.
   *
   * Algorithm:
   *   1. Read last-known snapshot. If device is offline or unknown, return
   *      DEVICE_OFFLINE without publishing anything.
   *   2. Build a transport/stop envelope with the caller-supplied commandId
   *      and dispatch via `sendCommand`.
   *   3. On ack success → return `{ ok: true, commandId, snapshot, stoppedAt }`.
   *   4. On ack failure → propagate the ack error. `lastKnown` is stamped
   *      on offline-style failures for client context.
   *
   * Atomicity note: if the stop command fails at the ack layer, the device
   * state is (by assumption) unchanged — the service has not modified any
   * session config. A future enhancement may re-advertise the captured
   * snapshot as a `reason: 'initial'` state broadcast if telemetry shows
   * clients getting confused about the "did it or didn't it" case; for v1
   * we skip that because the client can re-read with GET /session.
   *
   * @param {string} deviceId
   * @param {{ commandId: string }} opts
   * @returns {Promise<
   *   | { ok: true,  commandId: string, snapshot: Object, stoppedAt: string }
   *   | { ok: false, code: string, error: string, lastKnown?: Object }
   * >}
   */
  async claim(deviceId, opts = {}) {
    const commandId = opts?.commandId;
    if (typeof commandId !== 'string' || commandId.length === 0) {
      return {
        ok: false,
        code: 'VALIDATION',
        error: 'commandId required',
      };
    }

    // 1. Capture snapshot.
    const captured = this.getSnapshot(deviceId);
    if (!captured || captured.online === false) {
      this.#logger.warn?.('session-control.claim.offline', {
        deviceId,
        commandId,
        hasRecord: !!captured,
      });
      return {
        ok: false,
        code: ERROR_CODES.DEVICE_OFFLINE,
        error: 'Device offline or unknown',
        lastKnown: captured?.snapshot ?? null,
      };
    }

    // 2. Dispatch transport/stop.
    const envelope = this.#transport.buildCommand({ targetDevice: deviceId, command: 'transport', commandId,
      params: { action: 'stop' }, ts: new Date(this.#clock.now()).toISOString() });

    const ack = await this.sendCommand(envelope);
    if (!ack || ack.ok !== true) {
      this.#logger.warn?.('session-control.claim.stop_failed', {
        deviceId,
        commandId,
        code: ack?.code,
        error: ack?.error,
      });
      // Propagate the failure as-is. Ensure lastKnown is present so clients
      // can still restore the prior state context if they want to retry.
      const result = {
        ok: false,
        code: ack?.code || 'UNKNOWN',
        error: ack?.error || 'Stop command failed',
      };
      if (ack && ack.lastKnown !== undefined) {
        result.lastKnown = ack.lastKnown;
      } else {
        result.lastKnown = captured.snapshot;
      }
      return result;
    }

    this.#logger.info?.('session-control.claim.ok', { deviceId, commandId });
    return {
      ok: true,
      commandId,
      snapshot: captured.snapshot,
      stoppedAt: new Date(this.#clock.now()).toISOString(),
    };
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
    return this.#transport.waitForStateChange(deviceId, predicate, timeoutMs);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

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
