const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Restarts the piano bridge when it lives inside the DaylightStation Android app:
 * `POST /restart` on the app shell's lifeline port, which restarts the payload
 * (the MIDI link, the synth, the kiosk page) and answers even while the control
 * port is down. Never throws: the supervisor treats a failed relaunch as one step
 * of its backoff.
 */
export class PianoBridgeLifelineRestartAdapter {
  #url; #headers; #fetchImpl; #timeoutMs;

  /**
   * @param {Object} opts
   * @param {string} opts.lifelineBase - http://<tablet>:<lifeline port>
   * @param {Object} [opts.headers] - the token header
   */
  constructor({ lifelineBase, headers = {}, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!lifelineBase) throw new Error('PianoBridgeLifelineRestartAdapter requires lifelineBase');
    this.#url = `${lifelineBase.replace(/\/+$/, '')}/restart`;
    this.#headers = { ...headers };
    this.#fetchImpl = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  /** @returns {Promise<{ok: boolean, error?: string}>} */
  async restart() {
    try {
      const res = await this.#fetchImpl(this.#url, { method: 'POST', headers: this.#headers, signal: AbortSignal.timeout(this.#timeoutMs) });
      return res?.ok ? { ok: true } : { ok: false, error: `lifeline HTTP ${res?.status ?? 'error'}` };
    } catch (err) {
      return { ok: false, error: `lifeline ${String(err?.message ?? err)}` };
    }
  }
}

export default PianoBridgeLifelineRestartAdapter;
