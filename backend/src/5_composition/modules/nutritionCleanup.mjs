import { MastraAdapter } from '#adapters/agents/MastraAdapter.mjs';
import { MastraRunAdapter } from '#adapters/agents/MastraRunAdapter.mjs';
import { AgentTranscriptFileStore } from '#adapters/agents/AgentTranscriptFileStore.mjs';
import { YamlAgentStateStore } from '#adapters/persistence/yaml/YamlAgentStateStore.mjs';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { YamlSavedMealsDatastore } from '#adapters/persistence/yaml/YamlSavedMealsDatastore.mjs';
import { IconManifestStore } from '#adapters/persistence/IconManifestStore.mjs';
import { TelegramNutribotIdentity } from '#adapters/nutribot/TelegramNutribotIdentity.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { AgentExecutionPolicy } from '#apps/agents/framework/AgentExecutionPolicy.mjs';
import { NutritionAuditor } from '#apps/agents/nutrition-auditor/NutritionAuditor.mjs';
import { NutritionCleanup } from '#apps/nutrition/NutritionCleanup.mjs';
import { NutritionRepairService } from '#apps/nutrition/NutritionRepairService.mjs';
import { CleanupQuestionSurface } from '#apps/nutrition/CleanupQuestionSurface.mjs';

export function createNutritionCleanup({ dataService, configService, userIdentityService, nutribotServices, upcGateway, agentOrchestrator, logger, scheduled = false, server }) {
  const clock = { now: () => Date.now() };
  const container = nutribotServices.nutribotContainer;
  const timezoneFor = userId => container.getConfig?.()?.getUserTimezone?.(userId) || 'America/Los_Angeles';
  const icons = new IconManifestStore({ dataService, mediaRoot: configService.getMediaDir(), logger });
  const store = new YamlAgentStateStore({ dataService });
  const items = nutribotServices.nutriListStore;
  const foodLogs = nutribotServices.foodLogStore;
  const runtime = new MastraAdapter({ model: configService.getAppConfig?.('agents')?.nutrition_auditor?.model || 'openai/gpt-4o',
    logger, maxToolCalls: 20, timeoutMs: 120000, executionPolicy: new AgentExecutionPolicy({ maxToolCalls: 20, logger,
      transcriptStore: new AgentTranscriptFileStore({ mediaDir: configService.getMediaDir() }) }) });
  const dbDir = configService.getDataDir() + '/agents';
  const runs = new MastraRunAdapter({ dbPath: dbDir + '/cleanup-runs.db' });
  const auditor = new NutritionAuditor({ runtime, items, foodLogs, clock, timezoneFor, icons, upc: upcGateway,
    catalog: new YamlFoodCatalogDatastore({ dataService, logger }), meals: new YamlSavedMealsDatastore({ dataService }) });
  agentOrchestrator?.register(NutritionAuditor, { ...auditor, runtime });
  const repairs = new NutritionRepairService({ items, foodLogs, review: container.getFoodLogReview(), icons, clock, timezoneFor });
  const cleanup = new NutritionCleanup({ store, runs, auditor, repairs, items, foodLogs, clock, timezoneFor, logger });
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
  const stop = scheduled ? new NodeApplicationScheduler().every(30000, tick) : () => {};
  server?.once?.('close', stop);
  cleanup.stop = stop;
  if (scheduled) void tick();
  return cleanup;
}
