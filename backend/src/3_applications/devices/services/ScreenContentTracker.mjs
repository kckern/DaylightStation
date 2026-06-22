// backend/src/3_applications/devices/services/ScreenContentTracker.mjs
/**
 * ScreenContentTracker — per-device "is a real video playing" registry, fed by
 * `screen.presence` WS messages carrying a `playing` flag (true only for
 * non-art content; ArtMode/screensaver report playing:false). A heartbeat older
 * than the TTL is treated as not-playing (a crashed player tab stops beating).
 *
 * @module 3_applications/devices/services/ScreenContentTracker
 */
const DEFAULT_TTL_MS = 15000;

export class ScreenContentTracker {
  #devices; #clock; #ttlMs; #logger;

  constructor({ clock = Date, ttlMs = DEFAULT_TTL_MS, logger = console } = {}) {
    this.#devices = new Map();   // deviceId -> { playing, lastSeen }
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#logger = logger;
  }

  /** @param {{onClientMessage?:Function}} eventBus */
  start(eventBus) {
    if (typeof eventBus?.onClientMessage === 'function') {
      eventBus.onClientMessage((_clientId, message) => this.record(message));
    }
    this.#logger.info?.('screen-content.started', { ttlMs: this.#ttlMs });
  }

  record(message) {
    if (!message || message.type !== 'screen.presence' || !message.deviceId) return;
    this.#devices.set(message.deviceId, {
      playing: message.playing === true,
      lastSeen: this.#clock.now(),
    });
  }

  isPlaying(deviceId) {
    const d = this.#devices.get(deviceId);
    if (!d) return false;
    if (this.#clock.now() - d.lastSeen > this.#ttlMs) return false;
    return d.playing === true;
  }
}

export default ScreenContentTracker;
