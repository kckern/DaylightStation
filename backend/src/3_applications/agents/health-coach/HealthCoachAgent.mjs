// backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { HealthToolFactory } from './tools/HealthToolFactory.mjs';
import { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
import { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
import { DailyDashboard } from './assignments/DailyDashboard.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class HealthCoachAgent extends BaseAgent {
  static id = 'health-coach';
  static description = 'Health coaching and fitness dashboard agent';

  getSystemPrompt() {
    return systemPrompt;
  }

  registerTools() {
    const { healthStore, healthService, fitnessPlayableService, dataService } = this.deps;

    this.addToolFactory(new HealthToolFactory({ healthStore, healthService }));
    this.addToolFactory(new FitnessContentToolFactory({ fitnessPlayableService, dataService }));
    this.addToolFactory(new DashboardToolFactory({ dataService, healthStore }));

    // Register assignments
    this.registerAssignment(new DailyDashboard());
  }

  async runAssignment(assignmentId, opts = {}) {
    // Inject default userId from config if not provided (e.g., scheduler trigger)
    if (!opts.userId) {
      opts.userId = this.deps.configService?.getHeadOfHousehold?.() || 'default';
    }
    const result = await super.runAssignment(assignmentId, opts);

    // Persist the dashboard for daily-dashboard assignment
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
