/**
 * Morning Debrief Handler
 * @module journalist/handlers/morning
 * 
 * Handles morning debrief trigger (from cron or manual API call)
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

const logger = createLogger({ source: 'journalist', app: 'morning-handler' });

/**
 * Handle morning debrief request
 * 
 * @param {Object} deps - Dependencies
 * @param {Object} deps.generateMorningDebrief - GenerateMorningDebrief use case
 * @param {Object} deps.sendMorningDebrief - SendMorningDebrief use case
 * @param {Object} deps.userResolver - UserResolver for username lookup
 * @param {string} username - System username
 * @param {string} [date] - Optional target date (YYYY-MM-DD)
 * @returns {Object} Result
 */
export async function handleMorningDebrief(deps, username, date = null) {
  logger.info('morning.handler.start', { username, date });

  try {
    // Step 1: Generate the debrief
    const debrief = await deps.generateMorningDebrief.execute({
      username,
      date
    });

    // Step 2: Resolve user's conversation ID
    // For MVP, assume username can be used to look up telegram conversation
    // In production, this should query from user profile or config
    const conversationId = await resolveConversationId(deps.userResolver, username);
    
    if (!conversationId) {
      logger.error('morning.handler.no-conversation-id', { username });
      return {
        success: false,
        error: 'Could not resolve conversation ID for user'
      };
    }

    // Step 3: Send to Telegram
    const result = await deps.sendMorningDebrief.execute({
      conversationId,
      debrief
    });

    logger.info('morning.handler.complete', {
      username,
      date: debrief.date,
      success: result.success,
      fallback: result.fallback
    });

    return {
      success: true,
      username,
      date: debrief.date || date,
      messageId: result.messageId,
      fallback: result.fallback
    };

  } catch (error) {
    logger.error('morning.handler.failed', {
      username,
      date,
      error: error.message,
      stack: error.stack
    });

    return {
      success: false,
      username,
      error: error.message
    };
  }
}

/**
 * Resolve username to Telegram conversation ID
 * 
 * For MVP: Build conversation ID from user profile telegram identity
 * Format: telegram:{bot_id}_{user_id}
 */
async function resolveConversationId(userResolver, username) {
  if (!userResolver) {
    logger.warn('morning.no-user-resolver', { username });
    return null;
  }

  // Get user data from resolver
  const user = userResolver.getUser(username);
  
  if (!user || !user.telegram_user_id || !user.telegram_bot_id) {
    logger.warn('morning.incomplete-telegram-config', {
      username,
      hasUser: !!user,
      hasTelegramUserId: !!user?.telegram_user_id,
      hasTelegramBotId: !!user?.telegram_bot_id
    });
    return null;
  }

  const conversationId = `telegram:${user.telegram_bot_id}_${user.telegram_user_id}`;
  logger.debug('morning.conversation-resolved', { username, conversationId });
  
  return conversationId;
}
