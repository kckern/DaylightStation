/**
 * DeviceLivenessService — tracks the latest known device-state snapshot per
 * device and synthesizes an `offline` broadcast when a device stops emitting
 * heartbeats.
 *
 * Subscribes to every `device-state:*` publish on the event bus via a
 * pattern subscriber. For each incoming broadcast:
 *   - updates the in-memory map (snapshot + lastSeenAt)
 *   - resets a 15s timer (configurable)
 *   - if the device was previously offline and the incoming reason is
 *     `heartbeat`, synthesizes a `reason: 'initial'` broadcast so
 *     subscribers re-hydrate without waiting for the next natural change.
 *
 * When the timer fires with no new messages, publishes a synthesized
 * `buildDeviceStateBroadcast({ reason: 'offline', snapshot: lastKnown })`
 * on `device-state:<id>` and flips the device to offline=false.
 *
 * @module applications/devices/services
 */

import {
  DEVICE_STATE_TOPIC,
  parseDeviceTopic,
} from '#shared-contracts/media/topics.mjs';
import { buildDeviceStateBroadcast } from '#shared-contracts/media/envelopes.mjs';

const DEFAULT_OFFLINE_TIMEOUT_MS = 15000;

/**
 * @typedef {Object} LivenessEntry
 * @property {Object} snapshot      Last known SessionSnapshot
 * @property {number} lastSeenAt    Epoch ms of last heartbeat
 * @property {boolean} online       Whether the device is currently considered online
 * @property {*} [timer]            Node timer handle
 */

export class DeviceLivenessService {
  #eventBus;
  #logger;
  #clock;
  #offlineTimeoutMs;

  /** @type {Map<string, LivenessEntry>} */
  #entries = new Map();
  #unsubscribe = null;
  #started = false;

  /**
   * @param {Object} deps
   * @param {Object} deps.eventBus - Event bus (WebSocketEventBus)
   * @param {Object} [deps.logger]
   * @param {Object} [deps.clock] - { now(): number } (defaults to Date)
   * @param {number} [deps.offlineTimeoutMs=15000]
   */
  constructor(deps = {}) {
    if (!deps.eventBus) {
      throw new TypeError('DeviceLivenessService requires eventBus');
    }
    this.#eventBus = deps.eventBus;
    this.#logger = deps.logger || console;
    this.#clock = deps.clock || Date;
    this.#offlineTimeoutMs =
      typeof deps.offlineTimeoutMs === 'number' && deps.offlineTimeoutMs > 0
        ? deps.offlineTimeoutMs
        : DEFAULT_OFFLINE_TIMEOUT_MS;
  }

  /**
   * Begin observing the bus. Idempotent.
   */
  start() {
    if (this.#started) return;
    this.#started = true;

    this.#logger.info?.('device-liveness.start', {
      offlineTimeoutMs: this.#offlineTimeoutMs,
    });

