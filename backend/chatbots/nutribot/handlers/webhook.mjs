/**
 * NutriBot Webhook Handler
 * @module nutribot/handlers/webhook
 * 
 * Express handler for NutriBot webhooks.
 */

import { createLogger } from '../../_lib/logging/index.mjs';
import { NutribotEventRouter } from '../adapters/EventRouter.mjs';

const logger = createLogger({ source: 'handler', app: 'nutribot' });

/**
 * Create NutriBot webhook handler
 * @param {import('../container.mjs').NutribotContainer} container
 * @returns {Function} Express handler
 */
export function nutribotWebhookHandler(container) {
  const router = new NutribotEventRouter(container);

  return async (req, res) => {
    const traceId = req.traceId || 'unknown';
    const startTime = Date.now();

    try {
      // Extract event from body
      const event = req.body;

      logger.debug('webhook.received', { 
        traceId, 
        updateId: event.update_id,
        type: req.webhookType,
      });

      // Route event
      await router.route(event);

      const duration = Date.now() - startTime;
      logger.info('webhook.processed', { traceId, durationMs: duration });

      // Always return 200 for Telegram
      res.status(200).json({ ok: true });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('webhook.error', { 
        traceId, 
        error: error.message, 
        durationMs: duration,
      });

      // Still return 200 to prevent Telegram retries
      res.status(200).json({ ok: true, error: error.message });
    }
  };
}

export default nutribotWebhookHandler;
