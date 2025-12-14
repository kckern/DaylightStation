/**
 * NutriBot Server/Router
 * @module nutribot/server
 * 
 * Express router for NutriBot endpoints.
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
import { nutribotWebhookHandler } from './handlers/webhook.mjs';
import { nutribotReportHandler } from './handlers/report.mjs';
import { nutribotReportImgHandler } from './handlers/reportImg.mjs';

/**
 * Create NutriBot Express Router
 * @param {import('./container.mjs').NutribotContainer} container
 * @returns {Router}
 */
export function createNutribotRouter(container) {
  const router = Router();

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint with validation and idempotency
  router.post(
    '/webhook',
    webhookValidationMiddleware('nutribot'),
    idempotencyMiddleware({ ttlMs: 300000 }),
    asyncHandler(nutribotWebhookHandler(container))
  );

  // Report endpoints (no webhook middleware needed)
  router.get('/report', asyncHandler(nutribotReportHandler(container)));
  router.get('/report.png', asyncHandler(nutribotReportImgHandler(container)));

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createNutribotRouter;
