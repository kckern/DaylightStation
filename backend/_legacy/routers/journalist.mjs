/**
 * Legacy Journalist Router Bridge
 *
 * This file now delegates to the new clean architecture implementation.
 * It maintains backward compatibility by providing the same initialization interface.
 *
 * New implementation: backend/src/3_applications/journalist/
 * New router: backend/src/4_api/routers/journalist.mjs
 */

import express from 'express';
import { createLogger } from '../chatbots/_lib/logging/index.mjs';

// Import new architecture components
import { JournalistContainer } from '../../src/3_applications/journalist/JournalistContainer.mjs';
import { JournalistInputRouter } from '../../src/2_adapters/journalist/JournalistInputRouter.mjs';
import { createJournalistRouter } from '../../src/4_api/routers/journalist.mjs';
import { YamlJournalEntryRepository } from '../../src/2_adapters/persistence/yaml/YamlJournalEntryRepository.mjs';
import { YamlMessageQueueRepository } from '../../src/2_adapters/persistence/yaml/YamlMessageQueueRepository.mjs';

const logger = createLogger({ source: 'journalist', app: 'journalist' });
const JournalistRouter = express.Router();

let container = null;
let initialized = false;

/**
 * Initialize journalist with dependencies
 * Called from api.mjs when config is available
 *
 * @param {Object} config - Journalist configuration
 * @param {Object} dependencies - Service dependencies
 * @returns {express.Router|null}
 */
export function initializeJournalist(config, dependencies = {}) {
  try {
    // Create repositories if not provided
    const journalEntryRepository = dependencies.journalEntryRepository ||
      (dependencies.userDataService ? new YamlJournalEntryRepository({
        userDataService: dependencies.userDataService,
        userResolver: dependencies.userResolver,
        configService: dependencies.configService,
        logger
      }) : null);

    const messageQueueRepository = dependencies.messageQueueRepository ||
      (dependencies.userDataService ? new YamlMessageQueueRepository({
        userDataService: dependencies.userDataService,
        userResolver: dependencies.userResolver,
        logger
      }) : null);

    // Create the new architecture container
    container = new JournalistContainer(config, {
      messagingGateway: dependencies.messagingGateway,
      aiGateway: dependencies.aiGateway,
      journalEntryRepository,
      messageQueueRepository,
      conversationStateStore: dependencies.conversationStateStore,
      quizRepository: dependencies.quizRepository,
      userResolver: dependencies.userResolver,
      logger
    });

    // Create the new router
    const router = createJournalistRouter(container, {
      botId: config.telegram?.journalistBotId || process.env.JOURNALIST_TELEGRAM_BOT_ID,
      gateway: dependencies.messagingGateway,
      configService: dependencies.configService
    });

    initialized = true;
    logger.info('journalist.initialized', { status: 'success', architecture: 'new' });
    return router;
  } catch (error) {
    logger.error('journalist.init.failed', { error: error.message });
    return null;
  }
}

/**
 * Get the journalist container instance
 * @returns {JournalistContainer|null}
 */
export function getJournalistContainer() {
  return container;
}

/**
 * Check if journalist is initialized
 * @returns {boolean}
 */
export function isJournalistInitialized() {
  return initialized;
}

// Fallback handler when not initialized
JournalistRouter.all('*', (req, res) => {
  if (!initialized) {
    return res.status(503).json({
      error: 'Journalist module not initialized',
      message: 'The journalist chatbot has not been fully configured'
    });
  }
  res.status(404).json({ error: 'Not found' });
});

export default JournalistRouter;

// Re-export new architecture components for direct usage
export { JournalistContainer, JournalistInputRouter };
