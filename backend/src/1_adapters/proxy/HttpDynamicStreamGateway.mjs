import { IDynamicStreamGateway } from '#apps/proxy/ports/IDynamicStreamGateway.mjs';

const HLS_CONTENT_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_STREAM_REDIRECTS = 5;

export function isBlockedStreamHost(host) {
  if (!host) return true;
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.local')) return true;
  const match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [first, second] = [Number(match[1]), Number(match[2])];
  return first === 127
    || first === 10
    || (first === 192 && second === 168)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31);
}

function assertSafeStreamUrl(rawUrl, via) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    const error = new Error('Invalid src URL');
    error.code = 'STREAM_INVALID_URL';
    error.via = via;
    throw error;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const error = new Error('Only http/https URLs allowed');
    error.code = 'STREAM_INVALID_URL';
    error.host = parsed.hostname;
    error.via = via;
    throw error;
  }
  if (isBlockedStreamHost(parsed.hostname)) {
    const error = new Error('Blocked host');
    error.code = 'STREAM_BLOCKED_HOST';
    error.host = parsed.hostname;
    error.via = via;
    throw error;
  }
  return parsed;
}

export async function safeStreamFetch(startUrl, options = {}) {
  const {
    headers,
    signal,
    fetchFn = globalThis.fetch,
    maxRedirects = MAX_STREAM_REDIRECTS,
  } = options;
  let currentUrl = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetchFn(currentUrl, { headers, redirect: 'manual', signal });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    currentUrl = assertSafeStreamUrl(new URL(location, currentUrl).toString(), 'redirect').toString();
  }
  const error = new Error('Too many redirects');
  error.code = 'STREAM_TOO_MANY_REDIRECTS';
  error.host = new URL(startUrl).hostname;
  throw error;
}

export function rewriteHlsPlaylist(text, baseUrl, profile) {
  const wrap = (value) => {
    const query = new URLSearchParams({ src: new URL(value, baseUrl).toString() });
    if (profile) query.set('profile', profile);
    return `/api/v1/proxy/stream?${query.toString()}`;
  };
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${wrap(value)}"`);
    }
    return wrap(trimmed);
  }).join('\n');
}

/** Fetch-based dynamic stream gateway with redirect-by-redirect SSRF checks. */
export class HttpDynamicStreamGateway extends IDynamicStreamGateway {
  #fetch;
  #getProfiles;

  constructor({ fetchFn = globalThis.fetch, getProfiles = () => [] } = {}) {
    super();
    if (typeof fetchFn !== 'function') throw new Error('HttpDynamicStreamGateway requires fetch');
    if (typeof getProfiles !== 'function') throw new Error('HttpDynamicStreamGateway requires getProfiles');
    this.#fetch = fetchFn;
    this.#getProfiles = getProfiles;
  }

  async open({ sourceUrl, profileName, range }) {
    const target = assertSafeStreamUrl(sourceUrl);
    let headers = { 'User-Agent': 'Mozilla/5.0' };
    const profile = this.#getProfiles().find((candidate) => candidate?.name === profileName) || null;
    if (profile?.scrape?.headers && typeof profile.scrape.headers === 'object') {
      headers = { ...headers, ...profile.scrape.headers };
    }
    if (range) headers.Range = range;

    let upstream;
    try {
      upstream = await safeStreamFetch(target.toString(), {
        headers,
        signal: AbortSignal.timeout(30000),
        fetchFn: this.#fetch,
      });
    } catch (error) {
      if (!error.host) error.host = target.hostname;
      throw error;
    }
    if (!upstream.ok && upstream.status !== 206) {
      return { kind: 'upstream_error', host: target.hostname, status: upstream.status };
    }

    const contentType = upstream.headers.get('content-type') || '';
    const baseType = contentType.toLowerCase().split(';')[0].trim();
    const isHls = HLS_CONTENT_TYPES.has(baseType) || target.pathname.toLowerCase().endsWith('.m3u8');
    if (isHls) {
      return {
        kind: 'playlist',
        body: rewriteHlsPlaylist(await upstream.text(), target.toString(), profileName),
      };
    }
    return {
      kind: 'stream',
      host: target.hostname,
      status: upstream.status,
      contentType: contentType || 'application/octet-stream',
      acceptRanges: upstream.headers.get('accept-ranges') || 'bytes',
      contentRange: upstream.headers.get('content-range'),
      contentLength: upstream.headers.get('content-length'),
      body: upstream.body,
    };
  }
}

export default HttpDynamicStreamGateway;
