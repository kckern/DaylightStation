import { createContentFilterRouter } from '../api/contentFilter.mjs';
import { createFilterJobs } from './content-filter-jobs.mjs';

/** @param {{ configService, rootLogger, aiGateway?: object }} deps - aiGateway: scoped view for title-card drafts */
export async function createContentFilterRuntime({ configService, rootLogger, aiGateway = null, contentRegistry = null }) {
  const { GetContentFilter } = await import("../application/content-filter/usecases/GetContentFilter.mjs");
  const { ContentFilterScenes } = await import("../application/content-filter/usecases/ContentFilterScenes.mjs");
  const { ContentFilterArt } = await import("../application/content-filter/usecases/ContentFilterArt.mjs");
  const { ContentFilterReview } = await import("../application/content-filter/usecases/ContentFilterReview.mjs");
  const { ContentFilterLibrary } = await import("../application/content-filter/usecases/ContentFilterLibrary.mjs");
  const { createTitleQueue } = await import("../application/content-filter/titleQueue.mjs");
  const logger = rootLogger.child({ module: 'content-filter-api' });
  // Heavy runs happen in the filter worker (Debian; the app image cannot install refine's
  // Python stack). CONTENT_FILTER_EXECUTOR=inline runs them in this process instead.
  const inline = process.env.CONTENT_FILTER_EXECUTOR === 'inline';
  const schedule = (fn, ms) => setTimeout(fn, ms);
  let contentFilterScenes = null;
  const { jobs, contentFilterRepository, digestOf } = await createFilterJobs({
    householdDir: configService.getHouseholdPath(''), dataDir: configService.getDataDir(), mediaDir: configService.getMediaDir(),
    logger, executor: inline ? 'inline' : 'worker', schedule,
    draftCards: aiGateway ? (rk) => contentFilterScenes.draftCards({ ratingKey: rk }) : null,
  });
  const titleQueue = createTitleQueue();
  contentFilterScenes = new ContentFilterScenes({ contentFilterRepository, aiGateway, logger, titleQueue });
  const plexClient = contentRegistry?.get?.('plex')?.client || null;
  const contentFilterReview = new ContentFilterReview({ contentFilterRepository, jobs, digestOf, logger, titleQueue });
  const contentFilterLibrary = new ContentFilterLibrary({ contentFilterRepository, jobs, digestOf });
  // A landed audit drops review marks whose row moved or went away.
  jobs.onAudit(async (rk) => { await contentFilterReview.pruneMarks(rk); contentFilterLibrary.invalidate(rk); });
  jobs.onSettled(({ ratingKey }) => contentFilterLibrary.invalidate(ratingKey));
  // Inline runs die with this process. A worker's runs outlive an app restart: the worker marks a
  // run interrupted when its heartbeat stops, and the app watches the store to see runs settle.
  if (inline) await jobs.recover(); else jobs.watch();
  return createContentFilterRouter({
    contentFilterArt: plexClient ? new ContentFilterArt({ plex: plexClient, logger }) : null,
    getContentFilter: new GetContentFilter({ contentFilterRepository }),
    contentFilterScenes,
    contentFilterReview,
    contentFilterLibrary,
    jobs,
    logger,
  });
}
