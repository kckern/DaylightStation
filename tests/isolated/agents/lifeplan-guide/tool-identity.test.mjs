import { describe, it, expect } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';
import { CeremonyToolFactory } from '#apps/agents/lifeplan-guide/tools/CeremonyToolFactory.mjs';
import { LifelogToolFactory } from '#apps/agents/lifeplan-guide/tools/LifelogToolFactory.mjs';
import { NotificationToolFactory } from '#apps/agents/lifeplan-guide/tools/NotificationToolFactory.mjs';
import { CoachingToolFactory } from '#apps/agents/lifeplan-guide/tools/CoachingToolFactory.mjs';

const stub = new Proxy({}, { get: () => () => ({}) });

it('no lifeplan-guide tool exposes a username param', () => {
  const factories = [
    new PlanToolFactory({ lifePlanStore: stub, goalStateService: stub, beliefEvaluator: stub, feedbackService: stub, planAuthoringService: stub }),
    new CeremonyToolFactory({ ceremonyService: stub, ceremonyRecordStore: stub, cadenceService: stub, lifePlanStore: stub }),
    new LifelogToolFactory({ aggregator: stub, metricsStore: stub, driftService: stub }),
    new NotificationToolFactory({ notificationService: stub }),
    new CoachingToolFactory({ conversationStore: stub, workingMemory: stub }),
  ];
  for (const f of factories) {
    for (const tool of f.createTools()) {
      expect(tool.parameters?.properties?.username, `${tool.name} still has username`).toBeUndefined();
    }
  }
});
