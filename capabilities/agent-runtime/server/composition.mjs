import { isContainerRuntime } from "#system/runtime/runtimeEnvironment.mjs";
import { AgentConfigProjection } from './adapters/AgentConfigProjection.mjs';
import crypto from "node:crypto";
import { AgentOrchestrator } from './application/AgentOrchestrator.mjs';
import { EchoAgent } from './application/echo/index.mjs';
import { Scheduler } from "#adapters/scheduling/AgentAssignmentScheduler.mjs";
import { agentSchedulerEnabled } from "./composition/agentSchedulerEnabled.mjs";
import { WorkingMemoryRepository } from "./application/framework/WorkingMemoryRepository.mjs";
import { AgentExecutionPolicy } from "./application/framework/AgentExecutionPolicy.mjs";
import { AgentTranscriptFileStore, MastraAdapter, MastraAgentMemoryFactory, MastraMemoryProcessorFactory, YamlWorkingMemoryAdapter } from "./adapters/index.mjs";

export function createAgentRuntimeServices(config) {
  const { logger = console, agentUsageRecorder = null, dataService, configService } = config;
  const agentConfigProjection = new AgentConfigProjection({ configService });

  // Mastra reads API keys from process.env — bridge from ConfigService
  if (configService) {
    const openaiKey = configService.getSystemAuth('openai', 'api_key');
    if (openaiKey && !process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = openaiKey;
    }
  }

  // Resolve mediaDir early so all MastraAdapter instances can write transcripts.
  // Falls back to a sibling of the data directory if getMediaDir is unavailable.
  const mediaDir = configService?.getMediaDir?.() || null;

  // Build Mastra Memory for cross-session persistence. Uses LibSQL (SQLite) backed
  // by data/agents/memory.db. Factory creates parent dir if missing.
  const dataPath = configService?.getDataDir?.() ?? 'data';
  const memoryFactory = new MastraAgentMemoryFactory();
  const memoryProcessorFactory = new MastraMemoryProcessorFactory();
  let mastraMemory = null;
  try {
    mastraMemory = memoryFactory.createMemory({
      dbPath: `${dataPath}/agents/memory.db`,
      lastMessages: 20,
      // Working memory disabled pending JSONSchema fix. With @mastra/memory@1.17.5
      // the Zod-to-JSONSchema conversion of healthCoachWorkingMemorySchema (all
      // fields .optional()) produces { type: "None" }, which OpenAI rejects:
      //   "Invalid schema for function 'updateWorkingMemory': schema must be
      //    a JSON Schema of 'type: \"object\"', got 'type: \"None\"'"
      // Fix path: pass JSONSchema7 directly OR make at least one field
      // required so Zod produces a valid object schema.
    });
  } catch (memErr) {
    logger.warn?.('agent.memory.init_failed', { error: memErr.message });
  }

  // Create Mastra adapter (IAgentRuntime implementation)
  const transcriptStore = mediaDir ? new AgentTranscriptFileStore({ mediaDir }) : null;
  const maxToolCalls = 50;
  const agentRuntime = new MastraAdapter({
    logger,
    usageRecorder: agentUsageRecorder,
    mediaDir,
    memory: mastraMemory,
    maxToolCalls,
    executionPolicy: new AgentExecutionPolicy({ maxToolCalls, logger, transcriptStore }),
  });

  // Create working memory adapter for agent state persistence
  const workingMemory = new WorkingMemoryRepository({
    recordStore: new YamlWorkingMemoryAdapter({ dataService, logger }),
  });

  // Create orchestrator
  const agentOrchestrator = new AgentOrchestrator({
    agentRuntime,
    resolveDefaultUserId: () => configService.getHeadOfHousehold?.(),
    createTurnId: crypto.randomUUID,
    logger,
  });

  // Create scheduler for cron-triggered assignments
  const scheduler = new Scheduler({
    logger,
    enabled: agentSchedulerEnabled({
      nodeEnv: process.env.NODE_ENV,
      enableCron: process.env.ENABLE_CRON,
      isContainer: isContainerRuntime(),
    }),
  });

  // Register available agents
  agentOrchestrator.register(EchoAgent, { workingMemory });


  return { agentConfigProjection, dataPath, maxToolCalls, transcriptStore, memoryFactory, memoryProcessorFactory, workingMemory, agentOrchestrator, scheduler, mediaDir };
}
