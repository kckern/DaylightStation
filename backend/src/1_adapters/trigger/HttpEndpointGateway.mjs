/**
 * HTTP implementation of IEndpointGateway. Resolves a named endpoint from config
 * and makes the call. Never accepts a raw URL from a caller — only the name.
 * Layer: ADAPTER (1_adapters/trigger).
 * @module adapters/trigger/HttpEndpointGateway
 */
export class HttpEndpointGateway {
  #endpoints; #fetch; #logger;
  constructor({ endpoints = {}, fetchFn = fetch, logger = console } = {}) {
    this.#endpoints = endpoints;
    this.#fetch = fetchFn;
    this.#logger = logger;
  }
  async call(ref, params) {
    const ep = this.#endpoints[ref];
    if (!ep || !ep.url) {
      this.#logger.warn?.('trigger.script.unknown_endpoint', { ref });
      return null;
    }
    const method = (ep.method || 'POST').toUpperCase();
    const opts = { method, headers: ep.headers || {} };
    if (method !== 'GET' && method !== 'HEAD') opts.body = JSON.stringify(params ?? {});
    try {
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
