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
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    // User timezone from nutrilog or default to Pacific
    const tz = gathered.todayNutrition?.timezone || 'America/Los_Angeles';
    const localHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
    const dayComplete = localHour >= 20; // 8 PM — day is essentially over
    const sections = [`## Date: ${today}\n## Current Local Time: ${now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })}\n## Day Complete: ${dayComplete}`];

    sections.push(`\n## Tracked Nutrition (today so far)\n${JSON.stringify(gathered.todayNutrition || {}, null, 2)}`);
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

Critical context — time of day:
- CHECK THE TIME. If "Day Complete" is false, today's totals are PARTIAL — the user is still eating.
- When the day is incomplete, your PRIMARY job is remaining-budget coaching:
  1. State what's been consumed so far (cal + protein)
  2. Calculate the remaining budget: calories left to ceiling (round to nearest 50), protein still needed (round to nearest 5g)
  3. Prescribe the rest of the day in macro terms: "You've got ~700-1100 cal and ~90g protein left — that's a protein shake + a chicken-heavy dinner"
  4. Reference what worked on similar good days from nutrition history to suggest a concrete plan for the remaining meals (e.g., "a Premier Protein + salmon dinner like the 24th would close the protein gap at ~650 cal")
  5. If yesterday was an overshoot, factor that in: "after yesterday's 1628, aim for the low end tonight — keep it under 700 cal for dinner"
- When the day IS complete, evaluate the full day against goals and the 7-day trend

Weight-loss context:
- The user's objective is weight_loss. A low-calorie day after an overshoot is CORRECTIVE, not alarming
- Frame deficits after surplus days positively. Only flag undereating if it's a multi-day pattern

Writing rules:
- Zoom out: compare today against the 7-day trend — is this day better or worse? Is there a multi-day pattern? Calculate the weekly average vs target
- If today exceeded calorie goal (day complete): prescribe a specific compensatory target for tomorrow
- If there's a multi-day overshoot streak, calculate the cumulative surplus and what it takes to recover
- If protein is short: state the gap in grams and the weekly protein average vs target
- USE THE FOOD ITEMS to give specific, comparative insight across days:
  - Find a recent "good day" from nutrition history and CONTRAST it with today by naming specific foods
  - Frame tradeoffs: "the fried mac & cheese balls (330 cal, 9g protein) vs a Premier Protein (160 cal, 30g protein) — same slot, wildly different outcome"
  - Connect food choices to macro results — don't just list foods
- Reference weight trend to ground the stakes
- Do NOT mention implied intake, calorie adjustments, or tracking accuracy — today's data is too recent
- Do not repeat any coaching point from the coaching history in the last 7 days
- Never say "great job", "awesome", "well done", or similar cheerleading
- Round calories to the nearest 50 and protein to the nearest 5g — "~700 cal" not "714 cal". False precision undermines trust
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
