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

const DEFAULT_OFFLINE_TIMEOUT_MS = 15000;

/**
 * @typedef {Object} LivenessEntry
 * @property {Object} snapshot      Last known SessionSnapshot
 * @property {number} lastSeenAt    Epoch ms of last heartbeat
 * @property {boolean} online       Whether the device is currently considered online
 * @property {*} [timer]            Node timer handle
 */

export class DeviceLivenessService {
  #presenceGateway;
  #logger;
  #clock;
  #offlineTimeoutMs;
  #scheduler;

  /** @type {Map<string, LivenessEntry>} */
  #entries = new Map();
  #unsubscribe = null;
  #started = false;

  /**
   * @param {Object} deps
   * @param {Object} deps.presenceGateway - Semantic device presence gateway
   * @param {Object} [deps.logger]
   * @param {Object} [deps.clock] - { now(): number } (defaults to Date)
   * @param {number} [deps.offlineTimeoutMs=15000]
   */
  constructor(deps = {}) {
    if (!deps.presenceGateway?.subscribeDeviceStates || !deps.presenceGateway?.publishDeviceState) {
      throw new TypeError('DeviceLivenessService requires presenceGateway');
    }
    if (!deps.scheduler?.after) throw new TypeError('DeviceLivenessService requires scheduler');
    this.#presenceGateway = deps.presenceGateway;
    this.#logger = deps.logger || console;
    this.#clock = deps.clock || Date;
    this.#scheduler = deps.scheduler;
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

    // Observe all semantic device-state changes through the presence gateway.
    if (typeof this.#presenceGateway.subscribeDeviceStates === 'function') {
      this.#unsubscribe = this.#presenceGateway.subscribeDeviceStates(
        (state) => this.#handleDeviceState(state),
      );
    } else {
      this.#logger.warn?.('device-liveness.no_subscribe_pattern', {
        note: 'presence gateway subscription unavailable — liveness inactive',
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
      if (entry.cancelOffline) {
        entry.cancelOffline();
        entry.cancelOffline = null;
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

  /**
   * All device ids with a cached snapshot. Used by the event bus to replay
   * every known device-state to a wildcard ('*') subscriber — /media clients
   * subscribe via predicate filters that sync as '*', so per-topic replay
   * alone never reaches them and a fresh tab would show "Not reporting"
   * until the next live broadcast.
   * @returns {string[]}
   */
  knownDeviceIds() {
    return [...this.#entries.keys()];
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
  #handleDeviceState(state) {
    if (!state || typeof state !== 'object') return;
    const { deviceId, reason, snapshot, topic } = state;
    if (!deviceId || typeof deviceId !== 'string') {
      this.#logger.debug?.('device-liveness.skip_no_device_id', { topic });
      return;
    }

    // Synthesized offline broadcasts re-enter this handler (pattern
    // subscribers fire on every publish). Don't treat them as a heartbeat.
    if (reason === 'offline') return;

    if (!snapshot || typeof snapshot !== 'object') {
      this.#logger.debug?.('device-liveness.skip_no_snapshot', { deviceId, reason });
      return;
    }

    const prevEntry = this.#entries.get(deviceId);
    const wasOffline = !!prevEntry && prevEntry.online === false;

    // Clear previous offline timer (if any) and arm a fresh one.
    prevEntry?.cancelOffline?.();

    const entry = {
      snapshot,
      lastSeenAt: this.#clock.now(),
      online: true,
      cancelOffline: null,
    };
    entry.cancelOffline = this.#armTimer(deviceId);
    this.#entries.set(deviceId, entry);

    // Synthesize a `reason: 'initial'` broadcast when returning from offline
    // via a heartbeat — gives subscribers a clean "back online" signal.
    if (wasOffline && reason === 'heartbeat') {
      this.#logger.info?.('device-liveness.online', { deviceId });
      const ts = new Date(this.#clock.now()).toISOString();
      this.#safePublish({ deviceId, snapshot, reason: 'initial', ts });
    }
  }

  /**
   * Arm the offline timer for a device. Returns the timer handle.
   * @param {string} deviceId
   * @private
   */
  #armTimer(deviceId) {
    return this.#scheduler.after(this.#offlineTimeoutMs, () => {
      const entry = this.#entries.get(deviceId);
      if (!entry) return;

      entry.online = false;
      entry.cancelOffline = null;

      this.#logger.warn?.('device-liveness.offline', {
        deviceId,
        sinceMs: this.#clock.now() - entry.lastSeenAt,
      });

      const ts = new Date(this.#clock.now()).toISOString();
      this.#safePublish({ deviceId, snapshot: entry.snapshot, reason: 'offline', ts });
    });
  }

  /**
   * Broadcast defensively — catch errors so a bad handler doesn't tear down
   * the service.
   * @private
   */
  #safePublish(state) {
    try {
      this.#presenceGateway.publishDeviceState(state);
    } catch (err) {
      this.#logger.error?.('device-liveness.broadcast_error', {
        deviceId: state.deviceId,
        error: err?.message,
      });
    }
  }
}

export default DeviceLivenessService;
