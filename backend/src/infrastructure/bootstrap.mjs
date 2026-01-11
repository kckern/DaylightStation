// backend/src/infrastructure/bootstrap.mjs
import { ContentSourceRegistry } from '../domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../adapters/content/media/filesystem/FilesystemAdapter.mjs';
import { PlexAdapter } from '../adapters/content/media/plex/PlexAdapter.mjs';
import { YamlWatchStateStore } from '../adapters/persistence/yaml/YamlWatchStateStore.mjs';

/**
 * Create and configure the content registry
 * @param {Object} config
 * @param {string} [config.mediaBasePath]
 * @param {Object} [config.plex] - Plex configuration
 * @param {string} [config.plex.host] - Plex server URL
 * @param {string} [config.plex.token] - Plex auth token
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
