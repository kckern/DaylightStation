/**
 * Admin Apps Config Router (thin HTTP shell)
 *
 * Lists and reads/writes per-app config files. All persistence + rules live in
 * AppsConfigService (#apps/admin/AppsConfigService.mjs), injected from the
 * composition root. This router only extracts params, calls the service, and
 * shapes the HTTP response. Typed errors thrown by the service propagate to the
 * P1.3 string error-middleware (ValidationError→400, NotFoundError→404).
 *
 * Endpoints (all under /api/v1/admin/apps):
 * - GET    /             - List all known apps with config file existence check
 * - GET    /:appId/config - Read app config (parsed + raw)
 * - PUT    /:appId/config - Write app config (accepts raw YAML or parsed object)
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * Create Admin Apps Config Router
 *
 * @param {Object} config
 * @param {Object} config.appsConfigService - Injected AppsConfigService (from the composition root)
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminAppsRouter(config) {
  const { appsConfigService: service, logger = console } = config;
  if (!service) {
    throw new Error('createAdminAppsRouter requires an injected appsConfigService');
  }
  const router = express.Router();

  // GET / - List all known apps with config file metadata
  router.get('/', asyncHandler((req, res) => {
    res.json(service.listApps());
  }));

  // GET /:appId/config - Read app config file
  router.get('/:appId/config', asyncHandler((req, res) => {
    res.json(service.readAppConfig(req.params.appId));
  }));

  // PUT /:appId/config - Write app config file
  router.put('/:appId/config', asyncHandler((req, res) => {
    res.json(service.writeAppConfig(req.params.appId, req.body || {}));
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createAdminAppsRouter;
