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
  RetryImageDetection,
  AcceptFoodLog,
  DiscardFoodLog,
  RestoreFoodLog,
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
import { LogFoodFromScale } from './usecases/LogFoodFromScale.mjs';
import { SelectScaleContainer } from './usecases/SelectScaleContainer.mjs';
import { SelectScaleDensity } from './usecases/SelectScaleDensity.mjs';
import { ShowScaleDensityHelp } from './usecases/ShowScaleDensityHelp.mjs';
import { RetractScaleLog } from './usecases/RetractScaleLog.mjs';
import { LogScaleFoodFromText } from './usecases/LogScaleFoodFromText.mjs';
import { FoodLogReview } from '#apps/nutrition/FoodLogReview.mjs';
import { NearestIconChooser } from '#apps/nutrition/NearestIconChooser.mjs';
import { scopedGateway } from '#apps/common/ports/IAIGateway.mjs';
import { createLocalNutritionResponse } from './services/LocalNutritionResponse.mjs';

/**
 * NutriBot Container
 *
 * Manages dependency injection for all Nutribot use cases.
 * Uses lazy-loading for efficient resource usage.
 */
export class NutribotContainer {
  #config;
  #options;
  #iconChooser;
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
  #reportDelivery;
  #barcodeGenerator;
  #foodIconsString;
  #reconciliationReader;
  #healthStore;
  #catalogService;
  #scaleConfig;
  #imageDownloader;
  #photoStore;
  #pause;
  #foodLogReview;
  #receiptPublisher = null;

  // Use Cases (lazy-loaded)
  #logFoodFromImage;
  #retryImageDetection;
  #logFoodFromText;
  #logFoodFromVoiceText;
  #logFoodFromVoice;
  #logFoodFromUPC;
  #acceptFoodLog;
  #discardFoodLog;
  #restoreFoodLog;
  #reviseFoodLog;
  #processRevisionInput;
  #selectUPCPortion;
  #generateDailyReport;
  #mealCoachingTrigger;
  #budgetService;
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
  #logFoodFromScale;
  #selectScaleContainer;
  #selectScaleDensity;
  #showScaleDensityHelp;
  #retractScaleLog;
  #logScaleFoodFromText;

  /**
   * @param {Object} config - NutriBot configuration
   * @param {Object} [options] - Additional options
   * @param {Object} [options.messagingGateway] - Messaging gateway instance
   * @param {Object} [options.aiGateway] - AI gateway instance
   * @param {Object} [options.decisionGateway] - IDecisionGateway (typed decisions, e.g. Jev)
   * @param {Object} [options.upcGateway] - UPC lookup gateway
   * @param {Object} [options.googleImageGateway] - Google Image Search gateway
   * @param {Object} [options.foodLogStore] - Food log store (IFoodLogStore)
   * @param {Object} [options.nutriListStore] - Nutrient list store (INutriListStore)
   * @param {Object} [options.nutriCoachStore] - DEPRECATED: coaching now handled by HealthCoachAgent
   * @param {Object} [options.conversationStateStore] - Conversation state store
   * @param {Object} [options.reportDelivery] - Prepared-report delivery capability
   * @param {Object} [options.logger] - Custom logger instance
   */
  constructor(config, options = {}) {
    this.#config = config;
    this.#options = options;
    this.#logger = options.logger || console;

    // Accept injected dependencies
    this.#messagingGateway = options.messagingGateway || createLocalNutritionResponse();
    this.#aiGateway = options.aiGateway;
    this.#upcGateway = options.upcGateway;
    this.#googleImageGateway = options.googleImageGateway;
    this.#foodLogStore = options.foodLogStore;
    this.#nutriListStore = options.nutriListStore;
    // nutriCoachStore no longer used — HealthCoachAgent owns coaching persistence
    this.#conversationStateStore = options.conversationStateStore;
    this.#reportDelivery = options.reportDelivery;
    this.#barcodeGenerator = options.barcodeGenerator;
    this.#foodIconsString = options.foodIconsString;
    this.#reconciliationReader = options.reconciliationReader || null;
    this.#agentOrchestrator = options.agentOrchestrator || null;
    this.#mealCoachingTrigger = options.mealCoachingTrigger || null;
    // The health budget contract (range + zone) for the daily report caption.
    this.#budgetService = options.budgetService || null;
    this.#healthStore = options.healthStore || null;
    this.#catalogService = options.catalogService || null;
    this.#scaleConfig = options.scaleConfig || null;
    this.#imageDownloader = options.imageDownloader;
    this.#photoStore = options.photoStore || null;
    this.#pause = options.pause || (async () => {});
  }

  // ==================== Config Getter ====================

  /**
   * Get the configuration object
   * @returns {Object}
   */
  getConfig() {
    return this.#config;
  }

