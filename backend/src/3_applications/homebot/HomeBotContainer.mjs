/**
 * HomeBotContainer - Dependency injection container for HomeBot
 * @module homebot/HomeBotContainer
 *
 * Manages gratitude collection flows via Telegram.
 * Uses dynamic imports for lazy loading of use cases.
 */

export class HomeBotContainer {
  #config;
  #messagingGateway;
  #aiGateway;
  #conversationStateStore;
  #gratitudeService;
  #householdService;
  #logger;

  // Lazy-loaded use cases (cached after first load)
  #processGratitudeInput;
  #assignItemToUser;
  #toggleCategory;
  #cancelGratitudeInput;

  /**
   * @param {Object} config - HomeBot configuration
   * @param {Object} [options] - Additional options
   * @param {Object} [options.messagingGateway] - Messaging gateway instance
   * @param {Object} [options.aiGateway] - AI gateway instance
   * @param {Object} [options.conversationStateStore] - Conversation state store
   * @param {Object} [options.gratitudeService] - Gratitude service instance
   * @param {Object} [options.householdService] - Household service instance
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#config = config;
    this.#messagingGateway = options.messagingGateway;
    this.#aiGateway = options.aiGateway;
    this.#conversationStateStore = options.conversationStateStore;
    this.#gratitudeService = options.gratitudeService;
    this.#householdService = options.householdService;
    this.#logger = options.logger || console;
  }

  // ==================== Infrastructure Getters ====================

  getMessagingGateway() {
    if (!this.#messagingGateway) {
      throw new Error('messagingGateway not configured');
    }
    return this.#messagingGateway;
  }

  getAIGateway() {
    if (!this.#aiGateway) {
      throw new Error('aiGateway not configured');
    }
    return this.#aiGateway;
  }

  getConversationStateStore() {
    return this.#conversationStateStore;
  }

  getGratitudeService() {
    return this.#gratitudeService;
  }

  getHouseholdService() {
    return this.#householdService;
  }

  // ==================== Use Case Getters (Async with Dynamic Import) ====================

  /**
   * Get ProcessGratitudeInput use case
   * @returns {Promise<ProcessGratitudeInput>}
   */
  async getProcessGratitudeInput() {
    if (!this.#processGratitudeInput) {
      const { ProcessGratitudeInput } = await import('./usecases/ProcessGratitudeInput.mjs');
      this.#processGratitudeInput = new ProcessGratitudeInput({
        messagingGateway: this.#messagingGateway,
        aiGateway: this.#aiGateway,
        conversationStateStore: this.#conversationStateStore,
        householdService: this.#householdService,
        logger: this.#logger,
      });
    }
    return this.#processGratitudeInput;
  }

  /**
   * Get AssignItemToUser use case
   * @returns {Promise<AssignItemToUser>}
   */
  async getAssignItemToUser() {
    if (!this.#assignItemToUser) {
      const { AssignItemToUser } = await import('./usecases/AssignItemToUser.mjs');
      this.#assignItemToUser = new AssignItemToUser({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        gratitudeService: this.#gratitudeService,
        householdService: this.#householdService,
        logger: this.#logger,
      });
    }
    return this.#assignItemToUser;
  }

  /**
   * Get ToggleCategory use case
   * @returns {Promise<ToggleCategory>}
   */
  async getToggleCategory() {
    if (!this.#toggleCategory) {
      const { ToggleCategory } = await import('./usecases/ToggleCategory.mjs');
      this.#toggleCategory = new ToggleCategory({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#toggleCategory;
  }

  /**
   * Get CancelGratitudeInput use case
   * @returns {Promise<CancelGratitudeInput>}
   */
  async getCancelGratitudeInput() {
    if (!this.#cancelGratitudeInput) {
      const { CancelGratitudeInput } = await import('./usecases/CancelGratitudeInput.mjs');
      this.#cancelGratitudeInput = new CancelGratitudeInput({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#cancelGratitudeInput;
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize the container
   */
  async initialize() {
    this.#logger.info?.('container.initialize', { app: 'homebot' });
    // Future: Initialize connections, load caches, etc.
  }

  /**
   * Shutdown the container
   */
  async shutdown() {
    this.#logger.info?.('container.shutdown', { app: 'homebot' });
    // Future: Close connections, flush caches, etc.
  }
}

export default HomeBotContainer;
