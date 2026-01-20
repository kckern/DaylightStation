/**
 * Legacy Backend Entry Point
 * Standalone entry point for running legacy backend directly.
 * For toggle-based routing, use backend/index.js instead.
 */

import express from 'express';
import { existsSync } from 'fs';
import { createServer } from 'http';
import path, { join } from 'path';
import cors from 'cors';
import 'dotenv/config';

// Config path resolver and loader
import { resolveConfigPaths, getConfigFilePaths } from './lib/config/pathResolver.mjs';
import { initConfigService, ConfigValidationError } from './lib/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from './lib/logging/config.js';

// Logging system
import { initializeLogging } from './lib/logging/dispatcher.js';
import { createConsoleTransport, createLogglyTransport, createFileTransport } from './lib/logging/transports/index.js';
import { createLogger } from './lib/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from './lib/logging/config.js';

// App factory
import { createApp } from './app.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

// =============================================================================
// Config Initialization
// =============================================================================

// Resolve config paths (from env vars, mount, or fallback)
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: join(__dirname, '..') });

if (configPaths.error) {
  console.error('[FATAL] Configuration error:', configPaths.error);
  console.error('[FATAL] Set DAYLIGHT_CONFIG_PATH and DAYLIGHT_DATA_PATH environment variables');
  process.exit(1);
}

console.log(`[Config] Source: ${configPaths.source}, Config: ${configPaths.configDir}`);

// Check for config files in resolved path
const configFiles = getConfigFilePaths(configPaths.configDir);
const configExists = configFiles && existsSync(configFiles.system);

// Load configuration from YAML files into process.env (for logging config)
hydrateProcessEnvFromConfigs(configPaths.configDir);

// Initialize ConfigService v2 (primary config system)
// Fails fast if config is invalid - this is intentional
try {
  initConfigService(configPaths.dataDir);
  console.log('[Config] ConfigService v2 initialized with dataDir:', configPaths.dataDir);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error('[FATAL] Config validation failed:');
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

// =============================================================================
// Logging Initialization
// =============================================================================

let loggingConfig = loadLoggingConfig();

// Initialize the new unified logging system
const dispatcher = initializeLogging({
  defaultLevel: resolveLoggerLevel('backend', loggingConfig),
  componentLevels: loggingConfig.loggers || {}
});

// Add console transport
dispatcher.addTransport(createConsoleTransport({
  colorize: !isDocker,
  format: isDocker ? 'json' : 'pretty'
}));

// Add file transport in development mode (with log rotation)
if (!isDocker) {
  dispatcher.addTransport(createFileTransport({
    filename: join(__dirname, '..', 'dev.log'),
    format: 'json', // JSON format for easier parsing
    maxSize: 50 * 1024 * 1024, // 50 MB before rotation
    maxFiles: 3, // Keep 3 rotated files (dev.log, dev.log.1, dev.log.2)
    colorize: false
  }));
  console.log('[Logging] File transport enabled: dev.log (max 50MB, 3 files)');
}

// Add Loggly transport if configured
const logglyToken = resolveLogglyToken();
const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
if (logglyToken && logglySubdomain) {
  dispatcher.addTransport(createLogglyTransport({
    token: logglyToken,
    subdomain: logglySubdomain,
    tags: getLoggingTags(loggingConfig) || ['daylight', 'backend']
  }));
}

// Create the root logger using the new system
const logger = createLogger({
  source: 'backend',
  app: 'api',
  context: { env: process.env.NODE_ENV }
});

// =============================================================================
// Main Application
// =============================================================================

async function main() {
  // Create HTTP server
  const server = createServer();

  // Create app using factory
  const app = await createApp({ server, logger, configPaths, configExists });

  // Mount app on server
  server.on('request', app);

  // Start server
  const port = process.env.PORT || 3112;
  const host = '0.0.0.0';
  server.listen(port, host, () => {
    logger.info('server.started', {
      port,
      host,
      mode: 'standalone-legacy',
      env: process.env.NODE_ENV || 'development',
      transports: dispatcher.getTransportNames()
    });
  });
}

main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});

// =============================================================================
// Secondary API App (port 3119)
// =============================================================================

const api_app = express();
api_app.use(cors());

async function initializeApiApp() {
  const { default: apiRouter } = await import('./api.mjs');

  api_app.use(express.json({
    limit: '50mb', // Increased limit for voice memo audio uploads
    strict: false // Allows parsing of JSON with single-quoted property names
  }));
  api_app.use(express.urlencoded({ limit: '50mb', extended: true }));
  api_app.use('', apiRouter);  // Mount at root - subdomain already indicates API

  api_app.listen(3119, () => {
    logger.info('api.secondary.listen', { port: 3119 });
  });
}

initializeApiApp().catch(err => logger.error('api.secondary.init.failure', { message: err?.message || err, stack: err?.stack }));
