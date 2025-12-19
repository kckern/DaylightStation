/**
 * Journalist Dependency Injection Container
 * @module journalist/container
 * 
 * Wires up all journalist dependencies.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

// Core Use Cases
import { ProcessTextEntry } from './application/usecases/ProcessTextEntry.mjs';
import { ProcessVoiceEntry } from './application/usecases/ProcessVoiceEntry.mjs';
import { InitiateJournalPrompt } from './application/usecases/InitiateJournalPrompt.mjs';
import { GenerateMultipleChoices } from './application/usecases/GenerateMultipleChoices.mjs';
import { HandleCallbackResponse } from './application/usecases/HandleCallbackResponse.mjs';

// Quiz Use Cases (Phase 5)
import { SendQuizQuestion } from './application/usecases/SendQuizQuestion.mjs';
import { RecordQuizAnswer } from './application/usecases/RecordQuizAnswer.mjs';
import { AdvanceToNextQuizQuestion } from './application/usecases/AdvanceToNextQuizQuestion.mjs';
import { HandleQuizAnswer } from './application/usecases/HandleQuizAnswer.mjs';

// Analysis Use Cases (Phase 5)
import { GenerateTherapistAnalysis } from './application/usecases/GenerateTherapistAnalysis.mjs';
import { ReviewJournalEntries } from './application/usecases/ReviewJournalEntries.mjs';
import { ExportJournalMarkdown } from './application/usecases/ExportJournalMarkdown.mjs';

// Command Use Cases (Phase 5)
import { HandleSlashCommand } from './application/usecases/HandleSlashCommand.mjs';
import { HandleSpecialStart } from './application/usecases/HandleSpecialStart.mjs';

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
  
  // Quiz Use Cases (Phase 5)
  #sendQuizQuestion;
  #recordQuizAnswer;
  #advanceToNextQuizQuestion;
  #handleQuizAnswer;
  
  // Analysis Use Cases (Phase 5)
  #generateTherapistAnalysis;
  #reviewJournalEntries;
  #exportJournalMarkdown;
  
  // Command Use Cases (Phase 5)
  #handleSlashCommand;
  #handleSpecialStart;
  
  // Repositories
  #quizRepository;

  /**
   * @param {Object} config - Journalist configuration
   * @param {Object} [options] - Additional options
   * @param {Object} [options.messagingGateway] - Messaging gateway instance
   * @param {Object} [options.aiGateway] - AI gateway instance
   * @param {Object} [options.journalEntryRepository] - Journal entry repository
   * @param {Object} [options.messageQueueRepository] - Message queue repository
   * @param {Object} [options.conversationStateStore] - Conversation state store
   * @param {Object} [options.quizRepository] - Quiz repository
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
    this.#quizRepository = options.quizRepository;
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

  getQuizRepository() {
    return this.#quizRepository;
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
        handleQuizAnswer: this.getHandleQuizAnswer(),
        processTextEntry: this.getProcessTextEntry(),
        initiateJournalPrompt: this.getInitiateJournalPrompt(),
        logger: this.#logger,
      });
    }
    return this.#handleCallbackResponse;
  }

  // ==================== Quiz Use Cases (Phase 5) ====================

  getSendQuizQuestion() {
    if (!this.#sendQuizQuestion) {
      this.#sendQuizQuestion = new SendQuizQuestion({
        messagingGateway: this.getMessagingGateway(),
        quizRepository: this.#quizRepository,
        messageQueueRepository: this.#messageQueueRepository,
        logger: this.#logger,
      });
    }
    return this.#sendQuizQuestion;
  }

  getRecordQuizAnswer() {
    if (!this.#recordQuizAnswer) {
      this.#recordQuizAnswer = new RecordQuizAnswer({
        quizRepository: this.#quizRepository,
        messageQueueRepository: this.#messageQueueRepository,
        logger: this.#logger,
      });
    }
    return this.#recordQuizAnswer;
  }

  getAdvanceToNextQuizQuestion() {
    if (!this.#advanceToNextQuizQuestion) {
      this.#advanceToNextQuizQuestion = new AdvanceToNextQuizQuestion({
        messagingGateway: this.getMessagingGateway(),
        messageQueueRepository: this.#messageQueueRepository,
        journalEntryRepository: this.#journalEntryRepository,
        initiateJournalPrompt: this.getInitiateJournalPrompt(),
        logger: this.#logger,
      });
    }
    return this.#advanceToNextQuizQuestion;
  }

  getHandleQuizAnswer() {
    if (!this.#handleQuizAnswer) {
      this.#handleQuizAnswer = new HandleQuizAnswer({
        recordQuizAnswer: this.getRecordQuizAnswer(),
        advanceToNextQuizQuestion: this.getAdvanceToNextQuizQuestion(),
        messageQueueRepository: this.#messageQueueRepository,
        logger: this.#logger,
      });
    }
    return this.#handleQuizAnswer;
  }

  // ==================== Analysis Use Cases (Phase 5) ====================

  getGenerateTherapistAnalysis() {
    if (!this.#generateTherapistAnalysis) {
      this.#generateTherapistAnalysis = new GenerateTherapistAnalysis({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        journalEntryRepository: this.#journalEntryRepository,
        messageQueueRepository: this.#messageQueueRepository,
        logger: this.#logger,
      });
    }
    return this.#generateTherapistAnalysis;
  }

  getReviewJournalEntries() {
    if (!this.#reviewJournalEntries) {
      this.#reviewJournalEntries = new ReviewJournalEntries({
        messagingGateway: this.getMessagingGateway(),
        journalEntryRepository: this.#journalEntryRepository,
        logger: this.#logger,
      });
    }
    return this.#reviewJournalEntries;
  }

  getExportJournalMarkdown() {
    if (!this.#exportJournalMarkdown) {
      this.#exportJournalMarkdown = new ExportJournalMarkdown({
        journalEntryRepository: this.#journalEntryRepository,
        logger: this.#logger,
      });
    }
    return this.#exportJournalMarkdown;
  }

  // ==================== Command Use Cases (Phase 5) ====================

  getHandleSlashCommand() {
    if (!this.#handleSlashCommand) {
      this.#handleSlashCommand = new HandleSlashCommand({
        initiateJournalPrompt: this.getInitiateJournalPrompt(),
        generateTherapistAnalysis: this.getGenerateTherapistAnalysis(),
        reviewJournalEntries: this.getReviewJournalEntries(),
        sendQuizQuestion: this.getSendQuizQuestion(),
        logger: this.#logger,
      });
    }
    return this.#handleSlashCommand;
  }

  getHandleSpecialStart() {
    if (!this.#handleSpecialStart) {
      this.#handleSpecialStart = new HandleSpecialStart({
        messagingGateway: this.getMessagingGateway(),
        messageQueueRepository: this.#messageQueueRepository,
        journalEntryRepository: this.#journalEntryRepository,
        initiateJournalPrompt: this.getInitiateJournalPrompt(),
        logger: this.#logger,
      });
    }
    return this.#handleSpecialStart;
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
