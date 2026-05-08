import { BaseAgent } from '../framework/BaseAgent.mjs';
import { PlanToolFactory } from './tools/PlanToolFactory.mjs';
import { LifelogToolFactory } from './tools/LifelogToolFactory.mjs';
import { CeremonyToolFactory } from './tools/CeremonyToolFactory.mjs';
import { NotificationToolFactory } from './tools/NotificationToolFactory.mjs';
import { CoachingToolFactory } from './tools/CoachingToolFactory.mjs';
import { CadenceCheck } from './assignments/CadenceCheck.mjs';
import { systemPrompt } from './prompts/system.mjs';
import { loadAgentConfig } from '../framework/loadAgentConfig.mjs';
import { lifeplanGuideWorkingMemoryTemplate } from './memory/workingMemoryTemplate.mjs';
import { buildObservationalMemory } from '../framework/buildObservationalMemory.mjs';

export class LifeplanGuideAgent extends BaseAgent {
  static id = 'lifeplan-guide';
  static description = 'Personal life coach for goal tracking, value alignment, and ceremony facilitation';

  /**
   * Per-agent Mastra Memory configuration. Shares the same working memory
   * schema as health-coach so user observations made by either agent are
   * visible to both via resource-scoped storage.
   *
   * (When lifeplan-guide grows its own observation fields, union the schema
   * with health-coach's or split into per-agent Memory instances.)
   */
  static getMemoryConfig({ configService } = {}) {
    const yaml = loadAgentConfig({ configService, agentId: 'lifeplan-guide' });
    const m = yaml.memory;
    const out = { lastMessages: m.last_messages };
    if (m.working_memory?.enabled) {
      out.workingMemory = {
        enabled: true,
        scope: m.working_memory.scope || 'resource',
        template: lifeplanGuideWorkingMemoryTemplate,
      };
    }
    return out;
  }

  /**
   * Build memory processors for this agent. Currently: ObservationalMemory for
   * auto-compaction of long threads. T5 will add the TimeWindow processor.
   *
   * @param {{ configService?, memory? }} [deps]
   * @returns {{ inputProcessors: Array, outputProcessors: Array }}
   */
  static getMemoryProcessors({ configService, memory } = {}) {
    const yaml = loadAgentConfig({ configService, agentId: 'lifeplan-guide' });
    const storage = memory?.storage?.stores?.memory ?? null;
    const obs = buildObservationalMemory(yaml.memory?.observational, { storage });
    return {
      inputProcessors:  obs ? [obs] : [],
      outputProcessors: obs ? [obs] : [],
    };
  }

  getSystemPrompt(_context = {}) {
    return systemPrompt;
  }

  registerTools() {
    const {
      lifePlanStore, goalStateService, beliefEvaluator, feedbackService,
      aggregator, metricsStore, driftService,
      ceremonyService, ceremonyRecordStore, cadenceService,
      notificationService,
      conversationStore, workingMemory,
    } = this.deps;

    this.addToolFactory(new PlanToolFactory({
      lifePlanStore, goalStateService, beliefEvaluator, feedbackService,
    }));

    this.addToolFactory(new LifelogToolFactory({
      aggregator, metricsStore, driftService,
    }));

    this.addToolFactory(new CeremonyToolFactory({
      ceremonyService, ceremonyRecordStore, cadenceService, lifePlanStore,
    }));

    this.addToolFactory(new NotificationToolFactory({
      notificationService,
    }));

    this.addToolFactory(new CoachingToolFactory({
      conversationStore, workingMemory,
    }));

    this.registerAssignment(new CadenceCheck());
  }
}
