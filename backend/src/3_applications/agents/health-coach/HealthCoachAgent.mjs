// backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { HealthToolFactory } from './tools/HealthToolFactory.mjs';
import { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
import { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
import { ReconciliationToolFactory } from './tools/ReconciliationToolFactory.mjs';
import { MessagingChannelToolFactory } from './tools/MessagingChannelToolFactory.mjs';
import { DailyDashboard } from './assignments/DailyDashboard.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class HealthCoachAgent extends BaseAgent {
  static id = 'health-coach';
  static description = 'Health coaching and fitness dashboard agent';

  getSystemPrompt() {
    return systemPrompt;
  }

  registerTools() {
    const { healthStore, healthService, fitnessPlayableService, sessionService, mediaProgressMemory, dataService, messagingGateway, conversationId } = this.deps;

    // Existing
    this.addToolFactory(new HealthToolFactory({ healthStore, healthService, sessionService }));
    this.addToolFactory(new FitnessContentToolFactory({ fitnessPlayableService, mediaProgressMemory, dataService }));
    this.addToolFactory(new DashboardToolFactory({ dataService, healthStore }));

    // New: reconciliation data access
    this.addToolFactory(new ReconciliationToolFactory({ healthStore }));

    // New: messaging channel delivery (only if gateway available)
    if (messagingGateway && conversationId) {
      this.addToolFactory(new MessagingChannelToolFactory({ messagingGateway, conversationId }));
    }

    // Existing assignment
    this.registerAssignment(new DailyDashboard());
  }

  async runAssignment(assignmentId, opts = {}) {
    if (!opts.userId) {
      opts.userId = this.deps.configService?.getHeadOfHousehold?.() || 'default';
    }
    const result = await super.runAssignment(assignmentId, opts);

    if (assignmentId === 'daily-dashboard' && result) {
      const writeTool = this.getTools().find(t => t.name === 'write_dashboard');
      if (writeTool) {
        const today = new Date().toISOString().split('T')[0];
        await writeTool.execute({ userId: opts.userId, date: today, dashboard: result });
      }
    }

    return result;
  }
}
