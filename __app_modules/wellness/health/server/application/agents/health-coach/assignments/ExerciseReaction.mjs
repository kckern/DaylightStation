import { automatedAssignmentDeps, canonicalCoachingResult, assignmentEvidence, localDate, goalsWithRange } from './budgetContext.mjs';
// __backend/src/3_applications/agents/health-coach/assignments/ExerciseReaction.mjs

import { Assignment } from "../../../../../../../../__capabilities/agent-runtime/server/application/framework/Assignment.mjs";
import { coachingMessageSchema } from "../schemas/coachingMessage.mjs";

/**
 * ExerciseReaction - Strava webhook-triggered assignment.
 * Produces a post-exercise context message with net calorie info.
 *
 * Lifecycle:
 * 1. EARLY EXIT — skip LLM entirely if activity calories < 200 (trivial activity)
 * 2. GATHER — load today's nutrition and user goals from tools
 * 3. PROMPT — assemble activity + nutrition data into a focused prompt
 * 4. REASON — LLM produces a structured coaching message JSON
 * 5. VALIDATE — JSON Schema check via OutputValidator
 * 6. ACT — if should_send, record exercise_today in working memory with 24h TTL
 *
 * Note: Message delivery (send_channel_message) is NOT done here.
 * This legacy assignment returns a validated payload to its caller; scheduled notifications use CoachingOrchestrator.
 */
export class ExerciseReaction extends Assignment {
  static id = 'exercise-reaction';
  static description = 'Post-exercise nutrition context message';
  // No static schedule — Strava webhook-triggered only

  /**
   * Override execute to guard against trivial activities before LLM pipeline.
   * @param {Object} deps - Same deps as Assignment.execute()
   * @returns {Promise<Object>} { should_send: false } for trivial, else super.execute()
   */
  async execute(deps) {
    const activity = deps.context?.activity;
    const burn = activity?.calories ?? activity?.caloriesBurned;
    if (!Number.isFinite(burn) || burn < 200) {
      return { should_send: false };
    }
    return super.execute(automatedAssignmentDeps(deps));
  }

  /**
   * Gather phase — programmatic tool calls (no LLM).
   * Loads today's nutrition and user goals.
   */
  async gather({ tools, userId, memory, logger, context }) {
    const call = (name, params) => {
      const tool = tools.find(t => t.name === name);
      if (!tool) {
        logger?.warn?.('gather.tool_not_found', { name });
        return Promise.resolve(null);
      }
      return tool.execute(params).catch(err => {
        logger?.warn?.('gather.tool_error', { name, error: err.message });
        return { error: err.message };
      });
    };

    const activity = context?.activity || {};

    const [todayNutrition, goals] = await Promise.all([
      call('get_day_budget', { userId, date: context?.date || localDate(0, context?.timezone) }),
      call('get_user_goals', { userId }),
    ]);

    logger?.info?.('gather.complete', {
      activityType: activity.type,
      activityCalories: activity.calories,
      hasTodayNutrition: !!todayNutrition,
      hasGoals: !!goals,
    });

    return { userId, activity, todayNutrition, goals };
  }

  /**
   * Build a focused prompt with activity details, today's nutrition, and net calories.
   */
  buildPrompt(gathered, memory) {
    const sections = [
      `## Activity\n${JSON.stringify(gathered.activity || {}, null, 2)}`,
      `## Canonical Daily Budget\n${JSON.stringify(assignmentEvidence(gathered), null, 2)}`,
      `## User Goals\n${JSON.stringify(goalsWithRange(gathered.goals, gathered.todayNutrition), null, 2)}`,
      `## Working Memory\n${memory.serialize()}`,
      `## Instructions\nSelect whether to send a factual activity reaction. Activity burn and synchronized daily exercise credit are distinct. Never add the activity burn to canonical credit. Return raw JSON matching coachingMessageSchema. Delivered facts are rendered from eligible shared observations.`,
    ];

    return sections.join('\n');
  }

  /**
   * Returns the JSON Schema that the LLM output must conform to.
   */
  getOutputSchema() {
    return coachingMessageSchema;
  }

  /**
   * Validate LLM output against the coachingMessageSchema.
   */
  async validate(raw, gathered, logger) {
    return canonicalCoachingResult(raw, gathered, 'exercise-reaction', logger);
  }

  /**
   * Act phase — if message is being sent, record exercise today in working memory.
   * This assignment returns the validated payload without sending a message.
   */
  async act(validated, { memory, userId, logger }) {
    if (validated.should_send) {
      memory.set('exercise_today', { timestamp: new Date().toISOString() }, { ttl: 24 * 60 * 60 * 1000 });
    }

    logger?.info?.('act.complete', {
      userId,
      should_send: validated.should_send,
    });
  }
}
