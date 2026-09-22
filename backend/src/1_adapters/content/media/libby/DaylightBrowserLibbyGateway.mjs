import { ILibbyBootstrapGateway, normalizeBootstrapSpine, validBootstrapInput } from '#apps/proxy/ports/ILibbyBootstrapGateway.mjs';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const failure = code => Object.assign(new Error(code), { code });

function privateBase(value) {
  let url;
  try { url = new URL(value); } catch { /* Fail closed below. */ }
  const host = url?.hostname || '';
  const octets = host.split('.').map(Number);
  const privateV4 = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168));
  // Fixed Docker service identity or private literals only: no arbitrary DNS target.
  const privateHost = ['daylight-browser', 'localhost', '[::1]'].includes(host) || privateV4 || /^\[f[cd][0-9a-f]{2}:/.test(host);
  if (!url || url.protocol !== 'http:' || !privateHost || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('DaylightBrowser requires a private HTTP base URL');
  }
  return url;
}

function listenUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*listen\.libbyapp\.com$/.test(url.hostname)) return null;
  return url;
}

function signedAudioUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  return url.protocol === 'https:' && url.hostname === 'audioclips.cdn.overdrive.com'
    && !url.port && !url.username && !url.password && !url.hash ? url : null;
}

/** Narrow HTTP adapter. Neither request capabilities nor external error detail are logged. */
export class DaylightBrowserLibbyGateway extends ILibbyBootstrapGateway {
  #endpoint;
  #fetch;
  #timeoutMs;

  constructor({ baseUrl, fetch = globalThis.fetch, timeoutMs = 75_000 } = {}) {
    super();
    this.#endpoint = new URL('/v1/operations/libby.bootstrap-loan', privateBase(baseUrl)).href;
    if (typeof fetch !== 'function') throw new Error('DaylightBrowser requires fetch');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 90_000) throw new Error('DaylightBrowser requires a bounded deadline');
    this.#fetch = fetch;
    this.#timeoutMs = timeoutMs;
  }

  async bootstrapLoan(input, { signal } = {}) {
    const web = listenUrl(input?.webUrl);
    if (!validBootstrapInput(input) || !web || web.search || /[\x00-\x20\x7f#]/.test(input.message) || input.message.startsWith('?')) {
      throw failure('BOOTSTRAP_INVALID_REQUEST');
    }
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > 65536) throw failure('BOOTSTRAP_INVALID_REQUEST');
    if (signal?.aborted) throw failure('BOOTSTRAP_ABORTED');
    const controller = new AbortController();
    let response;
    let reader;
    let abortCode;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = code => {
      abortCode ??= code;
      controller.abort();
      rejectAbort(failure(abortCode));
    };
    const onAbort = () => abort('BOOTSTRAP_ABORTED');
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => abort('BOOTSTRAP_TIMEOUT'), this.#timeoutMs);
    try {
      response = await Promise.race([this.#fetch(this.#endpoint, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body,
      }).then(result => {
        if (controller.signal.aborted) void result.body?.cancel().catch(() => {});
        return result;
      }), aborted]);
      if (response.status !== 200) {
        const code = { 409: 'BOOTSTRAP_BUSY', 422: 'BOOTSTRAP_UNSUPPORTED', 504: 'BOOTSTRAP_TIMEOUT' }[response.status];
        throw failure(code || 'BOOTSTRAP_UNAVAILABLE');
      }
      const length = response.headers.get('content-length');
      if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')
        || (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) || !response.body) {
        throw failure('BOOTSTRAP_INVALID_RESPONSE');
      }
      reader = response.body.getReader();
      let bytes = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw failure('BOOTSTRAP_INVALID_RESPONSE');
        chunks.push(Buffer.from(value));
      }
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('BOOTSTRAP_INVALID_RESPONSE'); }
      const normalized = normalizeBootstrapSpine(parsed);
      if (normalized.parts.some(part => !signedAudioUrl(part.upstreamUrl))) throw failure('BOOTSTRAP_INVALID_RESPONSE');
      return normalized;
    } catch (error) {
      const code = abortCode || (['BOOTSTRAP_INVALID_RESPONSE', 'BOOTSTRAP_BUSY', 'BOOTSTRAP_UNSUPPORTED', 'BOOTSTRAP_TIMEOUT'].includes(error?.code)
        ? error.code : 'BOOTSTRAP_UNAVAILABLE');
      throw failure(code);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
  }
}
