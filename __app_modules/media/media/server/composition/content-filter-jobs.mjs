import path from 'path';
import { fileURLToPath } from 'url';

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cli/contentfilter.cli.mjs');

/**
 * The content-filter run machinery. executor 'worker': the app queues runs and a remote filter
 * worker (`contentfilter worker --app <url>`) claims them over HTTP and hands back results, which
 * only the app writes. executor 'inline': the app runs everything itself. ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md.
 */
export async function createFilterJobs({ householdDir, dataDir, mediaDir, logger, executor, draftCards = null, schedule }) {
  const { FilesystemContentFilterRepository } = await import('../adapters/persistence/FilesystemContentFilterRepository.mjs');
  const { YamlFilterJobStore } = await import('../adapters/persistence/YamlFilterJobStore.mjs');
  const { ChildProcessContentFilterCli } = await import('../adapters/content-filter/ChildProcessContentFilterCli.mjs');
  const { ContentFilterJobs } = await import('../application/content-filter/jobs/ContentFilterJobs.mjs');
  const { filterDigest } = await import('../domain/content-filter/filterDigest.mjs');
  const contentFilterRepository = new FilesystemContentFilterRepository({ householdDir, mediaDir });
  const refinedFor = async (rk) => {
    const edl = await contentFilterRepository.getEdl(rk);
    const ref = edl?.sourceRef;
    return { edl, refined: ref?.workId != null && ref?.tagSetId != null ? await contentFilterRepository.getRefinedEdl(ref) : null };
  };
  const digestOf = async (rk) => filterDigest({ refined: (await refinedFor(rk)).refined, override: await contentFilterRepository.getOverride(rk) });
  const jobs = new ContentFilterJobs({
    store: new YamlFilterJobStore({ householdDir }),
    cli: new ChildProcessContentFilterCli({ cliPath: CLI_PATH, env: { DAYLIGHT_DATA_DIR: dataDir, DAYLIGHT_MEDIA_DIR: mediaDir } }),
    executor,
    film: async (rk) => {
      const { edl, refined } = await refinedFor(rk);
      const slug = (await contentFilterRepository.getMatchIndex())?.map?.[`plex:${rk}`]?.vidangel?.slug;
      return {
        hasEdl: !!edl, hasScenes: Array.isArray(refined?.scenes),
        exportArgs: slug ? [slug, '--content-id', `plex:${rk}`, '--out', path.join(mediaDir, 'content-filter', 'edl', `${rk}.edl.yml`)] : null,
      };
    },
    digestOf,
    draftCards,
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
    // Remote worker: everything a run needs, and where its results go (only the app writes).
    inputsOf: async (rk) => {
      const { edl, refined } = await refinedFor(rk);
      return {
        edl, refined, override: await contentFilterRepository.getOverride(rk),
        profiles: { family: await contentFilterRepository.getProfile('family') },
        refineReview: await contentFilterRepository.getRefineReview(rk),
        transcripts: await contentFilterRepository.listTranscriptFiles(rk),
      };
    },
    applyResults: async (rk, results) => {
      const { edl = null, refined = null, override = null, refineReview = null, transcripts = null } = results || {};
      if (edl) await contentFilterRepository.saveEdl(rk, edl);
      if (refined) {
        const ref = (edl || await contentFilterRepository.getEdl(rk))?.sourceRef;
        if (ref?.workId == null || ref?.tagSetId == null) throw new Error('No VidAngel tag set for this film; cannot save its refined EDL');
        await contentFilterRepository.saveRefinedEdl(ref, refined);
      }
      if (override) await contentFilterRepository.saveOverride(rk, override);
      if (refineReview) await contentFilterRepository.saveRefineReview(rk, refineReview);
      for (const [part, words] of Object.entries(transcripts || {})) await contentFilterRepository.saveTranscriptFile(rk, part, words);
      logger.info?.('content-filter.job.results', { ratingKey: rk, edl: !!edl, refined: !!refined, override: !!override, review: !!refineReview, transcripts: Object.keys(transcripts || {}).length });
    },
    logPath: (rk, runId) => path.join(mediaDir, 'content-filter', 'refine', String(rk), 'jobs', `${runId}.log`),
    schedule,
    logger,
  });
  return { jobs, contentFilterRepository, digestOf };
}
