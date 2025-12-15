/**
 * CLI Chat Simulator
 * @module cli/CLIChatSimulator
 * 
 * Main orchestrator for the CLI chat simulator.
 * Connects the CLI interface components to the chatbot containers.
 */

import { createLogger } from '../_lib/logging/index.mjs';
import { Attachment } from '../domain/value-objects/Attachment.mjs';
import { CLIPresenter } from './presenters/CLIPresenter.mjs';
import { CLIInputHandler, InputType } from './input/CLIInputHandler.mjs';
import { CLIMessagingGateway } from './adapters/CLIMessagingGateway.mjs';
import { CLIImageHandler } from './media/CLIImageHandler.mjs';
import { CLISessionManager } from './session/CLISessionManager.mjs';

// Real infrastructure implementations (no mocks)
import { NutriLogRepository } from '../nutribot/repositories/NutriLogRepository.mjs';
import { NutriListRepository } from '../nutribot/repositories/NutriListRepository.mjs';
import { FileConversationStateStore } from '../infrastructure/persistence/FileConversationStateStore.mjs';
import { FileRepository } from '../infrastructure/persistence/FileRepository.mjs';
import { OpenAIGateway } from '../infrastructure/ai/OpenAIGateway.mjs';
import { RealUPCGateway } from '../infrastructure/gateways/RealUPCGateway.mjs';
import { CanvasReportRenderer } from '../adapters/http/CanvasReportRenderer.mjs';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load preferred timezone from config.app-local.yml/config.app.yml
 */
function loadAppTimezone() {
  const searchPaths = [
    path.resolve(__dirname, '../../../config.app-local.yml'),
    path.resolve(__dirname, '../../../config.app.yml'),
    path.resolve(__dirname, '../../../../config.app-local.yml'),
    path.resolve(__dirname, '../../../../config.app.yml'),
    path.resolve(process.cwd(), 'config.app-local.yml'),
    path.resolve(process.cwd(), 'config.app.yml'),
  ];

  for (const p of searchPaths) {
    try {
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, 'utf8');
      const cfg = yaml.load(content) || {};
      const tz = cfg?.timezone || cfg?.weather?.timezone;
      if (tz) return tz;
    } catch (err) {
      // ignore and try next
    }
  }

  return 'America/Los_Angeles';
}

/**
 * Load API key from config.secrets.yml if not in environment
 */
function loadApiKeyFromConfig() {
  // First check environment
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  // Try to load from config.secrets.yml
  const configPaths = [
    path.resolve(__dirname, '../../../config.secrets.yml'),
    path.resolve(__dirname, '../../../../config.secrets.yml'),
    path.resolve(process.cwd(), 'config.secrets.yml'),
    path.resolve(process.cwd(), '../config.secrets.yml'),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(content);
        if (config?.OPENAI_API_KEY) {
          console.log(`✓ Loaded OPENAI_API_KEY from ${path.basename(configPath)}`);
          return config.OPENAI_API_KEY;
        }
      }
    } catch (e) {
      // Ignore and try next path
    }
  }

  return null;
}

/**
 * Dynamically import OpenAIGateway only when needed
 */
async function createRealAIGateway() {
  const apiKey = loadApiKeyFromConfig();
  
  if (!apiKey) {
    console.error('⚠️  OPENAI_API_KEY not found.');
    console.error('   Set it via: export OPENAI_API_KEY=sk-...');
    console.error('   Or add it to config.secrets.yml');
    return null;
  }

  try {
    const { OpenAIGateway } = await import('../infrastructure/ai/OpenAIGateway.mjs');
    return new OpenAIGateway({ 
      apiKey,
      model: 'gpt-4o',
      maxTokens: 1000,
    });
  } catch (error) {
    console.error('⚠️  Failed to load OpenAI gateway:', error.message);
    return null;
  }
}

/**
 * Bot configuration
 */
const BOT_CONFIG = {
  nutribot: {
    name: 'NutriBot',
    emoji: '🍎',
    description: 'Food logging & nutrition tracking',
    welcomeMessage: 'Welcome to NutriBot! Send me a photo of your food, describe what you ate, or scan a barcode.',
  },
  journalist: {
    name: 'Journalist',
    emoji: '📓',
    description: 'Daily journaling & reflection',
    welcomeMessage: 'Welcome to Journalist! Share your thoughts, and I\'ll help you reflect on your day.',
  },
};

/**
 * CLI Chat Simulator - main orchestrator
 */
export class CLIChatSimulator {
  #presenter;
  #inputHandler;
  #messagingGateway;
  #imageHandler;
  #session;
  #logger;
  #containers;
  #running;
  #timezone;
  
  // Mock adapters
  #aiGateway;
  #upcGateway;
  #reportRenderer;
  #nutrilogRepository;
  #nutrilistRepository;
  #conversationStateStore;
  #journalEntryRepository;
  #messageQueueRepository;

