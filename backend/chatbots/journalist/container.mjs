/**
 * Journalist Dependency Injection Container
 * @module journalist/container
 * 
 * Wires up all journalist dependencies.
 */

import { createLogger } from '../_lib/logging/index.mjs';

// Use Cases
import { ProcessTextEntry } from './application/usecases/ProcessTextEntry.mjs';
import { ProcessVoiceEntry } from './application/usecases/ProcessVoiceEntry.mjs';
import { InitiateJournalPrompt } from './application/usecases/InitiateJournalPrompt.mjs';
import { GenerateMultipleChoices } from './application/usecases/GenerateMultipleChoices.mjs';
import { HandleCallbackResponse } from './application/usecases/HandleCallbackResponse.mjs';

/**
 * Journalist Container
 */
export class JournalistContainer {
  #config;
  #options;
  #logger;
  
  // Infrastructure
  #messagingGateway;
  #aiGateway;
  #journalEntryRepository;
  #messageQueueRepository;
  #conversationStateStore;
  
  // Use Cases (lazy-loaded)
  #processTextEntry;
  #processVoiceEntry;
  #initiateJournalPrompt;
  #generateMultipleChoices;
  #handleCallbackResponse;

  /**
   * @param {Object} config - Journalist configuration
   * @param {Object} [options] - Additional options
   * @param {Object} [options.messagingGateway] - Messaging gateway instance
   * @param {Object} [options.aiGateway] - AI gateway instance
   * @param {Object} [options.journalEntryRepository] - Journal entry repository
   * @param {Object} [options.messageQueueRepository] - Message queue repository
   * @param {Object} [options.conversationStateStore] - Conversation state store
   */
  constructor(config, options = {}) {
    this.#config = config;
    this.#options = options;
    this.#logger = createLogger({ source: 'container', app: 'journalist' });

    // Accept injected dependencies
    this.#messagingGateway = options.messagingGateway;
    this.#aiGateway = options.aiGateway;
    this.#journalEntryRepository = options.journalEntryRepository;
    this.#messageQueueRepository = options.messageQueueRepository;
    this.#conversationStateStore = options.conversationStateStore;
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

  getJournalEntryRepository() {
    return this.#journalEntryRepository;
  }

  getMessageQueueRepository() {
    return this.#messageQueueRepository;
  }

  getConversationStateStore() {
    return this.#conversationStateStore;
  }

  // ==================== Use Case Getters ====================

  getProcessTextEntry() {
    if (!this.#processTextEntry) {
      this.#processTextEntry = new ProcessTextEntry({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        journalEntryRepository: this.#journalEntryRepository,
        messageQueueRepository: this.#messageQueueRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#processTextEntry;
  }

  getProcessVoiceEntry() {
    if (!this.#processVoiceEntry) {
      this.#processVoiceEntry = new ProcessVoiceEntry({
        messagingGateway: this.getMessagingGateway(),
        processTextEntry: this.getProcessTextEntry(),
        logger: this.#logger,
      });
    }
    return this.#processVoiceEntry;
  }

  getInitiateJournalPrompt() {
    if (!this.#initiateJournalPrompt) {
      this.#initiateJournalPrompt = new InitiateJournalPrompt({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        journalEntryRepository: this.#journalEntryRepository,
        messageQueueRepository: this.#messageQueueRepository,
        logger: this.#logger,
      });
    }
    return this.#initiateJournalPrompt;
  }

  getGenerateMultipleChoices() {
    if (!this.#generateMultipleChoices) {
      this.#generateMultipleChoices = new GenerateMultipleChoices({
        aiGateway: this.getAIGateway(),
        logger: this.#logger,
      });
    }
    return this.#generateMultipleChoices;
  }

  getHandleCallbackResponse() {
    if (!this.#handleCallbackResponse) {
      this.#handleCallbackResponse = new HandleCallbackResponse({
        messagingGateway: this.getMessagingGateway(),
        journalEntryRepository: this.#journalEntryRepository,
        handleQuizAnswer: null, // TODO: Add when implemented
        processTextEntry: this.getProcessTextEntry(),
        initiateJournalPrompt: this.getInitiateJournalPrompt(),
        logger: this.#logger,
      });
    }
    return this.#handleCallbackResponse;
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize the container
   */
  async initialize() {
    this.#logger.info('container.initialize', { app: 'journalist' });
    // Future: Initialize connections, load caches, etc.
  }

  /**
   * Shutdown the container
   */
  async shutdown() {
    this.#logger.info('container.shutdown', { app: 'journalist' });
    // Future: Close connections, flush caches, etc.
  }
}

export default JournalistContainer;
