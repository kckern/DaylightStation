/**
 * Direct Input Handlers
 * @module nutribot/handlers/directInput
 *
 * Express handlers for direct API inputs (UPC, image URL, text).
 * These bypass Telegram and allow programmatic food logging.
 */

import { nowTs } from '#system/utils/index.mjs';

/**
 * Resolve user identity for direct API calls using TelegramIdentityAdapter
 * @param {Object} options
 * @param {import('#adapters/messaging/TelegramIdentityAdapter.mjs').TelegramIdentityAdapter} options.identityAdapter
 * @param {Object} options.body - Request body
 * @param {Object} [options.query] - Request query params
 * @returns {{ userId: string, conversationId: string }}
 */
function resolveUserContext({ identityAdapter, body, query = {}, defaultMember }) {
  const user = body.user || query.user || defaultMember;
  if (!user) throw new Error('Missing required parameter: user');

  const identity = identityAdapter.resolve('nutribot', { username: user });

  return {
    userId: identity.username || user,
    conversationId: identity.conversationIdString,
  };
}

/**
 * Create direct UPC handler
 * @param {import('../../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {Object} [options.logger]
 * @returns {Function} Express handler
 */
export function directUPCHandler(container, options = {}) {
  const logger = options.logger || console;
  const identityAdapter = options.identityAdapter;
  const defaultMember = options.defaultMember;

  return async (req, res) => {
    const traceId = req.traceId || 'direct-upc';
    const startTime = Date.now();

    // Get UPC from body or query
    const upc = req.body?.upc || req.query?.upc;

    if (!upc) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required parameter: upc',
      });
    }

    // Clean UPC (remove dashes)
    const cleanUPC = String(upc).replace(/-/g, '');

    // Validate UPC format (8-14 digits)
    if (!/^\d{8,14}$/.test(cleanUPC)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid UPC format. Expected 8-14 digits.',
      });
    }

    const { userId, conversationId } = resolveUserContext({ identityAdapter, body: req.body, query: req.query, defaultMember });

    logger.info?.('direct.upc.received', {
      traceId,
      upc: cleanUPC,
      userId,
      conversationId,
    });

    // Call use case
    const useCase = container.getLogFoodFromUPC();
    const result = await useCase.execute({
      userId,
      conversationId,
      upc: cleanUPC,
      messageId: null, // No Telegram message
    });

    const duration = Date.now() - startTime;
    logger.info?.('direct.upc.processed', { traceId, durationMs: duration, success: result?.success });

    res.status(200).json({
      ok: true,
      result,
      durationMs: duration,
    });
  };
}

/**
 * Create direct image URL handler
 * @param {import('../../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {Object} [options.logger]
 * @returns {Function} Express handler
 */
export function directImageHandler(container, options = {}) {
  const logger = options.logger || console;
  const identityAdapter = options.identityAdapter;
  const defaultMember = options.defaultMember;

  return async (req, res) => {
    const traceId = req.traceId || 'direct-image';
    const startTime = Date.now();

    // Get image URL from body or query
    const imgUrl = req.body?.img_url || req.query?.img_url;

    // Enhanced logging for public API security monitoring
    const requestMetadata = {
      traceId,
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'],
      method: req.method,
      timestamp: nowTs(),
    };

    if (!imgUrl) {
      logger.warn?.('direct.image.missing_url', requestMetadata);
      return res.status(400).json({
        ok: false,
        error: 'Missing required parameter: img_url',
      });
    }

    // Basic URL validation
    try {
      new URL(imgUrl);
    } catch {
      logger.warn?.('direct.image.invalid_url', { ...requestMetadata, imgUrl: imgUrl.substring(0, 100) });
      return res.status(400).json({
        ok: false,
        error: 'Invalid img_url format',
      });
    }

    const { userId, conversationId } = resolveUserContext({ identityAdapter, body: req.body, query: req.query, defaultMember });

    logger.info?.('direct.image.received', {
      ...requestMetadata,
      imgUrl: imgUrl.substring(0, 100) + '...', // Truncate for logging
      imgDomain: new URL(imgUrl).hostname,
      userId,
      conversationId,
    });

    // Call use case
    const useCase = container.getLogFoodFromImage();
    const result = await useCase.execute({
      userId,
      conversationId,
      imageData: { url: imgUrl },
      messageId: null, // No Telegram message
    });

    const duration = Date.now() - startTime;
    logger.info?.('direct.image.processed', {
      traceId,
      ip: requestMetadata.ip,
      userAgent: requestMetadata.userAgent,
      imgDomain: new URL(imgUrl).hostname,
      durationMs: duration,
      success: result?.success,
      itemsLogged: result?.items?.length || 0,
    });

    res.status(200).json({
      ok: true,
      result,
      durationMs: duration,
    });
  };
}

/**
 * Create direct text handler
 * @param {import('../../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {Object} [options.logger]
 * @returns {Function} Express handler
 */
export function directTextHandler(container, options = {}) {
  const logger = options.logger || console;
  const identityAdapter = options.identityAdapter;
  const defaultMember = options.defaultMember;

  return async (req, res) => {
    const traceId = req.traceId || 'direct-text';
    const startTime = Date.now();

    // Get text from body or query
    const text = req.body?.text || req.query?.text;

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required parameter: text',
      });
    }

    const { userId, conversationId } = resolveUserContext({ identityAdapter, body: req.body, query: req.query, defaultMember });

    logger.info?.('direct.text.received', {
      traceId,
      textLength: text.length,
      userId,
      conversationId,
    });

    // Call use case
    const useCase = container.getLogFoodFromText();
    const result = await useCase.execute({
      userId,
      conversationId,
      text,
      messageId: null, // No Telegram message
    });

    const duration = Date.now() - startTime;
    logger.info?.('direct.text.processed', { traceId, durationMs: duration, success: result?.success });

    res.status(200).json({
      ok: true,
      result,
      durationMs: duration,
    });
  };
}

export default {
  directUPCHandler,
  directImageHandler,
  directTextHandler,
};
