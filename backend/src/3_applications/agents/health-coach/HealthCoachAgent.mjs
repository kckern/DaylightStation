// backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { HealthToolFactory } from './tools/HealthToolFactory.mjs';
import { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
import { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
import { ReconciliationToolFactory } from './tools/ReconciliationToolFactory.mjs';
import { MessagingChannelToolFactory } from './tools/MessagingChannelToolFactory.mjs';
import { DailyDashboard } from './assignments/DailyDashboard.mjs';
import { MorningBrief } from './assignments/MorningBrief.mjs';
import { NoteReview } from './assignments/NoteReview.mjs';
import { EndOfDayReport } from './assignments/EndOfDayReport.mjs';
import { WeeklyDigest } from './assignments/WeeklyDigest.mjs';
import { ExerciseReaction } from './assignments/ExerciseReaction.mjs';
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

    // New assignments
    this.registerAssignment(new MorningBrief());
    this.registerAssignment(new NoteReview());
    this.registerAssignment(new EndOfDayReport());
    this.registerAssignment(new WeeklyDigest());
    this.registerAssignment(new ExerciseReaction());
  }

  async runAssignment(assignmentId, opts = {}) {
    // Inject default userId from config if not provided (e.g., scheduler trigger)
    if (!opts.userId) {
      opts.userId = this.deps.configService?.getHeadOfHousehold?.() || 'default';
    }
    const result = await super.runAssignment(assignmentId, opts);

    // Existing: persist dashboard
    if (assignmentId === 'daily-dashboard' && result) {
      const writeTool = this.getTools().find(t => t.name === 'write_dashboard');
      if (writeTool) {
        const today = new Date().toISOString().split('T')[0];
        await writeTool.execute({ userId: opts.userId, date: today, dashboard: result });
      }
    }

    // New: deliver coaching messages via messaging channel
    const coachingAssignments = ['morning-brief', 'note-review', 'end-of-day-report', 'weekly-digest', 'exercise-reaction'];
    if (coachingAssignments.includes(assignmentId) && result?.should_send) {
      const sendTool = this.getTools().find(t => t.name === 'send_channel_message');
      if (sendTool) {
        await sendTool.execute({ text: result.text, parseMode: result.parse_mode || 'HTML' });
      }
      // Log coaching note for end-of-day report
      if (assignmentId === 'end-of-day-report') {
        const noteTool = this.getTools().find(t => t.name === 'log_coaching_note');
        if (noteTool) {
          const today = new Date().toISOString().split('T')[0];
          await noteTool.execute({
            userId: opts.userId,
            date: today,
            note: { type: 'observation', text: result.text },
          });
        }
      }
    }

    return result;
  }
}
