/**
 * ScreenPresenceService — owns a Home Assistant input_boolean per screen device,
 * driven by `screen.presence` WS messages. TRUE while the screen shows content,
 * FALSE otherwise. Defends against stale/lost state with: startup assert-off,
 * clean-transition off, a heartbeat TTL watchdog, periodic reconcile, and
 * immediate off on client disconnect.
 *
 * @module 3_applications/devices/services/ScreenPresenceService
 */

const DEFAULT_TTL_MS = 15000;
const DEFAULT_WATCHDOG_MS = 5000;
const DEFAULT_RECONCILE_MS = 60000;

export class ScreenPresenceService {
  #ha; #logger; #clock; #devices; #clientDevice;
  #watchdog; #reconcile; #watchdogMs; #reconcileMs;

  /**
   * @param {Object} opts
   * @param {{callService: Function}} opts.haGateway
   * @param {Object<string,{entity:string, ttlMs?:number}>|Map} opts.presenceByDevice
   * @param {Object} [opts.logger]
   * @param {{now:()=>number}} [opts.clock] - defaults to Date (Date.now)
   * @param {number} [opts.watchdogIntervalMs]
   * @param {number} [opts.reconcileIntervalMs]
   */
  constructor({ haGateway, presenceByDevice, logger = console, clock = Date,
    watchdogIntervalMs = DEFAULT_WATCHDOG_MS, reconcileIntervalMs = DEFAULT_RECONCILE_MS } = {}) {
    if (!haGateway) throw new Error('ScreenPresenceService requires haGateway');
    this.#ha = haGateway;
    this.#logger = logger;
    this.#clock = clock;
    this.#watchdogMs = watchdogIntervalMs;
    this.#reconcileMs = reconcileIntervalMs;
    this.#devices = new Map();
    const entries = presenceByDevice instanceof Map
      ? presenceByDevice.entries()
      : Object.entries(presenceByDevice || {});
    for (const [deviceId, cfg] of entries) {
      if (!cfg?.entity) continue;
      this.#devices.set(deviceId, {
        entity: cfg.entity,
        ttlMs: cfg.ttlMs || DEFAULT_TTL_MS,
        active: false,
        lastSeen: 0,
        asserted: null, // null = unknown until first assert
      });
    }
    this.#clientDevice = new Map(); // clientId -> deviceId
    this.#watchdog = null;
    this.#reconcile = null;
  }

  /** @param {{onClientMessage:Function, onClientDisconnection:Function}} eventBus */
  start(eventBus) {
    // Layer 3: startup assert OFF — clears a stale true left by a prior run/crash.
    for (const deviceId of this.#devices.keys()) this.#assert(deviceId, false, 'startup');

    if (typeof eventBus?.onClientMessage === 'function') {
      eventBus.onClientMessage((clientId, message) => this.#onMessage(clientId, message));
    }
    if (typeof eventBus?.onClientDisconnection === 'function') {
      eventBus.onClientDisconnection((clientId) => this.#onDisconnect(clientId));
    }

    this.#watchdog = setInterval(() => this.#tickWatchdog(), this.#watchdogMs);
    this.#reconcile = setInterval(() => this.#tickReconcile(), this.#reconcileMs);
    this.#watchdog.unref?.();
    this.#reconcile.unref?.();
    this.#logger.info?.('screen-presence.started', { devices: [...this.#devices.keys()] });
  }

  stop() {
    if (this.#watchdog) clearInterval(this.#watchdog);
    if (this.#reconcile) clearInterval(this.#reconcile);
    this.#watchdog = null;
    this.#reconcile = null;
  }

  #onMessage(clientId, message) {
    if (!message || message.type !== 'screen.presence') return;
    const device = this.#devices.get(message.deviceId);
    if (!device) return; // device not configured for presence
    this.#clientDevice.set(clientId, message.deviceId);
    device.lastSeen = this.#clock.now();
    device.active = !!message.active;
    this.#assert(message.deviceId, device.active, 'message');
  }

  #onDisconnect(clientId) {
    const deviceId = this.#clientDevice.get(clientId);
    this.#clientDevice.delete(clientId);
    if (!deviceId) return;
    const device = this.#devices.get(deviceId);
    if (!device) return;
    device.active = false; // Layer 5: client gone → inactive immediately
    this.#assert(deviceId, false, 'disconnect');
  }

  #tickWatchdog() {
    const now = this.#clock.now();
    for (const [deviceId, device] of this.#devices) {
      if (device.asserted === true && now - device.lastSeen > device.ttlMs) {
        device.active = false; // Layer 2: heartbeats stopped → stale → off
        this.#assert(deviceId, false, 'stale-ttl');
      }
    }
  }

  #tickReconcile() {
    const now = this.#clock.now();
    for (const [deviceId, device] of this.#devices) {
      const desired = device.active && (now - device.lastSeen <= device.ttlMs);
      // Layer 4: force a re-call even if asserted already matches — self-heals a
      // dropped/lost HA call. input_boolean turn_on/off is idempotent in HA.
      this.#callHa(device.entity, desired);
      device.asserted = desired;
    }
  }

  #assert(deviceId, on, reason) {
    const device = this.#devices.get(deviceId);
    if (!device) return;
    if (device.asserted === on) return; // idempotent — no flapping/spam
    this.#callHa(device.entity, on);
    device.asserted = on;
    this.#logger.info?.('screen-presence.assert', { deviceId, entity: device.entity, on, reason });
  }

  #callHa(entity, on) {
    Promise.resolve(
      this.#ha.callService('input_boolean', on ? 'turn_on' : 'turn_off', { entity_id: entity })
    ).catch((err) => this.#logger.warn?.('screen-presence.ha-call-failed', {
      entity, on, error: String(err?.message ?? err),
    }));
  }
}

export default ScreenPresenceService;
