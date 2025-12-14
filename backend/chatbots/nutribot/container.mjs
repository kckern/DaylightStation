/**
 * NutriBot Dependency Injection Container
 * @module nutribot/container
 * 
 * Wires up all nutribot dependencies.
 */

import { createLogger } from '../_lib/logging/index.mjs';

// Core Use Cases
import { LogFoodFromImage } from './application/usecases/LogFoodFromImage.mjs';
import { LogFoodFromText } from './application/usecases/LogFoodFromText.mjs';
import { LogFoodFromVoice } from './application/usecases/LogFoodFromVoice.mjs';
import { LogFoodFromUPC } from './application/usecases/LogFoodFromUPC.mjs';
import { AcceptFoodLog } from './application/usecases/AcceptFoodLog.mjs';
import { DiscardFoodLog } from './application/usecases/DiscardFoodLog.mjs';
import { ReviseFoodLog } from './application/usecases/ReviseFoodLog.mjs';
import { ProcessRevisionInput } from './application/usecases/ProcessRevisionInput.mjs';
import { SelectUPCPortion } from './application/usecases/SelectUPCPortion.mjs';

// Reporting Use Cases
import { GenerateDailyReport } from './application/usecases/GenerateDailyReport.mjs';
import { GetReportAsJSON } from './application/usecases/GetReportAsJSON.mjs';

// Coaching Use Cases
import { GenerateThresholdCoaching } from './application/usecases/GenerateThresholdCoaching.mjs';
import { GenerateOnDemandCoaching } from './application/usecases/GenerateOnDemandCoaching.mjs';

// Adjustment Use Cases
import { StartAdjustmentFlow } from './application/usecases/StartAdjustmentFlow.mjs';
import { SelectDateForAdjustment } from './application/usecases/SelectDateForAdjustment.mjs';
import { SelectItemForAdjustment } from './application/usecases/SelectItemForAdjustment.mjs';
import { ApplyPortionAdjustment } from './application/usecases/ApplyPortionAdjustment.mjs';
import { DeleteListItem } from './application/usecases/DeleteListItem.mjs';
import { MoveItemToDate } from './application/usecases/MoveItemToDate.mjs';

// Command Use Cases
import { HandleHelpCommand } from './application/usecases/HandleHelpCommand.mjs';
import { HandleReviewCommand } from './application/usecases/HandleReviewCommand.mjs';
import { ConfirmAllPending } from './application/usecases/ConfirmAllPending.mjs';

/**
 * NutriBot Container
 */
export class NutribotContainer {
  #config;
  #options;
  #logger;
  
  // Infrastructure
  #messagingGateway;
  #aiGateway;
  #upcGateway;
  #nutrilogRepository;
  #nutrilistRepository;
  #conversationStateStore;
  #reportRenderer;

  // Use Cases (lazy-loaded)
  #logFoodFromImage;
  #logFoodFromText;
  #logFoodFromVoice;
  #logFoodFromUPC;
  #acceptFoodLog;
  #discardFoodLog;
  #reviseFoodLog;
  #processRevisionInput;
  #selectUPCPortion;
  #generateDailyReport;
  #getReportAsJSON;
  #generateThresholdCoaching;
  #generateOnDemandCoaching;
  #startAdjustmentFlow;
  #selectDateForAdjustment;
  #selectItemForAdjustment;
  #applyPortionAdjustment;
  #deleteListItem;
  #moveItemToDate;
  #handleHelpCommand;
  #handleReviewCommand;
  #confirmAllPending;

