/**
 * HomeBot Dependency Injection Container
 * @module homebot/container
 * 
 * Wires up all HomeBot dependencies.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

// Use Case imports
import { ProcessGratitudeInput } from './application/usecases/ProcessGratitudeInput.mjs';
import { AssignItemToUser } from './application/usecases/AssignItemToUser.mjs';
import { ToggleCategory } from './application/usecases/ToggleCategory.mjs';
import { CancelGratitudeInput } from './application/usecases/CancelGratitudeInput.mjs';

/**
 * HomeBot Container
 * Manages dependency injection for HomeBot use cases and infrastructure.
 */
export class HomeBotContainer {
  #config;
  #options;
  #logger;
  
  // Infrastructure (injected)
  #messagingGateway;
  #aiGateway;
  #conversationStateStore;
  
  // Repositories (lazy-loaded)
  #gratitudeRepository;
  #householdRepository;

  // Use Cases (lazy-loaded)
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
   * @param {Object} [options.gratitudeRepository] - Gratitude repository
   * @param {Object} [options.householdRepository] - Household repository
   * @param {Object} [options.logger] - Custom logger instance
   */
  constructor(config, options = {}) {
    this.#config = config || {};
    this.#options = options;
    this.#logger = options.logger || createLogger({ source: 'container', app: 'homebot' });

    // Accept injected dependencies
    this.#messagingGateway = options.messagingGateway;
    this.#aiGateway = options.aiGateway;
    this.#conversationStateStore = options.conversationStateStore;
    this.#gratitudeRepository = options.gratitudeRepository;
    this.#householdRepository = options.householdRepository;

    this.#logger.info('homebot.container.created', {
      hasMessagingGateway: !!this.#messagingGateway,
      hasAIGateway: !!this.#aiGateway,
      hasConversationStateStore: !!this.#conversationStateStore,
    });
  }

  // ==================== Config Getter ====================

  /**
   * Get the configuration object
   * @returns {Object}
   */
  getConfig() {
    return this.#config;
  }

  // ==================== Infrastructure Getters ====================

  /**
   * Get messaging gateway
   * @returns {Object}
   */
  getMessagingGateway() {
    if (!this.#messagingGateway) {
      throw new Error('messagingGateway not configured');
    }
    return this.#messagingGateway;
  }

  /**
   * Get AI gateway
   * @returns {Object}
   */
  getAIGateway() {
    if (!this.#aiGateway) {
      throw new Error('aiGateway not configured');
    }
    return this.#aiGateway;
  }

  /**
   * Get conversation state store
   * @returns {Object}
   */
  getConversationStateStore() {
    return this.#conversationStateStore;
  }

  /**
   * Get gratitude repository
   * @returns {Object}
   */
  getGratitudeRepository() {
    return this.#gratitudeRepository;
  }

  /**
   * Get household repository
   * @returns {Object}
   */
  getHouseholdRepository() {
    return this.#householdRepository;
  }

  // ==================== Use Case Getters (Lazy Loading) ====================

  /**
   * Get ProcessGratitudeInput use case
   * @returns {ProcessGratitudeInput}
   */
  get processGratitudeInput() {
    if (!this.#processGratitudeInput) {
      this.#processGratitudeInput = new ProcessGratitudeInput({
        messagingGateway: this.#messagingGateway,
        aiGateway: this.#aiGateway,
        householdRepository: this.#householdRepository,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#processGratitudeInput;
  }

  /**
   * Get AssignItemToUser use case
   * @returns {AssignItemToUser}
   */
  get assignItemToUser() {
    if (!this.#assignItemToUser) {
      this.#assignItemToUser = new AssignItemToUser({
        messagingGateway: this.#messagingGateway,
        gratitudeRepository: this.#gratitudeRepository,
        householdRepository: this.#householdRepository,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#assignItemToUser;
  }

  /**
   * Get ToggleCategory use case
   * @returns {ToggleCategory}
   */
  get toggleCategory() {
    if (!this.#toggleCategory) {
      this.#toggleCategory = new ToggleCategory({
        messagingGateway: this.#messagingGateway,
        householdRepository: this.#householdRepository,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#toggleCategory;
  }

  /**
   * Get CancelGratitudeInput use case
   * @returns {CancelGratitudeInput}
   */
  get cancelGratitudeInput() {
    if (!this.#cancelGratitudeInput) {
      this.#cancelGratitudeInput = new CancelGratitudeInput({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#cancelGratitudeInput;
  }
}

export default HomeBotContainer;