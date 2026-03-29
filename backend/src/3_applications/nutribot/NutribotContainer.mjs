/**
 * NutriBot Dependency Injection Container
 * @module nutribot/container
 *
 * Wires up all nutribot dependencies using DDD conventions.
 */

// Use Cases
import {
  LogFoodFromImage,
  LogFoodFromText,
  LogFoodFromVoice,
  LogFoodFromUPC,
  AcceptFoodLog,
  DiscardFoodLog,
  ReviseFoodLog,
  ProcessRevisionInput,
  SelectUPCPortion,
  GenerateDailyReport,
  GetReportAsJSON,
  StartAdjustmentFlow,
  SelectDateForAdjustment,
  SelectItemForAdjustment,
  ApplyPortionAdjustment,
  DeleteListItem,
  MoveItemToDate,
  HandleHelpCommand,
  HandleReviewCommand,
  ConfirmAllPending,
  ShowDateSelection,
} from './usecases/index.mjs';

/**
 * NutriBot Container
 *
 * Manages dependency injection for all Nutribot use cases.
 * Uses lazy-loading for efficient resource usage.
 */
export class NutribotContainer {
  #config;
  #options;
  #logger;

  // Infrastructure
  #messagingGateway;
  #aiGateway;
  #upcGateway;
  #googleImageGateway;
  #foodLogStore;
  #nutriListStore;
  // NOTE: nutriCoachStore removed — coaching is now handled by HealthCoachAgent
  // via healthStore.loadCoachingData/saveCoachingData (YamlHealthDatastore)
  #conversationStateStore;
  #reportRenderer;
  #barcodeGenerator;
  #foodIconsString;
  #reconciliationReader;
  #healthStore;

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
  #agentOrchestrator;
  #startAdjustmentFlow;
  #showDateSelection;
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
   * @param {Object} [options.googleImageGateway] - Google Image Search gateway
   * @param {Object} [options.foodLogStore] - Food log store (IFoodLogStore)
   * @param {Object} [options.nutriListStore] - Nutrient list store (INutriListStore)
   * @param {Object} [options.nutriCoachStore] - DEPRECATED: coaching now handled by HealthCoachAgent
   * @param {Object} [options.conversationStateStore] - Conversation state store
   * @param {Object} [options.reportRenderer] - Report renderer
   * @param {Object} [options.logger] - Custom logger instance
   */
  constructor(config, options = {}) {
    this.#config = config;
    this.#options = options;
    this.#logger = options.logger || console;

    // Accept injected dependencies
    this.#messagingGateway = options.messagingGateway;
    this.#aiGateway = options.aiGateway;
    this.#upcGateway = options.upcGateway;
    this.#googleImageGateway = options.googleImageGateway;
    this.#foodLogStore = options.foodLogStore;
    this.#nutriListStore = options.nutriListStore;
    // nutriCoachStore no longer used — HealthCoachAgent owns coaching persistence
    this.#conversationStateStore = options.conversationStateStore;
    this.#reportRenderer = options.reportRenderer;
    this.#barcodeGenerator = options.barcodeGenerator;
    this.#foodIconsString = options.foodIconsString;
    this.#reconciliationReader = options.reconciliationReader || null;
    this.#agentOrchestrator = options.agentOrchestrator || null;
    this.#healthStore = options.healthStore || null;
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

  getGoogleImageGateway() {
    return this.#googleImageGateway;
  }

  getFoodLogStore() {
    if (!this.#foodLogStore) {
      throw new Error('foodLogStore not configured');
    }
    return this.#foodLogStore;
  }

  getNutriListStore() {
    if (!this.#nutriListStore) {
      throw new Error('nutriListStore not configured');
    }
    return this.#nutriListStore;
  }

  /** @deprecated Coaching is now handled by HealthCoachAgent via YamlHealthDatastore */
  getNutriCoachStore() {
    return null;
  }

  getConversationStateStore() {
    return this.#conversationStateStore; // Optional - state features degrade gracefully
  }

  getHealthStore() {
    return this.#healthStore; // Optional - used for /done command
  }

  getReportRenderer() {
    return this.#reportRenderer; // Optional - reports degrade to text-only
  }

  // ==================== Core Logging Use Cases ====================

  getLogFoodFromImage() {
    if (!this.#logFoodFromImage) {
      this.#logFoodFromImage = new LogFoodFromImage({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        foodIconsString: this.#foodIconsString,
        logger: this.#logger,
        reconciliationReader: this.#reconciliationReader,
      });
    }
    return this.#logFoodFromImage;
  }

  getLogFoodFromText() {
    if (!this.#logFoodFromText) {
      this.#logFoodFromText = new LogFoodFromText({
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.getAIGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        foodIconsString: this.#foodIconsString,
        logger: this.#logger,
        reconciliationReader: this.#reconciliationReader,
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
        googleImageGateway: this.#googleImageGateway,
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        foodIconsString: this.#foodIconsString,
        logger: this.#logger,
        barcodeGenerator: this.#barcodeGenerator,
      });
    }
    return this.#logFoodFromUPC;
  }

  // ==================== Food Log Action Use Cases ====================

  getAcceptFoodLog() {
    if (!this.#acceptFoodLog) {
      this.#acceptFoodLog = new AcceptFoodLog({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        generateDailyReport: this.getGenerateDailyReport(),
        agentOrchestrator: this.#agentOrchestrator,
        logger: this.#logger,
      });
    }
    return this.#acceptFoodLog;
  }

  getDiscardFoodLog() {
    if (!this.#discardFoodLog) {
      this.#discardFoodLog = new DiscardFoodLog({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
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
        foodLogStore: this.#foodLogStore,
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
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#processRevisionInput;
  }

  getSelectUPCPortion() {
    if (!this.#selectUPCPortion) {
      this.#selectUPCPortion = new SelectUPCPortion({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        generateDailyReport: this.getGenerateDailyReport(),
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
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
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
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#getReportAsJSON;
  }

  // ==================== Agent Orchestrator ====================

  getAgentOrchestrator() {
    return this.#agentOrchestrator;
  }

  // ==================== Adjustment Use Cases ====================

  getStartAdjustmentFlow() {
    if (!this.#startAdjustmentFlow) {
      this.#startAdjustmentFlow = new StartAdjustmentFlow({
        messagingGateway: this.getMessagingGateway(),
        selectDateForAdjustment: this.getSelectDateForAdjustment(),
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#startAdjustmentFlow;
  }

  getShowDateSelection() {
    if (!this.#showDateSelection) {
      this.#showDateSelection = new ShowDateSelection({
        messagingGateway: this.getMessagingGateway(),
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#showDateSelection;
  }

  getSelectDateForAdjustment() {
    if (!this.#selectDateForAdjustment) {
      this.#selectDateForAdjustment = new SelectDateForAdjustment({
        messagingGateway: this.getMessagingGateway(),
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#selectDateForAdjustment;
  }

  getSelectItemForAdjustment() {
    if (!this.#selectItemForAdjustment) {
      this.#selectItemForAdjustment = new SelectItemForAdjustment({
        messagingGateway: this.getMessagingGateway(),
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#selectItemForAdjustment;
  }

  getApplyPortionAdjustment() {
    if (!this.#applyPortionAdjustment) {
      this.#applyPortionAdjustment = new ApplyPortionAdjustment({
        messagingGateway: this.getMessagingGateway(),
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#applyPortionAdjustment;
  }

  getDeleteListItem() {
    if (!this.#deleteListItem) {
      this.#deleteListItem = new DeleteListItem({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#deleteListItem;
  }

  getMoveItemToDate() {
    if (!this.#moveItemToDate) {
      this.#moveItemToDate = new MoveItemToDate({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
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
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        generateDailyReport: this.getGenerateDailyReport(),
        agentOrchestrator: this.#agentOrchestrator,
        config: this.#config,
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
    this.#logger.info?.('container.initialize', { app: 'nutribot' });
  }

  /**
   * Shutdown the container
   */
  async shutdown() {
    this.#logger.info?.('container.shutdown', { app: 'nutribot' });
  }
}

export default NutribotContainer;