  /**
   * @param {Object} config - NutriBot configuration
   * @param {Object} [options] - Additional options
   * @param {Object} [options.messagingGateway] - Messaging gateway instance
   * @param {Object} [options.aiGateway] - AI gateway instance
   * @param {Object} [options.upcGateway] - UPC lookup gateway
   * @param {Object} [options.nutrilogRepository] - NutriLog repository
   * @param {Object} [options.nutrilistRepository] - NutriList repository
   * @param {Object} [options.conversationStateStore] - Conversation state store
   * @param {Object} [options.reportRenderer] - Report renderer
   */
  constructor(config, options = {}) {
    this.#config = config;
    this.#options = options;
    this.#logger = createLogger({ source: 'container', app: 'nutribot' });

    // Accept injected dependencies
    this.#messagingGateway = options.messagingGateway;
    this.#aiGateway = options.aiGateway;
    this.#upcGateway = options.upcGateway;
    this.#nutrilogRepository = options.nutrilogRepository;
    this.#nutrilistRepository = options.nutrilistRepository;
    this.#conversationStateStore = options.conversationStateStore;
    this.#reportRenderer = options.reportRenderer;
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

  getUPCGateway() {
    return this.#upcGateway;
  }

  getNutrilogRepository() {
    return this.#nutrilogRepository;
  }

  getNutrilistRepository() {
    return this.#nutrilistRepository;
  }

  getConversationStateStore() {
    return this.#conversationStateStore;
  }

  getReportRenderer() {
    return this.#reportRenderer;
  }

  // ==================== Core Logging Use Cases ====================

  getLogFoodFromImage() {
    if (!this.#logFoodFromImage) {
      this.#logFoodFromImage = new LogFoodFromImage({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        nutrilogRepository: this.#nutrilogRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#logFoodFromImage;
  }

  getLogFoodFromText() {
    if (!this.#logFoodFromText) {
      this.#logFoodFromText = new LogFoodFromText({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        nutrilogRepository: this.#nutrilogRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#logFoodFromText;
  }

  getLogFoodFromVoice() {
    if (!this.#logFoodFromVoice) {
      this.#logFoodFromVoice = new LogFoodFromVoice({
        messagingGateway: this.getMessagingGateway(),
        logFoodFromText: this.getLogFoodFromText(),
        logger: this.#logger,
      });
    }
    return this.#logFoodFromVoice;
  }

  getLogFoodFromUPC() {
    if (!this.#logFoodFromUPC) {
      this.#logFoodFromUPC = new LogFoodFromUPC({
        messagingGateway: this.getMessagingGateway(),
        upcGateway: this.#upcGateway,
        aiGateway: this.#aiGateway,
        nutrilogRepository: this.#nutrilogRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#logFoodFromUPC;
  }

  // ==================== Food Log Action Use Cases ====================

  getAcceptFoodLog() {
    if (!this.#acceptFoodLog) {
      // Only pass generateDailyReport if we have the required config
      const generateDailyReport = this.#config && this.#nutrilogRepository && this.#nutrilistRepository
        ? this.getGenerateDailyReport()
        : null;
      
      this.#acceptFoodLog = new AcceptFoodLog({
        messagingGateway: this.getMessagingGateway(),
        nutrilogRepository: this.#nutrilogRepository,
        nutrilistRepository: this.#nutrilistRepository,
        conversationStateStore: this.#conversationStateStore,
        generateDailyReport,
        logger: this.#logger,
      });
    }
    return this.#acceptFoodLog;
  }

