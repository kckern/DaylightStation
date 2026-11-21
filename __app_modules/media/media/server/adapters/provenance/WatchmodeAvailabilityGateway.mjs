/**
 * Streaming availability from Watchmode (api.watchmode.com).
 *
 * One call per title: `GET /v1/title/{id}/sources/`, where id is an IMDb id or a
 * typed TMDB id (`movie-603`, `tv-1396`). Watchmode counts the call against the
 * account's monthly quota (2 credits for an id lookup as of 2026-11) and reports
 * the running total in `X-Account-Quota-Used`, which is passed back so the
 * caller can hold a reserve without counting calls itself.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import { IStreamingAvailabilityGateway } from '../../application/provenance/ports/IStreamingAvailabilityGateway.mjs';

const BASE = 'https://api.watchmode.com/v1';

const num = (v) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };

export class WatchmodeAvailabilityGateway extends IStreamingAvailabilityGateway {
  #apiKey; #region; #fetch; #timeoutMs;

  constructor({ apiKey, region = 'US', fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
    super();
    if (!apiKey) throw new Error('WatchmodeAvailabilityGateway requires apiKey');
    this.#apiKey = apiKey;
    this.#region = region;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async sources(lookupId) {
    const id = String(lookupId ?? '');
    if (!/^(tt\d+|movie-\d+|tv-\d+)$/.test(id)) throw new Error(`bad lookup id: ${id}`);
    const url = `${BASE}/title/${id}/sources/?apiKey=${encodeURIComponent(this.#apiKey)}&regions=${encodeURIComponent(this.#region)}`;
    const res = await this.#fetch(url, { signal: AbortSignal.timeout(this.#timeoutMs), headers: { Accept: 'application/json' } });
    const quota = num(res.headers?.get?.('x-account-quota'));
    const quotaUsed = num(res.headers?.get?.('x-account-quota-used'));
    if (res.status === 404) return { sources: [], quota, quotaUsed };
    if (!res.ok) {
      const err = new Error(`watchmode ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    // An unknown title comes back as an error object rather than a 404.
    const list = Array.isArray(body) ? body : [];
    const sources = list
      .filter((s) => s && (!s.region || s.region === this.#region))
      .map((s) => ({ name: String(s.name ?? ''), type: String(s.type ?? ''), url: s.web_url || null }));
    return { sources, quota, quotaUsed };
  }
}
