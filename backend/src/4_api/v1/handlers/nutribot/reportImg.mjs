/**
 * NutriBot Report Image Handler
 * @module nutribot/handlers/reportImg
 *
 * HTTP endpoint for report image.
 */

/**
 * Create NutriBot report image handler
 * @param {Object} dailyReportImage
 * @param {Object} [options]
 * @param {Object} [options.logger]
 * @returns {Function} Express handler
 */
export function nutribotReportImgHandler(dailyReportImage, options = {}) {
  const logger = options.logger || console;

  return async (req, res) => {
    const traceId = req.traceId || 'unknown';

    // Extract chatId and date from query
    const chatId = req.query.chatId;
    const date = req.query.date;

    logger.info?.('reportImg.request', { chatId, date, traceId });

    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: 'chatId is required',
        traceId,
      });
    }

    const imageBuffer = await dailyReportImage.generate({
      userId: chatId,
      date,
      reportLoaded: (reportData) => {
        logger.info?.('reportImg.data', { traceId, chatId, date, itemCount: reportData?.items?.length || 0 });
      },
    });

    logger.info?.('reportImg.generated', { traceId, chatId, date });

    // Set content type and send image
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(imageBuffer);
  };
}

export default nutribotReportImgHandler;
