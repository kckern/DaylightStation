/**
 * HomeAssistantAdapter - Home Assistant implementation of IHomeAutomationGateway
 *
 * Provides access to Home Assistant's REST API for device control,
 * state queries, scene activation, and script execution.
 */

import { nowTs24 } from '../../../0_system/utils/index.mjs';

/**
 * @typedef {import('../../../3_applications/home-automation/ports/IHomeAutomationGateway.mjs').DeviceState} DeviceState
 * @typedef {import('../../../3_applications/home-automation/ports/IHomeAutomationGateway.mjs').ServiceResult} ServiceResult
 * @typedef {import('../../../3_applications/home-automation/ports/IHomeAutomationGateway.mjs').WaitOptions} WaitOptions
 * @typedef {import('../../../3_applications/home-automation/ports/IHomeAutomationGateway.mjs').WaitResult} WaitResult
 */

export class HomeAssistantAdapter {
  #baseUrl;
  #token;
  #logger;
  #httpClient;
  #metrics;

  /**
   * @param {Object} config
   * @param {string} config.baseUrl - Home Assistant base URL (e.g., 'http://homeassistant.local:8123')
   * @param {string} config.token - Long-lived access token
   * @param {Object} [deps]
   * @param {Object} [deps.logger] - Logger instance
   * @param {Object} [deps.httpClient] - HTTP client (defaults to fetch)
   */
  constructor(config, deps = {}) {
    if (!config?.baseUrl) {
      throw new Error('HomeAssistantAdapter requires baseUrl');
    }
    if (!config?.token) {
      throw new Error('HomeAssistantAdapter requires token');
    }

    // Normalize baseUrl (remove trailing slash)
    this.#baseUrl = config.baseUrl.replace(/\/$/, '');
    this.#token = config.token;
    this.#logger = deps.logger || console;
    this.#httpClient = deps.httpClient || null;

    this.#metrics = {
      startedAt: Date.now(),
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      lastRequestAt: null
    };
  }

  // =============================================================================
  // IHomeAutomationGateway Implementation
  // =============================================================================

  /**
   * Get current state of a device/entity
   * @param {string} entityId - Entity ID (e.g., 'light.living_room', 'binary_sensor.door')
   * @returns {Promise<DeviceState | null>}
   */
  async getState(entityId) {
    if (!entityId) return null;

    try {
      const response = await this.#apiGet(`/api/states/${entityId}`);

      if (!response) return null;

      return {
        entityId: response.entity_id,
        state: response.state,
        attributes: response.attributes || {},
        lastChanged: response.last_changed
      };
    } catch (error) {
      this.#logger.debug?.('ha.getState.error', { entityId, error: error.message });
      return null;
    }
  }

  /**
   * Call a service on Home Assistant
   * @param {string} domain - Service domain (e.g., 'light', 'switch', 'script')
   * @param {string} service - Service name (e.g., 'turn_on', 'toggle')
   * @param {Object} [data] - Service data (e.g., { entity_id: 'light.living_room' })
   * @returns {Promise<ServiceResult>}
   */
  async callService(domain, service, data = {}) {
    if (!domain || !service) {
      return { ok: false, error: 'Domain and service are required' };
    }

    try {
      this.#logger.debug?.('ha.callService', { domain, service, data });

      const response = await this.#apiPost(`/api/services/${domain}/${service}`, data);

      this.#logger.info?.('ha.callService.success', { domain, service });
      return { ok: true, data: response };
    } catch (error) {
      this.#logger.error?.('ha.callService.error', {
        domain,
        service,
        error: error.message
      });
      return { ok: false, error: error.message };
    }
  }

  /**
   * Activate a scene
   * @param {string} sceneId - Scene ID (with or without 'scene.' prefix)
   * @returns {Promise<ServiceResult>}
   */
  async activateScene(sceneId) {
    if (!sceneId) {
      return { ok: false, error: 'Scene ID is required' };
    }

    const entityId = this.#normalizeEntityId(sceneId, 'scene');

    // Use sampled logging to reduce log spam during frequent scene activations
    this.#logger.sampled?.('ha.scene.activating', { entityId }, { maxPerMinute: 30 });

    return this.callService('scene', 'turn_on', { entity_id: entityId });
  }

  /**
   * Run a script
   * @param {string} scriptId - Script ID (with or without 'script.' prefix)
   * @returns {Promise<ServiceResult>}
   */
  async runScript(scriptId) {
    if (!scriptId) {
      return { ok: false, error: 'Script ID is required' };
    }

    const entityId = this.#normalizeEntityId(scriptId, 'script');

    this.#logger.debug?.('ha.runScript', { scriptId, entityId });

    return this.callService('script', 'turn_on', { entity_id: entityId });
  }

  /**
   * Wait for an entity to reach a desired state
   * @param {string} entityId - Entity ID to monitor
   * @param {string} desiredState - State value to wait for (e.g., 'on', 'off')
   * @param {WaitOptions} [options]
   * @returns {Promise<WaitResult>}
   */
  async waitForState(entityId, desiredState, options = {}) {
    const timeoutMs = options.timeoutMs ?? 30000;
    const pollIntervalMs = options.pollIntervalMs ?? 2000;

    const startTime = Date.now();
    let finalState = 'unknown';

    this.#logger.debug?.('ha.waitForState.start', { entityId, desiredState, timeoutMs });

    while (Date.now() - startTime < timeoutMs) {
      const state = await this.getState(entityId);
      finalState = state?.state ?? 'unknown';

      if (finalState === desiredState) {
        const elapsedMs = Date.now() - startTime;
        this.#logger.info?.('ha.waitForState.reached', { entityId, desiredState, elapsedMs });
        return { reached: true, elapsedMs, finalState };
      }

      await this.#sleep(pollIntervalMs);
    }

    const elapsedMs = Date.now() - startTime;
    this.#logger.warn?.('ha.waitForState.timeout', { entityId, desiredState, finalState, elapsedMs });
    return { reached: false, elapsedMs, finalState };
  }

  /**
   * Check if adapter is connected/configured
   * @returns {boolean}
   */
  isConnected() {
    return !!(this.#baseUrl && this.#token);
  }

  /**
   * Get provider name
   * @returns {string}
   */
  getProviderName() {
    return 'homeassistant';
  }

  // =============================================================================
  // Additional Convenience Methods
  // =============================================================================

  /**
   * Turn on an entity
   * @param {string} entityId - Entity ID
   * @returns {Promise<ServiceResult>}
   */
  async turnOn(entityId) {
    const domain = this.#extractDomain(entityId);
    return this.callService(domain, 'turn_on', { entity_id: entityId });
  }

  /**
   * Turn off an entity
   * @param {string} entityId - Entity ID
   * @returns {Promise<ServiceResult>}
   */
  async turnOff(entityId) {
    const domain = this.#extractDomain(entityId);
    return this.callService(domain, 'turn_off', { entity_id: entityId });
  }

  /**
   * Toggle an entity
   * @param {string} entityId - Entity ID
   * @returns {Promise<ServiceResult>}
   */
  async toggle(entityId) {
    const domain = this.#extractDomain(entityId);
    return this.callService(domain, 'toggle', { entity_id: entityId });
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    const uptimeMs = Date.now() - this.#metrics.startedAt;
    return {
      provider: 'homeassistant',
      uptime: {
        ms: uptimeMs,
        formatted: this.#formatDuration(uptimeMs)
      },
      requests: {
        total: this.#metrics.requestCount,
        success: this.#metrics.successCount,
        errors: this.#metrics.errorCount
      },
      lastRequestAt: this.#metrics.lastRequestAt
    };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Make a GET request to HA API
   * @private
   */
  async #apiGet(path) {
    return this.#apiRequest('GET', path);
  }

  /**
   * Make a POST request to HA API
   * @private
   */
  async #apiPost(path, data) {
    return this.#apiRequest('POST', path, data);
  }

  /**
   * Make an API request
   * @private
   */
  async #apiRequest(method, path, data = null) {
    const url = `${this.#baseUrl}${path}`;
    const headers = {
      'Authorization': `Bearer ${this.#token}`,
      'Content-Type': 'application/json'
    };

    this.#metrics.requestCount++;
    this.#metrics.lastRequestAt = nowTs24();

    try {
      let response;

      if (this.#httpClient) {
        response = await this.#httpClient.request({ method, url, headers, data });
      } else {
        const options = {
          method,
          headers
        };
        if (data && method !== 'GET') {
          options.body = JSON.stringify(data);
        }
        const fetchResponse = await fetch(url, options);

        if (!fetchResponse.ok) {
          throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
        }

        response = await fetchResponse.json();
      }

      this.#metrics.successCount++;
      return response;
    } catch (error) {
      this.#metrics.errorCount++;
      this.#logger.error?.('ha.api.error', { method, path, error: error.message });
      throw error;
    }
  }

  /**
   * Normalize entity ID with domain prefix
   * @private
   */
  #normalizeEntityId(id, domain) {
    if (!id) return id;
    const prefix = `${domain}.`;
    return id.startsWith(prefix) ? id : `${prefix}${id}`;
  }

  /**
   * Extract domain from entity ID
   * @private
   */
  #extractDomain(entityId) {
    if (!entityId || !entityId.includes('.')) return 'homeassistant';
    return entityId.split('.')[0];
  }

  /**
   * Sleep helper
   * @private
   */
  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format duration for display
   * @private
   */
  #formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

export default HomeAssistantAdapter;
