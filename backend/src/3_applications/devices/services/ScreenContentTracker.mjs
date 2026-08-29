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

  constructor({ presenceGateway, clock = Date, ttlMs = DEFAULT_TTL_MS, logger = console } = {}) {
    if (!presenceGateway?.subscribeScreenPresence) throw new Error('ScreenContentTracker requires presenceGateway');
    this.#devices = new Map();   // deviceId -> { playing, lastSeen }
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#logger = logger;
    this.presenceGateway = presenceGateway;
  }

  start() {
    this.presenceGateway.subscribeScreenPresence((presence) => this.record(presence));
    this.#logger.info?.('screen-content.started', { ttlMs: this.#ttlMs });
  }

  record(message) {
    if (!message?.deviceId) return;
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
