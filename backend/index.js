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

import { resolveConfigPaths, getConfigFilePaths } from './_legacy/lib/config/pathResolver.mjs';
import { loadAllConfig } from './_legacy/lib/config/loader.mjs';
import { initConfigService as initLegacyConfigService, ConfigValidationError as LegacyConfigValidationError } from './_legacy/lib/config/index.mjs';
import { initConfigService as initNewConfigService, ConfigValidationError as NewConfigValidationError } from './src/0_infrastructure/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from './_legacy/lib/logging/config.js';
import { initializeLogging } from './_legacy/lib/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './_legacy/lib/logging/transports/index.js';
import { createLogger } from './_legacy/lib/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from './_legacy/lib/logging/config.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

async function main() {
  // ==========================================================================
  // Shared Configuration (runs once for both backends)
  // ==========================================================================

  const configPaths = resolveConfigPaths({ isDocker, codebaseDir: __dirname });
  if (configPaths.error) {
    console.error('[FATAL] Configuration error:', configPaths.error);
    process.exit(1);
  }

  console.log(`[Config] Source: ${configPaths.source}, Config: ${configPaths.configDir}`);

  const configFiles = getConfigFilePaths(configPaths.configDir);
  const configExists = configFiles && existsSync(configFiles.system);

  hydrateProcessEnvFromConfigs(configPaths.configDir);

  // Initialize both legacy and new ConfigService singletons
  // Both are needed during the migration period
  try {
    initLegacyConfigService(configPaths.dataDir);
    initNewConfigService(configPaths.dataDir);
    console.log('[Config] ConfigService initialized (legacy + new)');
  } catch (err) {
    if (err instanceof LegacyConfigValidationError || err instanceof NewConfigValidationError) {
      console.error('[FATAL] Config validation failed:', err.message);
      process.exit(1);
    }
    // Ignore "already initialized" errors - can happen if server.mjs was loaded first
    if (!err.message?.includes('already initialized')) {
      throw err;
    }
  }

  // Load full config into process.env
  if (configExists) {
    const configResult = loadAllConfig({
      configDir: configPaths.configDir,
      dataDir: configPaths.dataDir,
      isDocker,
      isDev: !isDocker
    });
    process.env = { ...process.env, isDocker, ...configResult.config };
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

  // In dev mode, use BACKEND_PORT (frontend/Vite uses PORT for user-facing port)
  // In production (Docker), use PORT directly
  const port = process.env.BACKEND_PORT || process.env.PORT || 3111;
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', {
      port,
      host: '0.0.0.0',
      mode: 'path-routing',
      message: 'Path-based routing: /api/v1/* -> new, everything else -> legacy'
    });
  });

  // ==========================================================================
  // Secondary API Server (port 3119) - for webhooks (always routes to legacy)
  // ==========================================================================

  const secondaryPort = process.env.SECONDARY_PORT || 3119;
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
