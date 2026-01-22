/**
 * DaylightStation Server Entry Point (New DDD Backend)
 * Standalone entry point for running new backend directly.
 * For toggle-based routing, use backend/index.js instead.
 */

import { existsSync } from 'fs';
import { createServer } from 'http';
import path, { join } from 'path';
import 'dotenv/config';

// Config imports - using new infrastructure
import { initConfigService, configService, ConfigValidationError } from './0_infrastructure/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from './0_infrastructure/logging/config.js';

// Logging imports (use the new src/ logging)
import { initializeLogging } from './0_infrastructure/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './0_infrastructure/logging/transports/index.js';
import { createLogger } from './0_infrastructure/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags } from './0_infrastructure/logging/config.js';

// App factory
import { createApp } from './app.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

async function main() {
  // ==========================================================================
  // Configuration
  // ==========================================================================

  // Detect data directory from environment (same pattern as index.js)
  const dataDir = isDocker
    ? '/usr/src/app/data'
    : process.env.DAYLIGHT_DATA_PATH;

  if (!dataDir) {
    console.error('[FATAL] DAYLIGHT_DATA_PATH not set. Cannot start.');
    process.exit(1);
  }

  // Derive config paths from data directory
  const configDir = join(dataDir, 'system');
  const configExists = existsSync(join(configDir, 'system.yml')) || existsSync(join(configDir, 'app.yml'));

  console.log(`[Config] Source: ${isDocker ? 'docker' : 'env'}, dataDir: ${dataDir}`);

  // Hydrate process.env with config values (for logging)
  hydrateProcessEnvFromConfigs(configDir);

  // Initialize ConfigService v2
  try {
    initConfigService(dataDir);
    console.log('[Config] ConfigService initialized');
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error('[FATAL] Config validation failed:', err.message);
      process.exit(1);
    }
    // Ignore "already initialized" errors
    if (!err.message?.includes('already initialized')) {
      throw err;
    }
  }

  // Build configPaths object for createApp (uses ConfigService values)
  const configPaths = {
    dataDir: configService.getDataDir(),
    configDir: configService.getConfigDir(),
    source: isDocker ? 'docker' : 'env'
  };

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

  // Loggly transport if configured (use ConfigService for secrets)
  const logglyToken = configService.getSecret('LOGGLY_TOKEN');
  const logglySubdomain = configService.getSecret('LOGGLY_SUBDOMAIN');
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

  const port = configService.getPort();
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', { port, host: '0.0.0.0', mode: 'standalone-new' });
  });
}

// Run the server
main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
