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
} from '#backend/src/0_infrastructure/bootstrap.mjs';
import {
  initConfigService,
  resetConfigService,
  configService
} from '#backend/src/0_infrastructure/config/index.mjs';

/**
 * Load test configuration from ConfigService and system-local.yml.
 * Uses DAYLIGHT_DATA_PATH directly (no pathResolver needed).
 */
export async function loadTestConfig() {
  const yaml = await import('js-yaml');

  // Use DAYLIGHT_DATA_PATH directly (no pathResolver needed)
  const dataPath = process.env.DAYLIGHT_DATA_PATH;

  if (!dataPath) {
    throw new Error(
      'TEST CONFIG ERROR: DAYLIGHT_DATA_PATH not set.\n' +
      'Add it to your .env file.'
    );
  }

  if (!fs.existsSync(dataPath)) {
    throw new Error(
      `TEST CONFIG ERROR: Data path does not exist: ${dataPath}\n` +
      'Ensure the path is correct and accessible.'
    );
  }

  // Load system-local.yml for local overrides
  const envName = process.env.DAYLIGHT_ENV;
  let localConfig = {};
  if (envName) {
    const localPath = path.join(dataPath, 'system', `system-local.${envName}.yml`);
    if (fs.existsSync(localPath)) {
      localConfig = yaml.load(fs.readFileSync(localPath, 'utf8')) || {};
    }
  }

  // Get media path from local config or default
  const mediaPath = localConfig.paths?.media || path.join(dataPath, '../media');

  // Initialize ConfigService
  if (configService.isReady()) {
    resetConfigService();
  }
  initConfigService(dataPath);

  // Get Plex config from ConfigService
  const plexAuth = configService.getHouseholdAuth('plex') || {};
  const plexConfig = {
    host: plexAuth.server_url || localConfig.plex?.host || null,
    token: plexAuth.token || null
  };

  return {
    mounts: {
      data: dataPath,
      media: mediaPath
    },
    plex: plexConfig,
    householdId: configService.getDefaultHouseholdId()
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
