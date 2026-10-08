/**
 * BrowserPlaybackTracker — the last `playback_state` a browser tab published
 * about itself: what it is playing and who started it (`origin`).
 *
 * A fleet screen's live snapshot is read from device liveness; a browser has
 * no such snapshot, and its play/log ledger rows only appear after ten
 * seconds of playback (and not at all where play/log is not wired). This is
 * the browser's own, immediate account of how its current item started —
 * a routine that drove the tab over `client-control` stamps `origin` on the
 * session, and the tab broadcasts it with every state frame.
 *
 * Entries older than `ttlMs` are ignored: a tab that went silent is not
 * "playing now".
 */
const LIVE_STATES = new Set(['playing', 'paused', 'buffering', 'loading']);

export class BrowserPlaybackTracker {
  #entries = new Map();
  #clock;
  #ttlMs;

  constructor({ clock = Date, ttlMs = 120_000 } = {}) {
    this.#clock = clock;
    this.#ttlMs = ttlMs;
  }

  /** @param {{deviceId:string, state?:string, contentId?:string|null, title?:string|null, origin?:Object|null}} frame */
  observe({ deviceId, state = null, contentId = null, title = null, origin = null } = {}) {
    if (typeof deviceId !== 'string' || !deviceId) return;
    this.#entries.set(deviceId, { deviceId, state, contentId, title, origin, at: this.#clock.now() });
  }

  get(deviceId) {
    const entry = this.#entries.get(deviceId);
    if (!entry || this.#clock.now() - entry.at > this.#ttlMs) return null;
    return entry;
  }

  /** Browsers that report an item playing (or paused) right now. */
  list() {
    return [...this.#entries.values()].filter((entry) => this.get(entry.deviceId)
      && entry.contentId && LIVE_STATES.has(entry.state));
  }
}

export default BrowserPlaybackTracker;
