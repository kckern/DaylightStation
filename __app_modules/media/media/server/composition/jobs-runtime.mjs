import {join} from 'node:path';
import {MediaJobExecutor} from '../application/MediaJobExecutor.mjs';
import {MediaDownloadService} from '../application/services/MediaDownloadService.mjs';
import {createFreshVideoJobHandler} from '../application/FreshVideoJobHandler.mjs';
import {YtDlpAdapter} from '../adapters/YtDlpAdapter.mjs';
import {CuratedPageVideoGateway} from '../adapters/CuratedPageVideoGateway.mjs';
import {CourseSequenceService} from '../application/CourseSequenceService.mjs';
import {createCourseSequenceJobHandler} from '../application/CourseSequenceJobHandler.mjs';

export async function createMediaJobsRuntime({rootLogger,mediaBasePath,loadFile,courseSequence=null}) {
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

  if (courseSequence) registerCourseSequenceJob({ mediaExecutor, rootLogger, ...courseSequence });

  return {mediaExecutor,mediaDownloadService};
}

/**
 * Register the nightly `course-sequence` job (schedule in system/config/jobs.yml).
 * The course watchlist lives at content/lists/watchlists/courses.yml under the
 * data directory; `documents` loads/saves YAML relative to that directory.
 */
function registerCourseSequenceJob({mediaExecutor,contentRegistry,mediaProgressMemory,documents,timezone,newUid,rootLogger}) {
  const logger = rootLogger.child({ module: 'course-sequence' });
  const LIST_PATH = 'content/lists/watchlists/courses';
  const service = new CourseSequenceService({
    loadList: async () => documents.load(LIST_PATH),
    saveList: async (doc) => documents.save(LIST_PATH, doc),
    listChildren: async (contentId) => {
      const plex = contentRegistry.get('plex');
      const items = (await plex?.getList?.(contentId)) || [];
      return items.map(item => ({ id: item.id, title: item.title }));
    },
    loadProgress: async () => {
      const states = (await mediaProgressMemory?.listSourceProgress?.('plex')) || [];
      return new Map(states.map(state => [state.contentId, {
        percent: state.percent, playhead: state.playhead, skipped: state.skipped === true,
      }]));
    },
    today: () => new Date().toLocaleDateString('en-CA', { timeZone: timezone || 'America/Los_Angeles' }),
    newUid,
    logger,
  });
  mediaExecutor.register('course-sequence', createCourseSequenceJobHandler({ service, logger }));
}
