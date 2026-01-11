/**
 * Journalist Router Integration
 * @module backend/journalist
 * 
 * Integrates the chatbot-based journalist module into the main backend.
 * Note: Full chatbot integration should be done in api.mjs similar to nutribot.
 * This is a stub that will be replaced when journalist is fully integrated.
 */

import express from 'express';
import { createJournalistRouter } from '../chatbots/bots/journalist/server.mjs';
import { JournalistContainer } from '../chatbots/bots/journalist/container.mjs';
import { createLogger } from '../chatbots/_lib/logging/index.mjs';

const logger = createLogger({ source: 'journalist', app: 'journalist' });
const JournalistRouter = express.Router();

// Create a minimal container without full infrastructure
// This allows the webhook to work for testing, but won't send real messages
let container = null;
let initialized = false;

/**
 * Initialize journalist with dependencies
 * Called from api.mjs when config is available
 */
export function initializeJournalist(config, dependencies = {}) {
  try {
    container = new JournalistContainer(config, {
      messagingGateway: dependencies.messagingGateway,
      aiGateway: dependencies.aiGateway,
      journalEntryRepository: dependencies.journalEntryRepository,
      messageQueueRepository: dependencies.messageQueueRepository,
      conversationStateStore: dependencies.conversationStateStore,
      quizRepository: dependencies.quizRepository,
    });
    
    const router = createJournalistRouter(container, {
      botId: config.telegram?.journalistBotId || process.env.JOURNALIST_TELEGRAM_BOT_ID,
      gateway: dependencies.messagingGateway,
    });
    
    initialized = true;
    logger.info('journalist.initialized', { status: 'success' });
    return router;
  } catch (error) {
    logger.error('journalist.init.failed', { error: error.message });
    return null;
  }
}

// Fallback handler when not initialized
JournalistRouter.all('*', (req, res) => {
  if (!initialized) {
    return res.status(503).json({
      error: 'Journalist module not initialized',
      message: 'The journalist chatbot has not been fully configured',
    });
  }
  res.status(404).json({ error: 'Not found' });
});

export default JournalistRouter;
