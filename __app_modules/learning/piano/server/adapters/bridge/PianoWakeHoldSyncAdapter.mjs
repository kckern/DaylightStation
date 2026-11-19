const DEFAULT_TIMEOUT_MS = 10_000;
const SETTING = 'power.wakeSuppressUntilSec';

/**
 * Keeps the DaylightStation Android app's note-wake hold (`power.wakeSuppressUntilSec`,
 * epoch seconds, 0 = none) in step with the backend's screen override, when a relay
 * alone cannot:
 *
 * A saved local decision (including an explicit release or expired hold) wins.
 * On first migration only, adopt a valid unexpired tablet deadline. Failed
 * reads and writes retry on the supervisor's next reachable tick.
 */
export class PianoWakeHoldSyncAdapter {
  #baseUrl; #headers; #deviceId; #overrides; #now; #fetchImpl; #timeoutMs; #logger;
  #checking = null;
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
  async prepareWake() {
    if (this.#overrides.hasDecision?.(this.#deviceId)) return true;
    return !(await this.reconcile()).error;
  }

  reconcile() {
    if (!this.#checking) this.#checking = this.#check().finally(() => { this.#checking = null; });
    return this.#checking;
  }

  async #check() {
    if (!this.#pending) return { checked: false };
    this.#pending = false;
    try {
      const read = await this.#fetchImpl(`${this.#baseUrl}/settings`, { method: 'GET', headers: this.#headers, signal: AbortSignal.timeout(this.#timeoutMs) });
      if (!read?.ok) return this.#failed(`read HTTP ${read?.status ?? 'error'}`);
      const response = await read.json();
      const has = response?.settings?.find((s) => s.key === SETTING)?.value;
      if (response?.ok !== true || !Number.isInteger(has) || has < 0 || has > 2147483647)
        return this.#failed('invalid wake-suppression setting');
      // Read the backend's hold only now: one relayed while the GET was in flight must win.
      const override = this.#overrides.get(this.#deviceId);
      const now = this.#now();
      if (!override && this.#overrides.hasDecision?.(this.#deviceId) === false
          && has * 1000 > now
          && has * 1000 <= now + 86400000 + 1000) {
        this.#overrides.set(this.#deviceId, 'off', (has * 1000 - now) / 60000);
        return { checked: true, wrote: null };
      }
      const want = override?.state === 'off' ? Math.min(2147483647, Math.ceil(override.until / 1000)) : 0;
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
      // A user can clear/reassert while the tablet is writing. Recheck if that happened.
      const latest = this.#overrides.get(this.#deviceId);
      if (latest?.until !== override?.until || latest?.state !== override?.state) {
        this.#pending = true;
        return this.#check();
      }
      this.#logger.info?.('piano-wake-hold.resynced', { deviceId: this.#deviceId, had: has, wrote: want });
      return { checked: true, wrote: want };
    } catch (err) {
      return this.#failed(String(err?.message ?? err));
    }
  }

  #failed(error) {
    // Try again on the next reachable tick: the tablet may still hold a stale deadline.
    this.#pending = true;
    this.#logger.error?.('piano-wake-hold.resync-failed', { deviceId: this.#deviceId, error });
    return { checked: true, wrote: null, error };
  }
}

export default PianoWakeHoldSyncAdapter;
