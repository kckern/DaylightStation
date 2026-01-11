/**
 * Journalist Trigger Handler
 * @module journalist/handlers/trigger
 * 
 * HTTP endpoint for triggering journaling prompts.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

const logger = createLogger({ source: 'handler', app: 'journalist' });

/**
 * Create Journalist trigger handler
 * @param {import('../container.mjs').JournalistContainer} container
 * @returns {Function} Express handler
 */
export function journalistTriggerHandler(container) {
  return async (req, res) => {
    const traceId = req.traceId || 'unknown';

    try {
      // Extract chatId from query or body
      const chatId = req.query.chatId || req.body?.chatId;

      if (!chatId) {
        return res.status(400).json({ 
          ok: false, 
          error: 'chatId is required',
          traceId,
        });
      }

      // Get use case
      const useCase = container.getInitiateJournalPrompt();

      // Execute
      const result = await useCase.execute({ chatId });

      logger.info('trigger.sent', { traceId, chatId, messageId: result.messageId });

      res.json({
        ok: true,
        data: result,
        traceId,
      });
    } catch (error) {
      logger.error('trigger.error', { traceId, error: error.message });
      res.status(500).json({ 
        ok: false, 
        error: error.message,
        traceId,
      });
    }
  };
}

export default journalistTriggerHandler;
