/**
 * Journalist Dependency Injection Container
 * @module journalist/JournalistContainer
 *
 * Wires up all journalist dependencies following DDD patterns.
 */

// Core Use Cases
import { ProcessTextEntry } from './usecases/ProcessTextEntry.mjs';
import { ProcessVoiceEntry } from './usecases/ProcessVoiceEntry.mjs';
import { InitiateJournalPrompt } from './usecases/InitiateJournalPrompt.mjs';
import { GenerateMultipleChoices } from './usecases/GenerateMultipleChoices.mjs';
import { HandleCallbackResponse } from './usecases/HandleCallbackResponse.mjs';

// Quiz Use Cases
import { SendQuizQuestion } from './usecases/SendQuizQuestion.mjs';
import { RecordQuizAnswer } from './usecases/RecordQuizAnswer.mjs';
import { AdvanceToNextQuizQuestion } from './usecases/AdvanceToNextQuizQuestion.mjs';
import { HandleQuizAnswer } from './usecases/HandleQuizAnswer.mjs';

// Analysis Use Cases
import { GenerateTherapistAnalysis } from './usecases/GenerateTherapistAnalysis.mjs';
import { ReviewJournalEntries } from './usecases/ReviewJournalEntries.mjs';
import { ExportJournalMarkdown } from './usecases/ExportJournalMarkdown.mjs';

// Command Use Cases
import { HandleSlashCommand } from './usecases/HandleSlashCommand.mjs';
import { HandleSpecialStart } from './usecases/HandleSpecialStart.mjs';

// Morning Debrief Use Cases
import { GenerateMorningDebrief } from './usecases/GenerateMorningDebrief.mjs';
import { SendMorningDebrief } from './usecases/SendMorningDebrief.mjs';
import { HandleCategorySelection } from './usecases/HandleCategorySelection.mjs';
import { HandleDebriefResponse } from './usecases/HandleDebriefResponse.mjs';
import { HandleSourceSelection } from './usecases/HandleSourceSelection.mjs';
import { InitiateDebriefInterview } from './usecases/InitiateDebriefInterview.mjs';

