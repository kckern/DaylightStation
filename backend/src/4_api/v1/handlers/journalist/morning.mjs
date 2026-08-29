import { sendInternalError } from '#api/utils/internalError.mjs';
/**
 * Morning Debrief Handler
 * @module api/handlers/journalist/morning
 *
 * Handles morning debrief trigger (from cron or manual API call)
 */

/**
 * Create morning debrief handler
 *
 * @param {Object} journalistApi - Semantic Journalist operations
 * @param {Object} [options] - Additional options
 * @param {Object} [options.logger] - Logger instance
 * @returns {Function} Express handler (req, res) => Promise<void>
 */
export function journalistMorningDebriefHandler(journalistApi, options = {}) {
  const { logger = console } = options;

  return async (req, res) => {
    const username = journalistApi.resolveUsername(req.query.user || null);
    const date = req.query.date || null;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'No username specified and no default user configured',
      });
    }

    logger.info?.('morning.handler.start', { username, date });

    const result = await journalistApi.morning({ requestedUsername: username, date });
    if (result.kind === 'conversation_not_found') {
      logger.error?.('morning.handler.no-conversation-id', { username });
      return sendInternalError(res, {
        success: false,
        error: 'Could not resolve conversation ID for user',
      });
    }

    logger.info?.('morning.handler.complete', {
      username,
      date: result.date,
      success: result.delivery.success,
      fallback: result.delivery.fallback,
    });

    return res.status(200).json({
      success: true,
      username,
      date: result.date,
      messageId: result.delivery.messageId,
      fallback: result.delivery.fallback,
    });
  };
}

export default journalistMorningDebriefHandler;
