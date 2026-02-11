/**
 * Admin Integrations Router
 *
 * API for viewing integration status, merging data from multiple config sources.
 *
 * Data sources (relative to data root):
 * - household/config/integrations.yml  -- what the household uses
 * - system/config/services.yml         -- service URLs per environment
 * - household/auth/{provider}.yml      -- household auth (existence check only)
 * - system/auth/{provider}.yml         -- system auth (existence check only)
 *
 * Endpoints (all under /api/v1/admin/integrations):
 * - GET    /                 - List all integrations with status
 * - GET    /:provider        - Detail for a specific provider
 * - POST   /:provider/test   - Health check (placeholder -- return mock result)
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

/**
 * Create Admin Integrations Router
 *
 * @param {Object} config
 * @param {Object} config.configService - ConfigService for data directory paths
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminIntegrationsRouter(config) {
  const { configService, logger = console } = config;
  const router = express.Router();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the resolved data root directory
   */
  function getDataRoot() {
    return path.resolve(configService.getDataDir());
  }

  /**
   * Read household integrations config from household/config/integrations.yml
   * @returns {Object} Integrations config object
   */
  function readIntegrations() {
    const absPath = path.join(getDataRoot(), 'household/config/integrations.yml');
    if (!fs.existsSync(absPath)) return {};
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  /**
   * Read services config from system/config/services.yml
   * @returns {Object} Services config object (provider -> env -> URL)
   */
  function readServices() {
    const absPath = path.join(getDataRoot(), 'system/config/services.yml');
    if (!fs.existsSync(absPath)) return {};
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  /**
   * Determine current environment from DAYLIGHT_ENV or fallback to 'docker'
   * @returns {string}
   */
  function getEnvironment() {
    return process.env.DAYLIGHT_ENV || 'docker';
  }

  /**
   * Resolve service URL for a provider in the current environment.
   * Falls back through: env-specific -> docker -> first available -> null
   * @param {Object} services - Parsed services.yml object
   * @param {string} provider - Provider name (e.g. 'plex', 'homeassistant')
   * @param {string} env - Current environment name
   * @returns {string|null}
   */
  function getServiceUrl(services, provider, env) {
    const entry = services[provider];
    if (!entry) return null;
    return entry[env] || entry.docker || Object.values(entry)[0] || null;
  }

  /**
   * Check whether auth credentials exist for a provider.
   * Looks in both household/auth/{provider}.yml and system/auth/{provider}.yml.
   * Does NOT read file contents (masked).
   * @param {string} provider - Provider name
   * @returns {boolean}
   */
  function checkAuthExists(provider) {
    const householdPath = path.join(getDataRoot(), `household/auth/${provider}.yml`);
    const systemPath = path.join(getDataRoot(), `system/auth/${provider}.yml`);
    return fs.existsSync(householdPath) || fs.existsSync(systemPath);
  }

  // ===========================================================================
  // GET / - List all integrations with status
  // ===========================================================================

  router.get('/', (req, res) => {
    try {
      const integrations = readIntegrations();
      const services = readServices();
      const env = getEnvironment();

      const providers = [];

      for (const [category, entries] of Object.entries(integrations)) {
        // Handle messaging specially (nested structure)
        if (category === 'messaging') {
          const platforms = new Set();
          for (const [app, appEntries] of Object.entries(entries)) {
            if (Array.isArray(appEntries)) {
              appEntries.forEach(e => platforms.add(e.platform));
            }
          }
          platforms.forEach(platform => {
            providers.push({
              provider: platform,
              category: 'messaging',
              url: getServiceUrl(services, platform, env),
              hasAuth: checkAuthExists(platform),
            });
          });
          continue;
        }

        if (!Array.isArray(entries)) continue;

        entries.forEach(entry => {
          providers.push({
            provider: entry.provider,
            category,
            config: entry,
            url: getServiceUrl(services, entry.provider, env),
            hasAuth: checkAuthExists(entry.provider),
          });
        });
      }

      logger.info?.('admin.integrations.listed', { count: providers.length });
      res.json({ integrations: providers });
    } catch (error) {
      logger.error?.('admin.integrations.list.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to list integrations' });
    }
  });

  // ===========================================================================
  // GET /:provider - Detail for a specific provider
  // ===========================================================================

  router.get('/:provider', (req, res) => {
    try {
      const providerName = req.params.provider;
      const integrations = readIntegrations();
      const services = readServices();
      const env = getEnvironment();

      // Find which category this provider belongs to
      let found = null;
      for (const [category, entries] of Object.entries(integrations)) {
        if (category === 'messaging') {
          // Check if providerName is a platform in messaging
          for (const [app, appEntries] of Object.entries(entries)) {
            if (Array.isArray(appEntries) && appEntries.some(e => e.platform === providerName)) {
              found = {
                provider: providerName,
                category: 'messaging',
                apps: Object.keys(entries).filter(a => {
                  const ae = entries[a];
                  return Array.isArray(ae) && ae.some(e => e.platform === providerName);
                })
              };
              break;
            }
          }
          if (found) break;
          continue;
        }

        if (!Array.isArray(entries)) continue;

        const entry = entries.find(e => e.provider === providerName);
        if (entry) {
          found = { ...entry, category };
          break;
        }
      }

      if (!found) {
        return res.status(404).json({ error: `Provider "${providerName}" not found` });
      }

      const detail = {
        ...found,
        url: getServiceUrl(services, providerName, env),
        hasAuth: checkAuthExists(providerName),
        authLocations: {
          household: fs.existsSync(path.join(getDataRoot(), `household/auth/${providerName}.yml`)),
          system: fs.existsSync(path.join(getDataRoot(), `system/auth/${providerName}.yml`)),
        },
      };

      logger.info?.('admin.integrations.detail', { provider: providerName });
      res.json({ integration: detail });
    } catch (error) {
      logger.error?.('admin.integrations.detail.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to read integration detail' });
    }
  });

  // ===========================================================================
  // POST /:provider/test - Placeholder health check
  // ===========================================================================

  router.post('/:provider/test', (req, res) => {
    const providerName = req.params.provider;
    logger.info?.('admin.integrations.test.requested', { provider: providerName });
    // Placeholder - return a mock result
    res.json({
      provider: providerName,
      status: 'untested',
      message: 'Health check not yet implemented for this provider',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

export default createAdminIntegrationsRouter;
