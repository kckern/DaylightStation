/**
 * Idempotency Middleware
 * @module infrastructure/http/middleware/idempotency
 *
 * Prevents duplicate processing of webhooks.
 */

import crypto from 'crypto';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger({ source: 'middleware', app: 'http' });

// In-memory store for idempotency keys
const idempotencyStore = new Map();

// Cleanup interval reference
let cleanupInterval = null;

/**
 * Create idempotency middleware
 * @param {Object} options
 * @param {number} [options.ttlMs=300000] - TTL in milliseconds (default 5 minutes)
 * @returns {Function} Express middleware
 */
export function idempotencyMiddleware(options = {}) {
  const { ttlMs = 300000 } = options;

  // Start cleanup interval if not already running
  if (!cleanupInterval) {
    cleanupInterval = setInterval(() => {
      cleanupExpiredKeys(ttlMs);
    }, ttlMs / 2);

    // Don't prevent process exit
    cleanupInterval.unref();
  }

  return (req, res, next) => {
    // Compute key from bot + messageId + callbackData
    const key = computeIdempotencyKey(req);

    if (!key) {
      // Can't compute key - let it through
      return next();
    }

    // Check in store
    if (idempotencyStore.has(key)) {
      const entry = idempotencyStore.get(key);
      const age = Date.now() - entry.timestamp;

      if (age < ttlMs) {
        logger.debug('idempotency.duplicate', {
          key: key.slice(0, 16) + '...',
          ageMs: age,
          traceId: req.traceId,
        });
        // Return 200 immediately
        return res.status(200).json({ ok: true, skipped: true, reason: 'duplicate' });
      }
    }

    // Store key with timestamp
    idempotencyStore.set(key, { timestamp: Date.now(), traceId: req.traceId });

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

  // Hash for consistent length
  const hash = crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex');

  return hash;
}

/**
 * Clean up expired keys
 * @param {number} ttlMs
 */
function cleanupExpiredKeys(ttlMs) {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of idempotencyStore) {
    if (now - entry.timestamp > ttlMs) {
      idempotencyStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug('idempotency.cleanup', { cleaned, remaining: idempotencyStore.size });
  }
}

/**
 * Clear store (for testing)
 */
export function clearIdempotencyStore() {
  idempotencyStore.clear();
}

/**
 * Get store size (for testing)
 */
export function getIdempotencyStoreSize() {
  return idempotencyStore.size;
}

export default idempotencyMiddleware;
