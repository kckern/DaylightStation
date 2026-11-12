import express from 'express';
import { sendInternalError } from '#api/utils/internalError.mjs';
import {
  CROSS_ORIGIN_ISOLATION_HEADERS,
  isCrossOriginIsolatedPath,
} from '#shared/contracts/crossOriginIsolation.mjs';

const STATIC_ASSET_EXTENSION = /\.(js|mjs|cjs|css|map|json|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|m4a|ogg|oga|wav|webm|mov|pdf|wasm|txt|zip)$/i;

/**
 * Cross-origin isolation (COOP same-origin + COEP credentialless) for the
 * documents that need SharedArrayBuffer — by default the Fitness app, whose
 * pose detector runs TF.js WASM on threads.
 *
 * Scoped by request path, not by "is this index.html": the SPA serves one
 * index.html for every route, so the path is the only thing that tells a
 * Fitness document from any other. `/api/*`, `/ws` and every other app are
 * left alone.
 *
 * `getPolicy` is called per request, so a config reload (or the env kill
 * switch at next start) takes effect without a rebuild. If resolving the
 * policy throws, the response goes out without the headers: a page that is not
 * isolated still works (single-threaded pose), a request that 500s does not.
 *
 * @param {object} deps
 * @param {() => {enabled: boolean, paths: string[]}} deps.getPolicy
 * @param {object} [deps.logger]
 */
export function createCrossOriginIsolationMiddleware({ getPolicy, logger = null }) {
  if (typeof getPolicy !== 'function') {
    throw new Error('createCrossOriginIsolationMiddleware requires getPolicy');
  }
  let failureLogged = false;
  return function crossOriginIsolation(req, res, next) {
    let policy = null;
    try {
      policy = getPolicy();
    } catch (error) {
      if (!failureLogged) {
        failureLogged = true;
        logger?.warn?.('http.cross_origin_isolation.policy_failed', { error: error.message });
      }
    }
    if (policy?.enabled && isCrossOriginIsolatedPath(req.path, policy.paths)) {
      for (const [name, value] of Object.entries(CROSS_ORIGIN_ISOLATION_HEADERS)) {
        res.setHeader(name, value);
      }
    }
    next();
  };
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

function setFrontendDocumentHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Document-Policy', 'js-profiling');
}

export function createFrontendStaticRouter({ frontendPath }) {
  if (!frontendPath) throw new Error('createFrontendStaticRouter requires frontendPath');
  const router = express.Router();
  router.use(express.static(frontendPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) setFrontendDocumentHeaders(res);
    },
  }));
  router.use((req, res, next) => {
    if (req.path.startsWith('/api/v1') || req.path.startsWith('/ws')) return next();
    const lastSegment = req.path.slice(req.path.lastIndexOf('/') + 1);
    if (STATIC_ASSET_EXTENSION.test(lastSegment)) return next();
    setFrontendDocumentHeaders(res);
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
