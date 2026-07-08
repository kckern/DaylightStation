// backend/src/4_api/routers/proxy.mjs
import express from 'express';
import fs from 'fs';
import nodePath from 'path';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { streamFileWithRanges } from '#system/http/streamFile.mjs';
import { sendPlaceholderSvg } from '#system/proxy/placeholders.mjs';
import { compositeHeroImage } from '#rendering/canvas/compositeHero.mjs';

const HLS_CONTENT_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
]);

/**
 * SSRF guard for the stream proxy. Returns true if the host should be blocked
 * (loopback, private/link-local ranges, or *.local mDNS names).
 * Pure + exported so it can be unit-tested.
 * @param {string} host
 * @returns {boolean}
 */
export function isBlockedStreamHost(host) {
  if (!host) return true;
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1') return true;
  if (h.endsWith('.local')) return true;

  // IPv4 literal ranges
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127) return true;                       // 127.0.0.0/8
    if (a === 10) return true;                        // 10.0.0.0/8
    if (a === 192 && b === 168) return true;          // 192.168.0.0/16
    if (a === 169 && b === 254) return true;          // 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  }
  return false;
}

/**
 * Validate a stream URL against the SSRF guard + http/https-only check.
 * Returns the parsed URL if allowed, or throws a tagged error if blocked/invalid.
 * @param {string} rawUrl - absolute URL string
 * @param {string} [via] - context for logging ('redirect' for redirect hops)
 * @returns {URL}
 */
function assertSafeStreamUrl(rawUrl, via) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    const err = new Error('Invalid src URL');
    err.code = 'STREAM_INVALID_URL';
    err.via = via;
    throw err;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    const err = new Error('Only http/https URLs allowed');
    err.code = 'STREAM_INVALID_URL';
    err.host = u.hostname;
    err.via = via;
    throw err;
  }
  if (isBlockedStreamHost(u.hostname)) {
    const err = new Error('Blocked host');
    err.code = 'STREAM_BLOCKED_HOST';
    err.host = u.hostname;
    err.via = via;
    throw err;
  }
  return u;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_STREAM_REDIRECTS = 5;

/**
 * Fetch a stream URL while manually following redirects so the SSRF guard can be
 * re-applied on every hop. `fetch`'s automatic redirect following bypasses the
 * guard (an allowed public URL could 302 to e.g. http://169.254.169.254/), so we
 * disable it and validate each Location before continuing.
 *
 * Throws a tagged error (code STREAM_BLOCKED_HOST / STREAM_INVALID_URL /
 * STREAM_TOO_MANY_REDIRECTS) the route maps to a 400/502 response.
 *
 * @param {string} startUrl - already-validated initial absolute URL
 * @param {Object} opts
 * @param {Object} [opts.headers] - request headers (referer/user-agent/range)
 * @param {AbortSignal} [opts.signal]
 * @param {typeof fetch} [opts.fetchFn] - injectable fetch (for tests)
 * @param {number} [opts.maxRedirects]
 * @returns {Promise<Response>} the final (non-redirect) Response
 */
export async function safeStreamFetch(startUrl, opts = {}) {
  const {
    headers,
    signal,
    fetchFn = fetch,
    maxRedirects = MAX_STREAM_REDIRECTS,
  } = opts;

  let currentUrl = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const resp = await fetchFn(currentUrl, {
      headers,
      redirect: 'manual',
      signal,
    });

    if (!REDIRECT_STATUSES.has(resp.status)) {
      return resp;
    }

    const location = resp.headers.get('location');
    if (!location) {
      // Redirect status with no Location: treat as final response (let caller handle).
      return resp;
    }

    // Resolve relative Location against the current URL, then re-run the guard.
    const next = assertSafeStreamUrl(new URL(location, currentUrl).toString(), 'redirect');
    currentUrl = next.toString();
  }

  const err = new Error('Too many redirects');
  err.code = 'STREAM_TOO_MANY_REDIRECTS';
  throw err;
}

