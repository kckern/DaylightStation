/**
 * Idempotency Middleware
 * @module infrastructure/http/middleware/idempotency
 *
 * Prevents duplicate processing of webhooks.
 */

import { createLogger } from '#system/logging/logger.mjs';

const logger = createLogger({ source: 'middleware', app: 'http' });

/**
 * Create idempotency middleware
 * @param {Object} options
 * @param {number} [options.ttlMs=300000] - TTL in milliseconds (default 5 minutes)
 * @returns {Function} Express middleware
 */
export function idempotencyMiddleware(options = {}) {
  const { ttlMs = 300000, store } = options;
  if (!store?.checkAndRemember) throw new Error('idempotencyMiddleware requires a store');

  return (req, res, next) => {
    // Compute key from bot + messageId + callbackData
    const key = computeIdempotencyKey(req);

    if (!key) {
      // Can't compute key - let it through
      return next();
    }

    const result = store.checkAndRemember(key, { ttlMs, traceId: req.traceId });
    if (result.duplicate) {
      logger.debug('idempotency.duplicate', {
        key: result.key.slice(0, 16) + '...',
        ageMs: result.ageMs,
        traceId: req.traceId,
      });
      return res.status(200).json({ ok: true, skipped: true, reason: 'duplicate' });
    }

    next();
  };
}

/**
 * Compute idempotency key from request
 * @param {Object} req - Express request
 * @returns {string|null}
 */
function computeIdempotencyKey(req) {
  const body = req.body;
  if (!body) return null;

  const parts = [];

  // Bot identifier (from path or header)
  const botId = req.baseUrl || req.path || 'unknown';
  parts.push(botId);

  // Update ID (unique per Telegram update)
  if (body.update_id) {
    parts.push(`upd:${body.update_id}`);
  }

  // Message ID
  if (body.message?.message_id) {
    parts.push(`msg:${body.message.message_id}`);
  } else if (body.callback_query?.message?.message_id) {
    parts.push(`msg:${body.callback_query.message.message_id}`);
  }

  // Callback data (for callback queries)
  if (body.callback_query?.data) {
    parts.push(`cb:${body.callback_query.data}`);
  }

  // Callback ID
  if (body.callback_query?.id) {
    parts.push(`cbid:${body.callback_query.id}`);
  }

  if (parts.length < 2) {
    return null;
  }

  return parts;
}

export default idempotencyMiddleware;
