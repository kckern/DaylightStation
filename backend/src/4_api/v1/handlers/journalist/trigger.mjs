/**
 * Journalist Trigger Handler
 * @module api/handlers/journalist/trigger
 *
 * HTTP endpoint for triggering journaling prompts.
 */

/**
 * Create Journalist trigger handler
 * @param {import('../../../3_applications/journalist/JournalistContainer.mjs').JournalistContainer} container
 * @returns {Function} Express handler
 */
export function journalistTriggerHandler(container) {
  return async (req, res) => {
    // Extract chatId from query or body
    const chatId = req.query.chatId || req.body?.chatId;

    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: 'chatId is required',
      });
    }

    // Get use case
    const useCase = container.getInitiateJournalPrompt();

    // Execute
    const result = await useCase.execute({ chatId });

    res.json({
      ok: true,
      data: result,
    });
  };
}

export default journalistTriggerHandler;