/**
 * Rewrite an HLS (m3u8) playlist so that every segment / variant / key URI is
 * routed back through this stream proxy (carrying the same profile).
 * Pure + exported for unit testing.
 * @param {string} text - raw playlist body
 * @param {string} baseUrl - absolute URL the playlist was fetched from (resolves relatives)
 * @param {string} [profile] - profile name to carry forward
 * @returns {string}
 */
export function rewriteHlsPlaylist(text, baseUrl, profile) {
  const wrap = (u) => {
    const abs = new URL(u, baseUrl).toString();
    const q = new URLSearchParams({ src: abs });
    if (profile) q.set('profile', profile);
    return `/api/v1/proxy/stream?${q.toString()}`;
  };
  return text.split('\n').map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(u)}"`);
    }
    return wrap(t);
  }).join('\n');
}

/**
 * Create proxy router for streaming and thumbnails
 * @param {Object} config
 * @param {import('../../domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} config.registry
 * @param {import('../../0_system/proxy/ProxyService.mjs').ProxyService} [config.proxyService] - Optional proxy service for external services
 * @param {string} [config.mediaBasePath] - Base path for media files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
/**
 * Extract the uncompressed MusicXML text from a compressed `.mxl` buffer.
 *
 * A `.mxl` is a ZIP whose `META-INF/container.xml` names the root score file
 * (the MusicXML). We read that pointer and return the referenced entry as UTF-8
 * text, so the stream endpoint can serve clean XML that the frontend engraver
 * (OSMD) can parse directly — no in-browser unzip needed.
 *
 * @param {Buffer} buffer - raw .mxl file bytes
 * @returns {Promise<string>} uncompressed MusicXML
 */
export async function extractMusicXmlFromMxl(buffer) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buffer);

  // Preferred: follow META-INF/container.xml → <rootfile full-path="…">.
  const container = zip.getEntry('META-INF/container.xml');
  if (container) {
    const xml = container.getData().toString('utf-8');
    const m = xml.match(/<rootfile\b[^>]*\bfull-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const rootPath = m && (m[1] || m[2]);
    if (rootPath) {
      const entry = zip.getEntry(rootPath);
      if (entry) return entry.getData().toString('utf-8');
    }
  }

  // Fallback: first .musicxml/.xml entry that isn't ZIP metadata.
  const entry = zip.getEntries().find((e) =>
    !e.entryName.startsWith('META-INF/') &&
    /\.(musicxml|xml)$/i.test(e.entryName));
  if (entry) return entry.getData().toString('utf-8');

  throw new Error('No MusicXML entry found in .mxl archive');
}

