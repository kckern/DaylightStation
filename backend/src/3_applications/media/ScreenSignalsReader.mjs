/**
 * ScreenSignalsReader — when each screen was last heard from, for the screen
 * registry's lastSeen / "Not seen lately" (RQ-HOUSE-08).
 *
 *   fleet device-state   DeviceLivenessService: online now + last heartbeat
 *                        (in memory, since this process started)
 *   play ledger          newest playback start per device id (31 days back),
 *                        which survives restarts and covers browsers
 *
 * Browser announces are tracked by ScreenRegistryService itself.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 31;

export class ScreenSignalsReader {
  #liveness;
  #ledger;
  #clock;
  #logger;

  constructor({ livenessService = null, playLedger = null, clock = Date, logger = console } = {}) {
    this.#liveness = livenessService;
    this.#ledger = playLedger;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** @returns {Promise<Object<string, {lastSeen?:string, online?:boolean}>>} */
  async read() {
    const out = {};
    const bump = (id, lastSeen) => {
      if (!id || !Number.isFinite(Date.parse(lastSeen))) return;
      const prev = out[id]?.lastSeen;
      if (!prev || Date.parse(lastSeen) > Date.parse(prev)) out[id] = { ...(out[id] || {}), lastSeen };
    };
    if (this.#liveness) {
      try {
        for (const screenId of this.#liveness.knownDeviceIds()) {
          const entry = this.#liveness.getLastSnapshot(screenId);
          if (!entry) continue;
          const id = `fleet:${screenId}`;
          bump(id, entry.lastSeenAt);
          out[id] = { ...(out[id] || {}), online: entry.online === true };
        }
      } catch (error) {
        this.#logger.warn?.('media.screens.liveness_read_failed', { error: error.message });
      }
    }
    if (this.#ledger?.plays) {
      try {
        const from = new Date(this.#clock.now() - LOOKBACK_DAYS * DAY_MS).toISOString();
        for (const row of await this.#ledger.plays({ from, limit: 100000, nowEpoch: this.#clock.now() })) {
          bump(row.deviceId, row.startedAt);
        }
      } catch (error) {
        this.#logger.warn?.('media.screens.ledger_read_failed', { error: error.message });
      }
    }
    return out;
  }
}

export default ScreenSignalsReader;
