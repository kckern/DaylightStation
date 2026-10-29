import {join} from 'node:path';
import {MediaJobExecutor} from '../application/MediaJobExecutor.mjs';
import {MediaDownloadService} from '../application/services/MediaDownloadService.mjs';
import {createFreshVideoJobHandler} from '../application/FreshVideoJobHandler.mjs';
import {YtDlpAdapter} from '../adapters/YtDlpAdapter.mjs';
import {CuratedPageVideoGateway} from '../adapters/CuratedPageVideoGateway.mjs';

export async function createMediaJobsRuntime({rootLogger,mediaBasePath,loadFile}) {
  // Media job executor (YouTube downloads, etc.)
  const mediaExecutor = new MediaJobExecutor({
    logger: rootLogger.child({ module: 'media-executor' })
  });

  // Register fresh video download handler (only if mediaBasePath is configured)
  let mediaDownloadService = null;
  if (mediaBasePath) {
    const mediaPath = join(mediaBasePath, 'video', 'news');
    const { NewsMediaStore } = await import('../adapters/persistence/NewsMediaStore.mjs');
    const newsMediaStore = new NewsMediaStore({ mediaRoot: mediaBasePath });

    // `type: page` sources (curated web pages) resolve to one embedded video
    // before yt-dlp sees them; every other source passes straight through.
    const videoSourceGateway = new CuratedPageVideoGateway({
      inner: new YtDlpAdapter({
        downloadRoot: mediaPath,
        logger: rootLogger.child({ module: 'ytdlp' })
      }),
      logger: rootLogger.child({ module: 'freshvideo-page' })
    });

    mediaDownloadService = new MediaDownloadService({
      videoSourceGateway,
      newsMediaStore,
      downloadThumbnail: (url, provider) => videoSourceGateway.downloadThumbnail(url, provider),
      logger: rootLogger.child({ module: 'media-download' })
    });

    const { FilesystemFreshVideoMediaStore } = await import('../adapters/persistence/FilesystemFreshVideoMediaStore.mjs');
    const freshVideoMediaStore = new FilesystemFreshVideoMediaStore({
      mediaRoot: mediaPath,
      logger: rootLogger.child({ module: 'freshvideo-store' }),
    });
    const freshVideoSourceCatalog = {
      list: () => (loadFile('media/sources') || []).map((source) => ({
        provider: source.shortcode,
        sourceRef: {
          platform: source.src || 'youtube',
          collectionType: String(source.type || 'playlist').toLowerCase(),
          locator: source.playlist,
          linkPattern: source.link_pattern || null,
          description: source.description || null,
        },
      })),
    };
    mediaExecutor.register('freshvideo', createFreshVideoJobHandler({
      videoSourceGateway,
      sourceCatalog: freshVideoSourceCatalog,
      mediaStore: freshVideoMediaStore,
      lockOwnerId: process.pid,
      logger: rootLogger.child({ module: 'freshvideo' })
    }));
  } else {
    rootLogger.warn?.('freshvideo.disabled', {
      reason: 'mediaBasePath not configured - video downloads disabled'
    });
  }

  return {mediaExecutor,mediaDownloadService};
}
