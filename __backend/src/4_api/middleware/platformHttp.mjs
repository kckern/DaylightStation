import express from 'express';
import { sendInternalError } from '#api/utils/internalError.mjs';

const STATIC_ASSET_EXTENSION = /\.(js|mjs|cjs|css|map|json|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|m4a|ogg|oga|wav|webm|mov|pdf|wasm|txt|zip)$/i;

export function crossOriginIsolationHeaders(_req, res, next) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
}

export function skipWebSocketPaths(req, _res, next) {
  return req.path.startsWith('/ws') ? next('route') : next();
}

export function createMissingConfigRouter() {
  const router = express.Router();
  router.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/ws/')) return next();
    return sendInternalError(res, { error: 'Application not configured. Ensure system.yml exists.' });
  });
  return router;
}

/**
 * `Content-Security-Policy: frame-ancestors` for the app's pages: only the app
 * itself (and `http.allowed_origins`) may frame them, so another site cannot
 * put the household's screens in a frame and click through them.
 * __docs/reference/core/network-exposure.md (Cross-site requests).
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] - `http.frame_ancestors: false` turns it off
 * @param {Iterable<string>} [options.allowedOrigins] - normalized origins
 * @returns {string|null}
 */
export function frameAncestorsPolicy({ enabled = true, allowedOrigins = [] } = {}) {
  if (enabled === false) return null;
  return ["frame-ancestors 'self'", ...allowedOrigins].join(' ');
}

/** Headers for the SPA's HTML document (index.html and every SPA route). */
export function setFrontendDocumentHeaders(res, { frameAncestors = null } = {}) {
  // index.html must never be cached so location.reload() gets fresh script tags
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  // window.Profiler (JS Self-Profiling API) for on-device renderer profiling
  res.setHeader('Document-Policy', 'js-profiling');
  if (frameAncestors) res.setHeader('Content-Security-Policy', frameAncestors);
}

export function createFrontendStaticRouter({ frontendPath, frameAncestors = null }) {
  if (!frontendPath) throw new Error('createFrontendStaticRouter requires frontendPath');
  const router = express.Router();
  // Hashed asset filenames are immutable; only the document gets these headers.
  router.use(express.static(frontendPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) setFrontendDocumentHeaders(res, { frameAncestors });
    },
  }));
  router.use((req, res, next) => {
    if (req.path.startsWith('/api/v1') || req.path.startsWith('/ws')) return next();
    const lastSegment = req.path.slice(req.path.lastIndexOf('/') + 1);
    if (STATIC_ASSET_EXTENSION.test(lastSegment)) return next();
    setFrontendDocumentHeaders(res, { frameAncestors });
    return res.sendFile(`${frontendPath}/index.html`);
  });
  return router;
}

export function conciergeContextFromRequest(req) {
  return {
    satellite: req.satellite,
    conversationId: req.body?.conversation_id ?? req.body?.conversationId ?? null,
  };
}
