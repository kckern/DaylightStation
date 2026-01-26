// backend/index.js
/**
 * DaylightStation Backend Entry Point with Path-Based Routing
 *
 * Routes requests based on URL path:
 * - /api/v1/* -> new DDD backend (in src/)
 * - Everything else -> legacy backend (in _legacy/)
 *
 * New backend owns shared infrastructure: WebSocket/EventBus, MQTT, scheduler.
 * Legacy is a pure API compatibility layer.
 */

import { createServer } from 'http';
import { existsSync } from 'fs';
import path, { join } from 'path';
import 'dotenv/config';
import express from 'express';

import { initConfigService, ConfigValidationError, configService } from './src/0_system/config/index.mjs';
import { hydrateProcessEnvFromConfigs, loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from './src/0_system/logging/config.js';
import { initializeLogging } from './src/0_system/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './src/0_system/logging/transports/index.js';
import { createLogger } from './src/0_system/logging/logger.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

async function main() {
  // ==========================================================================
  // Shared Configuration (runs once for both backends)
  // ==========================================================================

  // Detect base directory from environment
  const baseDir = isDocker
    ? '/usr/src/app'
    : process.env.DAYLIGHT_BASE_PATH;

  if (!baseDir) {
    console.error('[Bootstrap] DAYLIGHT_BASE_PATH not set. Cannot start.');
    process.exit(1);
  }

  // Derive data directory from base (data and media are siblings)
  const dataDir = join(baseDir, 'data');

  // Derive config paths from data directory
  // Config lives inside data directory at system/
  const configDir = join(dataDir, 'system');
  const configPaths = { configDir, dataDir, source: isDocker ? 'docker' : 'env' };
  const configExists = existsSync(join(configDir, 'system.yml')) || existsSync(join(configDir, 'app.yml'));

  console.log(`[Bootstrap] Config source: ${configPaths.source}, dataDir: ${dataDir}`);

  // Hydrate process.env from config files (for logging config, etc.)
  hydrateProcessEnvFromConfigs(configDir);

  // Initialize ConfigService singleton (loads all YAML configs)
  try {
    initConfigService(dataDir);
    console.log(`[Bootstrap] ConfigService initialized from ${dataDir}`);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error('[Bootstrap] Config validation failed:', err.message);
      process.exit(1);
    }
    // Ignore "already initialized" errors - can happen if server.mjs was loaded first
    if (!err.message?.includes('already initialized')) {
      throw err;
    }
  }

  // ==========================================================================
  // Shared Logging (runs once for both backends)
  // ==========================================================================

  const loggingConfig = loadLoggingConfig();
  const dispatcher = initializeLogging({
    defaultLevel: resolveLoggerLevel('backend', loggingConfig),
    componentLevels: loggingConfig.loggers || {},
    timezone: configService.getTimezone()
  });

  dispatcher.addTransport(createConsoleTransport({
    colorize: !isDocker,
    format: isDocker ? 'json' : 'pretty'
  }));

  if (!isDocker) {
    dispatcher.addTransport(createFileTransport({
      filename: join(__dirname, '..', 'dev.log'),
      format: 'json',
      maxSize: 50 * 1024 * 1024,
      maxFiles: 3,
      colorize: false
    }));
  }

  const logglyToken = resolveLogglyToken();
  const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
  if (logglyToken && logglySubdomain) {
    dispatcher.addTransport(createLogglyTransport({
      token: logglyToken,
      subdomain: logglySubdomain,
      tags: getLoggingTags(loggingConfig)
    }));
  }

  const logger = createLogger({
    source: 'backend',
    app: 'router',
    context: { env: process.env.NODE_ENV }
  });

  // ==========================================================================
  // Create HTTP Server and Load Both Backends
  // ==========================================================================

  const server = createServer();

  logger.info('router.loading_backends', { message: 'Loading legacy and new backends...' });

  // Load new backend first (owns WebSocket/EventBus, MQTT, scheduler)
  const { createApp: createNewApp } = await import('./src/app.mjs');
  const newApp = await createNewApp({
    server,
    logger,
    configPaths,
    configExists
    // enableScheduler: true (default)
    // enableMqtt: true (default)
  });
  logger.info('router.new_loaded', { message: 'New backend loaded (owns infrastructure)' });

  // Load legacy backend (pure API layer - infrastructure disabled)
  const { createApp: createLegacyApp } = await import('./_legacy/app.mjs');
  const legacyApp = await createLegacyApp({
    server,
    logger,
    configPaths,
    configExists,
    enableWebSocket: false,
    enableScheduler: false
  });
  logger.info('router.legacy_loaded', { message: 'Legacy backend loaded (API layer only)' });

  // ==========================================================================
  // Request Routing (path-based)
  // ==========================================================================

  // Helper function for health responses
  const sendHealthResponse = (res, serverName) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      server: serverName,
      timestamp: Date.now(),
      uptime: process.uptime()
    }));
  };

  server.on('request', (req, res) => {
    // Root health check - bypasses ALL routing (always works)
    if (req.url === '/health' || req.url === '/api/v1/health' || req.url === '/api/v1/health/live') {
      return sendHealthResponse(res, 'main');
    }

    // Add header to indicate which backend served the request
    res.setHeader('X-Backend', req.url.startsWith('/api/v1') ? 'new' : 'legacy');

    if (req.url.startsWith('/api/v1')) {
      // Strip /api/v1 prefix before passing to new app
      req.url = req.url.replace('/api/v1', '') || '/';
      return newApp(req, res, (err) => {
        if (err && !res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });
    }

    // Everything else -> legacy
    return legacyApp(req, res, (err) => {
      if (err && !res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });
  });

  // ==========================================================================
  // Start Server
  // ==========================================================================

  // Get port from ConfigService
  // In prod (Docker): backend serves everything on app.port
  // In dev: Vite serves on app.port, backend hides on app.port + 1
  const appPort = configService.getAppPort();
  const port = isDocker ? appPort : appPort + 1;
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', {
      port,
      appPort,
      host: '0.0.0.0',
      mode: isDocker ? 'production' : 'development',
      message: isDocker
        ? 'Production: backend serves static + API'
        : `Development: backend on ${port}, Vite expected on ${appPort}`
    });
  });

  // ==========================================================================
  // Secondary Webhook Server (port 3119) - with DevProxy for debugging
  // ==========================================================================
  // Telegram webhooks are routed here. DevProxy can intercept and forward
  // to local dev machine when enabled.

  const secondaryPort = configService.getWebhookPort();
  
  // Create devProxy - only for webhook server
  const { createDevProxy } = await import('./src/0_system/http/middleware/devProxy.mjs');
  const devHost = configService.get('LOCAL_DEV_HOST') || configService.getSecret('LOCAL_DEV_HOST');
  const devProxy = createDevProxy({ logger, devHost });
  
  // Create Express app for webhook server to properly use router/middleware
  const webhookApp = express();
  webhookApp.use(express.json());
  webhookApp.use(express.urlencoded({ extended: true }));
  
  // Health check handlers - FIRST middleware (always works)
  webhookApp.get('/health', (req, res) => {
    res.json({
      ok: true,
      server: 'webhook',
      timestamp: Date.now(),
      uptime: process.uptime()
    });
  });
  webhookApp.get('/api/v1/health', (req, res) => {
    res.json({
      ok: true,
      server: 'webhook',
      timestamp: Date.now(),
      uptime: process.uptime()
    });
  });
  webhookApp.get('/api/v1/health/live', (req, res) => {
    res.json({ status: 'ok' });
  });
  
  // Mount devProxy router at /api/v1/dev (for status check on webhook port)
  webhookApp.use('/api/v1/dev', devProxy.router);
  
  // Apply devProxy middleware (checks if proxy is enabled and forwards if so)
  webhookApp.use(devProxy.middleware);
  
  // Route requests normally when proxy is disabled
  webhookApp.use((req, res, next) => {
    res.setHeader('X-Backend', req.url.startsWith('/api/v1') ? 'new' : 'legacy');

    if (req.url.startsWith('/api/v1')) {
      req.url = req.url.replace('/api/v1', '') || '/';
      return newApp(req, res, next);
    }

    return legacyApp(req, res, next);
  });

  const secondaryServer = createServer(webhookApp);
  secondaryServer.listen(secondaryPort, '0.0.0.0', () => {
    logger.info('server.webhook.started', {
      port: secondaryPort,
      host: '0.0.0.0',
      purpose: 'webhooks (Telegram)',
      devProxyEnabled: devProxy.getState().proxyEnabled,
      devProxyTarget: devHost || 'not configured'
    });
  });
}

main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
