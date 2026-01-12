// backend/src/4_api/middleware/legacyPlayShim.mjs
import express from 'express';

const DEPRECATION_LOG_INTERVAL = 60000;
const lastLogTimes = new Map();

function logDeprecationWarning(legacyEndpoint, newEndpoint) {
  const now = Date.now();
  const lastLog = lastLogTimes.get(legacyEndpoint) || 0;
  if (now - lastLog > DEPRECATION_LOG_INTERVAL) {
    console.warn(`[DEPRECATED] ${legacyEndpoint} -> Use ${newEndpoint} instead`);
    lastLogTimes.set(legacyEndpoint, now);
  }
}

function addDeprecationHeader(res, newEndpoint) {
  res.setHeader('X-Deprecated', `Use ${newEndpoint} instead`);
  res.setHeader('X-Deprecated-Since', '2026-01-10');
}

/**
 * Transform new API response to legacy format
 */
function toLegacyResponse(newResponse) {
  return {
    media_key: newResponse.media_key || newResponse.id,
    media_url: newResponse.media_url,
    media_type: newResponse.media_type,
    title: newResponse.title,
    duration: newResponse.duration,
    plex: newResponse.plex || (newResponse.id?.startsWith('plex:')
      ? newResponse.id.replace('plex:', '')
      : undefined),
    show: newResponse.show,
    season: newResponse.season,
    episode: newResponse.episode,
    resume_position: newResponse.resume_position,
    resume_percent: newResponse.resume_percent,
    thumbnail: newResponse.thumbnail,
    image: newResponse.thumbnail
  };
}

/**
 * Create middleware that handles legacy /media/plex/info and /media/info endpoints
 * by forwarding to the new /api/play endpoints.
 *
 * Legacy endpoints:
 * - GET /media/plex/info/:key/:config? -> /api/play/plex/:key/:config?
 * - GET /media/info/(path) -> /api/play/filesystem/(path)
 *
 * @returns {express.Router}
 */
export function createLegacyPlayShim() {
  const router = express.Router();

  /**
   * Legacy Plex info endpoint
   * GET /media/plex/info/:key/:config?
   */
  router.get('/media/plex/info/:key/:config?', async (req, res, next) => {
    const { key, config } = req.params;
    const queryString = Object.keys(req.query).length
      ? '?' + new URLSearchParams(req.query).toString()
      : '';

    let newPath = `/api/play/plex/${key}`;
    if (config) newPath += `/${config}`;
    newPath += queryString;

    logDeprecationWarning('/media/plex/info', newPath);
    addDeprecationHeader(res, newPath);

    req.url = newPath;
    req.originalUrl = newPath;
    req._legacyShimmed = true;

    const originalJson = res.json.bind(res);
    res.json = function(body) {
      if (req._legacyShimmed) {
        return originalJson(toLegacyResponse(body));
      }
      return originalJson(body);
    };

    next('route');
  });

  /**
   * Legacy filesystem info endpoint
   * GET /media/info/(path)
   */
  router.get('/media/info/*', async (req, res, next) => {
    const path = req.params[0] || '';
    const queryString = Object.keys(req.query).length
      ? '?' + new URLSearchParams(req.query).toString()
      : '';

    const newPath = `/api/play/filesystem/${path}${queryString}`;

    logDeprecationWarning('/media/info', newPath);
    addDeprecationHeader(res, newPath);

    req.url = newPath;
    req.originalUrl = newPath;
    req._legacyShimmed = true;

    const originalJson = res.json.bind(res);
    res.json = function(body) {
      if (req._legacyShimmed) {
        return originalJson(toLegacyResponse(body));
      }
      return originalJson(body);
    };

    next('route');
  });

  return router;
}
