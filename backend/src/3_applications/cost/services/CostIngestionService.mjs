/**
 * CostIngestionService - Application service for cost event handling
 * @module applications/cost/services/CostIngestionService
 *
 * Handles incoming costs from various sources (adapters implementing ICostSource).
 * Responsible for:
 * - Registering cost sources and subscribing to their events
 * - Persisting cost entries to the repository
 * - Triggering budget evaluations when costs are received
 * - Reconciling costs from external sources
 *
 * @example
 * const service = new CostIngestionService({
 *   costRepository: yamlCostRepository,
 *   budgetService: costBudgetService,
 *   sources: [openAICostSource],
 *   logger
 * });
 *
 * // Manual cost handling
 * await service.handleCostEvent(costEntry);
 *
 * // Reconcile all sources
 * await service.reconcile();
 */

/**
 * CostIngestionService
 * Application service for ingesting and processing cost events
 *
 * @class CostIngestionService
 */
export class CostIngestionService {
  /** @type {ICostRepository} */
  #costRepository;

  /** @type {Object|null} */
  #budgetService;

  /** @type {Map<string, ICostSource>} */
  #sources;

  /** @type {Object} */
  #logger;

  /**
   * Create a CostIngestionService instance
   *
   * @param {Object} config - Service configuration
   * @param {ICostRepository} config.costRepository - Repository for persisting cost entries (required)
   * @param {Object} [config.budgetService=null] - Budget service for evaluation (optional)
   * @param {ICostSource[]} [config.sources=[]] - Cost sources to register
   * @param {Object} [config.logger=console] - Logger instance
   * @throws {Error} If costRepository is not provided
   */
  constructor({ costRepository, budgetService = null, sources = [], logger = console }) {
    if (!costRepository) {
      throw new Error('costRepository is required');
    }

    this.#costRepository = costRepository;
    this.#budgetService = budgetService;
    this.#sources = new Map();
    this.#logger = logger;

    // Register any sources provided in constructor
    for (const source of sources) {
      this.registerSource(source);
    }
  }

  /**
   * Register a cost source and subscribe to its events
   *
   * Stores the source for reconciliation and subscribes to real-time cost events.
   *
   * @param {ICostSource} source - Cost source implementing ICostSource interface
   */
  registerSource(source) {
    const sourceId = source.getSourceId();

    // Store source by ID
    this.#sources.set(sourceId, source);

    // Subscribe to cost events
    source.onCost((entry) => this.handleCostEvent(entry));

    this.#logger.info?.('cost.source.registered', {
      sourceId,
      categories: source.getSupportedCategories()
    });
  }

  /**
   * Handle an incoming cost event
   *
   * Saves the entry to the repository and triggers budget evaluation.
   *
   * @param {CostEntry} entry - The cost entry to process
   * @returns {Promise<void>}
   * @throws {Error} If saving to repository fails
   */
  async handleCostEvent(entry) {
    // Save to repository
    await this.#costRepository.save(entry);

    // Log the event
    this.#logger.info?.('cost.received', {
      entryId: entry.id,
      amount: entry.amount.amount,
      category: entry.category.toString(),
      householdId: entry.attribution.householdId
    });

    // Trigger budget evaluation if service exists
    if (this.#budgetService) {
      await this.#budgetService.evaluateBudgets(entry.attribution.householdId);
    }
  }

  /**
   * Reconcile costs from external sources
   *
   * Fetches costs from sources and saves them to the repository.
   * Can reconcile a specific source or all registered sources.
   *
   * @param {string} [sourceId] - Specific source to reconcile (optional, reconciles all if not provided)
   * @param {Date} [since] - Only fetch costs after this date (optional)
   * @returns {Promise<{ totalEntries: number, sources: Array<{ sourceId: string, entriesCount: number }> }>}
   */
  async reconcile(sourceId, since) {
    const results = {
      totalEntries: 0,
      sources: []
    };

    // Determine which sources to reconcile
    const sourcesToReconcile = sourceId
      ? this.#getSourceById(sourceId)
      : Array.from(this.#sources.values());

    // Handle unknown source
    if (sourceId && sourcesToReconcile.length === 0) {
      this.#logger.warn?.('reconcile.source.unknown', { sourceId });
      return results;
    }

    // Reconcile each source
    for (const source of sourcesToReconcile) {
      const currentSourceId = source.getSourceId();

      try {
        const entries = await source.fetchCosts(since);

        if (entries.length > 0) {
          await this.#costRepository.saveBatch(entries);
        }

        this.#logger.info?.('reconcile.complete', {
          sourceId: currentSourceId,
          entriesCount: entries.length
        });

        results.sources.push({
          sourceId: currentSourceId,
          entriesCount: entries.length
        });
        results.totalEntries += entries.length;
      } catch (error) {
        this.#logger.error?.('reconcile.source.error', {
          sourceId: currentSourceId,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get source by ID as array (for consistent iteration)
   * @private
   * @param {string} sourceId - Source identifier
   * @returns {ICostSource[]} Array with source or empty
   */
  #getSourceById(sourceId) {
    const source = this.#sources.get(sourceId);
    return source ? [source] : [];
  }
}

export default CostIngestionService;
