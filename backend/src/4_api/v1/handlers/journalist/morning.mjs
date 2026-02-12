/**
 * Morning Debrief Handler
 * @module api/handlers/journalist/morning
 *
 * Handles morning debrief trigger (from cron or manual API call)
 */

/**
 * Create morning debrief handler
 *
 * @param {Object} container - Journalist container with dependencies
 * @param {Function} container.getGenerateMorningDebrief - Get GenerateMorningDebrief use case
 * @param {Function} container.getSendMorningDebrief - Get SendMorningDebrief use case
 * @param {Function} [container.getUserResolver] - Get UserResolver for username lookup
 * @param {Object} [options] - Additional options
 * @param {Object} [options.configService] - Config service for default user resolution
 * @param {Object} [options.logger] - Logger instance
 * @returns {Function} Express handler (req, res) => Promise<void>
 */
export function journalistMorningDebriefHandler(container, options = {}) {
  const { configService, telegramIdentityAdapter, logger = console } = options;

  return async (req, res) => {
    const username = req.query.user || configService?.getHeadOfHousehold?.() || 'kckern';
    const date = req.query.date || null;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'No username specified and no default user configured',
      });
    }

    logger.info?.('morning.handler.start', { username, date });

    // Step 1: Generate the debrief
    const generateMorningDebrief = container.getGenerateMorningDebrief();
    const debrief = await generateMorningDebrief.execute({
      username,
      date,
    });

    // Step 2: Resolve user's conversation ID
    const conversationId = resolveConversationId(telegramIdentityAdapter, username, logger);

    if (!conversationId) {
      logger.error?.('morning.handler.no-conversation-id', { username });
      return res.status(500).json({
        success: false,
        error: 'Could not resolve conversation ID for user',
      });
    }

    // Step 3: Send to Telegram
    const sendMorningDebrief = container.getSendMorningDebrief();
    const result = await sendMorningDebrief.execute({
      conversationId,
      debrief,
    });

    logger.info?.('morning.handler.complete', {
      username,
      date: debrief.date,
      success: result.success,
      fallback: result.fallback,
    });

    return res.status(200).json({
      success: true,
      username,
      date: debrief.date || date,
      messageId: result.messageId,
      fallback: result.fallback,
    });
  };
}

/**
 * Resolve username to Telegram conversation ID using TelegramIdentityAdapter
 */
function resolveConversationId(identityAdapter, username, logger) {
  if (!username) {
    logger.warn?.('journalist.morning.noUsername');
    return null;
  }

  try {
    const identity = identityAdapter.resolve('journalist', { username });
    return identity.conversationIdString;
  } catch (e) {
    logger.warn?.('journalist.morning.identityResolutionFailed', {
      username, error: e.message,
    });
    return null;
  }
}

export default journalistMorningDebriefHandler;
