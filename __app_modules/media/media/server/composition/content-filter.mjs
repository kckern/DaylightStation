import { createContentFilterRouter } from '../api/contentFilter.mjs';

/** @param {{ configService, rootLogger, aiGateway?: object }} deps - aiGateway: scoped view for title-card drafts */
export async function createContentFilterRuntime({ configService, rootLogger, aiGateway = null, contentRegistry = null }) {
  const { FilesystemContentFilterRepository } = await import("../adapters/persistence/FilesystemContentFilterRepository.mjs");
  const { GetContentFilter } = await import("../application/content-filter/usecases/GetContentFilter.mjs");
  const { ContentFilterScenes } = await import("../application/content-filter/usecases/ContentFilterScenes.mjs");
  const { ContentFilterArt } = await import("../application/content-filter/usecases/ContentFilterArt.mjs");
  const logger = rootLogger.child({ module: 'content-filter-api' });
  const contentFilterRepository = new FilesystemContentFilterRepository({
    householdDir: configService.getHouseholdPath(''),
    mediaDir: configService.getMediaDir(),
  });
  const plexClient = contentRegistry?.get?.('plex')?.client || null;
  return createContentFilterRouter({
    contentFilterArt: plexClient ? new ContentFilterArt({ plex: plexClient, logger }) : null,
    getContentFilter: new GetContentFilter({ contentFilterRepository }),
    contentFilterScenes: new ContentFilterScenes({ contentFilterRepository, aiGateway, logger }),
    logger,
  });
}