  /**
   * @param {Object} [options]
   * @param {string} [options.sessionName] - Named session
   * @param {boolean} [options.debug] - Enable debug logging
   * @param {string} [options.bot] - Start with specific bot
   * @param {boolean} [options.useRealAI] - Use real OpenAI API
   * @param {boolean} [options.useRealUPC] - Use real UPC lookup APIs
   * @param {boolean} [options.testMode] - Non-interactive mode for testing
   */
  constructor(options = {}) {
    // Store options for later
    this._testMode = options.testMode || false;
    this._useRealAI = options.useRealAI || false;
    this._useRealUPC = options.useRealUPC || false;
    this._debug = options.debug || false;

    // Standardize timezone early so all Date calculations align with the app config
    this.#timezone = loadAppTimezone();
    if (!process.env.TZ) {
      process.env.TZ = this.#timezone;
    }

    // Create logger - only output if debug mode is enabled
    this.#logger = createLogger({ 
      source: 'cli:simulator', 
      app: 'cli',
      // Silent output unless debug mode
      output: this._debug ? console.log : () => {},
    });

    // Initialize UI components
    this.#presenter = new CLIPresenter();
    this.#imageHandler = new CLIImageHandler();
    this.#inputHandler = new CLIInputHandler({ presenter: this.#presenter });
    
    this.#session = new CLISessionManager({
      sessionName: options.sessionName,
      debug: options.debug,
    });

    // Create logger for infrastructure (unless debug mode, then silent)
    const infraLogger = createLogger({
      source: 'cli:infra',
      app: 'cli',
      output: this._debug ? console.log : () => {},
    });

    // Initialize real adapters (AI will be configured in initialize() based on useRealAI)
    // Use _tmp directory for CLI data storage
    const cliDataPath = path.resolve(__dirname, '../../data/_tmp');
    
    // Create a simple config object for repositories
    const cliConfig = {
      getNutrilogPath: (userId) => `${cliDataPath}/nutrilogs/${userId}`,
      getNutrilistPath: (userId) => `${cliDataPath}/nutrilists/${userId}`,
      getConversationStatePath: (conversationId) => `${cliDataPath}/conversation-state/${conversationId}`,
    };
    
    this.#aiGateway = null; // Will be initialized in initialize()
    this.#upcGateway = new RealUPCGateway({ logger: infraLogger });
    this.#reportRenderer = new CanvasReportRenderer({ logger: infraLogger });
    this.#nutrilogRepository = new NutriLogRepository({ 
      config: cliConfig,
      logger: infraLogger 
    });
    this.#nutrilistRepository = new NutriListRepository({ 
      config: cliConfig,
      logger: infraLogger 
    });
    this.#conversationStateStore = new FileConversationStateStore({ 
      storePath: '_tmp/conversation-state',
      logger: infraLogger 
    });
    // Journalist repositories - use generic FileRepository
    this.#journalEntryRepository = new FileRepository({ 
      storePath: '_tmp/journal-entries',
      logger: infraLogger 
    });
    this.#messageQueueRepository = new FileRepository({ 
      storePath: '_tmp/message-queue',
      logger: infraLogger 
    });

    this.#containers = {};
    this.#running = false;

    // Pre-select bot if specified
    if (options.bot && BOT_CONFIG[options.bot]) {
      this.#session.setCurrentBot(options.bot);
    }

    this.#logger.info('simulator.created', { 
      sessionName: options.sessionName,
      debug: options.debug,
      bot: options.bot,
      useRealAI: options.useRealAI || false,
      testMode: options.testMode || false,
    });
  }

  /**
   * Get today's date in local timezone as YYYY-MM-DD
   * @private
   */
  #getLocalDate(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const tzDate = d.toLocaleDateString('en-CA', { timeZone: this.#timezone });
    return tzDate; // already YYYY-MM-DD in en-CA
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize the simulator
   */
  async initialize() {
    this.#logger.info('simulator.initializing', { useRealAI: this._useRealAI });

    // Initialize components
    await this.#imageHandler.initialize();
    await this.#session.initialize();

    // Create messaging gateway
    this.#messagingGateway = new CLIMessagingGateway({
      presenter: this.#presenter,
      inputHandler: this.#inputHandler,
      imageHandler: this.#imageHandler,
      testMode: this._testMode,
    });

    // Initialize AI gateway (use real OpenAI or throw error)
    if (this._useRealAI) {
      console.log('🔌 Connecting to OpenAI API...');
      const realGateway = await createRealAIGateway();
      if (realGateway) {
        this.#aiGateway = realGateway;
        console.log('✅ Connected to OpenAI API');
      } else {
        throw new Error('Failed to connect to OpenAI. Set OPENAI_API_KEY in environment or config.secrets.yml');
      }
    } else {
      throw new Error('CLI simulator requires real AI. Use --real-ai flag or set useRealAI: true');
    }

    // Initialize bot containers
    await this.#initializeBotContainers();

    this.#logger.info('simulator.initialized');
  }

  /**
   * Initialize bot containers with CLI adapters
   * @private
   */
  async #initializeBotContainers() {
    // Import containers dynamically to avoid circular deps
    const { NutribotContainer } = await import('../nutribot/container.mjs');
    
    // Create config object with required methods
    const config = {
      goals: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
      getUserTimezone: () => this.#timezone,
      getGoalsForUser: () => ({ calories: 2000, protein: 150, carbs: 200, fat: 65 }),
    };

    // Create silent logger for containers (unless debug mode)
    const containerLogger = createLogger({
      source: 'container',
      app: 'nutribot',
      output: this._debug ? console.log : () => {},
    });

    // Create adapters object with all mocks
    const adapters = {
      messagingGateway: this.#messagingGateway,
      aiGateway: this.#aiGateway,
      upcGateway: this.#upcGateway,
      reportRenderer: this.#reportRenderer,
      nutrilogRepository: this.#nutrilogRepository,
      nutrilistRepository: this.#nutrilistRepository,
      conversationStateStore: this.#conversationStateStore,
      messageQueueRepository: this.#messageQueueRepository,
      logger: containerLogger,
    };
    
    // NutriBot container with all CLI/mock adapters
    this.#containers.nutribot = new NutribotContainer(config, adapters);

    // Journalist container (when available)
    try {
      const { JournalistContainer } = await import('../journalist/container.mjs');
      this.#containers.journalist = new JournalistContainer({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        journalEntryRepository: this.#journalEntryRepository,
        aiGateway: this.#aiGateway,
      });
    } catch (error) {
      this.#logger.warn('simulator.journalistNotAvailable', { error: error.message });
      // Journalist container not yet implemented - that's okay
    }

    this.#logger.debug('simulator.containersInitialized', { 
      bots: Object.keys(this.#containers) 
    });
  }

  /**
   * Start the interactive session
   */
  async start() {
    this.#running = true;
    
    this.#logger.info('simulator.starting');

    // Show main menu if no bot selected
    if (!this.#session.getCurrentBot()) {
      await this.#showMainMenu();
    } else {
      await this.#startBotSession(this.#session.getCurrentBot());
    }
  }

  /**
   * Stop the simulator
   */
  async stop() {
    this.#running = false;
    
    // Persist session
    await this.#session.persist();
    
    this.#presenter.printNewline();
    this.#presenter.printSystemMessage('Session saved. Goodbye!');
    
    this.#logger.info('simulator.stopped');
  }

  // ==================== Main Menu ====================

  /**
   * Show the main menu
   * @private
   */
  async #showMainMenu() {
    while (this.#running) {
      this.#presenter.printMainMenu();
      
      const selection = await this.#inputHandler.promptBotSelection();

      switch (selection) {
        case 'nutribot':
        case 'journalist':
          await this.#startBotSession(selection);
          break;
        
        case 'settings':
          await this.#showSettings();
          break;
        
        case 'exit':
          await this.stop();
          return;
        
        default:
          this.#presenter.printWarning('Invalid selection');
      }
    }
  }

  /**
   * Show settings menu
   * @private
   */
  async #showSettings() {
    const selection = await this.#inputHandler.promptSettings();

    switch (selection) {
      case 'debug':
        const enabled = this.#session.toggleDebugMode();
        this.#presenter.printSuccess(`Debug logging ${enabled ? 'enabled' : 'disabled'}`);
        break;
      
      case 'clear_sessions':
        await this.#session.clear();
        this.#presenter.printSuccess('All sessions cleared');
        break;
      
      case 'back':
      default:
        break;
    }
  }

  // ==================== Bot Session ====================

  /**
   * Start a session with a specific bot
   * @private
   * @param {string} botName
   */
  async #startBotSession(botName) {
    if (!BOT_CONFIG[botName]) {
      this.#presenter.printError(`Unknown bot: ${botName}`);
      return;
    }

    const config = BOT_CONFIG[botName];
    this.#session.setCurrentBot(botName);

    this.#presenter.clearScreen();
    this.#presenter.printWelcome(config.name, this.#session.getSessionId());
    
    // For NutriBot, generate report on startup instead of welcome message
    if (botName === 'nutribot') {
      await this.#generateStartupReport();
    } else {
      // Other bots show welcome message
      this.#presenter.printBotMessage(config.welcomeMessage, {
        botName: config.name,
        emoji: config.emoji,
      });
    }

    this.#logger.info('simulator.botSessionStarted', { bot: botName });

    // Start the chat loop
    await this.#chatLoop(botName);
  }

  /**
   * Main chat loop for interacting with a bot
   * @private
   * @param {string} botName
   */
  async #chatLoop(botName) {
    while (this.#running && this.#session.getCurrentBot() === botName) {
      try {
        // Get user input
        const rawInput = await this.#inputHandler.promptText('> ');
        
        // Parse input type
        const { type, data } = this.#inputHandler.detectInputType(rawInput);
        
        this.#logger.debug('chatLoop.input', { type, data });

        // Handle based on type
        switch (type) {
          case InputType.COMMAND:
            const shouldContinue = await this.#handleCommand(data.command, data.args);
            if (!shouldContinue) return;
            break;
          
          case InputType.BUTTON_PRESS:
            await this.#handleButtonPress(botName, data.buttonId);
            break;
          
          case InputType.TEXT:
            if (data.text) {
              await this.#handleTextMessage(botName, data.text);
            }
            break;
          
          case InputType.PHOTO:
            await this.#handlePhotoMessage(botName, data);
            break;
          
          case InputType.VOICE:
            await this.#handleVoiceMessage(botName, data);
            break;
          
          case InputType.UPC:
            await this.#handleUPCMessage(botName, data.upc);
            break;
          
          default:
            this.#presenter.printWarning(`Unknown input type: ${type}`);
        }

        // Persist session after each interaction
        await this.#session.persist();

      } catch (error) {
        this.#logger.error('chatLoop.error', { error: error.message, stack: error.stack });
        this.#presenter.printError(error.message);
      }
    }
  }

  // ==================== Command Handling ====================

  /**
   * Handle a command
   * @private
   * @param {string} command
   * @param {string|null} args
   * @returns {Promise<boolean>} - Whether to continue the chat loop
   */
  async #handleCommand(command, args) {
    this.#logger.debug('handleCommand', { command, args });

    switch (command) {
      case 'help':
        this.#presenter.printHelp();
        return true;
      
      case 'switch':
        this.#session.setCurrentBot(null);
        return false; // Exit chat loop to show main menu
      
      case 'clear':
        this.#session.clearHistory();
        this.#session.clearLastPendingLogUuid();;
        this.#presenter.clearScreen();
        const config = BOT_CONFIG[this.#session.getCurrentBot()];
        this.#presenter.printWelcome(config.name, this.#session.getSessionId());
        this.#presenter.printSuccess('Conversation cleared');
        return true;
      
      case 'state':
        const state = this.#session.getBotState();
        this.#presenter.printSystemMessage('Current state:');
        console.log(JSON.stringify(state, null, 2));
        return true;
      
      case 'debug':
        const enabled = this.#session.toggleDebugMode();
        this.#presenter.printSuccess(`Debug logging ${enabled ? 'enabled' : 'disabled'}`);
        return true;
      
      case 'quit':
      case 'exit':
        await this.stop();
        return false;

      // === NutriBot Action Commands ===
      case 'accept':
        await this.#handleSlashAction('accept');
        return true;

      case 'revise':
        await this.#handleSlashAction('revise');
        return true;

      case 'discard':
        await this.#handleSlashAction('discard');
        return true;

      case 'report':
        await this.#handleReportCommand();
        return true;
      
      default:
        this.#presenter.printWarning(`Unknown command: /${command}`);
        return true;
    }
  }

  /**
   * Handle slash action commands (/accept, /revise, /discard)
   * @private
   */
  async #handleSlashAction(action) {
    const botName = this.#session.getCurrentBot();
    if (botName !== 'nutribot') {
      this.#presenter.printWarning(`/${action} is only available in NutriBot`);
      return;
    }

    const logUuid = this.#session.getLastPendingLogUuid();
    if (!logUuid) {
      this.#presenter.printWarning('No pending food log to act on. Log some food first!');
      return;
    }

    const container = this.#containers[botName];
    if (!container) {
      this.#presenter.printError('NutriBot container not available');
      return;
    }

    const conversationId = this.#session.getConversationId();
    const userId = this.#session.getUserId();

    try {
      switch (action) {
        case 'accept':
          const nutriLog = await this.#nutrilogRepository.findByUuid(logUuid);
          const acceptUseCase = container.getAcceptFoodLog();
          await acceptUseCase.execute({ userId, conversationId, logUuid });
          this.#session.clearLastPendingLogUuid();
          this.#logger.info('slashAction.accept', { logUuid });
          
          if (nutriLog?.items?.length > 0) {
            await this.#showAcceptConfirmation(nutriLog);
          }
          break;

        case 'revise':
          await this.#handleRevisionPrompt(container, logUuid);
          this.#logger.info('slashAction.revise', { logUuid });
          break;

        case 'discard':
          const discardUseCase = container.getDiscardFoodLog();
          await discardUseCase.execute({ userId, conversationId, logUuid });
          this.#session.clearLastPendingLogUuid();
          this.#presenter.printBotMessage('🗑️ Food log discarded.', {
            botName: 'NutriBot',
            emoji: '🍎',
          });
          this.#logger.info('slashAction.discard', { logUuid });
          break;
      }
    } catch (error) {
      this.#logger.error('slashAction.error', { error: error.message, action, logUuid });
      this.#presenter.printError(`Failed to ${action}: ${error.message}`);
    }
  }

  /**
   * Handle /report command - show today's nutrition report
   * @private
   */
  async #handleReportCommand() {
    const botName = this.#session.getCurrentBot();
    if (botName !== 'nutribot') {
      this.#presenter.printWarning('/report is only available in NutriBot');
      return;
    }

    try {
      // Get all items for today from nutrilist (use local date, not UTC)
      const today = this.#getLocalDate();
      const allItems = await this.#nutrilistRepository.findByDate?.(today) 
        || await this.#nutrilistRepository.getAll?.() 
        || [];
      
      const todayItems = allItems.filter(item => item.date === today);

      if (todayItems.length === 0) {
        this.#presenter.printBotMessage('📊 No food logged today yet!', {
          botName: 'NutriBot',
          emoji: '🍎',
        });
        return;
      }

      // Calculate totals
      const totals = todayItems.reduce((acc, item) => {
        acc.calories += item.calories || 0;
        acc.protein += item.protein || 0;
        acc.carbs += item.carbs || 0;
        acc.fat += item.fat || 0;
        return acc;
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      const goals = { calories: 2000, protein: 150 };
      const pctCal = Math.round((totals.calories / goals.calories) * 100);
      const pctPro = Math.round((totals.protein / goals.protein) * 100);

      const report = `📊 **Today's Nutrition Report** (${today})

📋 **Items:** ${todayItems.length} food items logged

📈 **Totals:**
• Calories: ${Math.round(totals.calories)} (${pctCal}% of ${goals.calories})
• Protein: ${Math.round(totals.protein)}g (${pctPro}% of ${goals.protein}g)
• Carbs: ${Math.round(totals.carbs)}g
• Fat: ${Math.round(totals.fat)}g`;

      this.#presenter.printBotMessage(report, {
        botName: 'NutriBot',
        emoji: '🍎',
      });

    } catch (error) {
      this.#logger.error('reportCommand.error', { error: error.message });
      this.#presenter.printError(`Failed to generate report: ${error.message}`);
    }
  }

  // ==================== Button Press Handling ====================

  /**
   * Handle button press (single character input)
   * @private
   * @param {string} botName
   * @param {string} buttonId
   */
  async #handleButtonPress(botName, buttonId) {
    const container = this.#containers[botName];
    if (!container) {
      this.#presenter.printError(`Bot ${botName} not available`);
      return;
    }

    // Shortcut: Z key directly triggers adjustment flow (for testing)
    if (buttonId.toUpperCase() === 'Z' && botName === 'nutribot') {
      this.#presenter.printSystemMessage('🔧 Starting adjustment flow (Z shortcut)...');
      await this.#handleAdjustmentCallback(container, 'adj_start', null);
      return;
    }

    const result = this.#messagingGateway.pressButton(buttonId);
    
    if (!result.success) {
      this.#presenter.printWarning(`No active button [${buttonId}]`);
      return;
    }

    this.#logger.debug('buttonPress.executed', { buttonId, callbackData: result.callbackData });

    const conversationId = this.#session.getConversationId();
    const userId = this.#session.getUserId();
    const messageId = result.messageId;

    // Handle adjustment flow callbacks (adj_*)
    if (result.callbackData.startsWith('adj_')) {
      await this.#handleAdjustmentCallback(container, result.callbackData, messageId);
      return;
    }

    // Parse the callback data (format: "action:uuid")
    const [action, logUuid] = result.callbackData.split(':');
    if (!action || !logUuid) {
      this.#presenter.printWarning(`Invalid button callback: ${result.callbackData}`);
      return;
    }

    try {
      switch (action) {
        case 'accept':
          const nutriLog = await this.#nutrilogRepository.findByUuid(logUuid);
          const acceptUseCase = container.getAcceptFoodLog();
          await acceptUseCase.execute({ userId, conversationId, logUuid });
          this.#logger.info('buttonPress.accept', { logUuid });
          
          // Remove from pending logs
          this.#session.removePendingLogUuid(logUuid);
          
          // Show confirmation (the use case already generates report, so don't call #checkAndGenerateReport)
          if (nutriLog?.items?.length > 0) {
            await this.#showAcceptConfirmation(nutriLog);
          }
          
          // Generate PNG report after accepting
          await this.#generatePhotoReport();
          break;

        case 'revise':
          await this.#handleRevisionPrompt(container, logUuid);
          this.#logger.info('buttonPress.revise', { logUuid });
          break;

        case 'discard':
          const discardUseCase = container.getDiscardFoodLog();
          await discardUseCase.execute({ userId, conversationId, logUuid });
          this.#presenter.printBotMessage('🗑️ Food log discarded.', {
            botName: 'NutriBot',
            emoji: '🍎',
          });
          
          // Remove from pending logs
          this.#session.removePendingLogUuid(logUuid);
          this.#logger.info('buttonPress.discard', { logUuid });
          
          // Don't generate report on discard, just confirm
          break;

        case 'portion':
          // Handle UPC portion selection (logUuid is actually the portion multiplier)
          await this.#handleUPCPortionSelection(container, logUuid);
          break;

        default:
          this.#logger.debug('buttonPress.unknownAction', { action, logUuid });
      }
    } catch (error) {
      this.#logger.error('buttonPress.error', { error: error.message, action, logUuid });
      this.#presenter.printError(`Failed to ${action}: ${error.message}`);
    }
  }

  /**
   * Handle adjustment flow callback
   * @private
   */
  async #handleAdjustmentCallback(container, callbackData, messageId) {
    const conversationId = this.#session.getConversationId();
    const userId = this.#session.getUserId();

    this.#logger.debug('adjustmentCallback', { callbackData, messageId });

    try {
      // Start adjustment flow
      if (callbackData === 'adj_start') {
        const useCase = container.getStartAdjustmentFlow();
        // Pass messageId so the flow can update the existing message
        this.#presenter.printSystemMessage(`[Adjustment starting on message: ${messageId || 'NEW'}]`);
        await useCase.execute({ userId, conversationId, messageId });
        return;
      }

      // Done - exit adjustment flow
      if (callbackData === 'adj_done') {
        // Delete the adjustment message (msg-1)
        if (messageId) {
          try {
            await this.#messagingGateway.deleteMessage(conversationId, messageId);
          } catch (e) {
            // Ignore delete errors
          }
        }
        
        // Clear adjustment state
        if (this.#session.clearAdjustmentState) {
          await this.#session.clearAdjustmentState();
        }
        
        this.#presenter.printBotMessage('✅ Adjustment complete.', {
          botName: 'NutriBot',
          emoji: '🍎',
        });
        // Regenerate report with updated data (this creates msg-2)
        await this.#generatePhotoReport();
        return;
      }

      // Date selection: adj_date_X
      if (callbackData.startsWith('adj_date_')) {
        const daysAgo = parseInt(callbackData.replace('adj_date_', ''), 10);
        const useCase = container.getSelectDateForAdjustment();
        await useCase.execute({ userId, conversationId, messageId, daysAgo });
        return;
      }

      // Back to date selection
      if (callbackData === 'adj_back_date') {
        const useCase = container.getStartAdjustmentFlow();
        await useCase.execute({ userId, conversationId });
        return;
      }

      // Item selection: adj_item_X
      if (callbackData.startsWith('adj_item_')) {
        const itemId = callbackData.replace('adj_item_', '');
        const useCase = container.getSelectItemForAdjustment();
        await useCase.execute({ userId, conversationId, messageId, itemId });
        return;
      }

      // Back to items list
      if (callbackData === 'adj_back_items') {
        // Get current state from conversation state store
        const state = await this.#conversationStateStore?.get(conversationId);
        const daysAgo = state?.getFlowValue('daysAgo');
        
        this.#presenter.printSystemMessage(`[Back to items: daysAgo=${daysAgo}, messageId=${messageId}]`);
        
        if (daysAgo !== undefined) {
          const useCase = container.getSelectDateForAdjustment();
          await useCase.execute({ userId, conversationId, messageId, daysAgo });
        } else {
          // Fall back to date selection (with messageId to update, not create new)
          const useCase = container.getStartAdjustmentFlow();
          await useCase.execute({ userId, conversationId, messageId });
        }
        return;
      }

      // Portion adjustment: adj_factor_X
      if (callbackData.startsWith('adj_factor_')) {
        const factor = parseFloat(callbackData.replace('adj_factor_', ''));
        const useCase = container.getApplyPortionAdjustment();
        await useCase.execute({ userId, conversationId, messageId, factor });
        return;
      }

      // Delete item
      if (callbackData === 'adj_delete') {
        const useCase = container.getDeleteListItem();
        await useCase.execute({ userId, conversationId, messageId });
        return;
      }

      // Pagination: adj_page_X
      // Pagination: adj_page_X
      if (callbackData.startsWith('adj_page_')) {
        const offset = parseInt(callbackData.replace('adj_page_', ''), 10);
        // Re-fetch items with new offset
        const state = await this.#conversationStateStore?.get(conversationId);
        const daysAgo = state?.getFlowValue('daysAgo');
        if (daysAgo !== undefined) {
          const useCase = container.getSelectDateForAdjustment();
          await useCase.execute({ userId, conversationId, messageId, daysAgo, offset });
        }
        return;
      }

      this.#logger.warn('adjustmentCallback.unhandled', { callbackData });

    } catch (error) {
      this.#logger.error('adjustmentCallback.error', { error: error.message, callbackData });
      this.#presenter.printError(`Adjustment failed: ${error.message}`);
    }
  }

  /**
   * Check if all pending logs are resolved and generate report
   * @private
   */
  async #checkAndGenerateReport() {
    const pendingLogs = this.#session.getPendingLogUuids();
    const hasPendingButtons = this.#messagingGateway.hasPendingButtons();
    
    this.#logger.debug('checkAndGenerateReport', { pendingLogs: pendingLogs.length, hasPendingButtons });
    
    if (pendingLogs.length > 0 || hasPendingButtons) {
      // Still have pending logs - show reminder
      const pendingCount = Math.max(pendingLogs.length, hasPendingButtons ? 1 : 0);
      this.#presenter.printSystemMessage(`📋 ${pendingCount} pending log(s) - accept or discard to generate report`);
      return;
    }
    
    // All pending logs resolved - generate full report with PNG
    this.#logger.info('checkAndGenerateReport.allResolved');
    
    try {
      // Get all items for today from nutrilist
      const today = this.#getLocalDate();
      const userId = this.#session.getUserId();
      
      // Try findByDate with userId, fall back to getAll and filter
      let todayItems = [];
      if (this.#nutrilistRepository.findByDate) {
        todayItems = await this.#nutrilistRepository.findByDate(userId, today) || [];
      }
      if (todayItems.length === 0 && this.#nutrilistRepository.getAll) {
        const allItems = this.#nutrilistRepository.getAll();
        todayItems = allItems.filter(item => item.date === today);
      }

      if (todayItems.length === 0) {
        this.#logger.debug('checkAndGenerateReport.noItems', { today });
        return; // No items to report
      }

      this.#logger.debug('checkAndGenerateReport.items', { today, count: todayItems.length });

      // Calculate totals
      const totals = todayItems.reduce((acc, item) => {
        acc.calories += item.calories || 0;
        acc.protein += item.protein || 0;
        acc.carbs += item.carbs || 0;
        acc.fat += item.fat || 0;
        return acc;
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      const goals = { calories: 2000, protein: 150, carbs: 200, fat: 65 };
      const pctCal = Math.round((totals.calories / goals.calories) * 100);
      const pctPro = Math.round((totals.protein / goals.protein) * 100);

      // Generate PNG report first
      const { textPath, pngPath } = await this.#generateReportFile(
        { items: todayItems }, 
        totals, 
        goals
      );

      // Build caption for the report image
      const caption = `📊 Daily Summary (${today})\n` +
        `${todayItems.length} items • ${Math.round(totals.calories)} cal (${pctCal}%) • ${Math.round(totals.protein)}g protein (${pctPro}%)`;

      // Send report as a photo message with caption
      const conversationId = this.#session.getConversationId();
      
      if (pngPath) {
        // Create attachment for the PNG
        const attachment = Attachment.photo({
          localPath: pngPath,
          mimeType: 'image/png',
          fileName: path.basename(pngPath),
        });

        // Display as photo message with bot attribution
        this.#presenter.printPhotoMessage({
          caption,
          emoji: '📊',
          botName: 'NutriBot',
          botEmoji: '🍎',
          filePath: pngPath,
        });
        
        // Send with buttons (registers them for interaction)
        await this.#messagingGateway.sendMessage(conversationId, caption, {
          choices: [
            [{ text: '✏️ Revise', callback_data: 'adj_start' }],
          ],
          inline: true,
          attachment,
        });
      } else {
        // Fallback to text-only report
        const report = `📊 **Daily Summary** (${today})\n\n` +
          `📋 **Items:** ${todayItems.length} food items logged\n\n` +
          `📈 **Totals:**\n` +
          `• Calories: ${Math.round(totals.calories)} (${pctCal}% of ${goals.calories})\n` +
          `• Protein: ${Math.round(totals.protein)}g (${pctPro}% of ${goals.protein}g)\n` +
          `• Carbs: ${Math.round(totals.carbs)}g\n` +
          `• Fat: ${Math.round(totals.fat)}g`;

        await this.#messagingGateway.sendMessage(conversationId, report, {
          choices: [
            [{ text: '✏️ Revise', callback_data: 'adj_start' }],
          ],
          inline: true,
        });
      }

      // Show data file paths
      const nutrilistPath = this.#nutrilistRepository.getFilePath?.() || '/tmp/nutribot-cli/nutrilist.json';
      this.#presenter.printSystemMessage(`📁 Data: ${nutrilistPath}`);

    } catch (error) {
      this.#logger.error('checkAndGenerateReport.error', { error: error.message });
    }
  }

  /**
   * Generate a photo report (PNG with caption) - called after accepting food
   * @private
   */
  async #generatePhotoReport() {
    try {
      const today = this.#getLocalDate();
      const userId = this.#session.getUserId();
      const conversationId = this.#session.getConversationId();
      
      // Delete any existing report messages first (only one report at a time)
      await this.#messagingGateway.deleteMessagesByType(conversationId, 'report');
      
      // Get today's items from nutrilist
      let todayItems = [];
      if (this.#nutrilistRepository.findByDate) {
        todayItems = await this.#nutrilistRepository.findByDate(userId, today);
      } else if (this.#nutrilistRepository.getAll) {
        const all = this.#nutrilistRepository.getAll();
        todayItems = all.filter(item => item.date === today);
      }

      if (todayItems.length === 0) {
        return; // Nothing to report
      }

      // Calculate totals
      const totals = todayItems.reduce((acc, item) => {
        acc.calories += item.calories || 0;
        acc.protein += item.protein || 0;
        acc.carbs += item.carbs || 0;
        acc.fat += item.fat || 0;
        return acc;
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      const goals = { calories: 2000, protein: 150, carbs: 200, fat: 65 };
      const pctCal = Math.round((totals.calories / goals.calories) * 100);

      // Generate PNG report
      const { pngPath } = await this.#generateReportFile(
        { items: todayItems }, 
        totals, 
        goals
      );

      // Build short caption (coaching placeholder)
      const caption = `📊 Updated Report (${today})\n` +
        `${todayItems.length} items • ${Math.round(totals.calories)} cal (${pctCal}%)`;

      if (pngPath) {
        // Create attachment
        const attachment = Attachment.photo({
          localPath: pngPath,
          mimeType: 'image/png',
          fileName: path.basename(pngPath),
        });

        // Display as photo message
        this.#presenter.printPhotoMessage({
          caption,
          emoji: '📊',
          botName: 'NutriBot',
          botEmoji: '🍎',
          filePath: pngPath,
        });
        
        // Register revise button and tag as report
        await this.#messagingGateway.sendMessage(conversationId, '', {
          choices: [
            [{ text: '✏️ Revise', callback_data: 'adj_start' }],
          ],
          inline: true,
          attachment,
          messageType: 'report',
        });
      }

    } catch (error) {
      this.#logger.error('generatePhotoReport.error', { error: error.message });
    }
  }

  /**
   * Generate report on startup (shows current week's data)
   * @private
   */
  async #generateStartupReport() {
    try {
      const today = this.#getLocalDate();
      const userId = this.#session.getUserId();
      const conversationId = this.#session.getConversationId();
      
      // Delete any existing report messages first (only one report at a time)
      await this.#messagingGateway.deleteMessagesByType(conversationId, 'report');
      
      // Get all items from nutrilist
      let allItems = [];
      if (this.#nutrilistRepository.getAll) {
        allItems = this.#nutrilistRepository.getAll();
      }

      // Get today's items
      const todayItems = allItems.filter(item => item.date === today);
      
      // Calculate this week's items (last 7 days)
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 6);
      const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      
      const weekItems = allItems.filter(item => item.date >= weekStartStr && item.date <= today);
      
      // Calculate totals
      const todayTotals = todayItems.reduce((acc, item) => {
        acc.calories += item.calories || 0;
        acc.protein += item.protein || 0;
        acc.carbs += item.carbs || 0;
        acc.fat += item.fat || 0;
        return acc;
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      const weekTotals = weekItems.reduce((acc, item) => {
        acc.calories += item.calories || 0;
        acc.protein += item.protein || 0;
        return acc;
      }, { calories: 0, protein: 0 });

      // Build report message
      const goals = { calories: 2000, protein: 150 };
      const pctCal = todayTotals.calories > 0 ? Math.round((todayTotals.calories / goals.calories) * 100) : 0;

      // Generate PNG if there are items today
      if (todayItems.length > 0) {
        const { pngPath } = await this.#generateReportFile(
          { items: todayItems }, 
          todayTotals, 
          goals
        );

        // Build caption for photo message
        const caption = `📊 NutriBot Dashboard (${today})\n` +
          `Today: ${todayItems.length} items • ${todayTotals.calories} cal (${pctCal}%) • ${todayTotals.protein}g protein`;

        if (pngPath) {
          // Create attachment
          const attachment = Attachment.photo({
            localPath: pngPath,
            mimeType: 'image/png',
            fileName: path.basename(pngPath),
          });

          // Display as photo message with bot attribution
          this.#presenter.printPhotoMessage({
            caption,
            emoji: '📊',
            botName: 'NutriBot',
            botEmoji: '🍎',
            filePath: pngPath,
          });
          
          // Send with buttons and tag as report
          await this.#messagingGateway.sendMessage(conversationId, caption, {
            choices: [
              [{ text: '✏️ Adjust Items', callback_data: 'adj_start' }],
            ],
            inline: true,
            attachment,
            messageType: 'report',
          });
        } else {
          // Text fallback
          await this.#messagingGateway.sendMessage(conversationId, caption, {
            choices: [
              [{ text: '✏️ Adjust Items', callback_data: 'adj_start' }],
            ],
            inline: true,
            messageType: 'report',
          });
        }
      } else {
        // No items today - still generate a report image showing week history
        const { pngPath } = await this.#generateReportFile(
          { items: [] }, 
          { calories: 0, protein: 0, carbs: 0, fat: 0 }, 
          goals
        );

        let caption = `📊 NutriBot Dashboard (${today})\n`;
        caption += `📅 Today: No food logged yet\n`;
        
        if (weekItems.length > 0) {
          const avgCal = Math.round(weekTotals.calories / 7);
          caption += `📈 This Week: ${weekItems.length} items • avg ${avgCal} cal/day`;
        } else {
          caption += `💡 Send a photo, text, or barcode to log food`;
        }

        if (pngPath) {
          // Create attachment
          const attachment = Attachment.photo({
            localPath: pngPath,
            mimeType: 'image/png',
            fileName: path.basename(pngPath),
          });

          // Display as photo message with bot attribution
          this.#presenter.printPhotoMessage({
            caption,
            emoji: '📊',
            botName: 'NutriBot',
            botEmoji: '🍎',
            filePath: pngPath,
          });
          
          // Send with buttons and tag as report
          await this.#messagingGateway.sendMessage(conversationId, caption, {
            choices: [
              [{ text: '✏️ Adjust Past Items', callback_data: 'adj_start' }],
            ],
            inline: true,
            attachment,
            messageType: 'report',
          });
        } else {
          // Fallback if PNG generation fails
          await this.#messagingGateway.sendMessage(conversationId, caption, {
            choices: [
              [{ text: '✏️ Adjust Past Items', callback_data: 'adj_start' }],
            ],
            inline: true,
            messageType: 'report',
          });
        }
      }

    } catch (error) {
      this.#logger.error('generateStartupReport.error', { error: error.message });
      // Fall back to simple welcome
      this.#presenter.printBotMessage('Welcome to NutriBot! Send me a photo of your food, describe what you ate, or scan a barcode.', {
        botName: 'NutriBot',
        emoji: '🍎',
      });
    }
  }

  // ==================== Message Handling ====================

  /**
   * Handle text message
   * @private
   * @param {string} botName
   * @param {string} text
   * @param {Object} [options]
   * @param {boolean} [options.skipUserPrint] - Skip printing user message (for voice flow)
   * @param {boolean} [options.skipHistory] - Skip adding to history (for voice flow)
   */
  async #handleTextMessage(botName, text, options = {}) {
    const { skipUserPrint = false, skipHistory = false } = options;
    
    if (!skipUserPrint) {
      this.#presenter.printUserMessage(text);
    }
    
    // Add to history
    if (!skipHistory) {
      this.#session.addToHistory({ role: 'user', type: 'text', content: text });
    }

    // Route to appropriate bot
    const container = this.#containers[botName];
    if (!container) {
      this.#presenter.printError(`Bot ${botName} not available`);
      return;
    }

    try {
      // For NutriBot, check if we're in revision mode first
      if (botName === 'nutribot') {
        const conversationId = this.#session.getConversationId();
        
        // Check for revision mode
        const state = await this.#conversationStateStore?.get(conversationId);
        if (state?.activeFlow === 'revision') {
          const handled = await this.#handleRevisionInput(container, text);
          if (handled) return;
        }
        
        // Check if text is a UPC barcode (all digits, more than 1 char)
        // Single digit is reserved for button presses
        const isUPC = /^\d{2,}$/.test(text.trim());
        if (isUPC) {
          this.#logger.info('handleTextMessage.upcDetected', { upc: text.trim() });
          await this.#handleUPCInput(container, text.trim());
          return;
        }
        
        // Normal food logging
        const useCase = container.getLogFoodFromText();
        const result = await useCase.execute({
          userId: this.#session.getUserId(),
          conversationId,
          text,
        });

        this.#logger.info('handleTextMessage.result', { success: result.success, itemCount: result.itemCount });

        // Store the pending log UUID for slash commands
        if (result.success && result.nutrilogUuid) {
          this.#session.setLastPendingLogUuid(result.nutrilogUuid);
        }
      }
      
      // Journalist handling would go here
      
    } catch (error) {
      this.#logger.error('handleTextMessage.error', { error: error.message });
      this.#presenter.printError(`Failed to process: ${error.message}`);
    }
  }

  /**
   * Process any pending callbacks from button selections
   * @private
   */
  async #processCallbacks(botName) {
    const callbackData = this.#messagingGateway.getLastCallbackData();
    this.#logger.debug('processCallbacks', { callbackData, botName });
    
    if (!callbackData) {
      this.#logger.debug('processCallbacks.noCallback');
      return;
    }

    // Parse callback: "action:uuid"
    const [action, logUuid] = callbackData.split(':');
    this.#logger.debug('processCallbacks.parsed', { action, logUuid });
    if (!action || !logUuid) return;

    const container = this.#containers[botName];
    if (!container) return;

    const conversationId = this.#session.getConversationId();
    const userId = this.#session.getUserId();

    try {
      switch (action) {
        case 'accept':
          // Get the log first to show confirmation
          const nutriLog = await this.#nutrilogRepository.findByUuid(logUuid);
          
          const acceptUseCase = container.getAcceptFoodLog();
          await acceptUseCase.execute({ userId, conversationId, logUuid });
          this.#session.clearLastPendingLogUuid();
          this.#logger.info('callback.accept', { logUuid });
          
          // Show CLI report after accepting
          if (nutriLog?.items?.length > 0) {
            await this.#showAcceptConfirmation(nutriLog);
          }
          break;

        case 'revise':
          // Handle revision directly in CLI - prompt for text input
          await this.#handleRevisionPrompt(container, logUuid);
          this.#logger.info('callback.revise', { logUuid });
          break;

        case 'discard':
          const discardUseCase = container.getDiscardFoodLog();
          await discardUseCase.execute({ userId, conversationId, logUuid });
          this.#session.clearLastPendingLogUuid();
          this.#logger.info('callback.discard', { logUuid });
          break;

        default:
          this.#logger.debug('callback.unknown', { action, logUuid });
      }
    } catch (error) {
      this.#logger.error('processCallbacks.error', { error: error.message, action, logUuid });
    }
  }

  /**
   * Show confirmation after accepting food log (brief, no report generation)
   * @private
   */
  async #showAcceptConfirmation(nutriLog) {
    const items = nutriLog.items || [];
    const totalCals = items.reduce((sum, i) => sum + (i.calories || 0), 0);
    const totalProtein = items.reduce((sum, i) => sum + (i.protein || 0), 0);
    const totalCarbs = items.reduce((sum, i) => sum + (i.carbs || 0), 0);
    const totalFat = items.reduce((sum, i) => sum + (i.fat || 0), 0);

    // Brief confirmation message
    const itemList = items.map(i => `${i.quantity || 1} ${i.unit || ''} ${i.name}`.trim()).join(', ');
    const message = `✅ Logged: ${itemList} (${totalCals} cal, ${totalProtein}g protein)`;

    this.#presenter.printBotMessage(message, {
      botName: 'NutriBot',
      emoji: '🍎',
    });
  }

  /**
   * Generate report files (text and PNG)
   * @private
   * @returns {Promise<{textPath: string, pngPath: string|null}>}
   */
  async #generateReportFile(nutriLog, totals, goals) {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const dataDir = process.env.CLI_DATA_DIR || '/tmp/nutribot-cli';
    const today = this.#getLocalDate();
    const timestamp = Date.now();
    
    // Ensure directory exists
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (e) { /* ignore */ }

    // Build history from all items in nutrilist (last 7 days, excluding today)
    const history = await this.#buildHistoryFromNutrilist(today);

    // Prepare report data
    const reportData = {
      date: today,
      totals,
      goals,
      items: nutriLog.items || [],
      history,
    };

    // Generate text report
    const textFileName = `report-${today}-${timestamp}.txt`;
    const textPath = path.join(dataDir, textFileName);
    const textContent = await this.#reportRenderer.renderDailyReport(reportData);
    await fs.writeFile(textPath, textContent);
    this.#logger.info('report.text.generated', { path: textPath });

    // Generate PNG report using canvas renderer
    let pngPath = null;
    try {
      const { CanvasReportRenderer } = await import('../adapters/http/CanvasReportRenderer.mjs');
      const canvasRenderer = new CanvasReportRenderer();
      const pngBuffer = await canvasRenderer.renderDailyReport(reportData);
      
      const pngFileName = `report-${today}-${timestamp}.png`;
      pngPath = path.join(dataDir, pngFileName);
      await fs.writeFile(pngPath, pngBuffer);
      this.#logger.info('report.png.generated', { path: pngPath });
    } catch (e) {
      this.#logger.warn('report.png.failed', { error: e.message, stack: e.stack });
      // Always show error to user
      this.#presenter.printSystemMessage(`⚠️  PNG report generation failed: ${e.message}`);
    }

    return { textPath, pngPath };
  }

  /**
   * Build history data from nutrilist for the weekly chart
   * @private
   * @param {string} today - Today's date YYYY-MM-DD
   * @returns {Promise<Array>} Array of daily summaries
   */
  async #buildHistoryFromNutrilist(today) {
    const allItems = this.#nutrilistRepository.getAll?.() || [];
    
    // Group items by date and aggregate
    const byDate = {};
    for (const item of allItems) {
      const date = item.date || item.createdAt?.split('T')[0];
      if (!date || date === today) continue; // Exclude today (today's data comes from items)
      
      if (!byDate[date]) {
        byDate[date] = { date, calories: 0, protein: 0, carbs: 0, fat: 0 };
      }
      byDate[date].calories += item.calories || 0;
      byDate[date].protein += item.protein || 0;
      byDate[date].carbs += item.carbs || 0;
      byDate[date].fat += item.fat || 0;
    }
    
    // Convert to array and sort by date
    const history = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    this.#logger.debug('buildHistoryFromNutrilist', { days: history.length, dates: history.map(h => h.date) });
    
    return history;
  }

  /**
   * Handle revision prompt - show current items and prompt for text
   * @private
   */
  async #handleRevisionPrompt(container, logUuid) {
    const conversationId = this.#session.getConversationId();
    const userId = this.#session.getUserId();

    // Get the original log
    const nutriLog = await this.#nutrilogRepository.findByUuid(logUuid);
    if (!nutriLog) {
      this.#presenter.printError('Could not find the log to revise');
      return;
    }

    // Build current items display with noom colors
    const colorEmoji = { green: '🟢', yellow: '🟡', orange: '🟠' };
    const currentItems = nutriLog.items.map(item => {
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      const color = colorEmoji[item.noom_color] || '⚪';
      return `${color} ${qty} ${unit} ${item.name} (${item.calories || 0} cal)`;
    }).join('\n');

    // Set state to revision mode
    await this.#conversationStateStore?.set(conversationId, {
      flow: 'revision',
      pendingLogUuid: logUuid,
    });

    // Send revision mode message with cancel button
    const { messageId: revisionMsgId } = await this.#messagingGateway.sendMessage(
      conversationId,
      `✏️ **Revision Mode**\n\nCurrent items:\n${currentItems}\n\nType your corrections (e.g., "it was a turkey sandwich" or "remove the apple")`,
      {
        choices: [
          [{ text: '❌ Cancel', callback_data: `discard:${logUuid}` }],
        ],
        inline: true,
      }
    );

    // Store revision message ID for later update
    await this.#conversationStateStore?.update?.(conversationId, {
      revisionMessageId: revisionMsgId,
    });

    // Return to main loop - user can type revision text or press cancel button
    // The revision input will be handled by #handleRevisionInput when user types
  }

  /**
   * Handle revision text input
   * @private
   */
  async #handleRevisionInput(container, text) {
    const conversationId = this.#session.getConversationId();
    const userId = this.#session.getUserId();
    
    // Get revision state
    const state = await this.#conversationStateStore?.get(conversationId);
    if (!state || state.activeFlow !== 'revision') {
      return false; // Not in revision mode
    }

    const logUuid = state.getFlowValue('pendingLogUuid');
    const revisionMsgId = state.getFlowValue('revisionMessageId');

    // Get the original log
    const nutriLog = await this.#nutrilogRepository.findByUuid(logUuid);
    if (!nutriLog) {
      this.#presenter.printError('Could not find the log to revise');
      return true;
    }

    // Get the original date to preserve it
    const originalDate = nutriLog.date || new Date().toISOString().split('T')[0];
    
    // Build context for AI (just the food items, not date)
    const originalItems = nutriLog.items.map(item => {
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      return `- ${qty} ${unit} ${item.name} (${item.calories || 0} cal)`;
    }).join('\n');

    const contextualText = `Original items:
${originalItems}

User revision: "${text}"`;

    // Update the revision message to show processing
    if (revisionMsgId) {
      await this.#messagingGateway.updateMessage(conversationId, revisionMsgId, {
        text: '🔍 Processing revision...',
        choices: [],
      });
    }

    // Discard the old log before creating the revised one
    const discardUseCase = container.getDiscardFoodLog();
    await discardUseCase.execute({ userId, conversationId, logUuid });
    this.#session.removePendingLogUuid(logUuid);

    // Clear revision state
    await this.#conversationStateStore?.clear?.(conversationId);

    // Use LogFoodFromText with the contextual prompt AND the original date
    const logFoodFromText = container.getLogFoodFromText();
    
    const result = await logFoodFromText.execute({
      userId,
      conversationId,
      text: contextualText,
      date: originalDate, // Preserve the original date
    });

    this.#logger.info('handleRevisionInput.result', { 
      success: result.success, 
      itemCount: result.itemCount 
    });

    // Track the new pending log UUID
    if (result.success && result.nutrilogUuid) {
      this.#session.addPendingLogUuid(result.nutrilogUuid);
    }
    
    return true; // Handled
  }

  /**
   * Handle UPC barcode input
   * @private
   */
  async #handleUPCInput(container, upc) {
    const conversationId = this.#session.getConversationId();
    const userId = this.#session.getUserId();

    this.#logger.info('handleUPCInput.start', { upc });

    try {
      const useCase = container.getLogFoodFromUPC();
      const result = await useCase.execute({
        userId,
        conversationId,
        upc,
      });

      this.#logger.info('handleUPCInput.result', { 
        success: result.success, 
        productName: result.product?.name,
        logUuid: result.nutrilogUuid,
      });

      // Store the pending log UUID for slash commands
      if (result.success && result.nutrilogUuid) {
        this.#session.setLastPendingLogUuid(result.nutrilogUuid);
        this.#session.addPendingLogUuid(result.nutrilogUuid);
      }

      return result.success;
    } catch (error) {
      this.#logger.error('handleUPCInput.error', { upc, error: error.message });
      this.#presenter.printError(`Failed to look up barcode: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle UPC portion selection callback
   * @private
   */
  async #handleUPCPortionSelection(container, portionStr) {
    const conversationId = this.#session.getConversationId();
    const userId = this.#session.getUserId();

    this.#logger.info('handleUPCPortionSelection.start', { portionStr });

    try {
      // Get the current state to find the pending log
      const state = await this.#conversationStateStore?.get(conversationId);
      if (!state || state.activeFlow !== 'upc_portion' || !state.getFlowValue('pendingLogUuid')) {
        this.#logger.warn('handleUPCPortionSelection.noState', { state });
        this.#presenter.printWarning('No pending UPC selection. Please scan again.');
        return;
      }

      const logUuid = state.getFlowValue('pendingLogUuid');
      const portionFactor = parseFloat(portionStr);

      if (isNaN(portionFactor) || portionFactor <= 0) {
        this.#logger.warn('handleUPCPortionSelection.invalidPortion', { portionStr });
        return;
      }

      // Use SelectUPCPortion use case
      const useCase = container.getSelectUPCPortion();
      const result = await useCase.execute({
        userId,
        conversationId,
        logUuid,
        portionFactor,
      });

      this.#logger.info('handleUPCPortionSelection.result', { success: result.success });

      if (result.success) {
        // Remove from pending logs
        this.#session.removePendingLogUuid(logUuid);

        // Show confirmation
        if (result.item) {
          await this.#showAcceptConfirmation({ items: [result.item] });
        }

        // Generate PNG report
        await this.#generatePhotoReport();
      }
    } catch (error) {
      this.#logger.error('handleUPCPortionSelection.error', { error: error.message });
      this.#presenter.printError(`Failed to select portion: ${error.message}`);
    }
  }

  /**
   * Process callbacks for a specific bot container (LEGACY - for test mode only)
   * @private
   */
  async #processCallbacksForBot(container) {
    const callbackData = this.#messagingGateway.getLastCallbackData();
    if (!callbackData) return;

    this.#logger.debug('processCallbacksForBot', { callbackData });

    const [action, logUuid] = callbackData.split(':');
    if (!action || !logUuid) return;

    const conversationId = this.#session.getConversationId();
    const userId = this.#session.getUserId();

    try {
      switch (action) {
        case 'accept':
          const acceptUseCase = container.getAcceptFoodLog();
          await acceptUseCase.execute({ userId, conversationId, logUuid });
          this.#logger.info('callback.accept', { logUuid });
          break;

        case 'revise':
          await this.#handleRevisionPrompt(container, logUuid);
          this.#logger.info('callback.revise', { logUuid });
          break;

        case 'discard':
          const discardUseCase = container.getDiscardFoodLog();
          await discardUseCase.execute({ userId, conversationId, logUuid });
          this.#logger.info('callback.discard', { logUuid });
          break;
      }
    } catch (error) {
      this.#logger.error('processCallbacksForBot.error', { error: error.message, action, logUuid });
    }
  }

  /**
   * Handle photo message (URL, path, or base64)
   * @private
   * @param {string} botName
   * @param {Object} imageData - { url, path, base64, sourceType }
   */
  async #handlePhotoMessage(botName, imageData) {
    const displayText = imageData.url || imageData.path || '[Base64 Image]';
    this.#presenter.printUserMessage(`[Photo: ${displayText}]`);
    
    this.#session.addToHistory({ role: 'user', type: 'photo', content: displayText });

    const container = this.#containers[botName];
    if (!container) {
      this.#presenter.printError(`Bot ${botName} not available`);
      return;
    }

    try {
      if (botName === 'nutribot') {
        // Convert image to base64 URL for AI
        const base64Url = await this.#prepareImageForAI(imageData);
        
        if (!base64Url) {
          this.#presenter.printError('Failed to load image');
          return;
        }

        const useCase = container.getLogFoodFromImage();
        const result = await useCase.execute({
          userId: this.#session.getUserId(),
          conversationId: this.#session.getConversationId(),
          imageData: { url: base64Url },
        });

        this.#logger.info('handlePhotoMessage.result', { success: result.success });

        // Store the pending log UUID for slash commands
        if (result.success && result.nutrilogUuid) {
          this.#session.setLastPendingLogUuid(result.nutrilogUuid);
          this.#session.addPendingLogUuid(result.nutrilogUuid);
        }

        // Generate PNG report after accepting
        if (result.success) {
          // Note: Report generation happens after user accepts
        }
      }
    } catch (error) {
      this.#logger.error('handlePhotoMessage.error', { error: error.message });
      this.#presenter.printError(`Failed to process image: ${error.message}`);
    }
  }

  /**
   * Prepare image for AI - download/load and convert to base64 URL
   * @private
   * @param {Object} imageData - { url, path, base64, sourceType }
   * @returns {Promise<string|null>} - Base64 data URL or null on error
   */
  async #prepareImageForAI(imageData) {
    try {
      // Already a base64 data URL
      if (imageData.base64) {
        this.#logger.debug('prepareImage.base64', { length: imageData.base64.length });
        return imageData.base64;
      }

      // URL - download and convert
      if (imageData.url) {
        this.#logger.debug('prepareImage.url', { url: imageData.url });
        return await this.#downloadAndConvertToBase64(imageData.url);
      }

      // Local path - load and convert
      if (imageData.path) {
        this.#logger.debug('prepareImage.path', { path: imageData.path });
        return await this.#loadFileAsBase64(imageData.path);
      }

      return null;
    } catch (error) {
      this.#logger.error('prepareImage.error', { error: error.message });
      return null;
    }
  }

  /**
   * Download image from URL and convert to base64 data URL
   * @private
   */
  async #downloadAndConvertToBase64(url) {
    const { createCanvas, loadImage } = await import('canvas');
    
    // Fetch the image
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Load and resize using Canvas
    const image = await loadImage(buffer);
    
    // Calculate dimensions maintaining aspect ratio (max 800px width for context efficiency)
    const maxWidth = 800;
    const { width, height } = image;
    const aspectRatio = height / width;
    const newWidth = Math.min(width, maxWidth);
    const newHeight = Math.round(newWidth * aspectRatio);
    
    // Create canvas and resize
    const canvas = createCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, newWidth, newHeight);
    
    // Convert to JPEG with quality
    const resizedBuffer = canvas.toBuffer('image/jpeg', { quality: 0.7 });
    const base64 = resizedBuffer.toString('base64');
    
    const sizeKb = Math.round(resizedBuffer.length / 1024);
    this.#logger.debug('downloadAndConvert.complete', { originalUrl: url, sizeKb, width: newWidth, height: newHeight });
    
    return `data:image/jpeg;base64,${base64}`;
  }

  /**
   * Load local file and convert to base64 data URL
   * @private
   */
  async #loadFileAsBase64(filePath) {
    const { createCanvas, loadImage } = await import('canvas');
    const fs = await import('fs/promises');
    const path = await import('path');
    
    // Resolve relative paths
    const resolvedPath = path.resolve(filePath);
    
    // Read the file
    const buffer = await fs.readFile(resolvedPath);
    
    // Load and resize using Canvas
    const image = await loadImage(buffer);
    
    // Calculate dimensions (max 800px width)
    const maxWidth = 800;
    const { width, height } = image;
    const aspectRatio = height / width;
    const newWidth = Math.min(width, maxWidth);
    const newHeight = Math.round(newWidth * aspectRatio);
    
    // Create canvas and resize
    const canvas = createCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, newWidth, newHeight);
    
    // Convert to JPEG
    const resizedBuffer = canvas.toBuffer('image/jpeg', { quality: 0.7 });
    const base64 = resizedBuffer.toString('base64');
    
    const sizeKb = Math.round(resizedBuffer.length / 1024);
    this.#logger.debug('loadFile.complete', { filePath, sizeKb, width: newWidth, height: newHeight });
    
    return `data:image/jpeg;base64,${base64}`;
  }

  /**
   * Handle voice message (audio file or simulated transcript)
   * @private
   * @param {string} botName
   * @param {Object|string} voiceData - { path, sourceType: 'file' } or { transcript } or string transcript
   */
  async #handleVoiceMessage(botName, voiceData) {
    // Handle legacy string input (simulated transcript)
    if (typeof voiceData === 'string') {
      voiceData = { transcript: voiceData };
    }

    // If it's an audio file, transcribe it first
    if (voiceData.path && voiceData.sourceType === 'file') {
      this.#presenter.printUserMessage(`[Voice: ${voiceData.path}]`);
      
      const conversationId = this.#session.getConversationId();
      
      // Show transcription status
      const { messageId: statusMsgId } = await this.#messagingGateway.sendMessage(
        conversationId,
        '🎙️ Transcribing audio...',
        {}
      );

      try {
        const transcript = await this.#transcribeAudioFile(voiceData.path);
        
        if (!transcript) {
          await this.#messagingGateway.deleteMessage(conversationId, statusMsgId);
          this.#presenter.printError('Failed to transcribe audio');
          return;
        }

        // Update status message with transcription (keep visible)
        await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
          text: `🎙️ "${transcript}"`,
        });
        
        this.#session.addToHistory({ role: 'user', type: 'voice', content: transcript });
        
        // Process as text - will create NEW message for analyzing → food list
        // Skip printing user message and history (already done above)
        await this.#handleTextMessage(botName, transcript, { skipUserPrint: true, skipHistory: true });
      } catch (error) {
        await this.#messagingGateway.deleteMessage(conversationId, statusMsgId);
        this.#presenter.printError(`Transcription failed: ${error.message}`);
      }
      return;
    }

    // Simulated transcript (from [voice:...] syntax)
    const transcript = voiceData.transcript;
    this.#presenter.printUserMessage(`[Voice: "${transcript}"]`);
    this.#session.addToHistory({ role: 'user', type: 'voice', content: transcript });

    // Voice messages are just text messages with the transcript
    await this.#handleTextMessage(botName, transcript);
  }

  /**
   * Transcribe audio file using OpenAI Whisper
   * @private
   * @param {string} filePath - Path to audio file
   * @returns {Promise<string|null>} - Transcribed text or null on error
   */
  async #transcribeAudioFile(filePath) {
    const fs = await import('fs');
    const pathModule = await import('path');
    
    // Resolve relative paths
    const resolvedPath = pathModule.resolve(filePath);
    
    this.#logger.debug('transcribeAudio.start', { filePath: resolvedPath });

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Audio file not found: ${resolvedPath}`);
    }

    // Get the AI gateway for transcription
    const container = this.#containers.nutribot;
    if (!container) {
      throw new Error('NutriBot container not available for transcription');
    }

    const aiGateway = container.getAIGateway();
    if (!aiGateway?.transcribe) {
      throw new Error('AI Gateway does not support transcription');
    }

    // Read file and transcribe
    const audioBuffer = fs.readFileSync(resolvedPath);
    const transcript = await aiGateway.transcribe(audioBuffer, {
      filename: pathModule.basename(resolvedPath),
    });

    this.#logger.debug('transcribeAudio.complete', { transcript: transcript?.substring(0, 50) });
    return transcript;
  }

  /**
   * Handle text message with custom icon (for voice transcripts)
   * @private
   * @param {string} botName
   * @param {string} text
   * @param {string} icon - Custom icon for status message
   * @param {string} [existingMessageId] - Existing message ID to reuse (for voice flow)
   */
  async #handleTextMessageWithIcon(botName, text, icon, existingMessageId) {
    // Similar to handleTextMessage but with custom icon for status message
    const container = this.#containers[botName];
    if (!container) {
      this.#presenter.printError(`Bot ${botName} not available`);
      return;
    }

    try {
      if (botName === 'nutribot') {
        const conversationId = this.#session.getConversationId();
        
        // Check for revision mode first
        const state = await this.#conversationStateStore?.get(conversationId);
        if (state?.activeFlow === 'revision') {
          const handled = await this.#handleRevisionInput(container, text);
          if (handled) return;
        }
        
        // Normal food logging with voice icon
        const useCase = container.getLogFoodFromText();
        const result = await useCase.execute({
          userId: this.#session.getUserId(),
          conversationId,
          text,
          statusIcon: icon, // Pass custom icon
          existingMessageId, // Reuse existing message if provided
        });

        if (result.success && result.nutrilogUuid) {
          this.#session.setLastPendingLogUuid(result.nutrilogUuid);
          this.#session.addPendingLogUuid(result.nutrilogUuid);
        }
      }
    } catch (error) {
      this.#logger.error('handleTextMessageWithIcon.error', { error: error.message });
      this.#presenter.printError(`Failed to process: ${error.message}`);
    }
  }

  /**
   * Handle UPC barcode (simulated)
   * @private
   */
  async #handleUPCMessage(botName, upc) {
    this.#presenter.printUserMessage(`[UPC: ${upc}]`);
    
    this.#session.addToHistory({ role: 'user', type: 'upc', content: upc });

    const container = this.#containers[botName];
    if (!container) {
      this.#presenter.printError(`Bot ${botName} not available`);
      return;
    }

    try {
      if (botName === 'nutribot') {
        const useCase = container.getLogFoodFromUPC();
        const result = await useCase.execute({
          userId: this.#session.getUserId(),
          conversationId: this.#session.getConversationId(),
          upc,
        });

        this.#logger.info('handleUPCMessage.result', { success: result.success });
      }
    } catch (error) {
      this.#logger.error('handleUPCMessage.error', { error: error.message });
      this.#presenter.printError(`Failed to look up barcode: ${error.message}`);
    }
  }

  // ==================== Getters ====================

  /**
   * Get the messaging gateway (for testing)
   */
  getMessagingGateway() {
    return this.#messagingGateway;
  }

  /**
   * Get a bot container (for testing)
   */
  getContainer(botName) {
    return this.#containers[botName];
  }

  /**
   * Get the session manager (for testing)
   */
  getSession() {
    return this.#session;
  }

  /**
   * Get the AI gateway (for testing/configuration)
   */
  getAIGateway() {
    return this.#aiGateway;
  }

  /**
   * Get the UPC gateway (for testing/configuration)
   */
  getUPCGateway() {
    return this.#upcGateway;
  }

  /**
   * Get the report renderer (for testing)
   */
  getReportRenderer() {
    return this.#reportRenderer;
  }

  /**
   * Get the nutrilog repository (for testing)
   */
  getNutrilogRepository() {
    return this.#nutrilogRepository;
  }

  /**
   * Get the nutrilist repository (for testing)
   */
  getNutrilistRepository() {
    return this.#nutrilistRepository;
  }

  /**
   * Get the conversation state store (for testing)
   */
  getConversationStateStore() {
    return this.#conversationStateStore;
  }

  /**
   * Get the presenter (for testing)
   */
  getPresenter() {
    return this.#presenter;
  }

  /**
   * Get the input handler (for testing)
   */
  getInputHandler() {
    return this.#inputHandler;
  }
}

export default CLIChatSimulator;