  getDiscardFoodLog() {
    if (!this.#discardFoodLog) {
      this.#discardFoodLog = new DiscardFoodLog({
        messagingGateway: this.getMessagingGateway(),
        nutrilogRepository: this.#nutrilogRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#discardFoodLog;
  }

  getReviseFoodLog() {
    if (!this.#reviseFoodLog) {
      this.#reviseFoodLog = new ReviseFoodLog({
        messagingGateway: this.getMessagingGateway(),
        nutrilogRepository: this.#nutrilogRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#reviseFoodLog;
  }

  getProcessRevisionInput() {
    if (!this.#processRevisionInput) {
      this.#processRevisionInput = new ProcessRevisionInput({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        nutrilogRepository: this.#nutrilogRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#processRevisionInput;
  }

  getSelectUPCPortion() {
    if (!this.#selectUPCPortion) {
      // Only pass generateDailyReport if we have the required config
      const generateDailyReport = this.#config && this.#nutrilogRepository && this.#nutrilistRepository
        ? this.getGenerateDailyReport()
        : null;

      this.#selectUPCPortion = new SelectUPCPortion({
        messagingGateway: this.getMessagingGateway(),
        nutrilogRepository: this.#nutrilogRepository,
        nutrilistRepository: this.#nutrilistRepository,
        conversationStateStore: this.#conversationStateStore,
        generateDailyReport,
        logger: this.#logger,
      });
    }
    return this.#selectUPCPortion;
  }

  // ==================== Reporting Use Cases ====================

  getGenerateDailyReport() {
    if (!this.#generateDailyReport) {
      this.#generateDailyReport = new GenerateDailyReport({
        messagingGateway: this.getMessagingGateway(),
        nutriLogRepository: this.#nutrilogRepository,
        nutriListRepository: this.#nutrilistRepository,
        reportRenderer: this.#reportRenderer,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#generateDailyReport;
  }

  getGetReportAsJSON() {
    if (!this.#getReportAsJSON) {
      this.#getReportAsJSON = new GetReportAsJSON({
        nutrilistRepository: this.#nutrilistRepository,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#getReportAsJSON;
  }

  // ==================== Coaching Use Cases ====================

  getGenerateThresholdCoaching() {
    if (!this.#generateThresholdCoaching) {
      this.#generateThresholdCoaching = new GenerateThresholdCoaching({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        nutrilistRepository: this.#nutrilistRepository,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#generateThresholdCoaching;
  }

  getGenerateOnDemandCoaching() {
    if (!this.#generateOnDemandCoaching) {
      this.#generateOnDemandCoaching = new GenerateOnDemandCoaching({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        nutrilistRepository: this.#nutrilistRepository,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#generateOnDemandCoaching;
  }

  // ==================== Adjustment Use Cases ====================

  getStartAdjustmentFlow() {
    if (!this.#startAdjustmentFlow) {
      this.#startAdjustmentFlow = new StartAdjustmentFlow({
        messagingGateway: this.getMessagingGateway(),
        nutrilistRepository: this.#nutrilistRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#startAdjustmentFlow;
  }

  getSelectDateForAdjustment() {
    if (!this.#selectDateForAdjustment) {
      this.#selectDateForAdjustment = new SelectDateForAdjustment({
        messagingGateway: this.getMessagingGateway(),
        nutrilistRepository: this.#nutrilistRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#selectDateForAdjustment;
  }

  getSelectItemForAdjustment() {
    if (!this.#selectItemForAdjustment) {
      this.#selectItemForAdjustment = new SelectItemForAdjustment({
        messagingGateway: this.getMessagingGateway(),
        nutrilistRepository: this.#nutrilistRepository,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#selectItemForAdjustment;
  }

  getApplyPortionAdjustment() {
    if (!this.#applyPortionAdjustment) {
      this.#applyPortionAdjustment = new ApplyPortionAdjustment({
        messagingGateway: this.getMessagingGateway(),
        nutrilistRepository: this.#nutrilistRepository,
        conversationStateStore: this.#conversationStateStore,
        generateDailyReport: this.getGenerateDailyReport(),
        logger: this.#logger,
      });
    }
    return this.#applyPortionAdjustment;
  }

  getDeleteListItem() {
    if (!this.#deleteListItem) {
      this.#deleteListItem = new DeleteListItem({
        messagingGateway: this.getMessagingGateway(),
        nutrilistRepository: this.#nutrilistRepository,
        conversationStateStore: this.#conversationStateStore,
        generateDailyReport: this.getGenerateDailyReport(),
        logger: this.#logger,
      });
    }
    return this.#deleteListItem;
  }

  getMoveItemToDate() {
    if (!this.#moveItemToDate) {
      this.#moveItemToDate = new MoveItemToDate({
        messagingGateway: this.getMessagingGateway(),
        nutrilistRepository: this.#nutrilistRepository,
        conversationStateStore: this.#conversationStateStore,
        generateDailyReport: this.getGenerateDailyReport(),
        logger: this.#logger,
      });
    }
    return this.#moveItemToDate;
  }

  // ==================== Command Use Cases ====================

  getHandleHelpCommand() {
    if (!this.#handleHelpCommand) {
      this.#handleHelpCommand = new HandleHelpCommand({
        messagingGateway: this.getMessagingGateway(),
        logger: this.#logger,
      });
    }
    return this.#handleHelpCommand;
  }

  getHandleReviewCommand() {
    if (!this.#handleReviewCommand) {
      this.#handleReviewCommand = new HandleReviewCommand({
        messagingGateway: this.getMessagingGateway(),
        startAdjustmentFlow: this.getStartAdjustmentFlow(),
        logger: this.#logger,
      });
    }
    return this.#handleReviewCommand;
  }

  getConfirmAllPending() {
    if (!this.#confirmAllPending) {
      this.#confirmAllPending = new ConfirmAllPending({
        messagingGateway: this.getMessagingGateway(),
        nutrilogRepository: this.#nutrilogRepository,
        acceptFoodLog: this.getAcceptFoodLog(),
        logger: this.#logger,
      });
    }
    return this.#confirmAllPending;
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize the container
   */
  async initialize() {
    this.#logger.info('container.initialize', { app: 'nutribot' });
    // Future: Initialize connections, load caches, etc.
  }

  /**
   * Shutdown the container
   */
  async shutdown() {
    this.#logger.info('container.shutdown', { app: 'nutribot' });
    // Future: Close connections, flush caches, etc.
  }
}

export default NutribotContainer;
