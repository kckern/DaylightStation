/**
 * Webhook Server
 *
 * Separate Express server for handling external webhooks.
 * Runs on port 3119 for security isolation from the main app.
 *
 * Handles:
 * - Telegram webhooks for Nutribot
 * - Telegram webhooks for Journalist
 *
 * @module webhook-server
 */

import express from 'express';
import cors from 'cors';
import { nowTs } from '../0_infrastructure/utils/index.mjs';
import { createDevProxy } from '../0_infrastructure/http/middleware/devProxy.mjs';

/**
 * Create the webhook server
 * @param {Object} config
 * @param {Object} config.nutribotContainer - NutribotContainer instance
 * @param {Object} config.journalistContainer - JournalistContainer instance
 * @param {string} [config.devHost] - Dev host for proxy forwarding
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Application}
 */
export function createWebhookServer(config) {
  const {
    nutribotContainer,
    journalistContainer,
    devHost,
    logger = console
  } = config;

  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Dev proxy for forwarding webhooks to dev server
  const devProxy = createDevProxy({ logger, devHost });
  app.use('/dev', devProxy.router);  // Toggle at /dev/proxy_toggle
  app.use(devProxy.middleware);      // Intercepts all requests when enabled
  logger.info?.('webhook.devProxy.initialized', { endpoint: '/dev/proxy_toggle', devHost: devHost || 'not configured' });

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      server: 'webhook',
      timestamp: nowTs(),
      devProxy: devProxy.getState()
    });
  });

  // Nutribot webhook
  if (nutribotContainer) {
    app.post('/api/foodlog/webhook', async (req, res) => {
      try {
        const result = await nutribotContainer.handleWebhook(req.body);
        res.json(result || { ok: true });
      } catch (error) {
        logger.error?.('webhook.nutribot.error', { error: error.message });
        res.status(500).json({ error: 'Webhook processing failed' });
      }
    });

    logger.info?.('webhook.nutribot.mounted', { path: '/api/foodlog/webhook' });
  }

  // Journalist webhook
  if (journalistContainer) {
    app.post('/api/journalist/webhook', async (req, res) => {
      try {
        const result = await journalistContainer.handleWebhook(req.body);
        res.json(result || { ok: true });
      } catch (error) {
        logger.error?.('webhook.journalist.error', { error: error.message });
        res.status(500).json({ error: 'Webhook processing failed' });
      }
    });

    logger.info?.('webhook.journalist.mounted', { path: '/api/journalist/webhook' });
  }

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      message: 'This webhook endpoint does not exist'
    });
  });

  return app;
}

/**
 * Start the webhook server
 * @param {express.Application} app - Express app from createWebhookServer
 * @param {Object} [options]
 * @param {number} [options.port=3119] - Port to listen on
 * @param {string} [options.host='0.0.0.0'] - Host to bind to
 * @param {Object} [options.logger] - Logger instance
 * @returns {Promise<http.Server>}
 */
export function startWebhookServer(app, options = {}) {
  const {
    port = 3119,
    host = '0.0.0.0',
    logger = console
  } = options;

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      logger.info?.('webhook.server.started', { port, host });
      resolve(server);
    });

    server.on('error', (error) => {
      logger.error?.('webhook.server.error', { error: error.message });
      reject(error);
    });
  });
}

export default { createWebhookServer, startWebhookServer };
