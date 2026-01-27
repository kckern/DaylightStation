// backend/index.js
/**
 * DaylightStation Backend Entry Point
 *
 * Routes all requests to the DDD backend (in src/).
 */

import { createServer } from 'http';
import { existsSync } from 'fs';
import path, { join } from 'path';
import 'dotenv/config';

import { initConfigService, ConfigValidationError, configService } from './src/0_system/config/index.mjs';
import { hydrateProcessEnvFromConfigs, loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from './src/0_system/logging/config.mjs';
import { initializeLogging } from './src/0_system/logging/dispatcher.mjs';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './src/0_system/logging/transports/index.mjs';
import { createLogger } from './src/0_system/logging/logger.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

async function main() {
  // ==========================================================================
  // Configuration
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
  // Logging
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
  // Create HTTP Server and Load Backend
  // ==========================================================================

  const server = createServer();

  logger.info('router.loading_backend', { message: 'Loading DDD backend...' });

  const { createApp } = await import('./src/app.mjs');
  const app = await createApp({
    server,
    logger,
    configPaths,
    configExists
  });
  logger.info('router.backend_loaded', { message: 'DDD backend loaded' });

  // ==========================================================================
  // Request Routing
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

    // Strip /api/v1 prefix if present
    if (req.url.startsWith('/api/v1')) {
      req.url = req.url.replace('/api/v1', '') || '/';
    }

    return app(req, res, (err) => {
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
}

main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
