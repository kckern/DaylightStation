import { ApplicationJobExecutor } from '#apps/scheduling/ApplicationJobExecutor.mjs';

/** Compose scheduled workflows that replaced deleted legacy module wrappers. */
export function createApplicationScheduledJobs({
  financeHarvestService = null,
  healthService = null,
  archiveService,
  loadArchiveConfig,
  foodLogStore = null,
  nutriListStore = null,
  mediaMemoryValidator = null,
  resolveHouseholdId,
  resolveUsername,
  clock = { now: () => new Date(), epoch: () => Date.now() },
  logger = console,
} = {}) {
  const requireDependency = (dependency, jobId, name) => {
    if (!dependency) throw new Error(`Scheduled job ${jobId} requires ${name}`);
    return dependency;
  };

  return new ApplicationJobExecutor({
    logger,
    handlers: {
      budget: (options) => requireDependency(
        financeHarvestService,
        'budget',
        'FinanceHarvestService',
      ).harvest(resolveHouseholdId(), options),

      health: (options) => requireDependency(
        healthService,
        'health',
        'AggregateHealthUseCase',
      ).execute(resolveUsername(), options.daysBack ?? 15, clock.now()),

      'archive-rotation': async () => {
        const username = resolveUsername();
        const config = loadArchiveConfig?.() || { services: {} };
        const results = [];
        const failures = [];

        // Summary-detail archives and nutrition use their own stores. The
        // generic ArchiveService handles only ordinary lifelog hot/cold data.
        const genericServices = Object.entries(config.services || {})
          .filter(([, serviceConfig]) => serviceConfig?.enabled)
          .filter(([service, serviceConfig]) => (
            service !== 'nutrilog'
            && service !== 'nutrilist'
            && serviceConfig.pattern !== 'summary-detail'
            && !serviceConfig.basePath
          ))
          .map(([service]) => service);

        for (const service of genericServices) {
          try {
            results.push({ service, ...archiveService.rotateToArchive(username, service) });
          } catch (error) {
            failures.push({ service, error: error.message });
          }
        }

        for (const [service, store, method] of [
          ['nutrilog', foodLogStore, 'archiveOldLogs'],
          ['nutrilist', nutriListStore, 'archiveOldItems'],
        ]) {
          if (!config.services?.[service]?.enabled) continue;
          try {
            const result = await requireDependency(store, 'archive-rotation', `${service} store`)[method](username);
            results.push({ service, ...result });
          } catch (error) {
            failures.push({ service, error: error.message });
          }
        }

        if (failures.length) {
          throw new AggregateError(
            failures.map(({ service, error }) => new Error(`${service}: ${error}`)),
            `Archive rotation failed for ${failures.length} service(s)`,
          );
        }
        return { username, results };
      },

      'media-memory-validator': (options) => requireDependency(
        mediaMemoryValidator,
        'media-memory-validator',
        'MediaMemoryValidatorService',
      ).validateMediaMemory({ dryRun: options.dryRun ?? false, nowMs: clock.epoch() }),
    },
  });
}

export default createApplicationScheduledJobs;