  /** Post-meal coaching trigger (`notify({userId, source})`), or null. */
  getMealCoachingTrigger() { return this.#mealCoachingTrigger; }

  setReceiptPublisher(publisher) { this.#receiptPublisher = publisher; }
  getReceiptPublisher() { return this.#receiptPublisher; }

  // ==================== Infrastructure Getters ====================

  getMessagingGateway() {
    if (!this.#messagingGateway) {
      throw new Error('messagingGateway not configured');
    }
    return this.#messagingGateway;
  }

  /**
   * Shared nearest-icon chooser: decision model first, LLM fallback supplied per call.
   */
  getIconChooser() {
    if (!this.#iconChooser) {
      this.#iconChooser = new NearestIconChooser({
        decisionGateway: scopedGateway(this.#options.decisionGateway || null, { feature: 'icon-pick' }),
        logger: this.#logger,
      });
    }
    return this.#iconChooser;
  }

  getAIGateway() {
    if (!this.#aiGateway) {
      throw new Error('aiGateway not configured');
    }
    return this.#aiGateway;
  }

  /**
   * The AI gateway narrowed to one Health feature, so its spend is
   * attributed `health/<feature>` in the usage ledger (composition scopes the
   * gateway to `{ app: 'health' }`). Throws like getAIGateway when absent.
   */
  #aiFor(feature) {
    return scopedGateway(this.getAIGateway(), { feature });
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

  getReportDelivery() {
    return this.#reportDelivery; // Optional - reports degrade to text-only
  }

  // ==================== Core Logging Use Cases ====================

  getLogFoodFromImage() {
    if (!this.#logFoodFromImage) {
      this.#logFoodFromImage = new LogFoodFromImage({
        receipts: () => this.#receiptPublisher,
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.#aiFor('photo-log'),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        foodIconsString: this.#foodIconsString,
        foodIconNames: this.#options.foodIconNames,
        logger: this.#logger,
        pause: this.#pause,
        reconciliationReader: this.#reconciliationReader,
        catalogService: this.#catalogService,
        imageDownloader: this.#imageDownloader,
        photoStore: this.#photoStore,
      });
    }
    return this.#logFoodFromImage;
  }

  getLogFoodFromText() {
    if (!this.#logFoodFromText) {
      this.#logFoodFromText = this.#buildLogFoodFromText('text-log');
    }
    return this.#logFoodFromText;
  }

