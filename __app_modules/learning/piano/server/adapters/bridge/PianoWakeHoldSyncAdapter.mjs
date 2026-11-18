const DEFAULT_TIMEOUT_MS = 10_000;
const SETTING = 'power.wakeSuppressUntilSec';

/**
 * Keeps the DaylightStation Android app's note-wake hold (`power.wakeSuppressUntilSec`,
 * epoch seconds, 0 = none) in step with the backend's screen override, when a relay
 * alone cannot:
 *
 * - The override lives in memory, so after a backend restart the tablet can still
 *   hold a future deadline that nothing will clear.
 * - A relay that failed left the tablet with the old value.
 *
 * `reconcile()` runs on the bridge supervisor's reachable ticks. It acts on the first
 * one after boot, and on the first one after `relayFailed()`; each such check is made
 * once (a check that fails is logged and not repeated every tick). It reads the
 * device's value and writes the backend's: the `off` override's deadline, or 0 when
 * the backend holds nothing and the tablet still holds a future deadline.
 */
export class PianoWakeHoldSyncAdapter {
  #baseUrl; #headers; #deviceId; #overrides; #now; #fetchImpl; #timeoutMs; #logger;
  #pending = true;   // the first reachable tick after boot

  constructor({ baseUrl, headers = {}, deviceId, overrides, now = () => Date.now(), fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, logger = console } = {}) {
    if (!baseUrl) throw new Error('PianoWakeHoldSyncAdapter requires baseUrl');
    if (!deviceId) throw new Error('PianoWakeHoldSyncAdapter requires deviceId');
    if (typeof overrides?.get !== 'function') throw new Error('PianoWakeHoldSyncAdapter requires overrides');
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#headers = { ...headers };
    this.#deviceId = deviceId;
    this.#overrides = overrides;
    this.#now = now;
    this.#fetchImpl = fetchImpl;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  /** A relay did not reach the device: check it on the next reachable tick. */
  relayFailed() { this.#pending = true; }

  /** @returns {Promise<{checked: boolean, wrote?: number|null, error?: string}>} */
  async reconcile() {
    if (!this.#pending) return { checked: false };
    this.#pending = false;
    const override = this.#overrides.get(this.#deviceId);
    const want = override?.state === 'off' ? Math.ceil(override.until / 1000) : 0;
    try {
      const read = await this.#fetchImpl(`${this.#baseUrl}/settings`, { method: 'GET', headers: this.#headers, signal: AbortSignal.timeout(this.#timeoutMs) });
      if (!read?.ok) return this.#failed(`read HTTP ${read?.status ?? 'error'}`);
      const has = Number((await read.json())?.settings?.find((s) => s.key === SETTING)?.value ?? 0);
      const holding = has * 1000 > this.#now();
      const agrees = want > 0 ? has === want : !holding;
      if (agrees) {
        this.#logger.debug?.('piano-wake-hold.resync-agrees', { deviceId: this.#deviceId, value: has });
        return { checked: true, wrote: null };
      }
      const write = await this.#fetchImpl(`${this.#baseUrl}/settings`, {
        method: 'POST',
        headers: { ...this.#headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: SETTING, value: want }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!write?.ok) return this.#failed(`HTTP ${write?.status ?? 'error'}`);
      this.#logger.info?.('piano-wake-hold.resynced', { deviceId: this.#deviceId, had: has, wrote: want });
      return { checked: true, wrote: want };
    } catch (err) {
      return this.#failed(String(err?.message ?? err));
    }
  }

  #failed(error) {
    this.#logger.error?.('piano-wake-hold.resync-failed', { deviceId: this.#deviceId, error });
    return { checked: true, wrote: null, error };
  }
}

export default PianoWakeHoldSyncAdapter;
