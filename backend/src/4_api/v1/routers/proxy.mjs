import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { streamMediaResourceWithRanges } from '#system/http/streamFile.mjs';
import { sendPlaceholderSvg } from '#system/proxy/placeholders.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';

const LONG_CACHE = 'public, max-age=31536000';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/** Build HTTP passthrough handlers at composition time; these are not ports. */
export function createProxyPassthroughHandlers(proxyService) {
  const bind = (service) => proxyService?.isConfigured?.(service)
    ? (req, res) => proxyService.proxy(service, req, res)
    : null;
  return {
    plex: bind('plex'),
    immich: bind('immich'),
    reddit: bind('reddit'),
    komga: bind('komga'),
    audiobookshelf: bind('audiobookshelf'),
  };
}

/** Create the HTTP translation layer for proxy operations. */
export function createProxyRouter(config = {}) {
  const router = express.Router();
  const {
    proxyMediaService,
    mintPlaybackStream,
    compositeHeroService,
    remoteThumbnailService = null,
    dynamicStreamService,
    passthroughHandlers = {},
    logger = console,
  } = config;

  router.get('/media/stream/*splat', asyncHandler(async (req, res) => {
    const result = await proxyMediaService.getContentMedia(splatPath(req));
    if (result.kind === 'unconfigured') {
      return res.status(404).json({ error: 'Media adapter not configured' });
    }
    if (result.kind === 'not_found') return res.status(404).json({ error: 'File not found' });
    if (result.kind === 'archive_error') {
      return res.status(422).json({ error: 'Could not decompress .mxl score' });
    }
    if (result.kind === 'document') {
      res.set({
        'Content-Type': 'application/vnd.recordare.musicxml+xml; charset=utf-8',
        'Cache-Control': LONG_CACHE,
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      });
      return res.send(result.body);
    }
    return streamMediaResourceWithRanges(req, res, result.resource, {
      'Cache-Control': LONG_CACHE,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Access-Control-Allow-Origin': '*',
    });
  }));

  router.get('/plex/stream/:ratingKey', asyncHandler(async (req, res) => {
    const ratingKey = req.params.ratingKey;
    const startOffset = Number.parseInt(req.query.offset) || 0;
    const session = typeof req.query.session === 'string' && req.query.session
      ? req.query.session
      : null;
    const result = await mintPlaybackStream.execute({ ratingKey, startOffset, session });
    if (result.kind === 'unconfigured') {
      return res.status(404).json({ error: 'Plex adapter not configured' });
    }
    if (result.kind === 'not_found') {
      return res.status(404).json({
        error: 'Could not generate stream URL',
        ratingKey,
        reason: result.reason,
      });
    }
    return res.redirect(result.url);
  }));

  router.get('/local-content/stream/:type/*splat', asyncHandler(async (req, res) => {
    const type = req.params.type;
    const relativePath = splatPath(req);
    const result = await proxyMediaService.getLocalContentMedia({ type, mediaRef: relativePath });
    if (result.kind === 'unconfigured') {
      return res.status(503).json({ error: 'LocalContent adapter not configured' });
    }
    if (result.kind === 'invalid_type') {
      return res.status(400).json({ error: `Unknown content type: ${type}` });
    }
    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'Media file not found', type, path: relativePath });
    }
    if (result.kind === 'disk_missing') {
      return res.status(404).json({ error: 'Media file not found on disk', path: result.path });
    }
    return streamMediaResourceWithRanges(req, res, result.resource, {
      'Cache-Control': LONG_CACHE,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Access-Control-Allow-Origin': '*',
    });
  }));

  router.use('/plex', resizePlexThumbnail, requiredPassthrough(
    passthroughHandlers.plex,
    'Plex proxy not configured (ProxyService required)',
  ));
  router.use('/immich', requiredPassthrough(
    passthroughHandlers.immich,
    'Immich proxy not configured (ProxyService required)',
  ));
  router.use('/reddit', placeholderPassthrough(passthroughHandlers.reddit, 'reddit'));

  router.get('/komga/composite/:bookId/:page', asyncHandler(async (req, res) => {
    const result = await compositeHeroService.get({ id: req.params.bookId, page: req.params.page });
    if (result.kind === 'invalid') {
      return res.status(400).json({ error: 'Invalid bookId or page' });
    }
    if (result.kind === 'unconfigured') {
      return res.status(503).json({ error: 'Komga proxy not configured' });
    }
    if (result.kind === 'placeholder') return sendPlaceholderSvg(res);
    if (result.kind === 'hit') {
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': LONG_CACHE, 'X-Cache': 'HIT' });
      return result.resource.open().pipe(res);
    }
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': result.artifact.length,
      'Cache-Control': LONG_CACHE,
      'X-Cache': 'MISS',
    });
    return res.send(result.artifact);
  }));

  router.use('/komga', placeholderPassthrough(passthroughHandlers.komga, 'komga'));
  router.use('/abs', requiredPassthrough(
    passthroughHandlers.audiobookshelf,
    'Audiobookshelf proxy not configured',
  ));

  router.get('/retroarch/thumbnail{/*splat}', asyncHandler(async (req, res) => {
    if (!remoteThumbnailService) {
      return res.status(503).json({ error: 'RetroArch thumbnail proxy not configured' });
    }
    const result = await remoteThumbnailService.get(splatPath(req));
    if (result.kind === 'missing_path') {
      return res.status(400).json({ error: 'No thumbnail path specified' });
    }
    if (result.kind === 'forbidden') {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }
    if (result.kind === 'unavailable') {
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'Thumbnail upstream unavailable' });
    }
    if (result.kind === 'hit') {
      res.set({
        'Content-Type': result.resource.mimeType,
        'Cache-Control': IMMUTABLE_CACHE,
        'X-Cache': 'HIT',
      });
      return result.resource.open().pipe(res);
    }
    res.set({
      'Content-Type': result.contentType,
      'Cache-Control': IMMUTABLE_CACHE,
      'X-Cache': 'MISS',
    });
    return res.send(result.artifact);
  }));

  router.get('/media{/*splat}', asyncHandler(async (req, res) => {
    const relativePath = splatPath(req);
    const result = await proxyMediaService.getMediaTreeResource(relativePath);
    if (result.kind === 'unconfigured') {
      return res.status(503).json({ error: 'Media path not configured' });
    }
    if (result.kind === 'missing_path') return res.status(400).json({ error: 'No path specified' });
    if (result.kind === 'forbidden') {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }
    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'Media file not found', path: relativePath });
    }
    if (result.kind === 'not_file') return res.status(400).json({ error: 'Path is not a file' });
    streamMediaResourceWithRanges(req, res, result.resource, {
      'Cache-Control': LONG_CACHE,
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    });
    logger.debug?.('proxy.media.served', { path: relativePath, mimeType: result.resource.mimeType });
  }));

  router.get('/stream', asyncHandler(async (req, res) => {
    const result = await dynamicStreamService.open({
      sourceUrl: req.query.src,
      profileName: req.query.profile ? String(req.query.profile) : undefined,
      range: req.headers.range,
    });
    if (result.kind === 'missing_source') {
      return res.status(400).json({ error: 'Missing src parameter' });
    }
    if (result.kind === 'blocked') return res.status(400).json({ error: 'Blocked host' });
    if (result.kind === 'invalid') {
      return res.status(400).json({ error: result.message || 'Invalid src URL' });
    }
    if (result.kind === 'too_many_redirects') {
      return res.status(502).json({ error: 'Too many redirects' });
    }
    if (result.kind === 'fetch_failed') {
      return res.status(502).json({ error: 'Upstream fetch failed' });
    }
    if (result.kind === 'upstream_error') {
      return res.status(result.status).json({ error: `Upstream returned ${result.status}` });
    }
    if (result.kind === 'playlist') {
      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      });
      return res.send(result.body);
    }

    res.status(result.status);
    res.set('Content-Type', result.contentType);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Accept-Ranges', result.acceptRanges);
    if (result.contentRange) res.set('Content-Range', result.contentRange);
    if (result.contentLength) res.set('Content-Length', result.contentLength);
    if (!result.body) return res.end();
    try {
      const reader = result.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) return res.end();
        res.write(Buffer.from(value));
        return pump();
      };
      await pump();
    } catch (error) {
      logger.warn?.('proxy.stream.pipeFailed', { host: result.host, error: error.message });
      if (!res.headersSent) res.status(502).end();
      else res.end();
    }
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

function resizePlexThumbnail(req, _res, next) {
  const width = Number.parseInt(req.query?.w, 10);
  const height = Number.parseInt(req.query?.h, 10);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
      && !req.path.startsWith('/photo/')) {
    req.url = `/photo/:/transcode?width=${width}&height=${height}&upscale=1&url=${encodeURIComponent(req.path)}`;
  }
  next();
}

function requiredPassthrough(handler, message) {
  return async (req, res, next) => {
    if (!handler) return res.status(503).json({ error: message });
    try {
      await handler(req, res);
    } catch (error) {
      if (res.headersSent) return res.end();
      next(error);
    }
  };
}

function placeholderPassthrough(handler, name) {
  return async (req, res) => {
    try {
      if (handler) await handler(req, res);
      else sendPlaceholderSvg(res);
    } catch (error) {
      console.error(`[proxy] ${name} error:`, name === 'reddit' ? error.message : error);
      sendPlaceholderSvg(res);
    }
  };
}

export default createProxyRouter;
