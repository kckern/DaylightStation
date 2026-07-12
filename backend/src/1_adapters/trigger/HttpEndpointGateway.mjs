/**
 * HTTP implementation of IEndpointGateway. Resolves a named endpoint from config
 * and makes the call. Never accepts a raw URL from a caller — only the name.
 * Layer: ADAPTER (1_adapters/trigger).
 * @module adapters/trigger/HttpEndpointGateway
 */
const DEFAULT_TIMEOUT_MS = 10000;

export class HttpEndpointGateway {
  #endpoints; #fetch; #logger; #timeoutMs;
  constructor({ endpoints = {}, fetchFn = fetch, logger = console, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.#endpoints = endpoints;
    this.#fetch = fetchFn;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
  }
  async call(ref, params) {
    const ep = this.#endpoints[ref];
    if (!ep || !ep.url) {
      this.#logger.warn?.('trigger.script.unknown_endpoint', { ref });
      return null;
    }
    try {
      const method = (ep.method || 'POST').toUpperCase();
      const opts = { method, headers: ep.headers || {}, signal: AbortSignal.timeout(this.#timeoutMs) };
      if (method !== 'GET' && method !== 'HEAD') opts.body = JSON.stringify(params ?? {});
      const res = await this.#fetch(ep.url, opts);
      this.#logger.info?.('trigger.script.called', { ref, method, ok: res?.ok !== false });
      return res;
    } catch (err) {
      this.#logger.warn?.('trigger.script.failed', { ref, error: err.message });
      return null;
    }
  }
}
export default HttpEndpointGateway;