// Adapters
import { LifelogAggregator } from '../../1_domains/lifelog/services/LifelogAggregator.mjs';
import { LoggingAIGateway } from '../../2_adapters/journalist/LoggingAIGateway.mjs';
import { DebriefRepository } from '../../2_adapters/journalist/DebriefRepository.mjs';

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
  #wrappedAIGateway;
  #journalEntryRepository;
  #messageQueueRepository;
  #conversationStateStore;

  // Use Cases (lazy-loaded)
  #processTextEntry;
  #processVoiceEntry;
  #initiateJournalPrompt;
  #generateMultipleChoices;
  #handleCallbackResponse;

  // Quiz Use Cases
  #sendQuizQuestion;
  #recordQuizAnswer;
  #advanceToNextQuizQuestion;
  #handleQuizAnswer;

  // Analysis Use Cases
  #generateTherapistAnalysis;
  #reviewJournalEntries;
  #exportJournalMarkdown;

  // Command Use Cases
  #handleSlashCommand;
  #handleSpecialStart;

  // Morning Debrief Use Cases
  #generateMorningDebrief;
  #sendMorningDebrief;
  #handleCategorySelection;
  #handleDebriefResponse;
  #handleSourceSelection;
  #initiateDebriefInterview;

  // Adapters
  #lifelogAggregator;

  // Infrastructure Repositories
  #debriefRepository;

  // Multi-user support
  #userResolver;

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
   * @param {Object} [options.userResolver] - UserResolver for multi-user support
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#config = config;
    this.#options = options;
    this.#logger = options.logger || console;

    // Accept injected dependencies
    this.#messagingGateway = options.messagingGateway;
    this.#aiGateway = options.aiGateway;
    this.#journalEntryRepository = options.journalEntryRepository;
    this.#messageQueueRepository = options.messageQueueRepository;
    this.#conversationStateStore = options.conversationStateStore;
    this.#quizRepository = options.quizRepository;
    this.#userResolver = options.userResolver;
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

    // Wrap AI gateway with logging wrapper (lazy initialization)
    if (!this.#wrappedAIGateway) {
      this.#wrappedAIGateway = new LoggingAIGateway({
        aiGateway: this.#aiGateway,
        username: this.#config.username || 'kckern',
        logger: this.#logger,
      });
    }

    return this.#wrappedAIGateway;
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

  getUserResolver() {
    return this.#userResolver;
  }

  getDebriefRepository() {
    if (!this.#debriefRepository) {
      // Get data path from config or environment
      const dataPath = process.env.path?.data
        ? `${process.env.path.data}/users/${this.#config.username || 'kckern'}/lifelog/journalist`
        : '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStationdata/users/kckern/lifelog/journalist';

      this.#debriefRepository = new DebriefRepository({
        logger: this.#logger,
        dataPath,
      });
    }
    return this.#debriefRepository;
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

  // ==================== Quiz Use Cases ====================

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

  // ==================== Analysis Use Cases ====================

  getGenerateTherapistAnalysis() {
    if (!this.#generateTherapistAnalysis) {
      this.#generateTherapistAnalysis = new GenerateTherapistAnalysis({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        journalEntryRepository: this.#journalEntryRepository,
        messageQueueRepository: this.#messageQueueRepository,
        debriefRepository: this.getDebriefRepository(),
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

  // ==================== Command Use Cases ====================

  getHandleSlashCommand() {
    if (!this.#handleSlashCommand) {
      this.#handleSlashCommand = new HandleSlashCommand({
        initiateJournalPrompt: this.getInitiateJournalPrompt(),
        generateTherapistAnalysis: this.getGenerateTherapistAnalysis(),
        generateMorningDebrief: this.getGenerateMorningDebrief(),
        sendMorningDebrief: this.getSendMorningDebrief(),
        messagingGateway: this.getMessagingGateway(),
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
        conversationStateStore: this.#conversationStateStore,
        initiateJournalPrompt: this.getInitiateJournalPrompt(),
        initiateDebriefInterview: this.getInitiateDebriefInterview(),
        logger: this.#logger,
      });
    }
    return this.#handleSpecialStart;
  }

  // ==================== Morning Debrief Use Cases ====================

  getLifelogAggregator() {
    if (!this.#lifelogAggregator) {
      this.#lifelogAggregator = new LifelogAggregator({
        logger: this.#logger,
      });
    }
    return this.#lifelogAggregator;
  }

  getGenerateMorningDebrief() {
    if (!this.#generateMorningDebrief) {
      this.#generateMorningDebrief = new GenerateMorningDebrief({
        lifelogAggregator: this.getLifelogAggregator(),
        aiGateway: this.getAIGateway(),
        debriefRepository: this.getDebriefRepository(),
        logger: this.#logger,
      });
    }
    return this.#generateMorningDebrief;
  }

  getSendMorningDebrief() {
    if (!this.#sendMorningDebrief) {
      this.#sendMorningDebrief = new SendMorningDebrief({
        messagingGateway: this.getMessagingGateway(),
        conversationStateStore: this.#conversationStateStore,
        debriefRepository: this.getDebriefRepository(),
        logger: this.#logger,
      });
    }
    return this.#sendMorningDebrief;
  }

  getHandleCategorySelection() {
    if (!this.#handleCategorySelection) {
      this.#handleCategorySelection = new HandleCategorySelection({
        messagingGateway: this.getMessagingGateway(),
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#handleCategorySelection;
  }

  getHandleDebriefResponse() {
    if (!this.#handleDebriefResponse) {
      this.#handleDebriefResponse = new HandleDebriefResponse({
        messagingGateway: this.getMessagingGateway(),
        conversationStateStore: this.#conversationStateStore,
        debriefRepository: this.getDebriefRepository(),
        journalEntryRepository: this.#journalEntryRepository,
        userResolver: this.getUserResolver(),
        logger: this.#logger,
      });
    }
    return this.#handleDebriefResponse;
  }

  getHandleSourceSelection() {
    if (!this.#handleSourceSelection) {
      this.#handleSourceSelection = new HandleSourceSelection({
        messagingGateway: this.getMessagingGateway(),
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#handleSourceSelection;
  }

  getInitiateDebriefInterview() {
    if (!this.#initiateDebriefInterview) {
      this.#initiateDebriefInterview = new InitiateDebriefInterview({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        journalEntryRepository: this.#journalEntryRepository,
        messageQueueRepository: this.#messageQueueRepository,
        debriefRepository: this.getDebriefRepository(),
        conversationStateStore: this.#conversationStateStore,
        userResolver: this.getUserResolver(),
        logger: this.#logger,
      });
    }
    return this.#initiateDebriefInterview;
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize the container
   */
  async initialize() {
    this.#logger.info?.('container.initialize', { app: 'journalist' });
    // Future: Initialize connections, load caches, etc.
  }

  /**
   * Shutdown the container
   */
  async shutdown() {
    this.#logger.info?.('container.shutdown', { app: 'journalist' });
    // Future: Close connections, flush caches, etc.
  }
}

export default JournalistContainer;
