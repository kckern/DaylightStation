import { registerFreshVideoProvider, registerOnlineVideoProviders } from "../../../modules/media/server/composition/content-providers.mjs";
import { registerArtCanvasSources } from '../../../modules/art/server/composition/canvas-providers.mjs';
import { pianoCurriculumEnrichment } from '../../../modules/piano/server/composition/plex-curriculum.mjs';
// Installed content-source assembly; retains product registration and ordering.
import { createCatalogSources, registerRemoteCatalogSources, registerTextCatalogSources } from '../../../capabilities/content-catalog/server/composition/installation.mjs';

// Content domain imports

import { AppRegistryAdapter } from "../../../capabilities/content-catalog/server/adapters/providers/app-registry/AppRegistryAdapter.mjs";
import { RetroArchAdapter } from "../../../capabilities/content-catalog/server/adapters/providers/retroarch/RetroArchAdapter.mjs";











// Content adapter manifests (for category/provider metadata)

import appRegistryManifest from "../../../capabilities/content-catalog/server/adapters/providers/app-registry/manifest.mjs";



export function createContentRegistry(config, deps = {}) {
  const { registry, savedQueryService, httpClient, mediaProgressMemory, app } = createCatalogSources(config, deps, { curriculumEnrichment: pianoCurriculumEnrichment });

  // Register FreshVideoAdapter for freshvideo: prefix (teded, kidnuz, etc.)
  // Uses FileAdapter for file listing and mediaProgressMemory for watch state
  registerFreshVideoProvider({ registry, config, mediaProgressMemory });

  // Register StreamAdapter for `stream:` prefix — arbitrary online URLs.
  registerOnlineVideoProviders({ registry, deps });

  registerRemoteCatalogSources(registry, config, httpClient);

  registerArtCanvasSources({ registry, config, httpClient, app });

  registerTextCatalogSources(registry, config, mediaProgressMemory);

  // Register AppRegistryAdapter for native app content IDs (app:webcam, app:gratitude, etc.)
  // App definitions mirror the frontend registry (label + param only, no component imports).
  const appDefs = {
    webcam:            { label: 'Webcam' },
    gratitude:         { label: 'Gratitude & Hope' },
    wrapup:            { label: 'Wrap Up' },
    office_off:        { label: 'Office Off' },
    keycode:           { label: 'Key Test' },
    'family-selector': { label: 'Family Selector', param: { name: 'winner', options: 'household' } },
    glympse:           { label: 'Glympse', param: { name: 'id' } },
    websocket:         { label: 'WebSocket', param: { name: 'path' } },
  };
  registry.register(
    new AppRegistryAdapter({ apps: appDefs }),
    { category: appRegistryManifest.capability, provider: appRegistryManifest.provider }
  );

  // Register RetroArchAdapter if games config exists
  if (config.games?.config) {
    registry.register(
      new RetroArchAdapter({
        config: config.games.config,
        catalogReader: config.games.catalogReader,
        catalog: config.games.catalog,
        logger: deps.logger
      }),
      { category: 'game', provider: 'retroarch' }
    );
  }

  return { registry, savedQueryService };
}
