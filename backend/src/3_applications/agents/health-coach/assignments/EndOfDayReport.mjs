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
      weight,
      workouts,
      coachingHistory,
      goals,
      nutritionHistory,
    ] = await Promise.all([
      call('get_today_nutrition',        { userId }),
      call('get_weight_trend',           { userId, days: 7 }),
      call('get_recent_workouts',        { userId }),
      call('get_coaching_history',       { userId, days: 7 }),
      call('get_user_goals',             { userId }),
      call('get_nutrition_history',      { userId, days: 7 }),
    ]);

    logger?.info?.('gather.complete', {
      hasTodayNutrition:    !!todayNutrition,
      hasWeight:            !!weight?.current,
      hasWorkouts:          !!workouts,
      hasCoachingHistory:   !!coachingHistory,
      hasGoals:             !!goals,
      hasNutritionHistory:  !!nutritionHistory,
    });

    return { todayNutrition, weight, workouts, coachingHistory, goals, nutritionHistory };
  }

  /**
   * Build a focused end-of-day prompt from gathered data and working memory.
   * The LLM uses this to produce the structured coaching message JSON.
   */
  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Date: ${today}`];

    sections.push(`\n## Tracked Nutrition (today)\n${JSON.stringify(gathered.todayNutrition || {}, null, 2)}`);
    sections.push(`\n## Nutrition History (last 7 days — for trend context)\n${JSON.stringify(gathered.nutritionHistory || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(gathered.goals || {}, null, 2)}`);
    sections.push(`\n## Weight Trend (7 days)\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## Today's Workouts\n${JSON.stringify(gathered.workouts || {}, null, 2)}`);
    sections.push(`\n## Recent Coaching History (last 7 days — for dedup)\n${JSON.stringify(gathered.coachingHistory || {}, null, 2)}`);
    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    sections.push(`\n## Instructions
Produce a JSON object matching the coachingMessageSchema:
- should_send: true unless there is genuinely nothing useful to say
- text: the message body (HTML formatted, under 200 words)
- parse_mode: "HTML"

Writing rules:
- State today's calories and protein vs goals with exact numbers and the delta (e.g., "1628 cal — 28 over your 1600 ceiling, protein 83g — 37g short of 120g target")
- Zoom out: compare today against the 7-day trend — is this day better or worse? Is there a multi-day pattern? Calculate the weekly average vs target
- If today exceeded calorie goal: prescribe a specific compensatory target for tomorrow (e.g., "aim for 1200 tomorrow to keep the weekly average in range")
- If there's a multi-day overshoot streak, calculate the cumulative surplus and what it takes to recover
- If protein is short: state the gap in grams and the weekly protein average vs target
- USE THE FOOD ITEMS to give specific, comparative insight across days:
  - Find a recent "good day" from nutrition history where macros were on target and CONTRAST it with today: "On the 24th you hit 148g protein at 1425 cal with salmon + protein shake + Premier Protein — today was 83g at 1628 cal because it was all appetizer food"
  - Name the specific items that made the good day work AND the specific items that derailed today
  - Frame it as a tradeoff: "the fried mac & cheese balls (330 cal, 9g protein) vs a Premier Protein (160 cal, 30g protein) — same slot, wildly different outcome"
  - Don't just note what's missing — connect the dots between food choices and the macro result
- Reference weight trend to ground the stakes (e.g., "weight up 0.4 lbs this week — the calorie surplus is showing up on the scale")
- Do NOT mention implied intake, calorie adjustments, or tracking accuracy — today's data is too recent
- Do not repeat any coaching point from the coaching history in the last 7 days
- Never say "great job", "awesome", "well done", or similar cheerleading
- Never give generic advice like "consider adjusting" or "ensure you're logging" — be specific and prescriptive
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
