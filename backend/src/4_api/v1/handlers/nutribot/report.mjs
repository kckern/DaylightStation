/**
 * NutriBot Report Handler
 * @module nutribot/handlers/report
 *
 * HTTP endpoint for JSON report.
 */

/**
 * Create NutriBot report handler
 * @param {import('../../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {Object} [options.logger]
 * @returns {Function} Express handler
 */
export function nutribotReportHandler(container, options = {}) {
  const logger = options.logger || console;

  return async (req, res) => {
    const traceId = req.traceId || 'unknown';

    // Extract chatId from query or body
    const chatId = req.query.chatId || req.body?.chatId;

    logger.info?.('report.request', { chatId, traceId });

    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: 'chatId is required',
        traceId,
      });
    }

    // Get use case
    const useCase = container.getGetReportAsJSON();

    // Execute
    const result = await useCase.execute({ userId: chatId });

    logger.info?.('report.generated', { traceId, chatId });

    res.json({
      ok: true,
      data: result,
      traceId,
    });
  };
}

export default nutribotReportHandler;
