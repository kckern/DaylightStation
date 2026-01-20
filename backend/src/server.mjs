/**
 * DaylightStation Server Entry Point (New DDD Backend)
 * Standalone entry point for running new backend directly.
 * For toggle-based routing, use backend/index.js instead.
 */

import { existsSync } from 'fs';
import { createServer } from 'http';
import path, { join } from 'path';
import 'dotenv/config';

// Config imports (from _legacy since that's where they live)
import { resolveConfigPaths, getConfigFilePaths } from '../_legacy/lib/config/pathResolver.mjs';
import { loadAllConfig } from '../_legacy/lib/config/loader.mjs';
import { initConfigService, ConfigValidationError } from '../_legacy/lib/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from '../_legacy/lib/logging/config.js';

// Logging imports (use the new src/ logging)
import { initializeLogging } from './0_infrastructure/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './0_infrastructure/logging/transports/index.js';
import { createLogger } from './0_infrastructure/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from '../_legacy/lib/logging/config.js';

// App factory
import { createApp } from './app.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

async function main() {
  // ==========================================================================
  // Configuration
  // ==========================================================================

  const configPaths = resolveConfigPaths({ isDocker, codebaseDir: join(__dirname, '..', '..') });

  if (configPaths.error) {
    console.error('[FATAL] Configuration error:', configPaths.error);
    console.error('[FATAL] Set DAYLIGHT_CONFIG_PATH and DAYLIGHT_DATA_PATH environment variables');
    process.exit(1);
  }

  console.log(`[Config] Source: ${configPaths.source}, Config: ${configPaths.configDir}`);

  // Check for config files
  const configFiles = getConfigFilePaths(configPaths.configDir);
  const configExists = configFiles && existsSync(configFiles.system);

  // Hydrate process.env with config values (for logging)
  hydrateProcessEnvFromConfigs(configPaths.configDir);

  // Initialize ConfigService v2
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

  // Load full config into process.env (needed before logging setup)
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
  // Logging
  // ==========================================================================

  const loggingConfig = loadLoggingConfig();

  const dispatcher = initializeLogging({
    defaultLevel: resolveLoggerLevel('backend', loggingConfig),
    componentLevels: loggingConfig.loggers || {}
  });

  // Console transport
  dispatcher.addTransport(createConsoleTransport({
    colorize: !isDocker,
    format: isDocker ? 'json' : 'pretty'
  }));

  // File transport in development
  if (!isDocker) {
    dispatcher.addTransport(createFileTransport({
      filename: join(__dirname, '..', 'dev.log'),
      format: 'json',
      maxSize: 50 * 1024 * 1024,
      maxFiles: 3,
      colorize: false
    }));
    console.log('[Logging] File transport enabled: dev.log (max 50MB, 3 files)');
  }

  // Loggly transport if configured
  const logglyToken = resolveLogglyToken();
  const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
  if (logglyToken && logglySubdomain) {
    dispatcher.addTransport(createLogglyTransport({
      token: logglyToken,
      subdomain: logglySubdomain,
      tags: getLoggingTags(loggingConfig) || ['daylight', 'backend']
    }));
  }

  const logger = createLogger({
    source: 'backend',
    app: 'api',
    context: { env: process.env.NODE_ENV }
  });

  // ==========================================================================
  // Create HTTP Server and App
  // ==========================================================================

  const server = createServer();
  const app = await createApp({ server, logger, configPaths, configExists, enableScheduler: true });

  // Mount app on server
  server.on('request', app);

  // ==========================================================================
  // Start Server
  // ==========================================================================

  const port = process.env.PORT || 3112;
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', { port, host: '0.0.0.0', mode: 'standalone-new' });
  });
}

// Run the server
main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
