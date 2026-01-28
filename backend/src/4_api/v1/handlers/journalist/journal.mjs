/**
 * Journalist Journal Export Handler
 * @module api/handlers/journalist/journal
 *
 * HTTP endpoint for journal export.
 */

/**
 * Create Journalist journal handler
 * @param {import('../../../3_applications/journalist/JournalistContainer.mjs').JournalistContainer} container
 * @returns {Function} Express handler
 */
export function journalistJournalHandler(container) {
  return async (req, res) => {
    // Extract chatId from query or body
    const chatId = req.query.chatId || req.body?.chatId;
    const startDate = req.query.startDate || req.body?.startDate;

    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: 'chatId is required',
      });
    }

    // Get use case
    const useCase = container.getExportJournalMarkdown?.();

    if (!useCase) {
      return res.status(501).json({
        ok: false,
        error: 'Export not available',
      });
    }

    // Execute
    const markdown = await useCase.execute({ chatId, startDate });

    // Set content type and send
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="journal-${chatId}.md"`);
    res.send(markdown);
  };
}

export default journalistJournalHandler;
