/** Authenticated actuator for the Portal Keys APK's local control server. */
export class PortalKeysLockdownAdapter {
  #baseUrl; #token; #fetch; #logger;
  constructor({ baseUrl, token, fetchFn = fetch, logger = console } = {}) {
    this.#baseUrl = baseUrl?.replace(/\/$/, ''); this.#token = token; this.#fetch = fetchFn; this.#logger = logger;
  }
  async setLockdown({ locked, lockedUntil = null }) {
    if (!this.#baseUrl || !this.#token) return { ok: false, skipped: true };
    const res = await this.#fetch(`${this.#baseUrl}/lockdown`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Lockdown-Token': this.#token },
      body: JSON.stringify({ locked: !!locked, lockedUntil: lockedUntil ? Date.parse(lockedUntil) : null }), signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Portal Keys lockdown HTTP ${res.status}`);
    this.#logger.info?.('shutdown.portal_synced', { locked: !!locked, lockedUntil });
    return { ok: true };
  }
}
