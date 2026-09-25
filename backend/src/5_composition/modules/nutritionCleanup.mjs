import { MastraAdapter } from '#adapters/agents/MastraAdapter.mjs';
import { MastraRunAdapter } from '#adapters/agents/MastraRunAdapter.mjs';
import { AgentTranscriptFileStore } from '#adapters/agents/AgentTranscriptFileStore.mjs';
import { YamlAgentStateStore } from '#adapters/persistence/yaml/YamlAgentStateStore.mjs';
import { JsonlAuditJournalStore } from '#adapters/persistence/yaml/JsonlAuditJournalStore.mjs';
import { sha256Text } from '#system/utils/sha256.mjs';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { YamlSavedMealsDatastore } from '#adapters/persistence/yaml/YamlSavedMealsDatastore.mjs';
import { YamlObservationStore } from '#adapters/persistence/yaml/YamlObservationStore.mjs';
import { IconManifestStore } from '#adapters/persistence/IconManifestStore.mjs';
import { PhotoStore } from '#adapters/persistence/PhotoStore.mjs';
import { YamlArtworkQueueStore } from '#adapters/persistence/yaml/YamlArtworkQueueStore.mjs';
import { TelegramNutribotIdentity } from '#adapters/nutribot/TelegramNutribotIdentity.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { AgentExecutionPolicy } from '#apps/agents/framework/AgentExecutionPolicy.mjs';
import { NutritionAuditor } from '#apps/agents/nutrition-auditor/NutritionAuditor.mjs';
import { NutritionCleanup } from '#apps/nutrition/NutritionCleanup.mjs';
import { DEFAULT_AUDITOR_SETTINGS } from '#domains/nutrition/services/auditorPolicy.mjs';
import { NutritionRepairService } from '#apps/nutrition/NutritionRepairService.mjs';
import { CleanupQuestionSurface } from '#apps/nutrition/CleanupQuestionSurface.mjs';
import { NutritionStabilization } from '#apps/nutrition/NutritionStabilization.mjs';
import { NutritionCaptureRecovery } from '#apps/nutrition/NutritionCaptureRecovery.mjs';
import { ArtworkRemediation } from '#apps/nutrition/ArtworkRemediation.mjs';
import { NutritionAuditTriage } from '#apps/nutrition/NutritionAuditTriage.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

