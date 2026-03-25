// backend/src/3_applications/agents/health-coach/assignments/EndOfDayReport.mjs

import { Assignment } from '../../framework/Assignment.mjs';
import { OutputValidator } from '../../framework/OutputValidator.mjs';
import { coachingMessageSchema } from '../schemas/coachingMessage.mjs';

/**
 * EndOfDayReport - Event-triggered assignment that produces coaching commentary
 * for the daily nutrition report.
 *
 * Triggered when the last pending log is accepted (no static schedule).
 *
 * Lifecycle:
 * 1. GATHER - parallel tool calls for raw + adjusted nutrition, reconciliation,
 *             weight trend, workouts, and coaching history
 * 2. PROMPT - assemble gathered data + memory into a focused coaching prompt
 * 3. REASON - LLM produces a structured coaching message JSON
 * 4. VALIDATE - JSON Schema check via OutputValidator
 * 5. ACT - no-op; delivery + coaching note logging handled by HealthCoachAgent.runAssignment()
 */
export class EndOfDayReport extends Assignment {
  static id = 'end-of-day-report';
  static description = 'Coaching commentary for daily nutrition report';
  // No static schedule — event-triggered

  /**
   * Gather phase — programmatic tool calls (no LLM).
   * Fetches raw nutrition, adjusted nutrition, reconciliation, weight trend,
   * today's workouts, and recent coaching history in parallel.
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

    const [
      todayNutrition,
      adjustedNutrition,
      reconciliation,
      weight,
      workouts,
      coachingHistory,
    ] = await Promise.all([
      call('get_today_nutrition',        { userId }),
      call('get_adjusted_nutrition',     { userId }),
      call('get_reconciliation_summary', { userId, days: 7 }),
      call('get_weight_trend',           { userId, days: 7 }),
      call('get_recent_workouts',        { userId }),
      call('get_coaching_history',       { userId, days: 7 }),
    ]);

    logger?.info?.('gather.complete', {
      hasTodayNutrition:    !!todayNutrition,
      hasAdjustedNutrition: !!adjustedNutrition,
      hasReconciliation:    !!reconciliation,
      hasWeight:            !!weight?.current,
      hasWorkouts:          !!workouts,
      hasCoachingHistory:   !!coachingHistory,
    });

    return { todayNutrition, adjustedNutrition, reconciliation, weight, workouts, coachingHistory };
  }

  /**
   * Build a focused end-of-day prompt from gathered data and working memory.
   * The LLM uses this to produce the structured coaching message JSON.
   */
  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Date: ${today}`];

    sections.push(`\n## Raw Tracked Nutrition (today)\n${JSON.stringify(gathered.todayNutrition || {}, null, 2)}`);
    sections.push(`\n## Adjusted Nutrition (with multiplier/phantom)\n${JSON.stringify(gathered.adjustedNutrition || {}, null, 2)}`);
    sections.push(`\n## Reconciliation Summary (7-day window)\nIMPORTANT: Due to 14-day weight smoothing, these accuracy numbers reflect eating behavior from ~4 weeks ago. Frame as historical: "About 4 weeks ago, tracking accuracy was X%".\n${JSON.stringify(gathered.reconciliation || {}, null, 2)}`);
    sections.push(`\n## Weight Trend (7 days)\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## Today's Workouts\n${JSON.stringify(gathered.workouts || {}, null, 2)}`);
    sections.push(`\n## Recent Coaching History (last 7 days — for dedup)\n${JSON.stringify(gathered.coachingHistory || {}, null, 2)}`);
    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    sections.push(`\n## Instructions
Produce a JSON object matching the coachingMessageSchema:
- should_send: true unless there is genuinely nothing useful to say
- text: the message body (HTML formatted, under 150 words)
- parse_mode: "HTML"

Writing rules:
- Show both raw and adjusted numbers side by side so the user can see the difference
- If tracking accuracy is below 70%, lead with that — it is the most important signal
- Reference the 7-day weight trend to ground advice in real outcomes (e.g., "down 0.5 lbs over 7 days")
- Do not repeat any coaching point that appears in the coaching history from the last 7 days
- Never say "great job", "awesome", "well done", or similar empty praise — data only
- Keep the message under 150 words
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
      throw new Error('EndOfDayReport output is not valid JSON');
    }

    const result = OutputValidator.validate(parsed, coachingMessageSchema);
    if (!result.valid) {
      logger?.warn?.('validate.schema_failure', { errors: result.errors });
      throw new Error(`EndOfDayReport validation failed: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  }

  /**
   * Act phase — no-op.
   * Delivery and coaching note logging are handled by HealthCoachAgent.runAssignment()
   * after execute() returns.
   */
  async act(validated, { memory, userId, logger }) {
    // Delivery + coaching note logging handled by HealthCoachAgent.runAssignment()
  }
}
