// backend/src/4_api/middleware/legacyListShim.mjs
import express from 'express';

const KNOWN_MODIFIERS = ['playable', 'shuffle', 'recent_on_top'];
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
 * Translate legacy data/list path to new format
 */
export function translateDataListPath(path) {
  const parts = path.split('/');
  const modifiers = [];
  const pathParts = [];

  for (const part of parts) {
    if (KNOWN_MODIFIERS.includes(part)) {
      modifiers.push(part);
    } else if (part.includes(',')) {
      const mods = part.split(',');
      for (const mod of mods) {
        if (KNOWN_MODIFIERS.includes(mod)) {
          modifiers.push(mod);
        } else {
          pathParts.push(mod);
        }
      }
    } else {
      pathParts.push(part);
    }
  }

  // Handle + as space replacement (legacy folder syntax)
  const localId = pathParts.join('/').replace(/\+/g, ' ');

  return { source: 'folder', localId, modifiers };
}

/**
 * Translate legacy media/plex/list path to new format
 */
export function translatePlexListPath(path) {
  const parts = path.split('/');
  const modifiers = [];
  const pathParts = [];

  for (const part of parts) {
    if (KNOWN_MODIFIERS.includes(part)) {
      modifiers.push(part);
    } else if (part.includes(',')) {
      const mods = part.split(',');
      for (const mod of mods) {
        if (KNOWN_MODIFIERS.includes(mod)) {
          modifiers.push(mod);
        } else {
          pathParts.push(mod);
        }
      }
    } else {
      pathParts.push(part);
    }
  }

  return { source: 'plex', localId: pathParts.join('/'), modifiers };
}

/**
 * Transform new list response to legacy format
 */
export function toLegacyListResponse(newResponse) {
  return {
    title: newResponse.title,
    label: newResponse.title,
    image: newResponse.image,
    kind: newResponse.source,
    plex: newResponse.source === 'plex' ? newResponse.path : undefined,
    items: newResponse.items.map(item => ({
      id: item.id,
      title: item.title,
      label: item.title,
      image: item.thumbnail || item.image,
      play: item.play,
      queue: item.queue,
      active: true,
      itemType: item.itemType
    }))
  };
}

/**
 * Create middleware for legacy list endpoints
 */
export function createLegacyListShim() {
  const router = express.Router();

  /**
   * GET /data/list/:folder/:config?
   */
  router.get('/data/list/:folder/:config?', async (req, res, next) => {
    const { folder, config } = req.params;
    const path = config ? `${folder}/${config}` : folder;
    const { source, localId, modifiers } = translateDataListPath(path);

    let newPath = `/api/list/${source}/${encodeURIComponent(localId)}`;
    if (modifiers.length) {
      newPath += `/${modifiers.join(',')}`;
    }

    logDeprecationWarning('/data/list', newPath);
    addDeprecationHeader(res, newPath);

    req.url = newPath;
    req.originalUrl = newPath;
    req._legacyShimmed = 'list';

    const originalJson = res.json.bind(res);
    res.json = function(body) {
      if (req._legacyShimmed === 'list') {
        return originalJson(toLegacyListResponse(body));
      }
      return originalJson(body);
    };

    next('route');
  });

  /**
   * GET /media/plex/list/:key/:config?
   */
  router.get('/media/plex/list/:key/:config?', async (req, res, next) => {
    const { key, config } = req.params;
    const path = config ? `${key}/${config}` : key;
    const { source, localId, modifiers } = translatePlexListPath(path);

    let newPath = `/api/list/${source}/${localId}`;
    if (modifiers.length) {
      newPath += `/${modifiers.join(',')}`;
    }

    logDeprecationWarning('/media/plex/list', newPath);
    addDeprecationHeader(res, newPath);

    req.url = newPath;
    req.originalUrl = newPath;
    req._legacyShimmed = 'list';

    const originalJson = res.json.bind(res);
    res.json = function(body) {
      if (req._legacyShimmed === 'list') {
        return originalJson(toLegacyListResponse(body));
      }
      return originalJson(body);
    };

    next('route');
  });

  return router;
}
