/**
 * HarvesterService - Orchestrates data harvesting operations
 *
 * Central application service that coordinates harvester adapters.
 * Provides a unified interface for:
 * - Registering harvesters
 * - Executing harvests with DRY logic (used by both API and scheduler)
 * - Querying harvester status
 *
 * Dependencies:
 * - Harvester adapters from 2_adapters/harvester/
 * - ConfigService for username resolution
 *
 * @module 3_applications/harvester/HarvesterService
 */

/**
 * Application service that orchestrates harvester operations
 */
export class HarvesterService {
  /** @type {Map<string, IHarvester>} */
  #harvesters = new Map();

  /** @type {Object} */
  #configService;

  /** @type {Object} */
  #logger;

  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.configService - ConfigService for user resolution
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ configService, logger }) {
    if (!configService) {
      throw new Error('HarvesterService requires configService');
    }
    this.#configService = configService;
    this.#logger = logger || console;
  }

  /**
   * Register a single harvester
   *
   * @param {IHarvester} harvester - Harvester instance implementing IHarvester
   * @throws {Error} If harvester lacks serviceId
   */
  register(harvester) {
    if (!harvester?.serviceId) {
      throw new Error('Harvester must have a serviceId property');
    }

    const serviceId = harvester.serviceId;

    if (this.#harvesters.has(serviceId)) {
      this.#log('warn', 'harvester.register.duplicate', {
        serviceId,
        message: 'Overwriting existing harvester',
      });
    }

    this.#harvesters.set(serviceId, harvester);
    this.#log('debug', 'harvester.register', {
      serviceId,
      category: harvester.category,
    });
  }

  /**
   * Register multiple harvesters
   *
   * @param {IHarvester[]} harvesters - Array of harvester instances
   */
  registerAll(harvesters) {
    if (!Array.isArray(harvesters)) {
      throw new Error('registerAll expects an array of harvesters');
    }

    for (const harvester of harvesters) {
      this.register(harvester);
    }

    this.#log('info', 'harvester.registerAll.complete', {
      count: harvesters.length,
      serviceIds: harvesters.map(h => h.serviceId),
    });
  }

  /**
   * Execute a harvest operation
   *
   * @param {string} serviceId - The harvester service ID (e.g., 'strava', 'lastfm')
   * @param {string} [username] - Target username (resolved from config if not provided)
   * @param {Object} [options] - Harvest options passed to the harvester
   * @returns {Promise<HarvestResult>} Result from the harvester
   * @throws {Error} If harvester not found or harvest fails
   */
  async harvest(serviceId, username, options = {}) {
    const harvester = this.#harvesters.get(serviceId);

    if (!harvester) {
      const error = new Error(`Harvester not found: ${serviceId}`);
      this.#log('error', 'harvester.harvest.notFound', { serviceId });
      throw error;
    }

    // Resolve username: use provided username, or head of household from config, or 'default'
    const resolvedUsername = username || this.#configService?.getHeadOfHousehold?.() || 'default';

    this.#log('info', 'harvester.harvest.start', {
      serviceId,
      username: resolvedUsername,
      category: harvester.category,
      options,
    });

    try {
      const result = await harvester.harvest(resolvedUsername, options);

      this.#log('info', 'harvester.harvest.complete', {
        serviceId,
        username: resolvedUsername,
        status: result.status,
        count: result.count,
      });

      return result;

    } catch (error) {
      this.#log('error', 'harvester.harvest.error', {
        serviceId,
        username: resolvedUsername,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get status for a specific harvester
   *
   * @param {string} serviceId - The harvester service ID
   * @returns {Object} Status object with serviceId, category, and circuit breaker state
   * @throws {Error} If harvester not found
   */
  getStatus(serviceId) {
    const harvester = this.#harvesters.get(serviceId);

    if (!harvester) {
      throw new Error(`Harvester not found: ${serviceId}`);
    }

    return {
      serviceId: harvester.serviceId,
      category: harvester.category,
      ...harvester.getStatus(),
    };
  }

  /**
   * Get status for all registered harvesters
   *
   * @returns {Object[]} Array of status objects for all harvesters
   */
  getAllStatuses() {
    const statuses = [];

    for (const [serviceId, harvester] of this.#harvesters) {
      statuses.push({
        serviceId,
        category: harvester.category,
        ...harvester.getStatus(),
      });
    }

    return statuses;
  }

  /**
   * List all registered harvesters
   *
   * @returns {Array<{serviceId: string, category: string, params: Array}>} Array of harvester info
   */
  listHarvesters() {
    return Array.from(this.#harvesters.values()).map(harvester => ({
      serviceId: harvester.serviceId,
      category: harvester.category,
      params: harvester.getParams?.() || [],
    }));
  }

  /**
   * Check if a harvester is registered
   *
   * @param {string} serviceId - The harvester service ID
   * @returns {boolean} True if harvester exists
   */
  has(serviceId) {
    return this.#harvesters.has(serviceId);
  }

  /**
   * Get a harvester instance by serviceId
   *
   * @param {string} serviceId - The harvester service ID
   * @returns {IHarvester|undefined} The harvester instance or undefined
   */
  get(serviceId) {
    return this.#harvesters.get(serviceId);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Log helper
   * @private
   */
  #log(level, message, data = {}) {
    if (this.#logger[level]) {
      this.#logger[level](message, data);
    }
  }
}

export default HarvesterService;
