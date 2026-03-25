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

    const [reconciliation, weight, nutritionHistory, goals] = await Promise.all([
      call('get_reconciliation_summary', { userId, days: 7 }),
      call('get_weight_trend',           { userId, days: 14 }),
      call('get_nutrition_history',      { userId, days: 7 }),
      call('get_user_goals',             { userId }),
    ]);

    logger?.info?.('gather.complete', {
      hasReconciliation:   !!reconciliation,
      hasWeight:           !!weight?.current,
      hasNutritionHistory: !!nutritionHistory,
      hasGoals:            !!goals,
    });

    return { reconciliation, weight, nutritionHistory, goals };
  }

  /**
   * Build a focused weekly summary prompt from gathered data and working memory.
   * The LLM uses this to produce the structured coaching message JSON.
   */
  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Week ending: ${today}`];

    sections.push(`\n## Reconciliation Summary (7-day window)\nIMPORTANT: Due to 14-day weight smoothing, these accuracy numbers reflect eating behavior from ~4 weeks ago. Frame as historical: "About 4 weeks ago, tracking accuracy was X%".\n${JSON.stringify(gathered.reconciliation || {}, null, 2)}`);
    sections.push(`\n## Weight Trend (14 days — for both 7d and 14d trends)\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## Nutrition History (7 days)\n${JSON.stringify(gathered.nutritionHistory || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(gathered.goals || {}, null, 2)}`);
    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    sections.push(`\n## Instructions
Produce a JSON object matching the coachingMessageSchema:
- should_send: true (weekly digest always sends unless there is genuinely no data)
- text: the message body (HTML formatted, under 250 words)
- parse_mode: "HTML"

Writing rules:
- Provide a weekly summary covering: avg tracked vs avg adjusted calories, accuracy trend, missed tracking days, best and worst tracking days, protein avg vs target, weight trend (7d and 14d if available)
- Keep text under 250 words
- Never use cheerleading language ("great job", "awesome", "well done") — just data and trend observations
- Reference specific numbers from the gathered data (averages, deltas, counts)
- Note whether the accuracy trend is improving, declining, or flat over the week
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
