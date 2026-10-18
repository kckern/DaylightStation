import { createArtAdapter } from '../adapters/ArtAdapter.mjs';
import { createArtRouter } from '../api/art.mjs';

export async function createArtContentRuntime({ configService, immichConfig, axios, imgBasePath, rootLogger, contentRegistry }) {
  // Art collections + optional Immich source for ArtMode.
  const artConfig = configService.getHouseholdAppConfig(null, 'art') || {};
  let artImmichSource = null;
  if (immichConfig) {
    const { ImmichClient } = await import("../../../../../__capabilities/content-catalog/server/adapters/providers/gallery/immich/ImmichClient.mjs");
    const { createImmichSource } = await import("../adapters/sources/immichSource.mjs");
    const artImmichClient = new ImmichClient(immichConfig, { httpClient: axios });
    const fetchImageBytes = async (assetId) => {
      const r = await axios.get(
        `${immichConfig.host.replace(/\/$/, '')}/api/assets/${assetId}/thumbnail?size=preview`,
        { headers: { 'x-api-key': immichConfig.apiKey }, responseType: 'arraybuffer' }
      );
      return Buffer.from(r.data);
    };
    artImmichSource = createImmichSource({
      client: artImmichClient,
      fetchImageBytes,
      proxyPath: '/api/v1/proxy/immich',
      logger: rootLogger.child({ module: 'art-immich' }),
    });
  }
  const artAdapter = createArtAdapter({
    imgBasePath,
    householdDir: configService.getHouseholdPath(''),
    collections: artConfig.collections || {},
    immichSource: artImmichSource,
    logger: rootLogger.child({ module: 'art-adapter' })
  });
  // Register a thin `art` content source so /display/art:<preset> resolves to a
  // representative thumbnail (menu cards for art presets). The screensaver
  // adapter itself isn't a full IContentSource — the wrapper delegates the
  // thumbnail path and stubs the unused list/playable interface.
  if (contentRegistry?.register) {
    const { createArtContentSource } = await import("../adapters/ArtContentSource.mjs");
    contentRegistry.register(
      createArtContentSource({ artAdapter, logger: rootLogger.child({ module: 'art-content' }) }),
      { category: 'art' }
    );
  }
  const { ArtPresetService } = await import("../application/ArtPresetService.mjs");
  const { FilesystemArtPresetCatalog } = await import("../adapters/FilesystemArtPresetCatalog.mjs");
  const { FilesystemAmbianceCatalog } = await import('../adapters/FilesystemAmbianceCatalog.mjs');
  const { AmbianceService } = await import('../application/AmbianceService.mjs');
  const artRouter = createArtRouter({
    ambianceService: new AmbianceService({
      catalog: new FilesystemAmbianceCatalog({
        householdDir: configService.getHouseholdPath(''),
        logger: rootLogger.child({ module: 'ambiance-catalog' }),
      }),
      artworkSource: artAdapter,
    }),
    artService: new ArtPresetService({
      catalog: new FilesystemArtPresetCatalog({
        householdDir: configService.getHouseholdPath(''),
        logger: rootLogger.child({ module: 'art-catalog' }),
      }),
      artSource: artAdapter,
    }),
    logger: rootLogger.child({ module: 'art-api' })
  });

  return { artAdapter, artRouter };
}
