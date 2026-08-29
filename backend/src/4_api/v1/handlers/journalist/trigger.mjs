/**
 * Journalist Trigger Handler
 * @module api/handlers/journalist/trigger
 *
 * HTTP endpoint for triggering journaling prompts.
 */

/**
 * Create Journalist trigger handler
 * @param {Object} journalistApi
 * @returns {Function} Express handler
 */
export function journalistTriggerHandler(journalistApi) {
  return async (req, res) => {
    // Extract chatId from query or body
    const chatId = req.query.chatId || req.body?.chatId;

    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: 'chatId is required',
      });
    }

    const result = await journalistApi.trigger({ chatId });

    res.json({
      ok: true,
      data: result,
    });
  };
}

export default journalistTriggerHandler;
