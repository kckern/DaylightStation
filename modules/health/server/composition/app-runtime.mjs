import { HealthMentionSuggestions } from "../application/health/HealthMentionSuggestions.mjs";
import { createHealthMentionsRouter } from "../api/routers/health-mentions.mjs";
import { YamlObservationStore } from "../adapters/persistence/yaml/YamlObservationStore.mjs";
import { dataService } from "#composition/runtimePersistence.mjs";
import { normalizeScaleNutribotConfig } from "../scale-config.mjs";
import { configService } from "#system/config/index.mjs";
import { validateScanConfig } from "../application/nutrition/validateScanConfig.mjs";
import { ApplyScanToComposition } from "../application/nutrition/usecases/ApplyScanToComposition.mjs";
import { HttpClient } from "#system/services/HttpClient.mjs";
import { UPCGateway } from "../adapters/nutrition/UPCGateway.mjs";
import { createObservationService } from "../application/nutrition/ScaleObservationService.mjs";
import { createTemplateCurationJob } from "./healthApi.mjs";
import { createCatalogAuditService } from "./healthApi.mjs";

export function createHealthMentionsApi({ healthServices, getHealthAnalyticsService }) {
  const healthMentionSuggestions = new HealthMentionSuggestions({
    analytics: {
      listPeriods: (input) => getHealthAnalyticsService()?.listPeriods?.(input) ?? { periods: [] },
    },
    healthData: healthServices.healthStore,
    aggregateHealth: healthServices.healthService,
  });
  return createHealthMentionsRouter({
    mentionSuggestions: healthMentionSuggestions,
  });

}

export function createHealthScanRuntime({ rootLogger, householdId, getObservationService }) {
  const observationStore = new YamlObservationStore({
    dataService,
    logger: rootLogger.child({ module: 'observation-store' }),
  });

  // LATE-BOUND composition surface. `ApplyScanToComposition` has to exist HERE (the scan
  // router takes it), while the observation service cannot be built until the nutribot
  // container, the head of household and the bot id have all resolved, much further down
  // this function. The scan use case therefore holds this delegating surface and resolves
  // on every call — long after startup, never captured.
  //
  // ONE surface, shared by the scale signals (which write weights) and the fridge-sheet
  // scan handler (which writes density/tare). Two of them would mean a scanned density
  // never meets its weight, the entry never completes, and nothing anywhere reports an
  // error.
  //
  // `available()` is the honest half. The service only exists once the head of household
  // and the bot id resolve; until then there is nowhere to record a scan. A surface that
  // quietly swallowed the write would still let the scan use case answer `ok: true` with a
  // resolved level and label, so the fridge sheet would ACKNOWLEDGE a scan that went
  // nowhere — the exact silent failure the ⚠️ ack exists to prevent. Saying "unavailable"
  // instead turns it into a visible refusal, and keeps the station booting.
  const scaleCompositionSurface = {
    available: () => getObservationService() !== null,
    setWeight: (...args) => getObservationService()?.setWeight(...args),
    setDensity: (...args) => getObservationService()?.setDensity(...args),
    setContainer: (...args) => getObservationService()?.setContainer(...args),
    endPlacement: (...args) => getObservationService()?.endPlacement(...args),
    clear: (...args) => getObservationService()?.clear(...args),
    undo: (...args) => getObservationService()?.undo(...args),
    read: (...args) => getObservationService()?.read(...args) ?? null,
  };

  const scanVocabConfig = normalizeScaleNutribotConfig(
    configService.getHouseholdAppConfig(householdId, 'scales') || {},
    { logger: rootLogger.child({ module: 'nutriscan' }) },
  );

  // Fail SOFT, not fatal. A malformed nutriscan table must not keep the whole
  // station from booting — media, fitness and the rest have nothing to do with
  // it. Disable nutriscan, log loudly, let UPC scanning carry on.
  let applyScanToComposition = null;
  try {
    validateScanConfig(scanVocabConfig);
    applyScanToComposition = new ApplyScanToComposition({
      store: scaleCompositionSurface,
      config: scanVocabConfig,
      logger: rootLogger.child({ module: 'nutriscan' }),
    });
  } catch (err) {
    rootLogger.error('nutriscan.config.invalid', {
      error: err.message, code: err.code, hint: 'fix the nutribot block in scales.yml',
    });
  }

  return { observationStore, applyScanToComposition };
}

export function createHealthNutritionLookup({ rootLogger, nutribotConfig }) {
  const upcHttpClient = new HttpClient({ logger: rootLogger.child({ module: 'upc-http' }) });
  const nxConfig = nutribotConfig.integrations?.nutritionix;
  const upcGateway = new UPCGateway({
    httpClient: upcHttpClient,
    nutritionix: nxConfig?.app_id ? {
      appId: nxConfig.app_id,
      appKey: configService.getSystemAuth('food', 'nutritionix_api_key'),
    } : null,
    logger: rootLogger.child({ module: 'upc-gateway' }),
  });

  return upcGateway;
}

