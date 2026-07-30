/**
 * LivingroomTvSurface — the DoNow adapter for the living-room Shield TV
 * (spec §5, surface id `livingroom-tv`).
 *
 * Dispatch delegates straight to the existing
 * `WakeAndLoadService.execute(deviceId, query)` orchestration (device
 * registry lookup, the full wake stack, its own acks) — this adapter adds no
 * device-control logic of its own.
 *
 * Occupancy is the three-step rule from spec §5.1 (the reason
 * `PlaybackPresenceTracker` deliberately does NOT expose its own
 * `occupancy()` — composing these two signals IS this adapter's job):
 *
 *   1. TV power off (`tvState.isOn()`, a thin wrap of `TVControlAdapter` /
 *      the HA `binary_sensor.living_room_tv_state` sensor) → idle.
 *   2. Power on AND `playback.playingRecently()` (recent `playback.log`
 *      frames) → active (occupant always null — the living room never
 *      knows WHO is watching).
 *   3. Power on with no recent frames → idle (paused/menu is idle — the
 *      same deploy-gate semantics: a paused tab does not block).
 *
 * `tvState.isOn()` throwing → unknown (fail closed) — an unreachable power
 * sensor must not be read as either "definitely off" (would clobber) or
 * "definitely on" (would page a parent for nothing).
 */
export class LivingroomTvSurface {
  #wakeAndLoad;
  #tvState;
  #playback;
  #deviceId;
  #logger;

  /**
   * @param {Object} config
   * @param {{execute: Function}} [config.wakeAndLoad] - WakeAndLoadService-shaped; optional
   * @param {{isOn: Function}} [config.tvState] - thin TVControlAdapter/HA-sensor wrap; optional
   * @param {{playingRecently: Function}} [config.playback] - PlaybackPresenceTracker; optional
   * @param {string} [config.deviceId='livingroom-tv'] - devices.yml id
   * @param {Object} [config.logger]
   */
  constructor({
    wakeAndLoad = null, tvState = null, playback = null, deviceId = 'livingroom-tv', logger = console,
  } = {}) {
    this.#wakeAndLoad = wakeAndLoad;
    this.#tvState = tvState;
    this.#playback = playback;
    this.#deviceId = deviceId;
    this.#logger = logger;
  }

  get id() { return 'livingroom-tv'; }

  /** @param {{query: object}} raw */
  validateAction(raw) {
    if (!raw || typeof raw !== 'object') return ['action must be an object'];
    if (!raw.query || typeof raw.query !== 'object') return ['action.query is required'];
    return [];
  }

  /** @returns {Promise<{state: 'idle'|'active'|'unknown', occupantId: null}>} */
  async occupancy() {
    if (!this.#tvState) return { state: 'unknown', occupantId: null };
    let isOn;
    try {
      isOn = await this.#tvState.isOn();
    } catch (err) {
      this.#logger.warn?.('donow.livingroom-tv.occupancy-failed', { error: err?.message || String(err) });
      return { state: 'unknown', occupantId: null };
    }
    if (!isOn) return { state: 'idle', occupantId: null };
    const playingRecently = this.#playback ? Boolean(this.#playback.playingRecently()) : false;
    return { state: playingRecently ? 'active' : 'idle', occupantId: null };
  }

  /** @returns {Promise<{dispatched: boolean, detail?: *}>} */
  async dispatch({ action }) {
    if (!this.#wakeAndLoad) return { dispatched: false };
    try {
      const result = await this.#wakeAndLoad.execute(this.#deviceId, action.query);
      return { dispatched: Boolean(result?.ok), detail: result };
    } catch (err) {
      this.#logger.warn?.('donow.livingroom-tv.dispatch-failed', { error: err?.message || String(err) });
      return { dispatched: false };
    }
  }

  label() { return 'The living room TV'; }
}

export default LivingroomTvSurface;
