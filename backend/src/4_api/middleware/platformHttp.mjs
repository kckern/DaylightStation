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
