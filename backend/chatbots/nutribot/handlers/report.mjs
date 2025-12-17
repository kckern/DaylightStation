/**
 * NutriBot Report Handler
 * @module nutribot/handlers/report
 * 
 * HTTP endpoint for JSON report.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

const logger = createLogger({ source: 'handler', app: 'nutribot' });

/**
 * Create NutriBot report handler
 * @param {import('../container.mjs').NutribotContainer} container
 * @returns {Function} Express handler
 */
export function nutribotReportHandler(container) {
  return async (req, res) => {
    const traceId = req.traceId || 'unknown';

    try {
      // Extract chatId from query or body
      const chatId = req.query.chatId || req.body?.chatId;

      logger.info('report.request', { chatId, traceId });

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

      logger.info('report.generated', { traceId, chatId });

      res.json({
        ok: true,
        data: result,
        traceId,
      });
    } catch (error) {
      logger.error('report.error', { traceId, error: error.message });
      res.status(500).json({ 
        ok: false, 
        error: error.message,
        traceId,
      });
    }
  };
}

export default nutribotReportHandler;
