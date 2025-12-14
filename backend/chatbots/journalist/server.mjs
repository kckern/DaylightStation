/**
 * Journalist Server/Router
 * @module journalist/server
 * 
 * Express router for Journalist endpoints.
 */

import { Router } from 'express';
import { 
  tracingMiddleware,
  webhookValidationMiddleware,
  idempotencyMiddleware,
  errorHandlerMiddleware,
  requestLoggerMiddleware,
  asyncHandler,
} from '../adapters/http/middleware/index.mjs';
import { journalistWebhookHandler } from './handlers/webhook.mjs';
import { journalistJournalHandler } from './handlers/journal.mjs';
import { journalistTriggerHandler } from './handlers/trigger.mjs';

/**
 * Create Journalist Express Router
 * @param {import('./container.mjs').JournalistContainer} container
 * @returns {Router}
 */
export function createJournalistRouter(container) {
  const router = Router();

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint with validation and idempotency
  router.post(
    '/webhook',
    webhookValidationMiddleware('journalist'),
    idempotencyMiddleware({ ttlMs: 300000 }),
    asyncHandler(journalistWebhookHandler(container))
  );

  // Journal export endpoint
  router.get('/journal', asyncHandler(journalistJournalHandler(container)));

  // Trigger endpoint
  router.get('/trigger', asyncHandler(journalistTriggerHandler(container)));

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createJournalistRouter;
