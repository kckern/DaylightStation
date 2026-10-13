import { createNoOpNotificationService } from "#adapters/integrations/noops.mjs";
import { buildAgentMemory } from "../../../__capabilities/agent-runtime/server/application/framework/buildAgentMemory.mjs";
import { buildAgentRuntime } from "../../../__capabilities/agent-runtime/server/application/framework/buildAgentRuntime.mjs";
import { AgentExecutionPolicy } from "../../../__capabilities/agent-runtime/server/application/framework/AgentExecutionPolicy.mjs";
import { MastraAdapter } from "../../../__capabilities/agent-runtime/server/adapters/index.mjs";
import { LifeplanGuideAgent } from "./application/agents/lifeplan-guide/LifeplanGuideAgent.mjs";
import { YamlConversationStore } from "../../../__capabilities/agent-runtime/server/adapters/YamlConversationStore.mjs";

export function registerLifeplanGuide({ config, dataService, logger, mediaDir, dataPath, maxToolCalls, transcriptStore, memoryFactory, memoryProcessorFactory, agentConfigProjection, agentOrchestrator, workingMemory }) {
  // Register lifeplan guide agent (requires lifeplan services)
  if (config.lifeplanServices) {
    const conversationStore = new YamlConversationStore({
      basePath: dataService.resolveUserPath?.('') || dataService.basePath,
    });

    // Per-agent Mastra Memory for lifeplan-guide. Shares the resource-scoped
    // working memory schema with health-coach so observations cross over.
    // (sharedAgentDeps from the reflective loop above is inside a different
    // conditional scope — reconstruct the bits we need locally.)
    const lifeplanMemoryDeps = {
      dataPath,
      logger,
      mediaDir,
      agentId: 'lifeplan-guide',
      AgentRuntime: MastraAdapter,
      maxToolCalls,
      executionPolicy: new AgentExecutionPolicy({ maxToolCalls, logger, transcriptStore }),
      memoryFactory,
      memoryProcessorFactory,
    };
    const lifeplanMemoryConfig = LifeplanGuideAgent.getMemoryConfig?.({ agentConfigProjection }) ?? null;
    const lifeplanMemory = buildAgentMemory(lifeplanMemoryConfig, lifeplanMemoryDeps);
    const lifeplanProcessors = LifeplanGuideAgent.getMemoryProcessors?.({
      agentConfigProjection,
      memory: lifeplanMemory,
      memoryProcessorFactory,
    }) ?? null;
    const lifeplanRuntime = buildAgentRuntime(lifeplanMemory, lifeplanMemoryDeps, lifeplanProcessors);

    agentOrchestrator.register(LifeplanGuideAgent, {
      workingMemory,
      lifePlanStore: config.lifeplanServices.container.getLifePlanStore(),
      goalStateService: config.lifeplanServices.container.getGoalStateService(),
      beliefEvaluator: config.lifeplanServices.container.getBeliefEvaluator(),
      feedbackService: config.lifeplanServices.services.feedbackService,
      planAuthoringService: config.lifeplanServices.services.planAuthoringService,
      lifeEventSuggester: config.lifeplanServices.services.lifeEventSuggester,
      clock: { now: () => new Date() },
      aggregator: config.lifeplanServices.aggregator,
      metricsStore: config.lifeplanServices.container.getMetricsStore(),
      driftService: config.lifeplanServices.services.driftService,
      ceremonyService: config.lifeplanServices.services.ceremonyService,
      ceremonyRecordStore: config.lifeplanServices.container.getCeremonyRecordStore(),
      cadenceService: config.lifeplanServices.container.getCadenceService(),
      notificationService: config.notificationService || createNoOpNotificationService(),
      conversationStore,
      agentRuntime: lifeplanRuntime,
    });
  }

}
