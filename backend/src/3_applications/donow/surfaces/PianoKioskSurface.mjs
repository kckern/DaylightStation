/**
 * PianoKioskSurface — the DoNow adapter for the Piano Kiosk tablet (spec §5,
 * surface id `piano-kiosk`).
 *
 * Dispatch broadcasts a NEW `piano.launch` message on the existing
 * `kiosk.launch` relay pattern (`backend/src/0_system/eventbus/
 * kioskLaunchRelay.mjs`, handled beside the frontend's
 * `useKioskLaunchCommand` — same device-identity filter: the kiosk drops
 * any message whose `deviceId` isn't its own).
 *
 * `kioskDeviceParam` NOTE (spec §5 addressing caveat): this is the tablet's
 * `?device=` localStorage identity STRING (see
 * `frontend/src/modules/Piano/PianoKiosk/kioskDeviceIdentity.js`), NOT a
 * `devices.yml` id — the same distinction behind the screensaver
 * shared-deviceId bug, where a shared `devices.yml` id put multiple
 * tablets to sleep together because they all matched one identity. This
 * adapter is configured with the kiosk's device PARAM value at composition
 * (from `piano.yml`), never a devices.yml entry — DoNow does not invent a
 * sixth addressing scheme.
 *
 * Occupancy delegates entirely to the injected `MidiPresenceTracker`
 * (`presence.occupancy()`), which already encodes the fresh/idle rule from
 * spec §5.1 (any MIDI activity within 5 minutes → active; a missed
 * `session_end` self-heals via that TTL, silence beyond it reads idle, not
 * unknown — no MIDI ever seen just means nobody has played).
 */
export class PianoKioskSurface {
  #eventBus;
  #presence;
  #kioskDeviceParam;
  #logger;

  /**
   * @param {Object} config
   * @param {{broadcast: Function}} [config.eventBus] - optional; absent means no target is listening
   * @param {{occupancy: Function}} [config.presence] - MidiPresenceTracker-shaped; optional
   * @param {string} config.kioskDeviceParam - the tablet's `?device=` identity string (NOT a devices.yml id)
   * @param {Object} [config.logger]
   */
  constructor({
    eventBus = null, presence = null, kioskDeviceParam = null, logger = console,
  } = {}) {
    this.#eventBus = eventBus;
    this.#presence = presence;
    this.#kioskDeviceParam = kioskDeviceParam;
    this.#logger = logger;
  }

  get id() { return 'piano-kiosk'; }

  /** @param {{contentId: string}} raw */
  validateAction(raw) {
    if (!raw || typeof raw !== 'object') return ['action must be an object'];
    if (typeof raw.contentId !== 'string' || raw.contentId.length === 0) return ['action.contentId is required'];
    return [];
  }

  /** @returns {Promise<{state: 'idle'|'active'|'unknown', occupantId: null}>} */
  async occupancy() {
    if (!this.#presence) return { state: 'unknown', occupantId: null };
    try {
      return this.#presence.occupancy();
    } catch (err) {
      this.#logger.warn?.('donow.piano-kiosk.occupancy-failed', { error: err?.message || String(err) });
      return { state: 'unknown', occupantId: null };
    }
  }

  /** @returns {Promise<{dispatched: boolean}>} */
  async dispatch({ action }) {
    if (!this.#eventBus) {
      this.#logger.warn?.('donow.piano-kiosk.no-bus', { contentId: action?.contentId });
      return { dispatched: false };
    }
    try {
      this.#eventBus.broadcast('kiosk.launch', {
        topic: 'kiosk.launch',
        deviceId: this.#kioskDeviceParam,
        contentId: action.contentId,
        type: 'piano.launch',
      });
    } catch (err) {
      this.#logger.warn?.('donow.piano-kiosk.dispatch-failed', { error: err?.message || String(err) });
      return { dispatched: false };
    }
    return { dispatched: true };
  }

  label() { return 'The Piano Kiosk'; }
}

export default PianoKioskSurface;
