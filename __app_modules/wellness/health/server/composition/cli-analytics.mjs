import path from "node:path";

export async function createHealthCliAnalytics({ configService: cfg, dataService }) {
    const { YamlHealthDatastore }    = await import("../adapters/persistence/yaml/YamlHealthDatastore.mjs");
    const { AggregateHealthUseCase } = await import("../application/health/AggregateHealthUseCase.mjs");
    const { HealthAnalyticsService } = await import("../application/health/analytics/HealthAnalyticsService.mjs");
    const { PeriodResolver }         = await import("../application/health/analytics/PeriodResolver.mjs");
    const { PersonalContextLoader }  = await import("../application/health/PersonalContextLoader.mjs");
    const { YamlPersonalPlaybookStore } = await import("../adapters/health/YamlPersonalPlaybookStore.mjs");
    const { YamlWorkingMemoryAdapter } = await import("../../../../../__capabilities/agent-runtime/server/adapters/YamlWorkingMemoryAdapter.mjs");
    const { default: yaml }          = await import('js-yaml');

    const healthStore    = new YamlHealthDatastore({ dataService, configService: cfg });
    const healthService  = new AggregateHealthUseCase({ healthStore });
    const periodResolver = new PeriodResolver();

    const dataDir    = cfg.getDataDir?.() || path.join(process.env.DAYLIGHT_BASE_PATH || '.', 'data');
    const archiveRoot = path.join(dataDir, 'users');
    // The loader reads playbooks through a store now, not a raw yaml reader —
    // the same YamlPersonalPlaybookStore the composition root uses (healthApi.mjs).
    // Left on the old `{ dataService, archiveRoot }` shape it threw on
    // construction, so every CLI reaching getHealthAnalytics() was dead.
    const playbookLoader       = new PersonalContextLoader({
      playbookStore: new YamlPersonalPlaybookStore({ usersRoot: archiveRoot }),
    });
    const workingMemoryAdapter = new YamlWorkingMemoryAdapter({ dataService });

    return new HealthAnalyticsService({
      healthStore, healthService, periodResolver,
      playbookLoader, workingMemoryAdapter,
    });
}
