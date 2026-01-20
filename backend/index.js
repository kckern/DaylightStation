// backend/index.js
/**
 * DaylightStation Backend Entry Point with Toggle
 *
 * Provides runtime toggle between legacy and new backends via /api/toggle_backend.
 * Defaults to 'legacy' on every restart for safety.
 */

import express from 'express';
import { createServer } from 'http';
import { existsSync } from 'fs';
import path, { join } from 'path';
import 'dotenv/config';

import { resolveConfigPaths, getConfigFilePaths } from './_legacy/lib/config/pathResolver.mjs';
import { loadAllConfig } from './_legacy/lib/config/loader.mjs';
import { initConfigService, ConfigValidationError } from './_legacy/lib/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from './_legacy/lib/logging/config.js';
import { initializeLogging } from './_legacy/lib/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './_legacy/lib/logging/transports/index.js';
import { createLogger } from './_legacy/lib/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from './_legacy/lib/logging/config.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

// Toggle state - defaults to legacy, resets on restart
let activeBackend = 'legacy';

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

  try {
    initConfigService(configPaths.dataDir);
    console.log('[Config] ConfigService initialized');
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error('[FATAL] Config validation failed:', err.message);
      process.exit(1);
    }
    throw err;
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
    app: 'toggle',
    context: { env: process.env.NODE_ENV }
  });

  // ==========================================================================
  // Create HTTP Server and Load Both Backends
  // ==========================================================================

  const server = createServer();

  logger.info('toggle.loading_backends', { message: 'Loading legacy and new backends...' });

  // Load legacy backend (scheduler runs here)
  const { createApp: createLegacyApp } = await import('./_legacy/app.mjs');
  const legacyApp = await createLegacyApp({ server, logger, configPaths, configExists });
  logger.info('toggle.legacy_loaded', { message: 'Legacy backend loaded' });

  // Load new backend (scheduler disabled - legacy handles it)
  const { createApp: createNewApp } = await import('./src/app.mjs');
  const newApp = await createNewApp({ server, logger, configPaths, configExists, enableScheduler: false });
  logger.info('toggle.new_loaded', { message: 'New backend loaded (scheduler disabled)' });

  // ==========================================================================
  // Toggle Router
  // ==========================================================================

  const toggleRouter = express.Router();
  toggleRouter.use(express.json());

  // GET /api/toggle_backend - Get current state
  toggleRouter.get('/api/toggle_backend', (req, res) => {
    res.json({ active: activeBackend });
  });

  // POST /api/toggle_backend - Switch backend
  toggleRouter.post('/api/toggle_backend', (req, res) => {
    const { target } = req.body;
    if (target !== 'legacy' && target !== 'new') {
      return res.status(400).json({ error: 'target must be "legacy" or "new"' });
    }
    const previous = activeBackend;
    activeBackend = target;
    logger.info('toggle.switched', { from: previous, to: target });
    res.json({ active: activeBackend, switched: true, previous });
  });

  // ==========================================================================
  // Request Routing
  // ==========================================================================

  server.on('request', (req, res) => {
    // Add header to indicate which backend served the request
    res.setHeader('X-Backend', activeBackend);

    // Handle toggle endpoint first (before routing to backends)
    if (req.url === '/api/toggle_backend' || req.url.startsWith('/api/toggle_backend?')) {
      return toggleRouter(req, res);
    }

    // Route to active backend
    const targetApp = activeBackend === 'legacy' ? legacyApp : newApp;
    targetApp(req, res);
  });

  // ==========================================================================
  // Start Server
  // ==========================================================================

  const port = process.env.PORT || 3112;
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', {
      port,
      host: '0.0.0.0',
      mode: 'toggle',
      active: activeBackend,
      message: `Toggle active: ${activeBackend}. Use POST /api/toggle_backend to switch.`
    });
  });
}

main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