  /**
   * Voice logs parse their transcript with the same use case as typed text,
   * on its own instance so that spend is attributed to `voice-log`.
   */
  #getLogFoodFromVoiceText() {
    if (!this.#logFoodFromVoiceText) {
      this.#logFoodFromVoiceText = this.#buildLogFoodFromText('voice-log');
    }
    return this.#logFoodFromVoiceText;
  }

  #buildLogFoodFromText(feature) {
    return new LogFoodFromText({
      receipts: () => this.#receiptPublisher,
      messagingGateway: this.getMessagingGateway(),
      aiGateway: this.#aiFor(feature),
      foodLogStore: this.#foodLogStore,
      conversationStateStore: this.#conversationStateStore,
      config: this.#config,
      foodIconsString: this.#foodIconsString,
      foodIconNames: this.#options.foodIconNames,
      logger: this.#logger,
      reconciliationReader: this.#reconciliationReader,
      catalogService: this.#catalogService,
    });
  }

  getLogFoodFromVoice() {
    if (!this.#logFoodFromVoice) {
      this.#logFoodFromVoice = new LogFoodFromVoice({
        transcribeAudio: this.#options.transcribeAudio,
        messagingGateway: this.getMessagingGateway(),
        logFoodFromText: this.#getLogFoodFromVoiceText(),
        logger: this.#logger,
      });
    }
    return this.#logFoodFromVoice;
  }

  getLogFoodFromUPC() {
    if (!this.#logFoodFromUPC) {
      this.#logFoodFromUPC = new LogFoodFromUPC({
        receipts: () => this.#receiptPublisher,
        messagingGateway: this.getMessagingGateway(),
        upcGateway: this.#upcGateway,
        aiGateway: scopedGateway(this.#aiGateway, { feature: 'upc-log' }),
        iconChooser: this.getIconChooser(),
        googleImageGateway: this.#googleImageGateway,
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        foodIconsString: this.#foodIconsString,
        foodIconNames: this.#options.foodIconNames,
        logger: this.#logger,
        barcodeGenerator: this.#barcodeGenerator,
        catalogService: this.#catalogService,
        reviewService: this.getFoodLogReview(),
        photoStore: this.#photoStore,
      });
    }
    return this.#logFoodFromUPC;
  }

  // ==================== Scale (food-scale relay) Use Cases ====================

  getLogFoodFromScale() {
    if (!this.#logFoodFromScale) {
      this.#logFoodFromScale = new LogFoodFromScale({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        scaleConfig: this.#scaleConfig,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#logFoodFromScale;
  }

  getSelectScaleContainer() {
    if (!this.#selectScaleContainer) {
      this.#selectScaleContainer = new SelectScaleContainer({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        scaleConfig: this.#scaleConfig,
        logger: this.#logger,
      });
    }
    return this.#selectScaleContainer;
  }

  getSelectScaleDensity() {
    if (!this.#selectScaleDensity) {
      this.#selectScaleDensity = new SelectScaleDensity({
        receipts: () => this.#receiptPublisher,
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        scaleConfig: this.#scaleConfig,
        logger: this.#logger,
      });
    }
    return this.#selectScaleDensity;
  }

  getShowScaleDensityHelp() {
    if (!this.#showScaleDensityHelp) {
      this.#showScaleDensityHelp = new ShowScaleDensityHelp({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        scaleConfig: this.#scaleConfig,
        logger: this.#logger,
      });
    }
    return this.#showScaleDensityHelp;
  }

  getLogScaleFoodFromText() {
    if (!this.#logScaleFoodFromText) {
      this.#logScaleFoodFromText = new LogScaleFoodFromText({
        receipts: () => this.#receiptPublisher,
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.#aiFor('scale-log'),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#logScaleFoodFromText;
  }

  getRetractScaleLog() {
    if (!this.#retractScaleLog) {
      this.#retractScaleLog = new RetractScaleLog({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#retractScaleLog;
  }

  getRetryImageDetection() {
    if (!this.#retryImageDetection) {
      this.#retryImageDetection = new RetryImageDetection({
        conversationStateStore: this.#conversationStateStore,
        logFoodFromImage: this.getLogFoodFromImage(),
        messagingGateway: this.getMessagingGateway(),
        logger: this.#logger,
      });
    }
    return this.#retryImageDetection;
  }

  // ==================== Food Log Action Use Cases ====================

  getAcceptFoodLog() {
    if (!this.#acceptFoodLog) {
      this.#acceptFoodLog = new AcceptFoodLog({
        receipts: () => this.#receiptPublisher,
        reviewService: this.getFoodLogReview(),
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        generateDailyReport: this.getGenerateDailyReport(),
        agentOrchestrator: this.#agentOrchestrator,
        logger: this.#logger,
        pause: this.#pause,
      });
    }
    return this.#acceptFoodLog;
  }

  getDiscardFoodLog() {
    if (!this.#discardFoodLog) {
      this.#discardFoodLog = new DiscardFoodLog({
        receipts: () => this.#receiptPublisher,
        reviewService: this.getFoodLogReview(),
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#discardFoodLog;
  }

  getRestoreFoodLog() {
    if (!this.#restoreFoodLog) {
      this.#restoreFoodLog = new RestoreFoodLog({
        nutriListStore: this.#nutriListStore,
        foodLogStore: this.#foodLogStore,
        receipts: () => this.#receiptPublisher,
        logger: this.#logger,
      });
    }
    return this.#restoreFoodLog;
  }

  getReviseFoodLog() {
    if (!this.#reviseFoodLog) {
      this.#reviseFoodLog = new ReviseFoodLog({
        receipts: () => this.#receiptPublisher,
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
        receipts: () => this.#receiptPublisher,
        messagingGateway: this.getMessagingGateway(),
        aiGateway: this.#aiFor('revision'),
        foodIconsString: this.#foodIconsString,
        foodIconNames: this.#options.foodIconNames,
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#processRevisionInput;
  }

  getSelectUPCPortion() {
    if (!this.#selectUPCPortion) {
      this.#selectUPCPortion = new SelectUPCPortion({
        receipts: () => this.#receiptPublisher,
        reviewService: this.getFoodLogReview(),
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        generateDailyReport: this.getGenerateDailyReport(),
        logger: this.#logger,
        pause: this.#pause,
      });
    }
    return this.#selectUPCPortion;
  }

  // ==================== Reporting Use Cases ====================

  getFoodLogReview() {
    return this.#foodLogReview ||= new FoodLogReview({ foodLogs: this.#foodLogStore, items: this.#nutriListStore, logger: this.#logger });
  }

  getGenerateDailyReport() {
    if (!this.#generateDailyReport) {
      this.#generateDailyReport = new GenerateDailyReport({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        nutriListStore: this.#nutriListStore,
        conversationStateStore: this.#conversationStateStore,
        reportDelivery: this.#reportDelivery,
        // A report is a meal checkpoint too: it arms the same quiet timer as a
        // capture, so a /report right after logging yields one coaching message.
        coachingOrchestrator: this.#mealCoachingTrigger ? {
          sendPostReport: async ({ userId, date }) => { this.#mealCoachingTrigger.notify({ userId, date, source: 'report' }); },
        } : null,
        config: this.#config,
        budgetService: this.#budgetService,
        logger: this.#logger,
        pause: this.#pause,
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
