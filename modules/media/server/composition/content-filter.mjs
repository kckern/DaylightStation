import { createContentFilterRouter } from '../api/contentFilter.mjs';

export async function createContentFilterRuntime({configService,rootLogger}) {
  const { FilesystemContentFilterRepository } = await import("../adapters/persistence/FilesystemContentFilterRepository.mjs");
  const { GetContentFilter } = await import("../application/content-filter/usecases/GetContentFilter.mjs");
  return createContentFilterRouter({
    getContentFilter: new GetContentFilter({
      contentFilterRepository: new FilesystemContentFilterRepository({
        householdDir: configService.getHouseholdPath(''),
        mediaDir: configService.getMediaDir(),
      }),
    }),
    logger: rootLogger.child({ module: 'content-filter-api' }),
  });
}
