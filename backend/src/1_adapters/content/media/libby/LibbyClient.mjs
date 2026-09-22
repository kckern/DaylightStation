import { randomUUID } from 'node:crypto';
import { normalizeBootstrapSpine } from '#apps/proxy/ports/ILibbyBootstrapGateway.mjs';

const DEFAULT_API_BASE = 'https://sentry.libbyapp.com/';

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stablePartKey(path, index) {
  const normalized = String(path || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || `part-${String(index + 1).padStart(3, '0')}`;
}

function cookiesFrom(headers) {
  const values = typeof headers?.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers?.get?.('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ');
}

function hostAllowed(hostname, allowedHosts) {
  return [...allowedHosts].some((rule) => rule.startsWith('.')
    ? hostname.length > rule.length && hostname.endsWith(rule)
    : hostname === rule);
}

/** Anti-corruption client for the read-only Libby account/open-audiobook flow. */
export class LibbyClient {
  #fetch;
  #credentials;
  #apiBase;
  #allowedHosts;
  #coverAllowedHosts;
  #bootstrapService;

  constructor({ fetch = globalThis.fetch, credentials, apiBase = DEFAULT_API_BASE, allowedHosts = [], coverAllowedHosts = [], bootstrapService } = {}) {
    if (typeof fetch !== 'function') throw new Error('LibbyClient requires fetch');
    if (!credentials?.getSnapshot) throw new Error('LibbyClient requires credentials');
    this.#fetch = fetch;
    this.#credentials = credentials;
    this.#apiBase = new URL(apiBase);
    this.#allowedHosts = new Set([this.#apiBase.hostname, ...allowedHosts]);
    this.#coverAllowedHosts = new Set(coverAllowedHosts);
    this.#bootstrapService = bootstrapService;
  }

  #url(value, base = this.#apiBase) {
    let url;
    try { url = new URL(value, base); } catch { /* Fail closed below without leaking provider input. */ }
    if (!url || url.username || url.password || url.protocol !== 'https:' || (url.port && url.port !== '443') || !hostAllowed(url.hostname, this.#allowedHosts)) {
      throw failure('LIBBY_ORIGIN_REJECTED', 'Libby provider returned a forbidden origin');
    }
    return url;
  }

  #fulfillmentUrl(value) {
    let url;
    try { url = new URL(value); } catch { /* Reject relative or malformed identities below. */ }
    if (!url || url.username || url.password) {
      throw failure('LIBBY_ORIGIN_REJECTED', 'Libby fulfillment identity rejected');
    }
    return this.#url(url);
  }

  #browserAudioUrl(value) {
    let url;
    try { url = new URL(value); } catch { /* Fail closed below. */ }
    if (!url || url.protocol !== 'https:' || url.hostname !== 'audioclips.cdn.overdrive.com'
      || url.port || url.username || url.password || url.hash) {
      throw failure('LIBBY_ORIGIN_REJECTED', 'Libby browser audio origin rejected');
    }
    return url;
  }

  async #requestJson(url, { authenticated = false, headers = {}, ...options } = {}) {
    const target = this.#url(url);
    const requestHeaders = { Accept: 'application/json', 'Cache-Control': 'no-cache', ...headers };
    if (authenticated) requestHeaders.Authorization = `Bearer ${this.#credentials.getSnapshot().token}`;
    const response = await this.#fetch(target.href, { ...options, redirect: 'manual', headers: requestHeaders });
    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => {});
      throw failure(response.status === 401 ? 'LIBBY_CREDENTIAL_REJECTED' : 'LIBBY_PROVIDER_FAILED', `Libby provider returned ${response.status}`);
    }
    return response.json();
  }

  async sync({ signal } = {}) {
    return this.#requestJson(new URL('chip/sync', this.#apiBase), { authenticated: true, signal });
  }

  async getActiveLoan({ cardId, titleId, signal } = {}) {
    const state = await this.sync({ signal });
    const loan = (state?.loans || []).find((item) => String(item?.cardId) === String(cardId) && String(item?.id) === String(titleId));
    if (!loan) throw failure('LIBBY_LOAN_NOT_FOUND', 'Libby loan is not active');
    if (loan?.type?.id !== 'audiobook') throw failure('LIBBY_UNSUPPORTED_FULFILLMENT', 'Libby loan is not an audiobook');
    const expiresAt = Date.parse(loan.expireDate || loan.expires || '');
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) throw failure('LIBBY_LOAN_EXPIRED', 'Libby loan has expired');
    if (!['string', 'number'].includes(typeof loan.websiteId) || !String(loan.websiteId).trim()) {
      throw failure('LIBBY_PROVIDER_FAILED', 'Libby loan is missing website identity');
    }
    return Object.freeze({
      cardId: String(cardId), titleId: String(titleId), websiteId: String(loan.websiteId),
      title: loan.title || null, subtitle: loan.subtitle || null,
      author: loan.firstCreatorName || null, description: loan.description || null,
      coverUrl: loan?.covers?.cover510Wide?.href || loan?.covers?.cover300Wide?.href || null,
      expiresAt,
    });
  }

  #coverUrl(value, base) {
    let url;
    try { url = new URL(value, base); } catch { /* Fail closed below. */ }
    if (!url || url.protocol !== 'https:' || url.port || url.username || url.password || !hostAllowed(url.hostname, this.#coverAllowedHosts)) {
      throw failure('LIBBY_ORIGIN_REJECTED', 'Libby cover origin rejected');
    }
    return url;
  }

  /** Adapter-owned image gateway. Account credentials never enter image requests. */
  async openCover({ cardId, titleId, signal } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let response;
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      controller.abort();
      signal?.removeEventListener('abort', abort);
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    };
    try {
      controller.signal.throwIfAborted();
      const loan = await this.getActiveLoan({ cardId, titleId, signal: controller.signal });
      let target = this.#coverUrl(loan.coverUrl);
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        controller.signal.throwIfAborted();
        response = await this.#fetch(target.href, {
          signal: controller.signal, redirect: 'manual', headers: { Accept: 'image/*' },
        });
        controller.signal.throwIfAborted();
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => {});
          response = null;
          if (!location || redirects === 3) throw failure('LIBBY_PROVIDER_FAILED', 'Libby cover redirect failed');
          target = this.#coverUrl(location, target);
          continue;
        }
        const contentType = response.headers.get('content-type');
        if (response.status !== 200 || !response.body || !/^image\/[a-z0-9!#$&^_.+-]+(?:\s*;|\s*$)/i.test(contentType || '')) {
          throw failure('LIBBY_PROVIDER_FAILED', 'Libby cover unavailable');
        }
        // Fetch decodes compressed bodies without rewriting the provider's length header.
        const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
        const contentLength = encoding && encoding !== 'identity' ? null : response.headers.get('content-length');
        return { body: response.body, contentType, contentLength, cleanup };
      }
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  async openLoan({ cardId, titleId, signal } = {}) {
    const loan = await this.getActiveLoan({ cardId, titleId, signal });

    const openUrl = new URL(`open/audiobook/card/${encodeURIComponent(cardId)}/title/${encodeURIComponent(titleId)}`, this.#apiBase);
    openUrl.searchParams.set('website_id', loan.websiteId);
    const meta = await this.#requestJson(openUrl, { authenticated: true, signal });
    if (typeof meta?.urls?.web !== 'string' || !meta.urls.web.trim()) {
      throw failure('LIBBY_UNSUPPORTED_FULFILLMENT', 'Libby audiobook is missing fulfillment URLs');
    }
    const web = this.#fulfillmentUrl(meta.urls.web);
    if (!Object.hasOwn(meta.urls, 'openbook')) {
      return this.#openBrowserLoan({ loan, web, message: meta.message, signal });
    }
    // Presence is authoritative: malformed explicit fulfillment must never fall back.
    if (typeof meta.urls.openbook !== 'string' || !meta.urls.openbook.trim()) {
      throw failure('LIBBY_UNSUPPORTED_FULFILLMENT', 'Libby audiobook is missing fulfillment URLs');
    }
    const openbookUrl = this.#fulfillmentUrl(meta.urls.openbook);
    const headUrl = new URL(web.href);
    if (meta?.message) headUrl.search = String(meta.message);
    const head = await this.#fetch(headUrl.href, { method: 'HEAD', redirect: 'manual', signal, headers: { Accept: '*/*' } });
    if (!head.ok) {
      await head.body?.cancel?.().catch?.(() => {});
      throw failure('LIBBY_PROVIDER_FAILED', `Libby web authorization returned ${head.status}`);
    }
    const cookie = cookiesFrom(head.headers);
    const openbook = await this.#requestJson(openbookUrl, { signal, headers: cookie ? { Cookie: cookie } : {} });
    return this.#normalizeFulfillment({ loan, web, openbook, cookie });
  }

  async #openBrowserLoan({ loan, web, message, signal }) {
    if (typeof this.#bootstrapService?.open !== 'function' || typeof message !== 'string' || !message) {
      throw failure('LIBBY_UNSUPPORTED_FULFILLMENT', 'Libby browser fulfillment is unavailable');
    }
    let result;
    try {
      result = await this.#bootstrapService.open({ webUrl: web.href, message, operationId: `libby-bootstrap-${randomUUID()}` }, { signal });
    } catch {
      throw failure('LIBBY_PROVIDER_FAILED', 'Libby browser fulfillment failed');
    }
    if (result?.kind !== 'opened') {
      throw failure(result?.kind === 'unsupported' ? 'LIBBY_UNSUPPORTED_FULFILLMENT' : 'LIBBY_PROVIDER_FAILED', 'Libby browser fulfillment failed');
    }
    let normalized;
    try {
      const { kind, ...spine } = result;
      normalized = normalizeBootstrapSpine(spine);
    } catch {
      throw failure('LIBBY_UNSUPPORTED_FULFILLMENT', 'Libby browser returned unsupported fulfillment');
    }
    // Reuse the same DRM, media, key, and origin gate as legacy fulfillment.
    const openbook = {
      title: normalized.title, creator: normalized.narrator ? [{ role: 'narrator', name: normalized.narrator }] : [],
      spine: normalized.parts.map(part => ({ path: part.upstreamUrl, '-odread-original-path': part.key,
        'media-type': part.mimeType, 'audio-duration': part.duration, '-odread-file-bytes': part.contentLength })),
    };
    const metadata = { subtitle: normalized.subtitle, author: normalized.author,
      partTitles: normalized.parts.map(part => part.title), browserAudio: true };
    return this.#normalizeFulfillment({ loan, web, openbook, metadata });
  }

  #normalizeFulfillment({ loan, web, openbook, cookie = '', metadata = {} }) {
    const spine = Array.isArray(openbook?.spine) ? openbook.spine : [];
    if (!spine.length || spine.length > 1000 || openbook.encryption || openbook.license) throw failure('LIBBY_UNSUPPORTED_FULFILLMENT', 'Libby audiobook has no playable spine');
    const keys = new Set();
    const parts = spine.map((part, index) => {
      if (part?.['media-type'] !== 'audio/mpeg' || part?.encryption || part?.license || typeof part.path !== 'string' || !part.path) {
        throw failure('LIBBY_UNSUPPORTED_FULFILLMENT', 'Libby fulfillment is not an unencrypted MP3');
      }
      const originalPath = part['-odread-original-path'] || part.path;
      const key = stablePartKey(originalPath, index);
      if (keys.has(key) || key.length > 256) throw failure('LIBBY_UNSUPPORTED_FULFILLMENT', 'Libby audiobook has invalid part identities');
      keys.add(key);
      return Object.freeze({
        key,
        index,
        title: metadata.partTitles?.[index] || `Part ${index + 1}`,
        duration: Number(part['audio-duration']) || null,
        contentLength: Number(part['-odread-file-bytes']) || null,
        mimeType: 'audio/mpeg',
        upstreamUrl: metadata.browserAudio ? this.#browserAudioUrl(part.path).href : this.#url(part.path, web).href,
        headers: cookie ? Object.freeze({ Cookie: cookie }) : Object.freeze({}),
      });
    });
    const narrator = (openbook?.creator || []).find((person) => person?.role === 'narrator')?.name || null;
    return Object.freeze({
      cardId: loan.cardId, titleId: loan.titleId, title: loan.title || openbook.title || 'Libby audiobook',
      subtitle: loan.subtitle || metadata.subtitle || null, author: loan.author || metadata.author || null,
      narrator, description: loan.description,
      expiresAt: Number.isFinite(loan.expiresAt) ? loan.expiresAt : null, parts: Object.freeze(parts),
    });
  }
}

export default LibbyClient;
