/**
 * LoadOriginHints — "who asked for this" carried from a load to the playback
 * start it causes.
 *
 * A routine (Home Assistant calling GET /device/:id/load) or a person sending
 * from another screen knows the origin; the screen that then plays reports
 * play/log without one. The load notes its origin here, keyed by the ledger
 * device id (`fleet:<devices.yml key>`), and the play ledger takes it for the
 * first start on that screen within `windowMs` (default 3 min — a cold TV
 * wake plus load is ~30-60 s). A hint is used once; later items of the same
 * queue are attributed at read time (see ScreenPlaybackService.startedBy).
 *
 * In memory only: a restart between load and start loses the hint, and the
 * row is written with origin null — never a wrong origin.
 */
const DEFAULT_WINDOW_MS = 3 * 60 * 1000;

export class LoadOriginHints {
  #windowMs;
  /** @type {Map<string, {origin:Object, at:number}>} */
  #hints = new Map();

  constructor({ windowMs = DEFAULT_WINDOW_MS } = {}) {
    this.#windowMs = windowMs;
  }

  /**
   * @param {string} deviceId - ledger device id
   * @param {Object|null} origin - null clears any pending hint
   * @param {number} atEpoch
   */
  note(deviceId, origin, atEpoch) {
    if (!deviceId) return;
    if (!origin) { this.#hints.delete(deviceId); return; }
    this.#hints.set(deviceId, { origin, at: atEpoch });
  }

  /**
   * The pending origin for a start on this screen, consumed; null when none
   * or too old.
   * @param {string} deviceId
   * @param {number} atEpoch
   */
  take(deviceId, atEpoch) {
    const hint = this.#hints.get(deviceId);
    if (!hint) return null;
    this.#hints.delete(deviceId);
    return atEpoch - hint.at <= this.#windowMs ? hint.origin : null;
  }
}

export default LoadOriginHints;
