// backend/src/3_applications/homebot/HomeBotContainer.mjs

import { ProcessGratitudeInput } from './usecases/ProcessGratitudeInput.mjs';
import { AssignItemToUser } from './usecases/AssignItemToUser.mjs';
import { ToggleCategory } from './usecases/ToggleCategory.mjs';
import { CancelGratitudeInput } from './usecases/CancelGratitudeInput.mjs';

/**
 * Dependency injection container for HomeBot
 * Uses shared adapters from 2_adapters/
 */
export class HomeBotContainer {
  #messagingGateway;
  #aiGateway;
  #gratitudeService;
  #conversationStateStore;
  #householdRepository;
  #websocketBroadcast;
  #logger;

  // Cached use cases
  #processGratitudeInput;
  #assignItemToUser;
  #toggleCategory;
  #cancelGratitudeInput;

  /**
   * @param {Object} config
   * @param {Object} config.messagingGateway - TelegramAdapter instance
   * @param {Object} config.aiGateway - OpenAIAdapter instance
   * @param {Object} config.gratitudeService - GratitudeService instance
   * @param {Object} config.conversationStateStore - IConversationStateStore implementation
   * @param {Object} config.householdRepository - IHouseholdRepository implementation
   * @param {Function} [config.websocketBroadcast] - WebSocket broadcast function
   * @param {Object} [config.logger]
   */
  constructor(config) {
    this.#messagingGateway = config.messagingGateway;
    this.#aiGateway = config.aiGateway;
    this.#gratitudeService = config.gratitudeService;
    this.#conversationStateStore = config.conversationStateStore;
    this.#householdRepository = config.householdRepository;
    this.#websocketBroadcast = config.websocketBroadcast;
    this.#logger = config.logger || console;
  }

  async getProcessGratitudeInput() {
    if (!this.#processGratitudeInput) {
      this.#processGratitudeInput = new ProcessGratitudeInput({
        messagingGateway: this.#messagingGateway,
        aiGateway: this.#aiGateway,
        conversationStateStore: this.#conversationStateStore,
        householdService: this.#householdRepository,
        logger: this.#logger
      });
    }
    return this.#processGratitudeInput;
  }

  async getAssignItemToUser() {
    if (!this.#assignItemToUser) {
      this.#assignItemToUser = new AssignItemToUser({
        messagingGateway: this.#messagingGateway,
        gratitudeService: this.#gratitudeService,
        conversationStateStore: this.#conversationStateStore,
        householdService: this.#householdRepository,
        websocketBroadcast: this.#websocketBroadcast,
        logger: this.#logger
      });
    }
    return this.#assignItemToUser;
  }

  async getToggleCategory() {
    if (!this.#toggleCategory) {
      this.#toggleCategory = new ToggleCategory({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        householdService: this.#householdRepository,
        logger: this.#logger
      });
    }
    return this.#toggleCategory;
  }

  async getCancelGratitudeInput() {
    if (!this.#cancelGratitudeInput) {
      this.#cancelGratitudeInput = new CancelGratitudeInput({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger
      });
    }
    return this.#cancelGratitudeInput;
  }

  // Expose adapters for router/handler access
  getMessagingGateway() {
    return this.#messagingGateway;
  }
}

export default HomeBotContainer;
