/**
 * Admin Integrations Router (thin HTTP shell)
 *
 * Views integration status by merging multiple config sources. All persistence +
 * rules (multi-file YAML merge, service-URL fallback chain, auth-presence checks,
 * environment resolution) live in IntegrationsQueryService
 * (#apps/admin/IntegrationsQueryService.mjs), injected from the composition root.
 * This router only extracts params, calls the service, and shapes the HTTP
 * response. Typed errors propagate to the P1.3 string error-middleware
 * (NotFoundError→404).
 *
 * Endpoints (all under /api/v1/admin/integrations):
 * - GET    /                 - List all integrations with status
 * - GET    /:provider        - Detail for a specific provider
 * - POST   /:provider/test   - Health check (explicit stub -> status 'untested')
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * Create Admin Integrations Router
 *
 * @param {Object} config
 * @param {Object} config.integrationsQueryService - Injected IntegrationsQueryService (from the composition root)
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminIntegrationsRouter(config) {
  const { integrationsQueryService: service, logger = console } = config;
  if (!service) {
    throw new Error('createAdminIntegrationsRouter requires an injected integrationsQueryService');
  }
  const router = express.Router();

  // GET / - List all integrations with status
  router.get('/', asyncHandler((req, res) => {
    res.json(service.listIntegrations());
  }));

  // GET /:provider - Detail for a specific provider
  router.get('/:provider', asyncHandler((req, res) => {
    res.json(service.getIntegration(req.params.provider));
  }));

  // POST /:provider/test - Explicit stub health check
  router.post('/:provider/test', asyncHandler((req, res) => {
    res.json(service.testProvider(req.params.provider));
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createAdminIntegrationsRouter;
