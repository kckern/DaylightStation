import { IPianoBridgeHealthProbe } from '#apps/devices/ports/IPianoBridgeHealthProbe.mjs';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * HTTP probe of the piano-bridge APK control plane (`:8770`): `GET /status` for
 * liveness and BLE state, `GET /loopback` for the piano's echo verdict.
 * See docs/runbooks/piano-kiosk-midi.md §0 for why the echo is the only proof
 * that MIDI OUT works.
 */
export class PianoBridgeHealthProbeAdapter extends IPianoBridgeHealthProbe {
  #baseUrl; #fetchImpl; #timeoutMs;

  /**
   * @param {Object} opts
   * @param {string} opts.bridgeUrl - http(s):// or ws(s):// base of the bridge
   * @param {Function} [opts.fetchImpl]
   * @param {number} [opts.timeoutMs]
   */
  constructor({ bridgeUrl, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super();
    if (!bridgeUrl) throw new Error('PianoBridgeHealthProbeAdapter requires bridgeUrl');
    if (typeof fetchImpl !== 'function') throw new Error('PianoBridgeHealthProbeAdapter requires fetchImpl');
    this.#baseUrl = bridgeUrl.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
    this.#fetchImpl = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async readHealth() {
    let status;
    try {
      status = await this.#getJson('/status');
    } catch (err) {
      return { reachable: false, ble: null, outVerified: null, error: String(err?.message ?? err) };
    }
    // Payloads since p19 put the echo verdict on /status; older ones only on /loopback.
    let outVerified = typeof status?.outVerified === 'boolean' ? status.outVerified : null;
    if (outVerified === null) {
      try {
        const verdict = (await this.#getJson('/loopback'))?.loopback?.outVerified;
        outVerified = typeof verdict === 'boolean' ? verdict : null;
      } catch { /* status answered; an unreadable loopback is "unknown", not "down" */ }
    }
    const ble = status?.ble?.state ?? null;
    return { reachable: true, ble: typeof ble === 'string' ? ble : null, outVerified, error: null };
  }

  async #getJson(path) {
    const res = await this.#fetchImpl(`${this.#baseUrl}${path}`, {
      method: 'GET',
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!res?.ok) throw new Error(`HTTP ${res?.status ?? 'error'} from ${path}`);
    return res.json();
  }
}

export default PianoBridgeHealthProbeAdapter;
