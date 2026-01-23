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

import { initConfigService, ConfigValidationError, configService } from './src/0_infrastructure/config/index.mjs';
import { hydrateProcessEnvFromConfigs, loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from './src/0_infrastructure/logging/config.js';
import { initializeLogging } from './src/0_infrastructure/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './src/0_infrastructure/logging/transports/index.js';
import { createLogger } from './src/0_infrastructure/logging/logger.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

async function main() {
  // ==========================================================================
  // Shared Configuration (runs once for both backends)
  // ==========================================================================

  // Detect data directory from environment
  const dataDir = isDocker
    ? '/usr/src/app/data'
    : process.env.DAYLIGHT_DATA_PATH;

  if (!dataDir) {
    console.error('[Bootstrap] DAYLIGHT_DATA_PATH not set. Cannot start.');
    process.exit(1);
  }

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
    componentLevels: loggingConfig.loggers || {}
  });

  dispatcher.addTransport(createConsoleTransport({
    colorize: !isDocker,
    format: isDocker ? 'json' : 'pretty'
  }));

  if (!isDocker) {
    dispatcher.addTransport(createFileTransport({
      filename: join(__dirname, 'dev.log'),
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

  server.on('request', (req, res) => {
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

  // Get port from ConfigService (loaded from system-local.{env}.yml)
  // BACKEND_PORT for dev (avoids conflict with Docker), PORT for production
  const port = configService.get('BACKEND_PORT') || configService.get('PORT') || 3111;
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', {
      port,
      host: '0.0.0.0',
      mode: 'path-routing',
      message: 'Path-based routing: /api/v1/* -> new, everything else -> legacy'
    });
  });

  // ==========================================================================
  // Secondary API Server - for webhooks (always routes to legacy)
  // ==========================================================================

  const secondaryPort = configService.get('SECONDARY_PORT') || 3119;
  const secondaryServer = createServer((req, res) => {
    res.setHeader('X-Backend', 'legacy');

    // Webhooks always go to legacy
    legacyApp(req, res, (err) => {
      if (err && !res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });
  });

  secondaryServer.listen(secondaryPort, '0.0.0.0', () => {
    logger.info('server.secondary.started', {
      port: secondaryPort,
      host: '0.0.0.0',
      mode: 'legacy-only',
      purpose: 'webhooks'
    });
  });
}

main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
