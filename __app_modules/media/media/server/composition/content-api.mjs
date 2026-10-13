import { createLocalRouter } from "../api/local.mjs";
import { LocalMediaCatalogService } from "../application/LocalMediaCatalogService.mjs";
import path from "path";
import { MenuMemoryService } from "../application/MenuMemoryService.mjs";
import { BrowseCatalogService } from "../application/BrowseCatalogService.mjs";
import { FfmpegVideoThumbnailGenerator } from "../adapters/FfmpegVideoThumbnailGenerator.mjs";
import { FilesystemLocalMediaRepository } from "../adapters/FilesystemLocalMediaRepository.mjs";
import { FilesystemContentMediaRepository } from "../adapters/FilesystemContentMediaRepository.mjs";
import { GetLocalMediaResource } from "../application/usecases/GetLocalMediaResource.mjs";
import { GetLocalMediaThumbnail } from "../application/usecases/GetLocalMediaThumbnail.mjs";
import { GetContentMediaResource } from "../application/usecases/GetContentMediaResource.mjs";

export function createMediaResourceOperations({ registry, mediaBasePath, cacheBasePath, dataPath, logger, config }) {
  // Get FileAdapter from registry for local router (handles local media browsing)
  const localMediaAdapter = registry.get('files');
  const thumbnailGenerator = new FfmpegVideoThumbnailGenerator();
  const localMediaRepository = new FilesystemLocalMediaRepository({
    mediaBasePath,
    cacheBasePath: cacheBasePath || path.join(dataPath, 'system/cache'),
    thumbnailGenerator,
    logger,
  });
  const getLocalMediaResource = new GetLocalMediaResource({ repository: localMediaRepository });
  const getLocalMediaThumbnail = new GetLocalMediaThumbnail({ repository: localMediaRepository });
  const contentMediaRepository = new FilesystemContentMediaRepository({
    singalongMediaPath: path.join(mediaBasePath, 'audio', 'singalong'),
    singalongDataPath: config.singalong?.dataPath,
    readalongAudioPath: path.join(mediaBasePath, 'audio', 'readalong'),
    readalongVideoPath: path.join(mediaBasePath, 'video', 'readalong'),
  });
  const getContentMediaResource = new GetContentMediaResource({ repository: contentMediaRepository });
  return { localMediaAdapter, getLocalMediaResource, getLocalMediaThumbnail, getContentMediaResource };
}

export function createMediaBrowseState({ menuMemoryRepository, configService }) {
  const menuMemory = new MenuMemoryService({
    load: menuMemoryRepository.load,
    save: menuMemoryRepository.save,
  });
  const browseCatalog = new BrowseCatalogService({
    loadMediaConfig: () => configService?.getHouseholdAppConfig?.(null, 'media') || {},
  });
  return { menuMemory, browseCatalog };
}

export function createLocalMediaRouter({ localMediaAdapter, getLocalMediaResource, getLocalMediaThumbnail, logger }) {
  return createLocalRouter({
        localMediaCatalog: new LocalMediaCatalogService({ source: localMediaAdapter }),
        getLocalMediaResource,
        getLocalMediaThumbnail,
        logger,
      });
}
