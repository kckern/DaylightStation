const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The bridge's speaker-repair endpoints (`:8770`), used by the supervisor's
 * speaker ladder. Never throws: every outcome is `{ok, error}`, because a failed
 * rung is a normal step on the ladder, not an exception.
 */
export class PianoBridgeSpeakerActionsAdapter {
  #baseUrl; #fetchImpl; #timeoutMs;

  constructor({ bridgeUrl, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!bridgeUrl) throw new Error('PianoBridgeSpeakerActionsAdapter requires bridgeUrl');
    this.#baseUrl = bridgeUrl.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
    this.#fetchImpl = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  a2dpReconnect() { return this.#post('/speaker/reconnect'); }

  bluetoothCycle(settleMs) {
    return this.#post(`/speaker/bt-cycle?settleMs=${Math.max(0, Math.round(Number(settleMs) || 0))}`);
  }

  /**
   * Readiness check: does the bridge carry the repair endpoints? A GET answers
   * "POST only" when they exist and 404 on an older payload.
   * @returns {Promise<{present: boolean|null}>} null when the bridge could not be asked
   */
  async probeEndpoints() {
    try {
      for (const path of ['/speaker/reconnect', '/speaker/bt-cycle']) {
        const r = await this.#fetchImpl(`${this.#baseUrl}${path}`, { method: 'GET', signal: AbortSignal.timeout(this.#timeoutMs) });
        if (r?.status === 404) return { present: false };
        if (!r?.ok) return { present: null };
      }
      return { present: true };
    } catch {
      return { present: null };
    }
  }

  async #post(path) {
    try {
      const res = await this.#fetchImpl(`${this.#baseUrl}${path}`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (res?.status === 404) return { ok: false, error: 'endpoint-missing' };
      if (!res?.ok) return { ok: false, error: `HTTP ${res?.status ?? 'error'}` };
      const body = await res.json().catch(() => ({}));
      return body?.ok === false ? { ok: false, error: String(body.error ?? 'refused') } : { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  }
}

export default PianoBridgeSpeakerActionsAdapter;
