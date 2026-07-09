/**
 * Admin Config Router (thin HTTP shell)
 *
 * Generic CRUD for YAML config files within allowed data directories. All
 * security policy + I/O lives in YamlConfigFileService
 * (#apps/admin/YamlConfigFileService.mjs). This router only extracts params,
 * calls the service, and returns the result. Typed errors thrown by the service
 * propagate to the P1.3 string error-middleware (ValidationError→400,
 * AuthorizationError→403, NotFoundError→404).
 *
 * Endpoints (all under /api/v1/admin/config):
 * - GET    /files       - List all editable config files with metadata
 * - GET    /files/*     - Read file contents (raw YAML + parsed object)
 * - PUT    /files/*     - Write file (accepts raw YAML string or parsed object)
 *
 * Allowed directories (relative to data root): system/config, household/config
 * Masked directories (listed but not readable/writable): system/auth, household/auth
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';

/**
 * Create Admin Config Router
 *
 * @param {Object} config
 * @param {Object} config.yamlConfigFileService - Injected YamlConfigFileService (from the
 *   composition root). Owns the directory allow/mask policy, traversal guard, and I/O.
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminConfigRouter(config) {
  const { yamlConfigFileService: service, logger = console } = config;
  if (!service) {
    throw new Error('createAdminConfigRouter requires an injected yamlConfigFileService');
  }
  const router = express.Router();

  // GET /files - List all editable config files
  router.get('/files', asyncHandler((req, res) => {
    res.json(service.listFiles());
  }));

  // GET /files/* - Read a config file
  router.get('/files/*splat', asyncHandler((req, res) => {
    res.json(service.readFile(splatPath(req)));
  }));

  // PUT /files/* - Write a config file
  router.put('/files/*splat', asyncHandler((req, res) => {
    res.json(service.writeFile(splatPath(req), req.body || {}));
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createAdminConfigRouter;
