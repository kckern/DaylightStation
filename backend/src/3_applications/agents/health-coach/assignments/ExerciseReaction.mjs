// backend/src/3_applications/agents/health-coach/assignments/ExerciseReaction.mjs

import { Assignment } from '../../framework/Assignment.mjs';
import { OutputValidator } from '../../framework/OutputValidator.mjs';
import { coachingMessageSchema } from '../schemas/coachingMessage.mjs';

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
 * It is handled by HealthCoachAgent.runAssignment() post-execute.
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
    if (!activity || activity.calories < 200) {
      return { should_send: false };
    }
    return super.execute(deps);
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
      call('get_today_nutrition', { userId }),
      call('get_user_goals', { userId }),
    ]);

    logger?.info?.('gather.complete', {
      activityType: activity.type,
      activityCalories: activity.calories,
      hasTodayNutrition: !!todayNutrition,
      hasGoals: !!goals,
    });

    return { activity, todayNutrition, goals };
  }

  /**
   * Build a focused prompt with activity details, today's nutrition, and net calories.
   */
  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Date: ${today}`];

    const activity = gathered.activity || {};
    const loggedCalories = gathered.todayNutrition?.calories ?? 0;
    const exerciseCalories = activity.calories ?? 0;
    const netCalories = loggedCalories - exerciseCalories;

    sections.push(`\n## Activity\n${JSON.stringify(activity, null, 2)}`);
    sections.push(`\n## Today's Nutrition\n${JSON.stringify(gathered.todayNutrition || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(gathered.goals || {}, null, 2)}`);
    sections.push(`\n## Net Calorie Summary
- Logged calories today: ${loggedCalories}
- Exercise calories burned: ${exerciseCalories}
- Net calories (logged - exercise): ${netCalories}`);

    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    sections.push(`\n## Instructions
Produce a JSON object matching the coachingMessageSchema:
- Activity details: type (${activity.type || 'unknown'}), calories burned (${exerciseCalories}), duration (${activity.duration ?? 'unknown'} min), avg HR (${activity.avgHr ?? 'unknown'})
- Today's logged calories so far: ${loggedCalories}
- Net calories (logged - exercise): ${netCalories}
- Remaining calorie need relative to goal
- Keep text under 100 words
- Factual only — no cheerleading, no "great job", no "keep it up"
- Return raw JSON matching coachingMessageSchema
- text: the message body (HTML formatted, under 100 words) — only set if should_send is true
- parse_mode: "HTML"

Return raw JSON only, no markdown code fences.`);

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
    let parsed;
    try {
      parsed = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output;
    } catch {
      throw new Error('ExerciseReaction output is not valid JSON');
    }

    const result = OutputValidator.validate(parsed, coachingMessageSchema);
    if (!result.valid) {
      logger?.warn?.('validate.schema_failure', { errors: result.errors });
      throw new Error(`ExerciseReaction validation failed: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  }

  /**
   * Act phase — if message is being sent, record exercise today in working memory.
   * Message delivery is handled by HealthCoachAgent after execute() returns.
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
