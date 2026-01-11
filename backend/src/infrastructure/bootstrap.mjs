// backend/src/infrastructure/bootstrap.mjs
import { ContentSourceRegistry } from '../domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../adapters/content/media/filesystem/FilesystemAdapter.mjs';

/**
 * Create and configure the content registry
 * @param {Object} config
 * @param {string} config.mediaBasePath
 * @returns {ContentSourceRegistry}
 */
export function createContentRegistry(config) {
  const registry = new ContentSourceRegistry();

  // Register filesystem adapter
  registry.register(new FilesystemAdapter({
    mediaBasePath: config.mediaBasePath
  }));

  // TODO: Register PlexAdapter when implemented
  // registry.register(new PlexAdapter(config.plex));

  return registry;
}
