/** Explicit moved provider manifests in their original discovery positions. */
import {fileURLToPath} from 'node:url';
export const relocatedProviderManifests=[
  {legacyPath:"backend/src/1_adapters/content/app-registry/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/app-registry/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/filesystem/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/filesystem/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/freshvideo/manifest.mjs",path:fileURLToPath(new URL("../../../../modules/media/server/adapters/providers/freshvideo/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/gallery/immich/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/gallery/immich/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/list/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/list/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/media/plex/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/plex/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/query/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/query/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/readable/audiobookshelf/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/readable/audiobookshelf/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/readable/komga/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/readable/komga/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/readalong/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/readalong/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/retroarch/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/retroarch/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/singalong/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/content-catalog/server/adapters/providers/singalong/manifest.mjs",import.meta.url))},
  {legacyPath:"backend/src/1_adapters/content/stream/manifest.mjs",path:fileURLToPath(new URL("../../../../capabilities/playback/server/adapters/stream/manifest.mjs",import.meta.url))},
  {legacyPath:'backend/src/1_adapters/finance/buxfer/manifest.mjs',path:fileURLToPath(new URL('../../../../modules/finance/server/adapters/buxfer/manifest.mjs',import.meta.url))},
  {legacyPath:'backend/src/1_adapters/home-automation/homeassistant/manifest.mjs',path:fileURLToPath(new URL('../../../../capabilities/home-control/server/adapters/homeassistant/manifest.mjs',import.meta.url))},
  {legacyPath:'backend/src/1_adapters/livestream/manifest.mjs',path:fileURLToPath(new URL('../../../../modules/livestream/server/adapters/manifest.mjs',import.meta.url))},
];
