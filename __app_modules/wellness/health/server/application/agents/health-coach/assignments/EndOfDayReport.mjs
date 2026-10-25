import { automatedAssignmentDeps, canonicalCoachingResult, assignmentEvidence } from './budgetContext.mjs';
// __backend/src/3_applications/agents/health-coach/assignments/EndOfDayReport.mjs

import { Assignment } from "../../../../../../../../__capabilities/agent-runtime/server/application/framework/Assignment.mjs";
import { coachingMessageSchema } from "../schemas/coachingMessage.mjs";
import { DEFAULT_TZ, localDate, goalsWithRange } from "./budgetContext.mjs";

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
 * 5. ACT - no-op; returns a validated payload; caller owns any delivery
 */
export class EndOfDayReport extends Assignment {
  static id = 'end-of-day-report';
  static description = 'Coaching commentary for daily nutrition report';
  // No static schedule — event-triggered

  async execute(deps) {
    return super.execute(automatedAssignmentDeps(deps));
  }

  /**
   * Gather phase — programmatic tool calls (no LLM).
   * Fetches raw nutrition, adjusted nutrition, reconciliation, weight trend,
   * today's workouts, and recent coaching history in parallel.
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

    // The user's LOCAL date: a UTC date is already tomorrow after 5pm Pacific.
    const todayDate = context?.date || localDate(0, context?.timezone);

    const [
      todayNutrition,
      weight,
      workouts,
      coachingHistory,
      goals,
      nutritionHistory,
    ] = await Promise.all([
      // The budget contract: totals, range, zone and COMPLETE (floor or declared).
      call('get_day_budget',             { userId, date: todayDate }),
      call('get_weight_trend',           { userId, days: 7 }),
      call('get_recent_workouts',        { userId }),
      call('get_coaching_history',       { userId, days: 7 }),
      call('get_user_goals',             { userId }),
      call('get_budget_range',           { userId, days: 7 }),
    ]);

    logger?.info?.('gather.complete', {
      hasTodayNutrition:    !!todayNutrition,
      hasWeight:            !!weight?.current,
      hasWorkouts:          !!workouts,
      hasCoachingHistory:   !!coachingHistory,
      hasGoals:             !!goals,
      hasNutritionHistory:  !!nutritionHistory,
      todayComplete:        todayNutrition?.complete ?? null,
      todayDeclared:        todayNutrition?.declared ?? null,
    });

    return { userId, eventItems: context?.eventItems || [], todayNutrition, weight, workouts, coachingHistory, goals, nutritionHistory, todayClosed: !!todayNutrition?.declared };
  }

  /**
   * Build a focused end-of-day prompt from gathered data and working memory.
   * The LLM uses this to produce the structured coaching message JSON.
   */
  buildPrompt(gathered, memory) {
    const now = new Date();
    const tz = gathered.todayNutrition?.timezone || DEFAULT_TZ;
    const today = gathered.todayNutrition?.date || localDate(0, tz);
    const logComplete = gathered.todayNutrition?.assessment?.trustworthy === true;
    const sections = [`## Date: ${today}\n## Current Local Time: ${now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })}\n## Logging Complete: ${logComplete}`];

    sections.push(`\n## Tracked Nutrition (today so far)\n${JSON.stringify(gathered.todayNutrition || {}, null, 2)}`);
    sections.push(`\n## Nutrition History (last 7 days — for trend context)\n${JSON.stringify(gathered.nutritionHistory || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(goalsWithRange(gathered.goals, gathered.todayNutrition), null, 2)}`);
    sections.push(`\n## Weight Trend (7 days)\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## Today's Workouts\n${JSON.stringify(gathered.workouts || {}, null, 2)}`);
    sections.push(`\n## Recent Coaching History (last 7 days — for dedup)\n${JSON.stringify(gathered.coachingHistory || {}, null, 2)}`);
    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    sections.push(`\n## Assessed Budget Evidence\n${JSON.stringify(assignmentEvidence(gathered), null, 2)}`);
    sections.push(`\n## Instructions
Produce raw JSON matching coachingMessageSchema, including should_send and text.
${!logComplete ? 'INCOMPLETE LOGGING DETECTED: the log is partial or budget evidence is unavailable. An incomplete log does not support an intake verdict.' : ''}
Logging completeness and finished-day lifecycle are separate. No protein failure verdict for a live day or unknown protein.
Compare food with the exercise-adjusted plan; exercise credit is included exactly once. The logging floor is not a target.
Do NOT mention implied intake or tracking accuracy for recent days. Never infer compensatory targets from legacy goals.
Only actual eventItems support just-logged language. Delivered facts are rendered deterministically from shared observations.`);

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
    return canonicalCoachingResult(raw, gathered, 'post-report', logger);
  }

  /**
   * Act phase — no-op.
   * This assignment returns the validated payload; it does not send or persist messages.
   */
  async act(validated, { memory, userId, logger }) {
    // Legacy result-only path; scheduled notifications use CoachingOrchestrator.
  }
}
