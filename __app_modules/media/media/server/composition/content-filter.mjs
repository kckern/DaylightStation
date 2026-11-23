import { createContentFilterRouter } from '../api/contentFilter.mjs';
import { createFilterJobs } from './content-filter-jobs.mjs';

/** The profile the player asks for when none is named (api/contentFilter.mjs). */
const DEFAULT_PROFILE = 'family';

/**
 * @param {{ configService, rootLogger, aiGateway?: object }} deps - aiGateway: scoped view for title-card drafts
 * @returns {Promise<{ router, filterStatus: { isActive(ratingKey:string): Promise<boolean> } }>}
 */
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
  // One queue per film for every write to its files: review marks and a run's saved results take turns.
  const titleQueue = createTitleQueue();
  const { jobs, contentFilterRepository, digestOf } = await createFilterJobs({
    householdDir: configService.getHouseholdPath(''), dataDir: configService.getDataDir(), mediaDir: configService.getMediaDir(),
    logger, executor: inline ? 'inline' : 'worker', schedule,
    draftCards: aiGateway ? (rk) => contentFilterScenes.draftCards({ ratingKey: rk }) : null,
    titleQueue,
  });
  contentFilterScenes = new ContentFilterScenes({ contentFilterRepository, aiGateway, logger, titleQueue });
  const plexClient = contentRegistry?.get?.('plex')?.client || null;
  const contentFilterReview = new ContentFilterReview({ contentFilterRepository, jobs, digestOf, logger, titleQueue });
  const contentFilterLibrary = new ContentFilterLibrary({ contentFilterRepository, jobs, digestOf, plex: plexClient });
  // A landed audit drops review marks whose row moved or went away.
  jobs.onAudit(async (rk) => { await contentFilterReview.pruneMarks(rk); contentFilterLibrary.invalidate(rk); });
  jobs.onSettled(({ ratingKey }) => contentFilterLibrary.invalidate(ratingKey));
  // Inline runs die with this process. A worker's runs outlive an app restart: the worker marks a
  // run interrupted when its heartbeat stops, and the app watches the store to see runs settle.
  if (inline) await jobs.recover(); else jobs.watch();
  // Warm the library's per-film facts and Plex snapshot after boot settles, so the first Admin
  // visit after a deploy does not wait on ~500 file reads and a full Plex movie sweep.
  const warm = schedule(async () => {
    const t0 = Date.now();
    try { const { meta } = await contentFilterLibrary.list({ view: 'active' }); logger.info('content-filter.library.warmed', { ms: Date.now() - t0, total: meta?.total ?? null }); }
    catch (err) { logger.warn('content-filter.library.warm-failed', { error: err?.message }); }
  }, 30_000);
  warm?.unref?.();
  const getContentFilter = new GetContentFilter({ contentFilterRepository });
  // Whether the filter switches on for a title by default (the player's own
  // test: certified for the household profile). Read by provenance rules.
  const filterStatus = {
    isActive: async (ratingKey) => (await getContentFilter.execute({ ratingKey: String(ratingKey), profileName: DEFAULT_PROFILE }))?.certification?.ready === true,
  };
  const router = createContentFilterRouter({
    contentFilterArt: plexClient ? new ContentFilterArt({ plex: plexClient, logger }) : null,
    getContentFilter,
    contentFilterScenes,
    contentFilterReview,
    contentFilterLibrary,
    jobs,
    logger,
  });
  return { router, filterStatus };
}
