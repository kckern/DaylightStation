// backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs

import { Assignment } from '../../framework/Assignment.mjs';
import { OutputValidator } from '../../framework/OutputValidator.mjs';
import { coachingMessageSchema } from '../schemas/coachingMessage.mjs';

/**
 * MorningBrief - Scheduled assignment that sends a daily reconciliation-aware nutrition brief.
 *
 * Lifecycle:
 * 1. GATHER - programmatically call tools for reconciliation, weight, goals, today's nutrition
 * 2. PROMPT - assemble gathered data + memory into a focused coaching prompt
 * 3. REASON - LLM produces a structured coaching message JSON
 * 4. VALIDATE - JSON Schema check via OutputValidator
 * 5. ACT - set last_morning_brief in working memory (24h TTL)
 *
 * Note: Message delivery (send_channel_message) is NOT done here.
 * It is handled by HealthCoachAgent.runAssignment() post-execute.
 */
export class MorningBrief extends Assignment {
  static id = 'morning-brief';
  static description = 'Daily nutrition brief with reconciled data';
  static schedule = '0 10 * * *';

  /**
   * Gather phase — programmatic tool calls (no LLM).
   * Fetches reconciliation summary, weight trend, user goals, and today's nutrition in parallel.
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

    const [reconciliation, weight, goals, todayNutrition] = await Promise.all([
      call('get_reconciliation_summary', { userId, days: 7 }),
      call('get_weight_trend', { userId, days: 7 }),
      call('get_user_goals', { userId }),
      call('get_today_nutrition', { userId }),
    ]);

    logger?.info?.('gather.complete', {
      hasReconciliation: !!reconciliation,
      hasWeight: !!weight?.current,
      hasGoals: !!goals,
      hasTodayNutrition: !!todayNutrition,
    });

    return { reconciliation, weight, goals, todayNutrition };
  }

  /**
   * Build a focused prompt from gathered data and working memory.
   * The LLM uses this to produce the structured coaching message JSON.
   */
  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Date: ${today}`];

    sections.push(`\n## Reconciliation Summary (7-day window)\nIMPORTANT: Due to 14-day weight smoothing, these accuracy numbers reflect eating behavior from ~4 weeks ago, not this week. Frame accordingly: "About 4 weeks ago, you were logging X% of actual intake" — NOT "this week's accuracy is X%".\n${JSON.stringify(gathered.reconciliation || {}, null, 2)}`);
    sections.push(`\n## Weight Trend (7 days)\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(gathered.goals || {}, null, 2)}`);
    sections.push(`\n## Today's Nutrition (so far)\n${JSON.stringify(gathered.todayNutrition || {}, null, 2)}`);
    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    sections.push(`\n## Instructions
Produce a JSON object matching the coachingMessageSchema:
- should_send: true (morning brief always sends unless there is genuinely nothing to say)
- text: the message body (HTML formatted, under 200 words)
- parse_mode: "HTML"

Writing rules:
- Lead with yesterday's reconciled numbers (tracked vs implied calories/protein), not cheerleading
- Reference specific numbers from the reconciliation and weight data
- Never say "great job", "awesome", or similar empty praise
- Note tracking accuracy trend (improving / declining / flat) if data is available
- Include today's calorie and protein targets from goals
- Mention weight trend direction (e.g., "down 0.3 lbs over 7 days") if weight data is present
- Flag missed tracking days if any are present in reconciliation
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
      throw new Error('MorningBrief output is not valid JSON');
    }

    const result = OutputValidator.validate(parsed, coachingMessageSchema);
    if (!result.valid) {
      logger?.warn?.('validate.schema_failure', { errors: result.errors });
      throw new Error(`MorningBrief validation failed: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  }

  /**
   * Act phase — record that the brief ran in working memory.
   * Message delivery is handled by HealthCoachAgent after execute() returns.
   */
  async act(validated, { memory, userId, logger }) {
    memory.set('last_morning_brief', new Date().toISOString(), { ttl: 24 * 60 * 60 * 1000 });

    logger?.info?.('act.complete', {
      userId,
      should_send: validated.should_send,
    });
  }
}
