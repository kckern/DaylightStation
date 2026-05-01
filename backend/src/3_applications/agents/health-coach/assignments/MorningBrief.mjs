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

    const yesterdayDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const [reconciliation, weight, goals, todayNutrition, nutritionHistory, yesterdayClosed] = await Promise.all([
      call('get_reconciliation_summary', { userId, days: 7 }),
      call('get_weight_trend', { userId, days: 7 }),
      call('get_user_goals', { userId }),
      call('get_today_nutrition', { userId }),
      call('get_nutrition_history', { userId, days: 7 }),
      call('is_day_closed', { userId, date: yesterdayDate }),
    ]);

    logger?.info?.('gather.complete', {
      hasReconciliation: !!reconciliation,
      hasWeight: !!weight?.current,
      hasGoals: !!goals,
      hasTodayNutrition: !!todayNutrition,
      hasNutritionHistory: !!nutritionHistory,
      yesterdayClosed: !!yesterdayClosed?.closed,
    });

    // Pattern signal detection (F-105.1) — when a notable trailing streak
    // is present, ground the coaching in a historical analog by querying
    // find_similar_period. We only fire on streaks ≥3 days to avoid spending
    // tokens on irrelevant precedent during normal weeks.
    const similarPeriod = await this.#detectAndQuerySimilarPeriod({
      tools,
      userId,
      nutritionHistory,
      weight,
      goals,
      logger,
    });

    return {
      reconciliation,
      weight,
      goals,
      todayNutrition,
      nutritionHistory,
      yesterdayClosed: !!yesterdayClosed?.closed,
      similarPeriod,
    };
  }

  /**
   * Inspect the last 7 days of nutrition history for a trailing calorie-surplus
   * or protein-shortfall streak (≥3 days). When detected, build a 7-day pattern
   * signature and query find_similar_period for the closest historical analog.
   * Returns the top match, or null when no streak is present / the lookup fails.
   *
   * @returns {Promise<null | { name: string, score: number, period: object }>}
   */
  async #detectAndQuerySimilarPeriod({ tools, userId, nutritionHistory, weight, goals, logger }) {
    const days = Array.isArray(nutritionHistory?.days)
      ? nutritionHistory.days
      : Array.isArray(nutritionHistory)
        ? nutritionHistory
        : [];
    if (days.length === 0) return null;

    const calMax = goals?.goals?.nutrition?.calories_max;
    const proteinMin = goals?.goals?.nutrition?.protein_min;

    // Trailing streak counters — start from the most recent day and walk back
    // until the streak breaks. This favors today's coaching relevance over
    // arbitrary windows earlier in the week.
    const trailingStreak = (predicate) => {
      let count = 0;
      for (let i = days.length - 1; i >= 0; i--) {
        if (predicate(days[i])) count += 1;
        else break;
      }
      return count;
    };

    const calorieSurplusStreak = typeof calMax === 'number'
      ? trailingStreak(d => typeof d?.calories === 'number' && d.calories > calMax)
      : 0;
    const proteinShortfallStreak = typeof proteinMin === 'number'
      ? trailingStreak(d => typeof d?.protein === 'number' && d.protein < proteinMin)
      : 0;

    const streakDetected = calorieSurplusStreak >= 3 || proteinShortfallStreak >= 3;
    if (!streakDetected) return null;

    const tool = tools.find(t => t.name === 'find_similar_period');
    if (!tool) {
      logger?.warn?.('morning_brief.similar_period.error', { reason: 'tool_not_registered' });
      return null;
    }

    // Build the signature from the same 7-day nutrition window plus the
    // weight history we already gathered. Missing dimensions are simply
    // omitted from the resulting object — the finder ignores them.
    const numericCalories = days.map(d => d?.calories).filter(v => typeof v === 'number');
    const numericProtein = days.map(d => d?.protein).filter(v => typeof v === 'number');
    const trackedDays = days.filter(d => typeof d?.calories === 'number' && d.calories > 0).length;

    const weightHistory = Array.isArray(weight?.history) ? weight.history : [];
    const numericWeights = weightHistory
      .map(w => (typeof w?.lbs === 'number' ? w.lbs : null))
      .filter(v => v !== null);

    const avg = (arr) => (arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length);

    const signature = {};
    const proteinAvg = avg(numericProtein);
    if (proteinAvg !== null) signature.protein_avg_g = proteinAvg;
    const calorieAvg = avg(numericCalories);
    if (calorieAvg !== null) signature.calorie_avg = calorieAvg;
    if (days.length > 0) signature.tracking_rate = trackedDays / days.length;
    const weightAvg = avg(numericWeights);
    if (weightAvg !== null) signature.weight_avg_lbs = weightAvg;
    if (numericWeights.length >= 2) {
      signature.weight_delta_lbs = numericWeights[numericWeights.length - 1] - numericWeights[0];
    }

    logger?.info?.('morning_brief.similar_period.queried', {
      userId,
      calorieSurplusStreak,
      proteinShortfallStreak,
      signatureDimensions: Object.keys(signature),
    });

    try {
      const result = await tool.execute({ userId, pattern_signature: signature, max_results: 1 });
      const matches = Array.isArray(result?.matches) ? result.matches : [];
      if (matches.length === 0) {
        return null;
      }
      const top = matches[0];
      logger?.info?.('morning_brief.similar_period.match_found', {
        name: top?.name,
        score: top?.score,
      });
      return {
        name: top?.name,
        score: top?.score,
        period: top?.period || null,
      };
    } catch (err) {
      logger?.warn?.('morning_brief.similar_period.error', { error: err?.message });
      return null;
    }
  }

  /**
   * Build a focused prompt from gathered data and working memory.
   * The LLM uses this to produce the structured coaching message JSON.
   */
  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Date: ${today}`];

    sections.push(`\n## Reconciliation Summary\nNote: implied_intake and tracking_accuracy are REDACTED for days less than 14 days old. Only mature data (14+ days) includes these fields. Do NOT mention implied intake or tracking accuracy for yesterday or any recent day.\n${JSON.stringify(gathered.reconciliation || {}, null, 2)}`);
    sections.push(`\n## Weight Trend (7 days)\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(gathered.goals || {}, null, 2)}`);
    sections.push(`\n## Nutrition History (last 7 days — calories, protein, macros per day)\n${JSON.stringify(gathered.nutritionHistory || {}, null, 2)}`);
    sections.push(`\n## Today's Nutrition (so far)\n${JSON.stringify(gathered.todayNutrition || {}, null, 2)}`);
    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    // Similar Period — historical analog when a notable pattern signal fired
    // during gather (F-105.1). The section anchors any "the last time this
    // happened" coaching language in concrete personal precedent.
    if (gathered.similarPeriod && gathered.similarPeriod.period) {
      const sp = gathered.similarPeriod;
      const period = sp.period || {};
      const stats = period.stats || {};
      const fmt = (v) => (typeof v === 'number' ? Number(v.toFixed(2)) : 'n/a');
      sections.push(
        `\n## Similar Period — historical analog for the current pattern\n` +
        `Period: ${sp.name ?? period.name ?? 'unknown'} (${period.from ?? '?'} → ${period.to ?? '?'})\n` +
        `Description: ${period.description || '(no description)'}\n` +
        `Stats: weight_avg=${fmt(stats.weight_avg_lbs)} protein_avg=${fmt(stats.protein_avg_g)}g ` +
        `calorie_avg=${fmt(stats.calorie_avg)} tracking_rate=${fmt(stats.tracking_rate)}\n` +
        `Use this as concrete personal precedent when the coach references "the last time this happened".`
      );
    }

    // Detect likely incomplete logging yesterday
    const calorieFloor = gathered.goals?.goals?.nutrition?.calories_min || 1200;
    const yesterdayDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const history = gathered.nutritionHistory?.days || gathered.nutritionHistory || [];
    const yesterdayEntry = Array.isArray(history)
      ? history.find(d => d.date === yesterdayDate)
      : history[yesterdayDate];
    const yesterdayCals = yesterdayEntry?.calories ?? yesterdayEntry?.total_calories ?? null;
    // Under calorie min = incomplete, UNLESS user explicitly marked the day as done
    const incompleteDay = yesterdayCals !== null && yesterdayCals < calorieFloor && !gathered.yesterdayClosed;

    sections.push(`\n## Instructions
Produce a JSON object matching the coachingMessageSchema:
- should_send: true (morning brief always sends unless there is genuinely nothing to say)
- text: the message body (HTML formatted, under 200 words)
- parse_mode: "HTML"
${incompleteDay ? `
INCOMPLETE LOGGING DETECTED — OVERRIDE NORMAL COACHING:
Yesterday's tracked calories (~${Math.round((yesterdayCals || 0) / 50) * 50}) are below the daily minimum target (${calorieFloor}), and the user did NOT mark the day as done via /done. This almost certainly means the user forgot to log one or more meals — NOT that they actually ate this little. DO NOT lecture about missed goals or undereating. Instead:
1. Note what WAS logged yesterday (name the specific items)
2. Point out the total looks incomplete — "looks like dinner didn't get logged" or similar
3. Ask the user what they had for the missing meal(s) so it can be logged
4. Keep it brief and helpful, not judgmental
This takes priority over ALL other coaching rules below.
` : ''}
Writing rules:
- Lead with yesterday's ACTUAL tracked calories AND protein vs goals with exact deltas — use the nutrition history data, not reconciliation (which lacks protein)
- Then zoom out: what does the 7-day trend look like? Are calories consistently over/under? Is protein chronically short? Identify the pattern, not just yesterday's snapshot
- If yesterday exceeded the calorie ceiling, prescribe a specific compensatory target for today (e.g., "aim for ${gathered.goals?.goals?.nutrition?.calories_min || 1200} today to offset")
- If there's a multi-day overshoot streak, calculate the cumulative surplus and what it takes to get back on track this week
- If protein is short: state the gap in grams and the weekly average vs target
- USE THE FOOD ITEMS to give specific, comparative insight across days:
  - Find a recent "good day" from nutrition history and CONTRAST it with yesterday: "On the 24th you hit 148g protein at 1425 cal with salmon + protein shake + Premier Protein — yesterday was all appetizer food, 83g protein at 1628 cal"
  - Name the specific items that made the good day work AND the specific items that derailed yesterday
  - Frame it as a tradeoff: "the fried mac & cheese balls (330 cal, 9g protein) vs a Premier Protein (160 cal, 30g protein) — same slot, wildly different outcome"
  - Use the good day as a blueprint for today: "get back to the salmon + shake pattern and you'll hit protein while staying under 1400"
- Reference weight trend direction to ground the stakes (e.g., "weight up 0.4 lbs — the 3-day calorie surplus is showing up on the scale")
- Never say "great job", "awesome", or similar empty praise
- Do NOT reference implied intake, calorie adjustments, or tracking accuracy for any day in the last 14 days
- Round calories to the nearest 50 and protein to the nearest 5g — "~1650 cal" not "1628 cal". False precision undermines trust
- Do NOT give generic advice like "consider adjusting your intake" or "ensure you're logging all meals" — be specific and prescriptive based on the actual numbers
- Flag missed tracking days (days with 0 tracked calories) if present
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
