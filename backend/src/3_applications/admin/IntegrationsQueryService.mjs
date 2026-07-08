/**
 * IntegrationsQueryService - Application service for the admin integrations viewer.
 *
 * Owns the multi-file YAML merge, service-URL fallback chain, and auth-presence
 * rules that the admin integrations router used to inline. The router becomes a
 * thin HTTP shell that extracts params, calls a method, and shapes the response.
 * Error cases throw typed errors that the router's P1.3 string error-middleware
 * maps to HTTP status:
 *   NotFoundError → 404 (provider not found)
 *
 * Data sources (relative to data root):
 * - household/config/integrations.yml  -- what the household uses
 * - system/config/services.yml         -- service URLs per environment
 * - household/auth/{provider}.yml      -- household auth (existence check only)
 * - system/auth/{provider}.yml         -- system auth (existence check only)
 *
 * The current environment is resolved at the composition root and injected
 * (`environment`), not read from process.env here.
 *
 * `testProvider` is an explicit, honest stub: health-check-per-provider is not
 * implemented, so it returns `status: 'untested'` rather than faking a result.
 */
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { NotFoundError } from '#system/utils/errors/index.mjs';

export class IntegrationsQueryService {
  /**
   * @param {Object} deps
   * @param {Object} deps.configService - ConfigService for data directory paths
   * @param {string} [deps.environment='docker'] - Current environment name, resolved at the
   *   composition root (was `process.env.DAYLIGHT_ENV || 'docker'` inline in the router).
   * @param {Object} [deps.logger=console] - Logger instance
   */
  constructor({ configService, environment = 'docker', logger = console }) {
    if (!configService) {
      throw new Error('IntegrationsQueryService requires a configService dependency');
    }
    this.configService = configService;
    this.environment = environment || 'docker';
    this.logger = logger;
  }

  /** Get the resolved data root directory */
  #getDataRoot() {
    return path.resolve(this.configService.getDataDir());
  }

  /** Read household integrations config from household/config/integrations.yml */
  #readIntegrations() {
    const absPath = path.join(this.#getDataRoot(), 'household/config/integrations.yml');
    if (!fs.existsSync(absPath)) return {};
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  /** Read services config from system/config/services.yml */
  #readServices() {
    const absPath = path.join(this.#getDataRoot(), 'system/config/services.yml');
    if (!fs.existsSync(absPath)) return {};
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  /**
   * Resolve service URL for a provider in the current environment.
   * Falls back through: env-specific -> docker -> first available -> null
   */
  #getServiceUrl(services, provider) {
    const entry = services[provider];
    if (!entry) return null;
    return entry[this.environment] || entry.docker || Object.values(entry)[0] || null;
  }

  /**
   * Check whether auth credentials exist for a provider (household or system).
   * Does NOT read file contents (masked).
   */
  #checkAuthExists(provider) {
    const householdPath = path.join(this.#getDataRoot(), `household/auth/${provider}.yml`);
    const systemPath = path.join(this.#getDataRoot(), `system/auth/${provider}.yml`);
    return fs.existsSync(householdPath) || fs.existsSync(systemPath);
  }

  /**
   * List all integrations with status.
   * @returns {{ integrations: Array<Object> }}
   */
  listIntegrations() {
    const integrations = this.#readIntegrations();
    const services = this.#readServices();

    const providers = [];

    for (const [category, entries] of Object.entries(integrations)) {
      // Handle messaging specially (nested structure)
      if (category === 'messaging') {
        const platforms = new Set();
        for (const [, appEntries] of Object.entries(entries)) {
          if (Array.isArray(appEntries)) {
            appEntries.forEach(e => platforms.add(e.platform));
          }
        }
        platforms.forEach(platform => {
          providers.push({
            provider: platform,
            category: 'messaging',
            url: this.#getServiceUrl(services, platform),
            hasAuth: this.#checkAuthExists(platform),
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
          url: this.#getServiceUrl(services, entry.provider),
          hasAuth: this.#checkAuthExists(entry.provider),
        });
      });
    }

    this.logger.info?.('admin.integrations.listed', { count: providers.length });
    return { integrations: providers };
  }

  /**
   * Detail for a specific provider.
   * @param {string} providerName
   * @returns {{ integration: Object }}
   * @throws {NotFoundError} provider not found
   */
  getIntegration(providerName) {
    const integrations = this.#readIntegrations();
    const services = this.#readServices();

    // Find which category this provider belongs to
    let found = null;
    for (const [category, entries] of Object.entries(integrations)) {
      if (category === 'messaging') {
        for (const [, appEntries] of Object.entries(entries)) {
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
      throw new NotFoundError(`Provider "${providerName}" not found`);
    }

    const dataRoot = this.#getDataRoot();
    const detail = {
      ...found,
      url: this.#getServiceUrl(services, providerName),
      hasAuth: this.#checkAuthExists(providerName),
      authLocations: {
        household: fs.existsSync(path.join(dataRoot, `household/auth/${providerName}.yml`)),
        system: fs.existsSync(path.join(dataRoot, `system/auth/${providerName}.yml`)),
      },
    };

    this.logger.info?.('admin.integrations.detail', { provider: providerName });
    return { integration: detail };
  }

  /**
   * Explicit honest stub: per-provider health checks are not implemented.
   * Returns `status: 'untested'` rather than faking a live probe result.
   * @param {string} providerName
   * @returns {{ provider, status, message, timestamp }}
   */
  testProvider(providerName) {
    this.logger.info?.('admin.integrations.test.requested', { provider: providerName });
    return {
      provider: providerName,
      status: 'untested',
      message: 'Health check not yet implemented for this provider',
      timestamp: new Date().toISOString(),
    };
  }
}

export default IntegrationsQueryService;