export function createProxyRouter(config) {
  const router = express.Router();
  const { registry, proxyService, configService, mediaBasePath, dataPath, retroarchProxy, logger = console } = config;

  /**
   * GET /proxy/media/stream/*
   * Stream a file from media adapter
   */
  router.get('/media/stream/*', asyncHandler(async (req, res) => {
      const filePath = decodeURIComponent(req.params[0] || '');
      const adapter = registry.get('files') || registry.get('media');
      if (!adapter) {
        return res.status(404).json({ error: 'Media adapter not configured' });
      }

      const item = await adapter.getItem(filePath);
      if (!item || !item.metadata?.filePath) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fullPath = item.metadata.filePath;
      const mimeType = item.metadata.mimeType || 'application/octet-stream';

      // Compressed MusicXML (.mxl) is a ZIP container — unzip on the fly and
      // serve the inner MusicXML as clean text so the engraver can parse it
      // directly (the raw ZIP bytes are unusable as the text the client fetches).
      if (/\.mxl$/i.test(fullPath)) {
        try {
          const xml = await extractMusicXmlFromMxl(await fs.promises.readFile(fullPath));
          res.set({
            'Content-Type': 'application/vnd.recordare.musicxml+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=31536000',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
          });
          return res.send(xml);
        } catch (err) {
          logger.warn?.('proxy.mxl.extract_failed', { filePath, error: err.message });
          return res.status(422).json({ error: 'Could not decompress .mxl score' });
        }
      }

      streamFileWithRanges(req, res, fullPath, mimeType, {
        'Cache-Control': 'public, max-age=31536000',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Access-Control-Allow-Origin': '*',
      });
  }));

  /**
   * GET /proxy/plex/stream/:ratingKey?offset=<seconds>
   * Redirect to Plex DASH stream with optional start offset.
   * Passing offset tells Plex to begin transcoding near that position,
   * so the DASH manifest's first segments are available at the resume point.
   */
  router.get('/plex/stream/:ratingKey', asyncHandler(async (req, res) => {
    const { ratingKey } = req.params;
    const startOffset = parseInt(req.query.offset) || 0;
    const adapter = registry.get('plex');
    if (!adapter) {
      return res.status(404).json({ error: 'Plex adapter not configured' });
    }

    const result = await adapter.getMediaUrl(ratingKey, { startOffset });
    const mediaUrl = result?.url ?? null;
    if (!mediaUrl) {
      return res.status(404).json({
        error: 'Could not generate stream URL',
        ratingKey,
        reason: result?.reason
      });
    }
    res.redirect(mediaUrl);
  }));

  /**
   * GET /proxy/local-content/stream/:type/*
   * Stream audio for LocalContent types (talk, scripture, hymn, primary, poem)
   */
  router.get('/local-content/stream/:type/*', asyncHandler(async (req, res) => {
      const { type } = req.params;
      const path = req.params[0] || '';
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(503).json({ error: 'LocalContent adapter not configured' });
      }

      // Map type to prefix
      const prefixMap = {
        'talk': 'talk',
        'scripture': 'scripture',
        'hymn': 'hymn',
        'primary': 'primary',
        'poem': 'poem'
      };

      const prefix = prefixMap[type];
      if (!prefix) {
        return res.status(400).json({ error: `Unknown content type: ${type}` });
      }

      // Get item to find media file path
      const item = await adapter.getItem(`${prefix}:${path}`);
      if (!item || !item.metadata?.mediaFile) {
        return res.status(404).json({ error: 'Media file not found', type, path });
      }

      // Construct full file path
      const mediaPath = item.metadata.mediaFile;
      const fullPath = nodePath.join(adapter.mediaPath, mediaPath);

      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Media file not found on disk', path: fullPath });
      }

      const ext = nodePath.extname(fullPath).toLowerCase();
      const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska'
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      streamFileWithRanges(req, res, fullPath, mimeType, {
        'Cache-Control': 'public, max-age=31536000',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Access-Control-Allow-Origin': '*',
      });
  }));

  /**
   * GET /proxy/plex/*
   * Passthrough proxy for Plex API requests (thumbnails, transcodes, etc.)
   * Requires ProxyService to be configured for Plex.
   */
  router.use('/plex', async (req, res, next) => {
    try {
      // Use ProxyService - required for Plex proxying
      if (proxyService?.isConfigured?.('plex')) {
        await proxyService.proxy('plex', req, res);
        return;
      }

      // No fallback - ProxyService is required
      return res.status(503).json({ error: 'Plex proxy not configured (ProxyService required)' });
    } catch (err) {
      if (res.headersSent) return res.end();
      next(err);
    }
  });

  /**
   * GET /proxy/immich/*
   * Passthrough proxy for Immich API requests (thumbnails, videos, etc.)
   * Requires ProxyService to be configured for Immich.
   */
  router.use('/immich', async (req, res, next) => {
    try {
      if (proxyService?.isConfigured?.('immich')) {
        await proxyService.proxy('immich', req, res);
        return;
      }

      // No fallback - ProxyService is required
      return res.status(503).json({ error: 'Immich proxy not configured (ProxyService required)' });
    } catch (err) {
      if (res.headersSent) return res.end();
      next(err);
    }
  });

  /**
   * GET /proxy/reddit/*
   * Passthrough proxy for Reddit image CDNs (i.redd.it, preview.redd.it)
   * that block direct hotlinking from external referrers.
   * URL scheme: /proxy/reddit/{host}/{path}
   */
  router.use('/reddit', async (req, res) => {
    try {
      if (proxyService?.isConfigured?.('reddit')) {
        await proxyService.proxy('reddit', req, res);
        return;
      }
      sendPlaceholderSvg(res);
    } catch (err) {
      console.error('[proxy] reddit error:', err.message);
      sendPlaceholderSvg(res);
    }
  });

  /**
   * GET /proxy/komga/composite/:bookId/:page
   * Generate a composite 16:9 hero image from Komga book cover + article pages.
   * On-demand generation with disk cache.
   */
  router.get('/komga/composite/:bookId/:page', asyncHandler(async (req, res) => {
    const { bookId, page } = req.params;
    const pageNum = parseInt(page, 10);
    if (!bookId || isNaN(pageNum) || pageNum < 1 || !/^[\w-]+$/.test(bookId)) {
      return res.status(400).json({ error: 'Invalid bookId or page' });
    }

    // Check disk cache
    const cacheDir = mediaBasePath
      ? nodePath.join(mediaBasePath, 'img', 'komga', 'hero')
      : null;
    const cacheFile = cacheDir
      ? nodePath.join(cacheDir, `${bookId}-${pageNum}.jpg`)
      : null;

    if (cacheFile && fs.existsSync(cacheFile)) {
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
        'X-Cache': 'HIT',
      });
      return fs.createReadStream(cacheFile).pipe(res);
    }

    // Get Komga credentials from ProxyService
    const komgaAdapter = proxyService?.getAdapter?.('komga');
    if (!komgaAdapter?.isConfigured?.()) {
      return res.status(503).json({ error: 'Komga proxy not configured' });
    }

    const baseUrl = komgaAdapter.getBaseUrl();
    const authHeaders = komgaAdapter.getAuthHeaders();

    // Fetch source images in parallel
    const imageUrls = [
      `${baseUrl}/api/v1/books/${bookId}/thumbnail`,    // cover
      `${baseUrl}/api/v1/books/${bookId}/pages/${pageNum}`,  // article page
      `${baseUrl}/api/v1/books/${bookId}/pages/${pageNum + 1}`, // next page
    ];

    const fetchResults = await Promise.allSettled(
      imageUrls.map(async (url) => {
        const resp = await fetch(url, {
          headers: { ...authHeaders, 'Accept': 'image/jpeg' },
          signal: AbortSignal.timeout(30000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return Buffer.from(await resp.arrayBuffer());
      })
    );

    // Collect successful fetches (skip failures gracefully)
    const buffers = fetchResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    if (buffers.length === 0) {
      return sendPlaceholderSvg(res);
    }

    // Composite
    const jpegBuffer = await compositeHeroImage(buffers);

    // Cache to disk
    if (cacheDir) {
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.writeFile(cacheFile, jpegBuffer);
    }

    // Serve
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': jpegBuffer.length,
      'Cache-Control': 'public, max-age=31536000',
      'X-Cache': 'MISS',
    });
    res.send(jpegBuffer);
  }));

  /**
   * GET /proxy/komga/*
   * Passthrough proxy for Komga API requests (page images, thumbnails, etc.)
   * Uses ProxyService with X-API-Key header auth
   */
  router.use('/komga', async (req, res) => {
    try {
      if (proxyService?.isConfigured?.('komga')) {
        await proxyService.proxy('komga', req, res);
        return;
      }
      sendPlaceholderSvg(res);
    } catch (err) {
      console.error('[proxy] komga error:', err);
      sendPlaceholderSvg(res);
    }
  });

  /**
   * GET /proxy/abs/*
   * Passthrough proxy for Audiobookshelf API requests (audio, covers, etc.)
   * Uses ProxyService for streaming with Bearer token auth
   */
  router.use('/abs', async (req, res, next) => {
    try {
      // Use ProxyService if available
      if (proxyService?.isConfigured?.('audiobookshelf')) {
        await proxyService.proxy('audiobookshelf', req, res);
        return;
      }

      // No fallback for now - ABS requires ProxyService
      return res.status(503).json({ error: 'Audiobookshelf proxy not configured' });
    } catch (err) {
      if (res.headersSent) return res.end();
      next(err);
    }
  });

  /**
   * GET /proxy/retroarch/thumbnail/*
   * Proxy RetroArch game thumbnails from X-plore WiFi File Manager,
   * with a permanent on-disk cache. First request per thumbnail fetches
   * from X-plore (with one retry); subsequent requests stream from disk.
   * Failures return 503 (no-store) so the client can retry.
   */
  router.get('/retroarch/thumbnail/*', asyncHandler(async (req, res) => {
    if (!retroarchProxy) {
      return res.status(503).json({ error: 'RetroArch thumbnail proxy not configured' });
    }

    const thumbPath = decodeURIComponent(req.params[0] || '');
    if (!thumbPath) {
      return res.status(400).json({ error: 'No thumbnail path specified' });
    }

    if (thumbPath.includes('..')) {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }

    const { baseUrl, thumbnailsPath, retryDelayMs = 1500 } = retroarchProxy;

    const cacheFile = mediaBasePath
      ? nodePath.join(mediaBasePath, 'img', 'retroarch', 'thumbs', thumbPath)
      : null;

    if (cacheFile && fs.existsSync(cacheFile)) {
      const ext = nodePath.extname(cacheFile).toLowerCase();
      const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      res.set({
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Cache': 'HIT',
      });
      return fs.createReadStream(cacheFile).pipe(res);
    }

    const xploreUrl = `${baseUrl}${thumbnailsPath}/${thumbPath}?cmd=file`;
    const attemptFetch = async () => {
      const response = await fetch(xploreUrl, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`xplore HTTP ${response.status}`);
      return {
        contentType: response.headers.get('content-type') || 'image/png',
        buffer: Buffer.from(await response.arrayBuffer()),
      };
    };

    let result;
    try {
      result = await attemptFetch();
    } catch (firstErr) {
      logger.warn?.('proxy.retroarch.thumbnail.retry', { path: thumbPath, error: firstErr.message });
      try {
        await new Promise(r => setTimeout(r, retryDelayMs));
        result = await attemptFetch();
      } catch (secondErr) {
        logger.warn?.('proxy.retroarch.thumbnail.failed', { path: thumbPath, error: secondErr.message });
        res.set('Cache-Control', 'no-store');
        return res.status(503).json({ error: 'Thumbnail upstream unavailable' });
      }
    }

    if (cacheFile) {
      try {
        await fs.promises.mkdir(nodePath.dirname(cacheFile), { recursive: true });
        await fs.promises.writeFile(cacheFile, result.buffer);
      } catch (writeErr) {
        logger.warn?.('proxy.retroarch.thumbnail.cacheWrite', { path: thumbPath, error: writeErr.message });
      }
    }

    res.set({
      'Content-Type': result.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Cache': 'MISS',
    });
    res.send(result.buffer);
  }));

  /**
   * GET /proxy/media/*
   * Stream audio/video files from the media mount
   * Replaces legacy /media/* endpoint for ambient music, poetry, etc.
   */
  router.get('/media/*', asyncHandler(async (req, res) => {
      if (!mediaBasePath) {
        return res.status(503).json({ error: 'Media path not configured' });
      }

      const relativePath = decodeURIComponent(req.params[0] || '');
      if (!relativePath) {
        return res.status(400).json({ error: 'No path specified' });
      }

      // Security: prevent path traversal
      const safePath = nodePath.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
      const fullPath = nodePath.join(mediaBasePath, safePath);

      // Ensure we're still within mediaBasePath
      if (!fullPath.startsWith(nodePath.resolve(mediaBasePath))) {
        return res.status(403).json({ error: 'Path traversal not allowed' });
      }

      // Try with common audio extensions if no extension provided
      let resolvedPath = fullPath;
      if (!fs.existsSync(resolvedPath)) {
        const extensions = ['mp3', 'm4a', 'mp4', 'wav', 'ogg', 'flac'];
        for (const ext of extensions) {
          const withExt = `${fullPath}.${ext}`;
          if (fs.existsSync(withExt)) {
            resolvedPath = withExt;
            break;
          }
        }
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: 'Media file not found', path: relativePath });
      }

      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Path is not a file' });
      }

      const ext = nodePath.extname(resolvedPath).toLowerCase().slice(1);
      const mimeTypes = {
        'mp3': 'audio/mpeg',
        'm4a': 'audio/mp4',
        'mp4': 'video/mp4',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        'flac': 'audio/flac',
        'webm': 'video/webm'
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      streamFileWithRanges(req, res, resolvedPath, mimeType, {
        'Cache-Control': 'public, max-age=31536000',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      });

      logger.debug?.('proxy.media.served', { path: relativePath, mimeType });
  }));

  /**
   * GET /proxy/stream?src=<absUrl>&profile=<name>
   * Dynamic-origin proxy for third-party HLS/video streams. Injects per-profile
   * referer/user-agent headers (to defeat hotlink protection), rewrites m3u8
   * playlists so child URIs route back through this proxy, and pipes segments
   * (with HTTP Range support) so CORS-less CDN streams play in the browser.
   *
   * Unlike #system/proxy/ProxyService (fixed per-service base URL), the target
   * origin here varies per request, so this route lives at the API layer.
   */
  router.get('/stream', asyncHandler(async (req, res) => {
    const src = req.query.src;
    const profileName = req.query.profile ? String(req.query.profile) : undefined;

    if (!src || typeof src !== 'string') {
      return res.status(400).json({ error: 'Missing src parameter' });
    }

    let target;
    try {
      target = assertSafeStreamUrl(src);
    } catch (err) {
      if (err.code === 'STREAM_BLOCKED_HOST') {
        logger.warn?.('proxy.stream.blocked', { host: err.host });
        return res.status(400).json({ error: 'Blocked host' });
      }
      return res.status(400).json({ error: err.message || 'Invalid src URL' });
    }

    // Look up per-profile scrape headers (referer / user-agent).
    let headers = { 'User-Agent': 'Mozilla/5.0' };
    const profiles = configService?.getStreamingProfiles?.() || [];
    const profile = profiles.find((p) => p?.name === profileName) || null;
    if (profile?.scrape?.headers && typeof profile.scrape.headers === 'object') {
      headers = { ...headers, ...profile.scrape.headers };
    }

    // Propagate the client's Range header upstream for segment seeking.
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    let upstream;
    try {
      upstream = await safeStreamFetch(target.toString(), {
        headers,
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      if (err.code === 'STREAM_BLOCKED_HOST') {
        logger.warn?.('proxy.stream.blocked', { host: err.host, via: 'redirect' });
        return res.status(400).json({ error: 'Blocked host' });
      }
      if (err.code === 'STREAM_INVALID_URL') {
        logger.warn?.('proxy.stream.blocked', { host: err.host, via: 'redirect' });
        return res.status(400).json({ error: err.message || 'Invalid redirect URL' });
      }
      if (err.code === 'STREAM_TOO_MANY_REDIRECTS') {
        logger.warn?.('proxy.stream.tooManyRedirects', { host: target.hostname });
        return res.status(502).json({ error: 'Too many redirects' });
      }
      logger.warn?.('proxy.stream.fetchFailed', { host: target.hostname, error: err.message });
      return res.status(502).json({ error: 'Upstream fetch failed' });
    }

    if (!upstream.ok && upstream.status !== 206) {
      logger.warn?.('proxy.stream.upstreamStatus', { host: target.hostname, status: upstream.status });
      return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
    }

    const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();
    const baseType = upstreamType.split(';')[0].trim();
    const pathName = target.pathname.toLowerCase();
    const isHls = HLS_CONTENT_TYPES.has(baseType) || pathName.endsWith('.m3u8');

    if (isHls) {
      const body = await upstream.text();
      const rewritten = rewriteHlsPlaylist(body, target.toString(), profileName);
      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      });
      return res.send(rewritten);
    }

    // Segment / key / mp4: pipe bytes through, honoring Range (206).
    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.set('Content-Range', contentRange);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.set('Content-Length', contentLength);

    if (!upstream.body) {
      return res.end();
    }
    try {
      // Web ReadableStream → Node response.
      const reader = upstream.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) return res.end();
        res.write(Buffer.from(value));
        return pump();
      };
      await pump();
    } catch (err) {
      logger.warn?.('proxy.stream.pipeFailed', { host: target.hostname, error: err.message });
      if (!res.headersSent) res.status(502).end();
      else res.end();
    }
  }));

  // Errors that propagate out of the passthrough proxies (plex/immich/abs) map
  // by name/status and hide internals on 5xx; streaming failures after headers
  // are sent delegate to Express's default handler.
  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createProxyRouter;
