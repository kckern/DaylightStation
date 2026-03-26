// backend/src/3_applications/agents/health-coach/assignments/WeeklyDigest.mjs

import { Assignment } from '../../framework/Assignment.mjs';
import { OutputValidator } from '../../framework/OutputValidator.mjs';
import { coachingMessageSchema } from '../schemas/coachingMessage.mjs';

/**
 * WeeklyDigest - Scheduled assignment that sends a weekly nutrition and health trend summary.
 *
 * Runs every Sunday at 7pm.
 *
 * Lifecycle:
 * 1. GATHER - programmatically call tools for reconciliation, weight trend (14d), nutrition history, and goals
 * 2. PROMPT - assemble gathered data + memory into a weekly trend coaching prompt
 * 3. REASON - LLM produces a structured coaching message JSON
 * 4. VALIDATE - JSON Schema check via OutputValidator
 * 5. ACT - set last_weekly_digest in working memory (7-day TTL)
 *
 * Note: Message delivery (send_channel_message) is NOT done here.
 * It is handled by HealthCoachAgent.runAssignment() post-execute.
 */
export class WeeklyDigest extends Assignment {
  static id = 'weekly-digest';
  static description = 'Weekly nutrition and health trend summary';
  static schedule = '0 19 * * 0';

  /**
   * Gather phase — programmatic tool calls (no LLM).
   * Fetches reconciliation summary (7d), weight trend (14d), nutrition history (7d),
   * and user goals in parallel.
   */
  async gather({ tools, userId, memory, logger }) {
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

    const [reconciliation, weight, weightLongTerm, nutritionHistory, goals] = await Promise.all([
      call('get_reconciliation_summary', { userId, days: 84 }),
      call('get_weight_trend',           { userId, days: 14 }),
      call('get_weight_trend',           { userId, days: 84 }),
      call('get_nutrition_history',      { userId, days: 7 }),
      call('get_user_goals',             { userId }),
    ]);

    logger?.info?.('gather.complete', {
      hasReconciliation:   !!reconciliation,
      hasWeight:           !!weight?.current,
      hasWeightLongTerm:   !!weightLongTerm?.current,
      hasNutritionHistory: !!nutritionHistory,
      hasGoals:            !!goals,
    });

    return { reconciliation, weight, weightLongTerm, nutritionHistory, goals };
  }

  /**
   * Build a focused weekly summary prompt from gathered data and working memory.
   * The LLM uses this to produce the structured coaching message JSON.
   */
  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Week ending: ${today}`];

    sections.push(`\n## Reconciliation Summary (12-week / 84-day window)\nNote: implied_intake and tracking_accuracy are ONLY present on mature days (14+ days old). Recent days only have tracked_calories and exercise_calories. This is by design.\n${JSON.stringify(gathered.reconciliation || {}, null, 2)}`);
    sections.push(`\n## Weight Trend (14 days — recent)\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## Weight Trend (12 weeks — long-term)\n${JSON.stringify(gathered.weightLongTerm || {}, null, 2)}`);
    sections.push(`\n## This Week's Nutrition (7 days)\n${JSON.stringify(gathered.nutritionHistory || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(gathered.goals || {}, null, 2)}`);
    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    sections.push(`\n## Instructions
Produce a JSON object matching the coachingMessageSchema:
- should_send: true (weekly digest always sends unless there is genuinely no data)
- text: the message body (HTML formatted, under 300 words)
- parse_mode: "HTML"

Writing rules:
- Frame this week in context of the 6-12 week trend. Did this week contribute to or detract from goals?
- This week's data: avg tracked calories, protein avg vs target, missed tracking days (0 tracked calories), weight change over 7 days
- Long-term context (from mature days 14+ days old): tracking accuracy trend over months, implied intake averages, weight trajectory over 6-12 weeks
- Show how this week compares: "This week you averaged X tracked calories vs Y/week over the past 2 months"
- Do NOT reference implied intake or tracking accuracy for any day less than 14 days old
- Keep text under 300 words
- Never use cheerleading language ("great job", "awesome", "well done") — just data and trend observations
- Reference specific numbers from the gathered data
- Return raw JSON only, no markdown code fences`);

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
   * @param {Object} raw - { output: string, toolCalls: Array }
   * @param {Object} gathered - Data from gather phase
   * @param {Object} logger - Logger
   * @returns {Object} Validated and parsed coaching message object
   * @throws {Error} If output is not valid JSON or fails schema validation
   */
  async validate(raw, gathered, logger) {
    let parsed;
    try {
      parsed = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output;
    } catch {
      throw new Error('WeeklyDigest output is not valid JSON');
    }

    const result = OutputValidator.validate(parsed, coachingMessageSchema);
    if (!result.valid) {
      logger?.warn?.('validate.schema_failure', { errors: result.errors });
      throw new Error(`WeeklyDigest validation failed: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  }

  /**
   * Act phase — record that the weekly digest ran in working memory with a 7-day TTL.
   * Message delivery is handled by HealthCoachAgent after execute() returns.
   */
  async act(validated, { memory, userId, logger }) {
    memory.set('last_weekly_digest', new Date().toISOString(), { ttl: 7 * 24 * 60 * 60 * 1000 });

    logger?.info?.('act.complete', {
      userId,
      should_send: validated.should_send,
    });
  }
}