export function startHealthScaleObservation({ userIdentityService, systemBots, eventBus, observationStore, nutribotServices, householdId, rootLogger, setObservationService }) {
  // Scale → Nutribot: settled kitchen-scale weights become density-logged food entries,
  // posted to the household head. Target chat resolved from head identity.
  try {
    const scaleHeadUser = configService.getHeadOfHousehold();
    const scaleHeadPlatformId = scaleHeadUser
      ? userIdentityService.resolvePlatformId('telegram', scaleHeadUser)
      : null;
    const scaleBotId = systemBots.nutribot?.telegram?.bot_id || '';
    if (scaleHeadUser) {
      setObservationService(createObservationService({
        // The composition root owns the transport. The application layer describes a
        // SCALE-SIGNAL SOURCE, not a generic event bus — which is also why the old bridge
        // had to live in the adapter layer to subscribe at all.
        scaleGateway: {
          subscribe: (listener) => {
            const unsubscribe = eventBus.subscribe('food-scale', listener);
            return () => { try { unsubscribe?.(); } catch { /* noop */ } };
          },
        },
        observationStore,
        nutribotContainer: nutribotServices.nutribotContainer,
        // For the Phase-1 `settled: false` stamp, and for resolving the committed ITEM's
        // uuid — which is what an observation's `pairedEntryUuid` points at.
        foodLogStore: nutribotServices.nutribotContainer.getFoodLogStore?.() || null,
        userId: scaleHeadUser,
        conversationId: scaleHeadPlatformId && scaleBotId ? `telegram:b${scaleBotId}_c${scaleHeadPlatformId}` : `device:${scaleHeadUser}`,
        scaleConfig: nutribotServices.scaleConfig,
        timezone: configService.getHouseholdTimezone?.(householdId),
        clock: () => new Date(),
        scheduler: { setTimeout, clearTimeout },
        commitQuietMs: (nutribotServices.scaleConfig?.commitQuietSec ?? 25) * 1000,
        logger: rootLogger.child({ module: 'observation-service' }),
      }));
    } else {
      rootLogger.warn?.('observation.service.skipped', { hasPlatformId: !!scaleHeadPlatformId, hasBotId: !!scaleBotId });
    }
  } catch (e) {
    rootLogger.warn?.('observation.service.wireFailed', { error: e.message });
  }

}

export function registerHealthMaintenance({ healthServices, rootLogger, scheduler }) {
  // Weekly meal-template curation (PRD F6.2): mines the last 90 days for
  // repeated combos and files them as PROPOSALS. It creates no template — the
  // person approves or dismisses each one in the picker, and a dismissal is
  // remembered forever. Safe to re-run: every proposal is keyed by its core
  // set and an already-known key is skipped, so a double tick is a no-op.
  // Sunday 04:10 — after the nightly archive rotation, before anyone is up.
  //
  // Composed inside a guard, and NOT allowed to be fatal: a wiring error in a
  // nutrition convenience must not take media, fitness and school down at boot
  // (the same posture as the unwired-scale decision). It fails loudly in the
  // log and the weekly task simply never registers.
  let templateCuration = null;
  try {
    templateCuration = createTemplateCurationJob({
      healthServices,
      logger: rootLogger.child({ module: 'health-template-curation' }),
    });
  } catch (err) {
    rootLogger.error('health.templates.curation.compose_failed', { error: err.message });
  }
  if (scheduler && templateCuration) {
    scheduler.registerTask('health:template-curation', '10 4 * * 0', async () => {
      const username = configService.getHeadOfHousehold?.() || configService.getDefaultUsername?.();
      if (!username) {
        rootLogger.warn('health.templates.curation.no_user', {});
        return;
      }
      try {
        await templateCuration.run(username);
      } catch (err) {
        rootLogger.warn('health.templates.curation.failed', { error: err.message });
      }
    });
  }

  // Weekly food-catalog drift audit (catalog-density fix, step 5). It READS:
  // it compares each catalog entry's derived serving against that food's own
  // logged history and logs what disagrees. It writes no nutrition and files
  // no proposal on its own — the report is recomputed on demand at
  // GET /api/v1/health/nutrition/catalog/audit, where a person approves or
  // dismisses each row. Sunday 04:10, beside the template curation, for the
  // same reason: after the nightly archive rotation, before anyone is up.
  //
  // Composed inside a guard and NOT allowed to be fatal, the same posture as
  // the curation job above: a wiring error in a nutrition convenience must not
  // take media, fitness and school down at boot.
  let catalogAudit = null;
  try {
    catalogAudit = createCatalogAuditService({
      healthServices,
      logger: rootLogger.child({ module: 'health-catalog-audit' }),
    });
  } catch (err) {
    rootLogger.error('health.catalog.audit.compose_failed', { error: err.message });
  }
  if (scheduler && catalogAudit) {
    scheduler.registerTask('health:catalog-audit', '10 4 * * 0', async () => {
      const username = configService.getHeadOfHousehold?.() || configService.getDefaultUsername?.();
      if (!username) {
        rootLogger.warn('health.catalog.audit.no_user', {});
        return;
      }
      try {
        const report = await catalogAudit.report(username);
        rootLogger.info('health.catalog.audit.weekly', {
          username,
          scanned: report.scanned,
          considered: report.considered,
          flagged: report.entries.length,
          names: report.entries.slice(0, 20).map((e) => e.name),
        });
      } catch (err) {
        rootLogger.warn('health.catalog.audit.failed', { error: err.message });
      }
    });
  }

}
