import { automatedAssignmentDeps, canonicalCoachingResult, assignmentEvidence } from './budgetContext.mjs';
// __backend/src/3_applications/agents/health-coach/assignments/WeeklyDigest.mjs

import { Assignment } from "../../../../../../../../__capabilities/agent-runtime/server/application/framework/Assignment.mjs";
import { coachingMessageSchema } from "../schemas/coachingMessage.mjs";
import { goalsWithRange, localDate } from "./budgetContext.mjs";

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
 * This legacy assignment returns a validated payload to its caller; scheduled notifications use CoachingOrchestrator.
 */
export class WeeklyDigest extends Assignment {
  static id = 'weekly-digest';
  static description = 'Weekly nutrition and health trend summary';
  static schedule = '0 19 * * 0';

  async execute(deps) {
    return super.execute(automatedAssignmentDeps(deps));
  }

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
      // The budget contract per day: calories, protein, net, range, zone, COMPLETE.
      call('get_budget_range',           { userId, days: 7 }),
      call('get_user_goals',             { userId }),
    ]);

    logger?.info?.('gather.complete', {
      hasReconciliation:   !!reconciliation,
      hasWeight:           !!weight?.current,
      hasWeightLongTerm:   !!weightLongTerm?.current,
      hasNutritionHistory: !!nutritionHistory,
      hasGoals:            !!goals,
    });

    // Pattern signal detection (F-105.2) — when the 7-day window shows a
    // sustained over-plan intake or protein shortfall against goals, query
    // find_similar_period for a historical analog. Mirrors MorningBrief's
    // approach but uses 7-day averages (the weekly cadence) rather than
    // trailing streaks.
    const similarPeriod = await this.#detectAndQuerySimilarPeriod({
      tools,
      userId,
      nutritionHistory,
      weight,
      goals,
      logger,
    });

    return { userId, reconciliation, weight, weightLongTerm, nutritionHistory, goals, similarPeriod };
  }

  /**
   * Inspect the 7-day nutrition window for a sustained over-plan intake
   * (avg > calories_max) or protein shortfall (avg < protein_min). When
   * detected, build a pattern signature from the same window plus the
   * 14-day weight history and query find_similar_period.
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

    const evidence = assignmentEvidence({ nutritionHistory: { days } });
    const trusted = evidence.days.filter(day => day.assessment.availability === 'available' && day.assessment.finished && day.assessment.trustworthy);
    const proteinMin = goals?.goals?.nutrition?.protein_min;
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const calorieAvg = evidence.period.averages.food;
    const numericProtein = trusted.filter(day => day.assessment.proteinKnown && typeof day.protein === 'number').map(day => day.protein);
    const proteinAvg = avg(numericProtein);
    const trackedDays = trusted.length;
    // Each food value is matched to its own exercise-adjusted boundary.
    const overPlan = evidence.period.averages.planDelta != null && evidence.period.averages.planDelta > 0;
    const proteinShortfall = typeof proteinMin === 'number' && proteinAvg !== null && proteinAvg < proteinMin;
    if (!overPlan && !proteinShortfall) return null;

    const tool = tools.find(t => t.name === 'find_similar_period');
    if (!tool) {
      logger?.warn?.('weekly_digest.similar_period.error', { reason: 'tool_not_registered' });
      return null;
    }

    // Signature uses the 14-day weight history that gather() already pulled.
    const weightHistory = Array.isArray(weight?.history) ? weight.history : [];
    const numericWeights = weightHistory
      .map(w => (typeof w?.lbs === 'number' ? w.lbs : null))
      .filter(v => v !== null);

    const signature = {};
    if (proteinAvg !== null) signature.protein_avg_g = proteinAvg;
    if (calorieAvg !== null) signature.calorie_avg = calorieAvg;
    if (days.length > 0) signature.tracking_rate = trackedDays / days.length;
    const weightAvg = avg(numericWeights);
    if (weightAvg !== null) signature.weight_avg_lbs = weightAvg;
    if (numericWeights.length >= 2) {
      signature.weight_delta_lbs = numericWeights[numericWeights.length - 1] - numericWeights[0];
    }

    logger?.info?.('weekly_digest.similar_period.queried', {
      userId,
      overPlan,
      proteinShortfall,
      signatureDimensions: Object.keys(signature),
    });

    try {
      const result = await tool.execute({ userId, pattern_signature: signature, max_results: 1 });
      const matches = Array.isArray(result?.matches) ? result.matches : [];
      if (matches.length === 0) {
        return null;
      }
      const top = matches[0];
      logger?.info?.('weekly_digest.similar_period.match_found', {
        name: top?.name,
        score: top?.score,
      });
      return {
        name: top?.name,
        score: top?.score,
        period: top?.period || null,
      };
    } catch (err) {
      logger?.warn?.('weekly_digest.similar_period.error', { error: err?.message });
      return null;
    }
  }

  /**
   * Build a focused weekly summary prompt from gathered data and working memory.
   * The LLM uses this to produce the structured coaching message JSON.
   */
  buildPrompt(gathered, memory) {
    const today = localDate(0);
    const sections = [`## Week ending: ${today}`];

    sections.push(`\n## Reconciliation Summary (12-week / 84-day window)\nNote: implied_intake and tracking_accuracy are ONLY present on mature days (14+ days old). Recent days only have tracked_calories and exercise_calories. This is by design.\n${JSON.stringify(gathered.reconciliation || {}, null, 2)}`);
    sections.push(`\n## Weight Trend (14 days — recent)\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## Weight Trend (12 weeks — long-term)\n${JSON.stringify(gathered.weightLongTerm || {}, null, 2)}`);
    sections.push(`\n## This Week's Nutrition (7 days)\n${JSON.stringify(gathered.nutritionHistory || {}, null, 2)}`);
    const latestDay = (gathered.nutritionHistory?.days || []).filter(d => d?.range).at(-1);
    sections.push(`\n## User Goals\n${JSON.stringify(goalsWithRange(gathered.goals, latestDay), null, 2)}`);
    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    // Similar Period — historical analog when a sustained weekly trend signal
    // fired during gather (F-105.2). The section anchors any "the last time
    // this happened" coaching language in concrete personal precedent.
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

    sections.push(`\n## Assessed Budget Evidence\n${JSON.stringify(assignmentEvidence(gathered), null, 2)}`);
    sections.push(`\n## Instructions
Produce raw JSON matching coachingMessageSchema, including should_send and text.
Use matched trustworthy finished dates for weekly calorie comparisons and disclose coverage and current configured goals.
Plan comparisons use exercise-adjusted food boundaries; surplus means above estimated maintenance. Unknown protein is not zero.
Keep recent and long-term weight and reconciliation context separate. Do NOT reference implied intake or tracking accuracy for any day less than 14 days old.
Delivered budget facts are rendered deterministically from shared observations.`);

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
    return canonicalCoachingResult(raw, gathered, 'weekly-digest', logger);
  }

  /**
   * Act phase — record that the weekly digest ran in working memory with a 7-day TTL.
   * This assignment returns the validated payload without sending a message.
   */
  async act(validated, { memory, userId, logger }) {
    memory.set('last_weekly_digest', new Date().toISOString(), { ttl: 7 * 24 * 60 * 60 * 1000 });

    logger?.info?.('act.complete', {
      userId,
      should_send: validated.should_send,
    });
  }
}
