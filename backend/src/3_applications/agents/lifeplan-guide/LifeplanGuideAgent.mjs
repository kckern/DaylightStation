import { BaseAgent } from '../framework/BaseAgent.mjs';
import { PlanToolFactory } from './tools/PlanToolFactory.mjs';
import { LifelogToolFactory } from './tools/LifelogToolFactory.mjs';
import { CeremonyToolFactory } from './tools/CeremonyToolFactory.mjs';
import { NotificationToolFactory } from './tools/NotificationToolFactory.mjs';
import { CoachingToolFactory } from './tools/CoachingToolFactory.mjs';
import { CadenceCheck } from './assignments/CadenceCheck.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class LifeplanGuideAgent extends BaseAgent {
  static id = 'lifeplan-guide';
  static description = 'Personal life coach for goal tracking, value alignment, and ceremony facilitation';

  getSystemPrompt() {
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
