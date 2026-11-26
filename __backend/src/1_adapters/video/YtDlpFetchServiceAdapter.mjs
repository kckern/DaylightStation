/**
 * YtDlpFetchServiceAdapter — the client of the ytdlp-fetch service
 * (`_extensions/ytdlp-fetch/server.mjs`): yt-dlp in its own container, over the
 * VPN, with PO tokens. The video stays in the service's storage; the app
 * streams it from there (`media.open({ start, end })`), so nothing large lands
 * in the app's (synced) media folder.
 *
 *   fetch(url, { name, maxHeight, onProgress, signal })
 *     -> { kind: 'downloaded', title, duration, media } | { kind: 'failed', error, reason }
 *     throws InfrastructureError when the service cannot be reached (the
 *     failover moves on to the next fetcher)
 *   stored(name) -> { title, duration, media } | null      (after an app restart)
 *   cancel(name)
 *   health() -> { ok, ytdlp, ... } | null
 *
 * Reference: __docs/reference/core/share.md (the fetch service)
 */
import { PassThrough, Readable } from 'node:stream';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const NAME = /^s[0-9a-f]{12}$/;
export const FETCH_POLL_MS = 700;

/** Why a fetch failed, from the service's error text. */
export function failureReason(error) {
  const text = String(error || '');
  if (/no progress for/i.test(text)) return 'stalled';
  if (/cancelled/i.test(text)) return 'cancelled';
  if (/too large|max-filesize|does not pass filter/i.test(text)) return 'too_large';
  if (/unavailable|private video|removed|members-only|sign in|age/i.test(text)) return 'unavailable';
  return 'error';
}

export class YtDlpFetchServiceAdapter {
  #base; #fetch; #logger; #pollMs; #wait;

  /**
   * @param {object} deps
   * @param {string} deps.baseUrl - e.g. http://vpn:8790
   * @param {Function} [deps.fetchImpl] - injectable fetch
   */
  constructor({ baseUrl, fetchImpl = globalThis.fetch, logger = console, pollMs = FETCH_POLL_MS, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    if (!baseUrl) throw new Error('YtDlpFetchServiceAdapter requires baseUrl');
    this.#base = String(baseUrl).replace(/\/+$/, '');
    this.#fetch = fetchImpl;
    this.#logger = logger;
    this.#pollMs = pollMs;
    this.#wait = wait;
  }

  get name() { return 'fetch-service'; }

  async #json(path, init = {}) {
    let res;
    try {
      res = await this.#fetch(`${this.#base}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000) });
    } catch (error) {
      throw new InfrastructureError(`fetch service unreachable: ${error.message}`, { code: 'FETCH_SERVICE_UNREACHABLE' });
    }
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status >= 500) throw new InfrastructureError(`fetch service answered ${res.status}`, { code: 'FETCH_SERVICE_ERROR' });
    return { status: res.status, body };
  }

  async health() {
    try { return (await this.#json('/health')).body; } catch { return null; }
  }

  #media(name, size) {
    const base = this.#base;
    const fetchImpl = this.#fetch;
    const logger = this.#logger;
    return Object.freeze({
      size,
      mimeType: 'video/mp4',
      open(range) {
        const out = new PassThrough();
        const headers = range ? { Range: `bytes=${range.start}-${range.end}` } : {};
        fetchImpl(`${base}/fetch/${name}/file`, { headers })
          .then((res) => {
            if (!res.ok || !res.body) throw new Error(`fetch service file ${res.status}`);
            Readable.fromWeb(res.body).on('error', (e) => out.destroy(e)).pipe(out);
          })
          .catch((error) => {
            logger.warn?.('share.fetch-service.stream-failed', { name, error: error.message });
            out.destroy(error);
          });
        return out;
      },
    });
  }

  async fetch(url, { name, maxHeight, onProgress, signal } = {}) {
    if (!NAME.test(String(name))) throw new Error('bad fetch name');
    const started = await this.#json('/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, maxHeight }),
    });
    if (started.status >= 400) {
      return { kind: 'failed', error: started.body?.error || `fetch refused (${started.status})`, reason: 'error' };
    }
    let misses = 0;
    for (;;) {
      if (signal?.aborted) {
        await this.cancel(name);
        return { kind: 'failed', error: 'cancelled', reason: 'cancelled' };
      }
      let job;
      try {
        const { status, body } = await this.#json(`/fetch/${name}`);
        if (status === 404) return { kind: 'failed', error: 'the fetch service lost the job', reason: 'error' };
        job = body;
        misses = 0;
      } catch (error) {
        // A blip is waited out; a service that stays away is the next fetcher's turn.
        misses += 1;
        if (misses >= 5) throw error;
        await this.#wait(this.#pollMs * 2);
        continue;
      }
      if (job.state === 'downloading' || job.state === 'queued') onProgress?.(Number(job.progress) || 0);
      if (job.state === 'ready') {
        return { kind: 'downloaded', title: job.title ?? null, duration: job.duration ?? null, media: this.#media(name, Number(job.size) || 0) };
      }
      if (job.state === 'failed') return { kind: 'failed', error: job.error || 'failed', reason: failureReason(job.error) };
      await this.#wait(this.#pollMs);
    }
  }

  async stored(name) {
    if (!NAME.test(String(name))) return null;
    try {
      const { status, body } = await this.#json(`/fetch/${name}`);
      if (status !== 200 || body?.state !== 'ready') return null;
      return { title: body.title ?? null, duration: body.duration ?? null, media: this.#media(name, Number(body.size) || 0) };
    } catch {
      return null;
    }
  }

  async cancel(name) {
    if (!NAME.test(String(name))) return;
    try { await this.#json(`/fetch/${name}`, { method: 'DELETE' }); } catch { /* the service sweeps it */ }
  }
}

export default YtDlpFetchServiceAdapter;
