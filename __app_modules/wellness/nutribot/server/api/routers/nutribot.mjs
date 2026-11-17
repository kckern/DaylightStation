/**
 * NutriBot API Router
 * @module nutribot/router
 *
 * Express router for NutriBot endpoints.
 * Provides Telegram webhook and direct API access.
 */

import express, { Router } from 'express';
import cors from 'cors';
import { nutribotReportHandler } from "../handlers/report.mjs";
import { nutribotReportImgHandler } from "../handlers/reportImg.mjs";
import { directUPCHandler, directImageHandler, directTextHandler } from "../handlers/directInput.mjs";

import {
  quickInputRoute, quickInputPreflight, isQuickInputRequest,
} from '../../../../../../__capabilities/quick-input/server/api.mjs';

// HTTP middleware
import {
  tracingMiddleware,
  errorHandlerMiddleware,
  asyncHandler,
} from '#system/http/middleware/index.mjs';
import { webhookValidationMiddleware } from "#api/v1/middleware/messagingWebhookValidation.mjs";
import { idempotencyMiddleware } from "#api/v1/middleware/messagingWebhookIdempotency.mjs";

/**
 * Create NutriBot Express Router
 * @param {Object} nutribotApi - Semantic direct-input and report service
 * @param {Object} [options]
 * @param {Function} [options.webhookHandler] - Pre-built Telegram webhook handler
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {{voice?: Object, text?: Object, photo?: Object}} [options.quickInput] - Quick-input endpoints by kind
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createNutribotRouter(nutribotApi, options = {}) {
  const router = Router();
  const { webhookHandler, dailyReportImage, botId, secretToken, idempotencyStore, quickInput = {}, logger = console } = options;

  // Apply middleware
  router.use(tracingMiddleware());
  // No requestLoggerMiddleware here any more: it is mounted globally on
  // /api/v1 in app.mjs, and a second mount would log every nutribot request
  // twice into a size-capped sink.

  // Webhook endpoint using pre-built handler
  if (webhookHandler) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('nutribot', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000, store: idempotencyStore }),
      webhookHandler,
    );
  } else {
    logger.warn?.('nutribot.webhook.disabled', { reason: 'No webhookHandler configured' });
  }

  // Quick-input intakes (the phone app): a recording at /voice, a typed meal
  // at /text, a photo at /photo. Raw bodies; each is the shared quick-input
  // route, which guards itself (origin, device binding, daily allowance) and
  // answers its own errors, and app.mjs keeps the app-wide CORS and body
  // parsers off these paths. Contract: the nutrition reference doc.
  for (const kind of ['voice', 'text', 'photo']) {
    if (!quickInput[kind]) continue;
    const route = { kind, logger, naming: { logContext: { bot: 'nutribot', kind } } };
    router.options(`/${kind}`, quickInputPreflight(route));
    router.post(
      `/${kind}`,
      // /text was here first, in another shape (see below). Only a request
      // that is a quick input takes this route; any other falls through.
      (req, res, next) => (isQuickInputRequest(req, kind) ? next() : next('route')),
      ...quickInputRoute(quickInput[kind], route),
    );
  }

  // Direct input endpoints (programmatic API access)
  const handlerOpts = { logger };
  router.all('/upc', asyncHandler(directUPCHandler(nutribotApi, handlerOpts)));
  router.all('/image', asyncHandler(directImageHandler(nutribotApi, handlerOpts)));
  // The earlier /text: `text` in a JSON body, a form or the query string. Its
  // path is kept off the app-wide CORS handler and body parsers for the
  // quick-input route above, so this route brings its own, with the same
  // settings the app uses everywhere else.
  router.all(
    '/text',
    cors(),
    express.json({ limit: '50mb' }),
    express.urlencoded({ limit: '50mb', extended: true }),
    asyncHandler(directTextHandler(nutribotApi, handlerOpts)),
  );

  // Pinhole endpoint - public access for IFTTT/external integrations
  // Uses same handler as /image, but with dedicated Cloudflare Access bypass
  router.all('/pinhole', asyncHandler(directImageHandler(nutribotApi, handlerOpts)));

  // Report endpoints
  router.get('/report', asyncHandler(nutribotReportHandler(nutribotApi, { logger })));
  router.get('/report.png', asyncHandler(nutribotReportImgHandler(dailyReportImage, { logger })));

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'nutribot' });
  });

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createNutribotRouter;