export function createNutritionCleanup({ dataService, configService, userIdentityService, nutribotServices, upcGateway, decisionGateway = null, agentOrchestrator, logger, usageRecorder = null, scheduled = false, server, journalSource = null }) {
  const clock = { now: () => Date.now() };
  const container = nutribotServices.nutribotContainer;
  const timezoneFor = userId => container.getConfig?.()?.getUserTimezone?.(userId) || 'America/Los_Angeles';
  const icons = new IconManifestStore({ dataService, mediaRoot: configService.getMediaDir(), logger });
  const store = new YamlAgentStateStore({ dataService });
  const items = nutribotServices.nutriListStore;
  const foodLogs = nutribotServices.foodLogStore;
  // Auditor settings own the model: every run passes its own. This default only
  // covers a call made without one (a run queued before settings recorded a model).
  const runtime = new MastraAdapter({ model: 'openai/' + DEFAULT_AUDITOR_SETTINGS.model,
    logger, usageRecorder, maxToolCalls: 20, timeoutMs: 120000, executionPolicy: new AgentExecutionPolicy({ maxToolCalls: 20, logger,
      transcriptStore: new AgentTranscriptFileStore({ mediaDir: configService.getMediaDir() }) }) });
  const dbDir = configService.getDataDir() + '/agents';
  const runs = new MastraRunAdapter({ dbPath: dbDir + '/cleanup-runs.db' });
  const catalog = new YamlFoodCatalogDatastore({ dataService, logger });
  const auditor = new NutritionAuditor({ runtime, items, foodLogs, clock, timezoneFor, icons, upc: upcGateway,
    observations: new YamlObservationStore({ dataService, logger }),
    catalog, meals: new YamlSavedMealsDatastore({ dataService }) });
  agentOrchestrator?.register(NutritionAuditor, { ...auditor, runtime });
  const repairs = new NutritionRepairService({ items, foodLogs, review: container.getFoodLogReview(), icons, clock, timezoneFor });
  // The artwork remediation queue (design 2026-09-23 §5): every icon or photo
  // that cannot be shown is queued and worked until fixed. Row fixes go through
  // the same repair service (audited, undoable); the nearest-icon pick uses the
  // UPC use case's AI gateway, confined to the manifest.
  const artwork = new ArtworkRemediation({ queue: new YamlArtworkQueueStore({ dataService }), items, repairs, catalog, icons,
    aiGateway: container.getAIGateway?.() || null, iconChooser: container.getIconChooser?.() || null, upcGateway, photos: new PhotoStore({ dataService, logger }), clock, logger });
  auditor.artwork = artwork;
  const stabilization = new NutritionStabilization({ items, review: container.getFoodLogReview(), clock, logger });
  // agents.yml → nutrition_auditor.triage: { mode: shadow|gate|off, threshold }
  const triageConfig = configService.getAppConfig?.('agents')?.nutrition_auditor?.triage || {};
  const triage = new NutritionAuditTriage({ decisionGateway, mode: triageConfig.mode, threshold: triageConfig.threshold,
    logger: logger.child?.({ module: 'nutrition-triage' }) || logger });
  // Run journal: one file per writer (journalSource, the same id the AI usage
  // ledger uses), since prod and a dev machine share the Dropbox data tree.
  const journal = new JsonlAuditJournalStore({ dataService, source: journalSource, logger });
  const cleanup = new NutritionCleanup({ store, runs, auditor, repairs, items, foodLogs, clock, timezoneFor, logger, stabilization, triage,
    journal, hash: sha256Text });
  cleanup.recovery = new NutritionCaptureRecovery({ review: container.getFoodLogReview(), items,
    observations: new YamlObservationStore({ dataService, logger }),
    scaleConfig: () => normalizeScaleNutribotConfig(configService.getHouseholdAppConfig?.(null, 'scales') || {}) });
  const identity = userIdentityService?.resolvePlatformId ? new TelegramNutribotIdentity({ configService, userIdentityService }) : null;
  const surface = new CleanupQuestionSurface({ cleanup, destinationFor: userId => identity?.conversationIdFor(userId) || null,
    gateway: container.getMessagingGateway(), logger });
  cleanup.handleTelegram = (...args) => surface.handle(...args);
  const userId = configService.getHeadOfHousehold();
  let ticking = false;
  const tick = async () => {
    if (ticking || !userId) return;
    ticking = true;
    try { await cleanup.tick(userId); await surface.sync(userId); }
    catch (error) { logger.warn('nutrition.cleanup.tick_failed', { error: error.message }); }
    finally { ticking = false; }
  };
  // Artwork: sweep the last day and work due items every ~2 min, sweep the last
  // week every ~hour. Same
  // gate, same owner and the same non-overlapping guard as the cleanup tick.
  let artworkBusy = false;
  const artworkRun = (label, work) => async () => {
    if (artworkBusy || !userId) return;
    artworkBusy = true;
    try { await work(); }
    catch (error) { logger.warn('artwork.queue.' + label + '_failed', { error: error.message }); }
    finally { artworkBusy = false; }
  };
  // Each 2-minute tick first sweeps today and yesterday, so a capture that
  // lands on `default` is queued within minutes rather than at the hourly sweep.
  const artworkTick = artworkRun('tick', async () => { await artwork.sweep(userId, { sinceDays: 1 }); await artwork.tick(userId); });
  const artworkSweep = artworkRun('sweep', async () => { await artwork.sweep(userId, { sinceDays: 7 }); await artwork.tick(userId); });
  const scheduler = scheduled ? new NodeApplicationScheduler() : null;
  const stops = scheduler ? [scheduler.every(30000, tick), scheduler.every(2 * 60 * 1000, artworkTick), scheduler.every(60 * 60 * 1000, artworkSweep)] : [];
  const stop = () => { for (const halt of stops) halt(); };
  server?.once?.('close', stop);
  cleanup.stop = stop;
  cleanup.artwork = artwork;
  if (scheduled) { void tick(); void artworkSweep(); }
  return cleanup;
}
