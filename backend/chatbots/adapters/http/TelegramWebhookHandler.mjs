/**
 * Telegram Webhook Handler
 * @module adapters/http/TelegramWebhookHandler
 * 
 * Creates an Express-compatible request handler that:
 * 1. Parses Telegram webhook updates using TelegramInputAdapter
 * 2. Routes events through UnifiedEventRouter
 * 3. Handles errors gracefully (always returns 200 to Telegram)
 * 4. Provides comprehensive logging
 */

import { v4 as uuidv4 } from 'uuid';
import { TelegramInputAdapter } from '../telegram/TelegramInputAdapter.mjs';
import { UnifiedEventRouter } from '../../application/routing/UnifiedEventRouter.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';

/**
 * Create a Telegram webhook handler for a specific bot
 * 
 * @param {Object} container - NutribotContainer or similar DI container
 * @param {Object} config - Bot configuration
 * @param {string} config.botId - Telegram bot ID
 * @param {string} [config.botName] - Bot name for logging
 * @param {Object} [options] - Additional options
 * @param {Object} [options.logger] - Custom logger
 * @param {Object} [options.gateway] - TelegramGateway for callback acknowledgements
 * @param {Function} [options.RouterClass] - Custom router class (default: UnifiedEventRouter)
 * @returns {Function} Express request handler
 */
export function createTelegramWebhookHandler(container, config, options = {}) {
  if (!container) {
    throw new Error('container is required');
  }
  if (!config?.botId) {
    throw new Error('config.botId is required');
  }

  const botName = config.botName || 'telegram';
  const logger = options.logger || createLogger({ source: 'webhook', app: botName });
  
  // Allow custom router injection for different bots (Journalist, etc.)
  const RouterClass = options.RouterClass || UnifiedEventRouter;
  const router = new RouterClass(container, { logger });
  
  const gateway = options.gateway || null;

  /**
   * Express request handler
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  return async function telegramWebhookHandler(req, res) {
    const traceId = req.traceId || req.headers['x-trace-id'] || uuidv4();
    const startTime = Date.now();

    logger.info('webhook.received', {
      traceId,
      updateId: req.body?.update_id,
      hasMessage: !!req.body?.message,
      hasCallback: !!req.body?.callback_query,
    });

    try {
      // 1. Parse Telegram update into InputEvent
      const event = TelegramInputAdapter.parse(req.body, config);

      if (!event) {
        logger.debug('webhook.skipped', { traceId, reason: 'unsupported_update_type' });
        return res.status(200).json({ ok: true, skipped: true });
      }

      logger.info('webhook.event', {
        traceId,
        type: event.type,
        userId: event.userId,
        conversationId: event.conversationId,
      });

      // 2. Acknowledge callback queries immediately (Telegram requires fast response)
      if (event.type === 'callback' && gateway && req.body?.callback_query?.id) {
        try {
          await gateway.answerCallbackQuery(req.body.callback_query.id);
        } catch (ackError) {
          logger.warn('webhook.callbackAck.failed', { traceId, error: ackError.message });
        }
      }

      // 3. Route to appropriate use case
      const result = await router.route(event);

      // 4. Log success
      const duration = Date.now() - startTime;
      logger.info('webhook.completed', {
        traceId,
        duration,
        eventType: event.type,
        success: true,
      });

      // Always return 200 to Telegram
      return res.status(200).json({ ok: true });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('webhook.error', {
        traceId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      // Still return 200 to prevent Telegram retries
      // (we don't want Telegram to retry failed requests)
      return res.status(200).json({ 
        ok: true, 
        error: error.message,
        traceId,
      });
    }
  };
}

/**
 * Create a validation middleware for Telegram webhooks
 * Validates the request structure and optionally the secret token
 * 
 * @param {Object} [options] - Validation options
 * @param {string} [options.secretToken] - Telegram webhook secret token
 * @returns {Function} Express middleware
 */
export function createWebhookValidationMiddleware(options = {}) {
  const logger = createLogger({ source: 'webhook', app: 'validation' });

  return function webhookValidationMiddleware(req, res, next) {
    // Check secret token if configured
    if (options.secretToken) {
      const headerToken = req.headers['x-telegram-bot-api-secret-token'];
      if (headerToken !== options.secretToken) {
        logger.warn('webhook.validation.invalidToken', {
          hasToken: !!headerToken,
        });
        return res.status(401).json({ error: 'Invalid secret token' });
      }
    }

    // Validate basic structure
    if (!req.body || typeof req.body !== 'object') {
      logger.warn('webhook.validation.invalidBody');
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Must have update_id
    if (!req.body.update_id) {
      logger.warn('webhook.validation.missingUpdateId');
      return res.status(400).json({ error: 'Missing update_id' });
    }

    next();
  };
}

/**
 * Create an idempotency middleware to prevent duplicate processing
 * Uses a simple in-memory cache (for production, use Redis)
 * 
 * @param {Object} [options] - Options
 * @param {number} [options.ttlMs=300000] - Cache TTL in milliseconds (default: 5 minutes)
 * @param {Map} [options.cache] - Custom cache (for testing or Redis adapter)
 * @returns {Function} Express middleware
 */
export function createIdempotencyMiddleware(options = {}) {
  const ttlMs = options.ttlMs || 300000; // 5 minutes
  const cache = options.cache || new Map();
  const logger = createLogger({ source: 'webhook', app: 'idempotency' });

  // Cleanup old entries periodically
  if (!options.cache) {
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of cache.entries()) {
        if (now - timestamp > ttlMs) {
          cache.delete(key);
        }
      }
    }, ttlMs).unref();
  }

  return function idempotencyMiddleware(req, res, next) {
    const updateId = req.body?.update_id;
    if (!updateId) {
      return next();
    }

    const key = `update:${updateId}`;
    
    if (cache.has(key)) {
      logger.debug('webhook.idempotency.duplicate', { updateId });
      return res.status(200).json({ ok: true, duplicate: true });
    }

    cache.set(key, Date.now());
    next();
  };
}

/**
 * Wrap an async handler for Express error handling
 * @param {Function} fn - Async handler function
 * @returns {Function} Express handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default createTelegramWebhookHandler;
