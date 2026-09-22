import { ILibbyStreamGateway } from '#apps/proxy/ports/ILibbyStreamGateway.mjs';

function hostAllowed(hostname, allowedHosts) {
  return [...allowedHosts].some(rule => rule.startsWith('.')
    ? hostname.length > rule.length && hostname.endsWith(rule)
    : hostname === rule);
}

/** Provider anti-corruption adapter for ephemeral Libby media capabilities. */
export class LibbyStreamGateway extends ILibbyStreamGateway {
  #fetch;
  #allowedHosts;

  constructor({ fetch = globalThis.fetch, allowedHosts = [] } = {}) {
    super();
    if (typeof fetch !== 'function') throw new Error('LibbyStreamGateway requires fetch');
    this.#fetch = fetch;
    this.#allowedHosts = new Set(allowedHosts);
  }

  #url(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    return url.protocol === 'https:' && (!url.port || url.port === '443')
      && !url.username && !url.password && hostAllowed(url.hostname, this.#allowedHosts) ? url : null;
  }

  async open({ source, method = 'GET', range = null, signal } = {}) {
    let target = this.#url(source?.upstreamUrl);
    if (!target) return { kind: 'upstream_error', reason: 'forbidden_origin' };
    if (signal?.aborted) return { kind: 'upstream_error', reason: 'cancelled' };
    const credentialOrigin = target.origin;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const headers = { ...(source?.headers || {}), ...(range ? { Range: range } : {}) };
      if (target.origin !== credentialOrigin) {
        delete headers.Cookie; delete headers.cookie;
        delete headers.Authorization; delete headers.authorization;
      }
      let response;
      try {
        response = await this.#fetch(target.href, { method: method === 'HEAD' ? 'HEAD' : 'GET', headers, signal, redirect: 'manual' });
      } catch (error) {
        return { kind: 'upstream_error', reason: error?.name === 'AbortError' ? 'cancelled' : 'fetch_failed' };
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel?.().catch?.(() => {});
        try { target = location ? this.#url(new URL(location, target).href) : null; } catch { target = null; }
        if (!target) return { kind: 'upstream_error', reason: 'forbidden_origin' };
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel?.().catch?.(() => {});
        return { kind: 'unauthorized' };
      }
      if (response.status === 416) {
        const contentRange = response.headers.get('content-range');
        await response.body?.cancel?.().catch?.(() => {});
        return { kind: 'range_not_satisfiable', contentRange };
      }
      if (![200, 206].includes(response.status)) {
        await response.body?.cancel?.().catch?.(() => {});
        return { kind: 'upstream_error', reason: 'provider_status' };
      }
      return {
        kind: 'opened', status: response.status, body: method === 'HEAD' ? null : response.body,
        contentType: response.headers.get('content-type') || source?.mimeType || 'audio/mpeg',
        contentLength: response.headers.get('content-length'), contentRange: response.headers.get('content-range'),
        acceptRanges: response.headers.get('accept-ranges'), etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      };
    }
    return { kind: 'upstream_error', reason: 'too_many_redirects' };
  }
}

export default LibbyStreamGateway;