    // Prefer subscribePattern (added in WebSocketEventBus) to observe every
    // device-state:* publish. Fall back to a no-op subscription if the bus
    // doesn't expose the seam.
    if (typeof this.#eventBus.subscribePattern === 'function') {
      this.#unsubscribe = this.#eventBus.subscribePattern(
        (topic) => {
          const parsed = parseDeviceTopic(topic);
          return !!parsed && parsed.kind === 'device-state';
        },
        (payload, topic) => this.#handleDeviceState(topic, payload),
      );
    } else {
      this.#logger.warn?.('device-liveness.no_subscribe_pattern', {
        note: 'event bus lacks subscribePattern — liveness inactive',
      });
    }
  }

  /**
   * Stop observing the bus and clear pending offline timers. Idempotent.
   */
  stop() {
    if (!this.#started) return;
    this.#started = false;

    if (typeof this.#unsubscribe === 'function') {
      try { this.#unsubscribe(); } catch {
        // ignore
      }
      this.#unsubscribe = null;
    }

    for (const entry of this.#entries.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }

    this.#logger.info?.('device-liveness.stop');
  }

  /**
   * Get the latest known snapshot for a device.
   *
   * @param {string} deviceId
   * @returns {null | { snapshot: Object, lastSeenAt: string, online: boolean }}
   */
  getLastSnapshot(deviceId) {
    const entry = this.#entries.get(deviceId);
    if (!entry) return null;
    return {
      snapshot: entry.snapshot,
      lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
      online: entry.online,
    };
  }

  /**
   * Whether a device is currently considered online.
   * @param {string} deviceId
   * @returns {boolean}
   */
  isOnline(deviceId) {
    const entry = this.#entries.get(deviceId);
    return !!entry && entry.online === true;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Process an incoming device-state broadcast.
   * @param {string} topic
   * @param {Object} payload
   * @private
   */
  #handleDeviceState(topic, payload) {
    if (!payload || typeof payload !== 'object') return;

    const deviceId = payload.deviceId;
    if (!deviceId || typeof deviceId !== 'string') {
      this.#logger.debug?.('device-liveness.skip_no_device_id', { topic });
      return;
    }

    const reason = payload.reason;

    // Synthesized offline broadcasts re-enter this handler (pattern
    // subscribers fire on every publish). Don't treat them as a heartbeat.
    if (reason === 'offline') return;

    const snapshot = payload.snapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      this.#logger.debug?.('device-liveness.skip_no_snapshot', { deviceId, reason });
      return;
    }

    const prevEntry = this.#entries.get(deviceId);
    const wasOffline = !!prevEntry && prevEntry.online === false;

    // Clear previous offline timer (if any) and arm a fresh one.
    if (prevEntry?.timer) clearTimeout(prevEntry.timer);

    const entry = {
      snapshot,
      lastSeenAt: this.#clock.now(),
      online: true,
      timer: null,
    };
    entry.timer = this.#armTimer(deviceId);
    this.#entries.set(deviceId, entry);

    // Synthesize a `reason: 'initial'` broadcast when returning from offline
    // via a heartbeat — gives subscribers a clean "back online" signal.
    if (wasOffline && reason === 'heartbeat') {
      this.#logger.info?.('device-liveness.online', { deviceId });
      const ts = new Date(this.#clock.now()).toISOString();
      this.#safeBroadcast(
        DEVICE_STATE_TOPIC(deviceId),
        buildDeviceStateBroadcast({
          deviceId,
          snapshot,
          reason: 'initial',
          ts,
        }),
      );
    }
  }

  /**
   * Arm the offline timer for a device. Returns the timer handle.
   * @param {string} deviceId
   * @private
   */
  #armTimer(deviceId) {
    return setTimeout(() => {
      const entry = this.#entries.get(deviceId);
      if (!entry) return;

      entry.online = false;
      entry.timer = null;

      this.#logger.warn?.('device-liveness.offline', {
        deviceId,
        sinceMs: this.#clock.now() - entry.lastSeenAt,
      });

      const ts = new Date(this.#clock.now()).toISOString();
      this.#safeBroadcast(
        DEVICE_STATE_TOPIC(deviceId),
        buildDeviceStateBroadcast({
          deviceId,
          snapshot: entry.snapshot,
          reason: 'offline',
          ts,
        }),
      );
    }, this.#offlineTimeoutMs);
  }

  /**
   * Broadcast defensively — catch errors so a bad handler doesn't tear down
   * the service.
   * @private
   */
  #safeBroadcast(topic, payload) {
    try {
      if (typeof this.#eventBus.broadcast === 'function') {
        this.#eventBus.broadcast(topic, payload);
      } else if (typeof this.#eventBus.publish === 'function') {
        this.#eventBus.publish(topic, payload);
      }
    } catch (err) {
      this.#logger.error?.('device-liveness.broadcast_error', {
        topic,
        error: err?.message,
      });
    }
  }
}

export default DeviceLivenessService;
