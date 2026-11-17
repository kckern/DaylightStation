/**
 * NutriBot API Router
 * @module nutribot/router
 *
 * Express router for NutriBot endpoints.
 * Provides Telegram webhook and direct API access.
 */

import express, { Router } from 'express';
import { nutribotReportHandler } from "../handlers/report.mjs";
import { nutribotReportImgHandler } from "../handlers/reportImg.mjs";
import { directUPCHandler, directImageHandler, directTextHandler } from "../handlers/directInput.mjs";
import { directInputGuard, DIRECT_INPUT_MAX_BYTES } from "../handlers/directInputGuard.mjs";

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
 * @param {Object} [options.directInput] - Who may use the direct-input routes (NutribotDirectInput).
 *   Left out, those routes refuse every request.
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createNutribotRouter(nutribotApi, options = {}) {
  const router = Router();
  const { webhookHandler, dailyReportImage, botId, secretToken, idempotencyStore, quickInput = {}, directInput = null, logger = console } = options;

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
      // /text was here first, in another shape (see below): a JSON or form
      // body falls through to it. /voice and /photo have no earlier shape.
      (req, res, next) => (kind !== 'text' || isQuickInputRequest(req, kind) ? next() : next('route')),
      ...quickInputRoute(quickInput[kind], route),
    );
  }

  // Direct input endpoints (programmatic API access): a barcode, an image
  // address, or `text` in a JSON body, a form or the query string, by any
  // method. They log food and can call paid models, so each sits behind the
  // direct-input guard: no request from another web origin or site, a caller
  // that is a bound device, a signed-in user of the app, or (only where the
  // household has opened the route) anyone, and the user's daily allowance.
  // app.mjs keeps the app-wide CORS handler and body parsers off these paths,
  // so the guard's first check runs before a body is read and each route
  // brings its own small parsers.
  const handlerOpts = { logger };
  const directHandlers = {
    upc: directUPCHandler(nutribotApi, handlerOpts),
    image: directImageHandler(nutribotApi, handlerOpts),
    text: directTextHandler(nutribotApi, handlerOpts),
    // Pinhole endpoint - public access for IFTTT/external integrations.
    // Uses same handler as /image, but with dedicated Cloudflare Access bypass.
    pinhole: directImageHandler(nutribotApi, handlerOpts),
  };
  for (const [route, handler] of Object.entries(directHandlers)) {
    const guard = directInputGuard(directInput, { route, logger });
    router.options(`/${route}`, guard.preflight);
    router.all(
      `/${route}`,
      guard.before,
      express.json({ limit: DIRECT_INPUT_MAX_BYTES }),
      express.urlencoded({ limit: DIRECT_INPUT_MAX_BYTES, extended: true }),
      guard.after,
      asyncHandler(handler),
    );
  }

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
