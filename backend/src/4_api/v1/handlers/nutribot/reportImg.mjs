/**
 * NutriBot Report Image Handler
 * @module nutribot/handlers/reportImg
 *
 * HTTP endpoint for report image.
 */

/**
 * Create NutriBot report image handler
 * @param {import('../../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {Object} [options.logger]
 * @returns {Function} Express handler
 */
export function nutribotReportImgHandler(container, options = {}) {
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

    // Get report data
    const reportUseCase = container.getGetReportAsJSON();
    const reportData = await reportUseCase.execute({
      userId: chatId,
      date,
    });

    logger.info?.('reportImg.data', { traceId, chatId, date, itemCount: reportData?.items?.length || 0 });

    // Generate image from report data using renderer if available
    const reportRenderer = container.getReportRenderer?.();
    let imageBuffer;

    if (reportRenderer?.renderDailyReport) {
      imageBuffer = await reportRenderer.renderDailyReport(reportData);
    } else {
      // Fallback: return a minimal placeholder PNG
      imageBuffer = generatePlaceholderPng();
    }

    logger.info?.('reportImg.generated', { traceId, chatId, date });

    // Set content type and send image
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(imageBuffer);
  };
}

/**
 * Generate a minimal valid placeholder PNG
 * @returns {Buffer}
 */
function generatePlaceholderPng() {
  // Create a 1x1 transparent PNG
  return Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR length
    0x49,
    0x48,
    0x44,
    0x52, // IHDR
    0x00,
    0x00,
    0x00,
    0x01, // width: 1
    0x00,
    0x00,
    0x00,
    0x01, // height: 1
    0x08,
    0x06, // bit depth: 8, color type: RGBA
    0x00,
    0x00,
    0x00, // compression, filter, interlace
    0x1f,
    0x15,
    0xc4,
    0x89, // CRC
    0x00,
    0x00,
    0x00,
    0x0a, // IDAT length
    0x49,
    0x44,
    0x41,
    0x54, // IDAT
    0x78,
    0x9c,
    0x63,
    0x00,
    0x01,
    0x00,
    0x00,
    0x05,
    0x00,
    0x01, // compressed data
    0x0d,
    0x0a,
    0x2d,
    0xb4, // CRC
    0x00,
    0x00,
    0x00,
    0x00, // IEND length
    0x49,
    0x45,
    0x4e,
    0x44, // IEND
    0xae,
    0x42,
    0x60,
    0x82, // CRC
  ]);
}

export default nutribotReportImgHandler;
