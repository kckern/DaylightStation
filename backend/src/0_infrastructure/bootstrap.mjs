// backend/src/0_infrastructure/bootstrap.mjs
import { ContentSourceRegistry } from '../1_domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../2_adapters/content/media/filesystem/FilesystemAdapter.mjs';
import { PlexAdapter } from '../2_adapters/content/media/plex/PlexAdapter.mjs';
import { LocalContentAdapter } from '../2_adapters/content/local-content/LocalContentAdapter.mjs';
import { FolderAdapter } from '../2_adapters/content/folder/FolderAdapter.mjs';
import { YamlWatchStateStore } from '../2_adapters/persistence/yaml/YamlWatchStateStore.mjs';

/**
 * Create and configure the content registry
 * @param {Object} config
 * @param {string} [config.mediaBasePath] - Base path for media files
 * @param {Object} [config.plex] - Plex configuration
 * @param {string} [config.plex.host] - Plex server URL
 * @param {string} [config.plex.token] - Plex auth token
 * @param {string} [config.dataPath] - Path to data files (for LocalContentAdapter)
 * @param {string} [config.watchlistPath] - Path to watchlist YAML (for FolderAdapter)
 * @returns {ContentSourceRegistry}
 */
export function createContentRegistry(config) {
  const registry = new ContentSourceRegistry();

  // Register filesystem adapter
  if (config.mediaBasePath) {
    registry.register(new FilesystemAdapter({
      mediaBasePath: config.mediaBasePath
    }));
  }

  // Register Plex adapter if configured
  if (config.plex?.host) {
    registry.register(new PlexAdapter({
      host: config.plex.host,
      token: config.plex.token
    }));
  }

  // Register local content adapter (optional)
  if (config.dataPath && config.mediaBasePath) {
    registry.register(new LocalContentAdapter({
      dataPath: config.dataPath,
      mediaPath: config.mediaBasePath
    }));
  }

  // Register folder adapter (optional, requires registry reference)
  if (config.watchlistPath) {
    registry.register(new FolderAdapter({
      watchlistPath: config.watchlistPath,
      registry
    }));
  }

  return registry;
}

/**
 * Create watch state store
 * @param {Object} config
 * @param {string} config.watchStatePath - Path for watch state files
 * @returns {YamlWatchStateStore}
 */
export function createWatchStore(config) {
  return new YamlWatchStateStore({
    basePath: config.watchStatePath
  });
}
