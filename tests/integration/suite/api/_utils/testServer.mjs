// tests/integration/api/_utils/testServer.mjs
/**
 * Test server factory for API integration tests.
 * Creates a fully-configured Express app with real data mounts.
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
import {
  createContentRegistry,
  createWatchStore,
  createApiRouters
} from '@backend/src/0_infrastructure/bootstrap.mjs';
import {
  initConfigService,
  resetConfigService,
  configService
} from '@backend/_legacy/lib/config/index.mjs';
import { resolveConfigPaths } from '@backend/_legacy/lib/config/pathResolver.mjs';

/**
 * Load test configuration from ConfigService and system-local.yml.
 * Uses pathResolver to discover data path, then reads local overrides.
 */
export async function loadTestConfig() {
  const yaml = await import('js-yaml');

  // Use pathResolver to discover data path (respects DAYLIGHT_DATA_PATH)
  const codebaseDir = path.resolve(__dirname, '../../../..');
  const configPaths = resolveConfigPaths({ codebaseDir });

  if (!configPaths.dataDir) {
    throw new Error(
      'TEST CONFIG ERROR: Data path not configured.\n' +
      'Set DAYLIGHT_DATA_PATH environment variable.'
    );
  }

  const dataPath = configPaths.dataDir;

  if (!fs.existsSync(dataPath)) {
    throw new Error(
      `TEST CONFIG ERROR: Data path does not exist: ${dataPath}\n` +
      'Ensure the path is correct and accessible.'
    );
  }

  // Load system-local.yml for local overrides (paths, plex host, etc.)
  let localConfig = {};
  const systemLocalYmlPath = path.join(dataPath, 'system', 'system-local.yml');
  if (fs.existsSync(systemLocalYmlPath)) {
    localConfig = yaml.load(fs.readFileSync(systemLocalYmlPath, 'utf8')) || {};
  }

  // Get media path from system-local.yml, fall back to data path
  const mediaPath = localConfig.path?.media || dataPath;

  // Initialize ConfigService for auth lookups
  let plexConfig = { host: null, token: null };
  try {
    if (configService.isReady()) {
      resetConfigService();
    }
    initConfigService(dataPath);

    // Get Plex token from household auth
    const plexAuth = configService.getHouseholdAuth('plex');
    if (plexAuth?.token) {
      plexConfig.token = plexAuth.token;
    }

    // Get Plex host from system.yml first
    const systemYmlPath = path.join(dataPath, 'system', 'system.yml');
    if (fs.existsSync(systemYmlPath)) {
      const systemConfig = yaml.load(fs.readFileSync(systemYmlPath, 'utf8'));
      if (systemConfig?.plex?.host) {
        plexConfig.host = systemConfig.plex.host;
      }
    }

    // Override with system-local.yml (local dev environment)
    if (localConfig.plex?.host) {
      plexConfig.host = localConfig.plex.host;
    }
  } catch (err) {
    console.warn('[testServer] Config loading failed:', err.message);
  }

  return {
    mounts: {
      data: dataPath,
      media: mediaPath
    },
    plex: plexConfig,
    householdId: process.env.HOUSEHOLD_ID || 'default'
  };
}

/**
 * Create a test server with real data mounts.
 *
 * @param {Object} options
 * @param {boolean} options.includePlex - Include Plex adapter (requires live server)
 * @returns {Promise<{app: express.Application, registry: Object, watchStore: Object, config: Object}>}
 */
export async function createTestServer(options = {}) {
  const { includePlex = false } = options;

  const config = await loadTestConfig();

  // Build paths
  const dataPath = config.mounts.data;
  const mediaPath = config.mounts.media || dataPath;
  const contentPath = path.join(dataPath, 'content');  // LocalContentAdapter looks in content/
  const householdDir = path.join(dataPath, 'households', config.householdId);
  const watchlistPath = path.join(householdDir, 'state', 'lists.yml');
  const watchStatePath = path.join(dataPath, 'media_memory');

  // Create content registry with real adapters
  const registryConfig = {
    mediaBasePath: mediaPath,
    dataPath: contentPath,  // LocalContentAdapter expects content/ subdirectory
    watchlistPath: fs.existsSync(watchlistPath) ? watchlistPath : null
  };

  // Only include Plex if requested and configured
  if (includePlex && config.plex.host && config.plex.token) {
    registryConfig.plex = {
      host: config.plex.host,
      token: config.plex.token
    };
  }

  const registry = createContentRegistry(registryConfig);

  // Create watch store
  const watchStore = createWatchStore({ watchStatePath });

  // Create Express app
  const app = express();
  app.use(express.json());

  // Create and mount all routers
  const routers = createApiRouters({ registry, watchStore });

  app.use('/api/content', routers.content);
  app.use('/api/list', routers.list);
  app.use('/api/play', routers.play);
  app.use('/api/local-content', routers.localContent);
  app.use('/proxy', routers.proxy);

  // Also mount legacy shims for baseline capture
  if (routers.legacyShims) {
    // Legacy endpoints will be mounted here for baseline capture
  }

  return {
    app,
    registry,
    watchStore,
    config: {
      ...config,
      paths: {
        data: dataPath,
        media: mediaPath,
        household: householdDir,
        watchlist: watchlistPath,
        watchState: watchStatePath
      }
    }
  };
}

/**
 * Create a minimal test server using fixtures (for offline testing).
 * Used when real data mounts aren't available.
 */
export async function createFixtureServer() {
  const fixturesPath = path.resolve(__dirname, '../../../_fixtures');

  const registry = createContentRegistry({
    mediaBasePath: path.join(fixturesPath, 'media'),
    dataPath: path.join(fixturesPath, 'local-content')
  });

  const watchStore = createWatchStore({
    watchStatePath: path.join(fixturesPath, 'watch-state')
  });

  const app = express();
  app.use(express.json());

  const routers = createApiRouters({ registry, watchStore });

  app.use('/api/content', routers.content);
  app.use('/api/list', routers.list);
  app.use('/api/play', routers.play);
  app.use('/api/local-content', routers.localContent);
  app.use('/proxy', routers.proxy);

  return { app, registry, watchStore };
}

export default createTestServer;
