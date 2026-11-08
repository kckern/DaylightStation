import path from 'path';
import { fileURLToPath } from 'url';
import { createContentFilterRouter } from '../api/contentFilter.mjs';

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cli/contentfilter.cli.mjs');

/** @param {{ configService, rootLogger, aiGateway?: object }} deps - aiGateway: scoped view for title-card drafts */
export async function createContentFilterRuntime({ configService, rootLogger, aiGateway = null, contentRegistry = null }) {
  const { FilesystemContentFilterRepository } = await import("../adapters/persistence/FilesystemContentFilterRepository.mjs");
  const { YamlFilterJobStore } = await import("../adapters/persistence/YamlFilterJobStore.mjs");
  const { ChildProcessContentFilterCli } = await import("../adapters/content-filter/ChildProcessContentFilterCli.mjs");
  const { GetContentFilter } = await import("../application/content-filter/usecases/GetContentFilter.mjs");
  const { ContentFilterScenes } = await import("../application/content-filter/usecases/ContentFilterScenes.mjs");
  const { ContentFilterArt } = await import("../application/content-filter/usecases/ContentFilterArt.mjs");
  const { ContentFilterJobs } = await import("../application/content-filter/jobs/ContentFilterJobs.mjs");
  const { ContentFilterReview } = await import("../application/content-filter/usecases/ContentFilterReview.mjs");
  const { ContentFilterLibrary } = await import("../application/content-filter/usecases/ContentFilterLibrary.mjs");
  const { createTitleQueue } = await import("../application/content-filter/titleQueue.mjs");
  const { filterDigest } = await import("../domain/content-filter/filterDigest.mjs");
  const logger = rootLogger.child({ module: 'content-filter-api' });
  const householdDir = configService.getHouseholdPath('');
  const mediaDir = configService.getMediaDir();
  const contentFilterRepository = new FilesystemContentFilterRepository({ householdDir, mediaDir });
  const titleQueue = createTitleQueue();
  const contentFilterScenes = new ContentFilterScenes({ contentFilterRepository, aiGateway, logger, titleQueue });
  const plexClient = contentRegistry?.get?.('plex')?.client || null;

  const refinedFor = async (rk) => {
    const edl = await contentFilterRepository.getEdl(rk);
    const ref = edl?.sourceRef;
    return { edl, refined: ref?.workId != null && ref?.tagSetId != null ? await contentFilterRepository.getRefinedEdl(ref) : null };
  };
  const digestOf = async (rk) => filterDigest({ refined: (await refinedFor(rk)).refined, override: await contentFilterRepository.getOverride(rk) });
  const jobs = new ContentFilterJobs({
    store: new YamlFilterJobStore({ householdDir }),
    cli: new ChildProcessContentFilterCli({ cliPath: CLI_PATH, env: { DAYLIGHT_DATA_DIR: configService.getDataDir(), DAYLIGHT_MEDIA_DIR: mediaDir } }),
    // Heavy runs happen in the filter worker (Debian; the app image cannot install refine's
    // Python stack). CONTENT_FILTER_EXECUTOR=inline runs them here instead.
    executor: process.env.CONTENT_FILTER_EXECUTOR === 'inline' ? 'inline' : 'worker',
    film: async (rk) => {
      const { edl, refined } = await refinedFor(rk);
      const slug = (await contentFilterRepository.getMatchIndex())?.map?.[`plex:${rk}`]?.vidangel?.slug;
      return {
        hasEdl: !!edl, hasScenes: Array.isArray(refined?.scenes),
        exportArgs: slug ? [slug, '--content-id', `plex:${rk}`, '--out', path.join(mediaDir, 'content-filter', 'edl', `${rk}.edl.yml`)] : null,
      };
    },
    digestOf,
    draftCards: aiGateway ? (rk) => contentFilterScenes.draftCards({ ratingKey: rk }) : null,
    clearNudges: async (rk, ids) => {
      const ov = await contentFilterRepository.getOverride(rk);
      if (!ov?.cueOverrides) return;
      for (const id of ids) {
        const c = ov.cueOverrides[id];
        if (c && ('startMs' in c || 'endMs' in c)) {
          delete c.startMs; delete c.endMs;
          logger.info?.('content-filter.nudge', { ratingKey: rk, cue: id, cleared: true, reason: 'send-back' });
        }
      }
      await contentFilterRepository.saveOverride(rk, ov);
    },
    logPath: (rk, runId) => path.join(mediaDir, 'content-filter', 'refine', String(rk), 'jobs', `${runId}.log`),
    schedule: (fn, ms) => setTimeout(fn, ms),
    logger,
  });
  const contentFilterReview = new ContentFilterReview({ contentFilterRepository, jobs, digestOf, logger, titleQueue });
  // A landed audit drops review marks whose row moved or went away.
  const contentFilterLibrary = new ContentFilterLibrary({ contentFilterRepository, jobs, digestOf });
  jobs.onAudit(async (rk) => { await contentFilterReview.pruneMarks(rk); contentFilterLibrary.invalidate(rk); });
  jobs.onSettled(({ ratingKey }) => contentFilterLibrary.invalidate(ratingKey));
  // Inline runs die with this process. A worker's runs outlive an app restart; the worker
  // itself marks a run interrupted when its heartbeat goes stale (Task 9).
  if (process.env.CONTENT_FILTER_EXECUTOR === 'inline') await jobs.recover();
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
