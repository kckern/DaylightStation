import { automatedAssignmentDeps, canonicalCoachingResult, assignmentEvidence } from './budgetContext.mjs';
// __backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs

import { Assignment } from "../../../../../../../../__capabilities/agent-runtime/server/application/framework/Assignment.mjs";
import { coachingMessageSchema } from "../schemas/coachingMessage.mjs";
import { localDate, goalsWithRange } from "./budgetContext.mjs";

// F-003 / F2-C compliance CTA suppression TTL. The thresholds + CTA text
// themselves come entirely from playbook YAML (`coaching_dimensions[*]`);
// there are no hardcoded defaults in code. When the playbook declares no
// dimensions, this assignment skips the compliance section entirely.
const COMPLIANCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// F-004 PatternDetector integration. The detector receives a 30-day window per
// dimension and evaluates each playbook entry. To avoid daily nagging, every
// detection that fires today gets a 7-day TTL key written to working memory;
// detections whose key is already active are filtered out before reaching the
// prompt. The TTL constant is shared with the compliance path above.
const PATTERN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PATTERN_WINDOW_DAYS = 30;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

// F-007 DEXA staleness CTA. When the user's calibration anchor (most recent
// DEXA scan) is older than the threshold, surface a CTA prompting a re-scan —
// body-composition math is currently running on consumer-BIA without a recent
// truth anchor. The CTA is suppressed for 14 days via a working-memory key so
// the user isn't nagged daily once they've seen it.
const DEXA_STALENESS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_DEXA_STALENESS_THRESHOLD_DAYS = 180;
const DEXA_STALENESS_MEMORY_KEY = 'dexa_stale_warned';

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
 * This legacy assignment returns a validated payload to its caller; scheduled notifications use CoachingOrchestrator.
 */
export class MorningBrief extends Assignment {
  static id = 'morning-brief';
  static description = 'Daily nutrition brief with reconciled data';
  static schedule = '0 10 * * *';

  async execute(deps) {
    return super.execute(automatedAssignmentDeps(deps));
  }

  /**
   * Gather phase — programmatic tool calls (no LLM).
   * Fetches reconciliation summary, weight trend, user goals, and today's nutrition in parallel.
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

    // The user's LOCAL dates (a UTC date drifts a day in the evening).
    const todayDate = localDate(0);
    const yesterdayDate = localDate(-1);

    const [reconciliation, weight, goals, todayNutrition, nutritionHistory] = await Promise.all([
      call('get_reconciliation_summary', { userId, days: 7 }),
      call('get_weight_trend', { userId, days: 7 }),
      call('get_user_goals', { userId }),
      // The budget contract: totals, range, zone and COMPLETE (floor or declared).
      call('get_day_budget', { userId, date: todayDate }),
      call('get_budget_range', { userId, days: 7 }),
    ]);
    const historyDays = Array.isArray(nutritionHistory?.days) ? nutritionHistory.days : [];
    const yesterdayClosed = { closed: !!historyDays.find(d => d?.date === yesterdayDate)?.declared };

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

    // Compliance CTAs (F-003) — call get_compliance_summary, load the
    // user's playbook for thresholds + CTA copy, and surface CTAs whose
    // current trailing streak crosses the documented threshold. A 7-day
    // working-memory TTL key suppresses repeats so we don't nag every
    // morning.
    const complianceCtas = await this.#detectComplianceCtas({
      tools,
      userId,
      memory,
      personalContextLoader: context?.personalContextLoader,
      logger,
    });

    // Pattern detections (F-004) — pull 30-day windows from the longitudinal
    // tools + compliance summary, run the user's playbook patterns through
    // the injected PatternDetector, suppress any detections whose 7-day TTL
    // key is still active, then stamp fresh keys for the rest. The result
    // is rendered under "## Detected Patterns" in buildPrompt.
    const detectedPatterns = await this.#detectPatterns({
      tools,
      userId,
      memory,
      goals,
      personalContextLoader: context?.personalContextLoader,
      patternDetector: context?.patternDetector,
      logger,
    });

    // DEXA staleness CTA (F-007) — when the user's calibration anchor
    // exceeds the configured threshold (default 180 days; playbook may
    // override via coaching_thresholds.dexa_staleness_days), surface a
    // re-scan prompt under "## DEXA Calibration". The CTA is suppressed
    // for 14 days via the `dexa_stale_warned` working-memory key.
    const staleCalibration = await this.#detectStaleCalibration({
      userId,
      memory,
      personalContextLoader: context?.personalContextLoader,
      calibrationConstants: context?.calibrationConstants,
      logger,
    });

    return {
      userId,
      reconciliation,
      weight,
      goals,
      todayNutrition,
      nutritionHistory,
      yesterdayClosed: !!yesterdayClosed?.closed,
      similarPeriod,
      complianceCtas,
      detectedPatterns,
      staleCalibration,
    };
  }

  /**
   * Evaluate the user's DEXA calibration freshness and emit a CTA when stale.
   *
   * Logic:
   *   1. If no `calibrationConstants` is wired, return null (graceful absence).
   *   2. Lazily call `await calibrationConstants.load(userId)` — the service is
   *      idempotent and instances are per-process; per-user state is loaded on
   *      first access. Failures are caught and degrade to "no CTA".
   *   3. Resolve the staleness threshold from the playbook
   *      (`coaching_thresholds.dexa_staleness_days`) when present, else the
   *      default of 180 days.
   *   4. If `flagIfStale(threshold)` returns true AND the suppression key
   *      `dexa_stale_warned` is not active in memory, emit a CTA and stamp
   *      the suppression key with a 14-day TTL.
   *
   * @returns {Promise<null | { type: 'staleness', days: number, lastDexaDate: string|null }>}
   */
  async #detectStaleCalibration({
    userId, memory, personalContextLoader, calibrationConstants, logger,
  }) {
    if (!calibrationConstants || typeof calibrationConstants.flagIfStale !== 'function') {
      return null;
    }

    try {
      if (typeof calibrationConstants.load === 'function') {
        await calibrationConstants.load(userId);
      }
    } catch (err) {
      logger?.warn?.('morning_brief.calibration.error', {
        stage: 'load',
        error: err?.message,
      });
      return null;
    }

    let thresholdDays = DEFAULT_DEXA_STALENESS_THRESHOLD_DAYS;
    if (personalContextLoader && typeof personalContextLoader.loadPlaybook === 'function') {
      try {
        const playbook = await personalContextLoader.loadPlaybook(userId);
        const fromPlaybook = playbook?.coaching_thresholds?.dexa_staleness_days;
        if (Number.isFinite(fromPlaybook) && fromPlaybook > 0) {
          thresholdDays = fromPlaybook;
        }
      } catch (err) {
        // Loader failure is non-fatal — fall back to default silently.
        logger?.warn?.('morning_brief.calibration.error', {
          stage: 'playbook_load',
          error: err?.message,
        });
      }
    }

    let stale;
    try {
      stale = calibrationConstants.flagIfStale(thresholdDays);
    } catch (err) {
      logger?.warn?.('morning_brief.calibration.error', {
        stage: 'flagIfStale',
        error: err?.message,
      });
      return null;
    }

    if (!stale) {
      return null;
    }

    if (memory?.get?.(DEXA_STALENESS_MEMORY_KEY)) {
      logger?.info?.('morning_brief.calibration.suppressed_by_memory', {
        userId,
        thresholdDays,
      });
      return null;
    }

    const days = typeof calibrationConstants.getStaleness === 'function'
      ? calibrationConstants.getStaleness()
      : null;
    const lastDexaDate = typeof calibrationConstants.getCalibrationDate === 'function'
      ? calibrationConstants.getCalibrationDate()
      : null;

    memory?.set?.(DEXA_STALENESS_MEMORY_KEY, new Date().toISOString(), {
      ttl: DEXA_STALENESS_TTL_MS,
    });
    logger?.info?.('morning_brief.calibration.stale', {
      userId,
      days,
      lastDexaDate,
      thresholdDays,
    });

    return { type: 'staleness', days, lastDexaDate };
  }

  /**
   * Run the user's playbook patterns through PatternDetector with a 30-day
   * window of nutrition / weight / workouts / compliance.
   *
   * Logic:
   *   1. Resolve playbook patterns. If the loader is unwired or the playbook
   *      lacks a `patterns` array, return [] without invoking the detector —
   *      there's nothing to evaluate.
   *   2. Resolve the detector. If it's not injected, return [].
   *   3. Pull 30-day windows in parallel (today − 29 → today). Tool errors
   *      degrade to empty arrays so a single bad fetch doesn't kill the rest.
   *   4. Call detector.detect(...) inside a try/catch. On error, log a warn
   *      event and return [] — the brief never blocks on this signal.
   *   5. Filter detections against working memory. Active TTL keys suppress
   *      the detection; surviving detections get a fresh 7-day TTL stamp.
   *
   * @returns {Promise<Array<object>>} surviving detections in source order
   */
  async #detectPatterns({
    tools, userId, memory, goals, personalContextLoader, patternDetector, logger,
  }) {
    if (!patternDetector || typeof patternDetector.detect !== 'function') {
      return [];
    }

    let playbookPatterns = [];
    if (personalContextLoader && typeof personalContextLoader.loadPlaybook === 'function') {
      try {
        const playbook = await personalContextLoader.loadPlaybook(userId);
        if (Array.isArray(playbook?.patterns)) {
          playbookPatterns = playbook.patterns;
        }
      } catch (err) {
        logger?.warn?.('morning_brief.pattern_detector.error', {
          stage: 'playbook_load',
          error: err?.message,
        });
        return [];
      }
    }

    if (playbookPatterns.length === 0) {
      return [];
    }

    const today = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - (PATTERN_WINDOW_DAYS - 1) * 86400000)
      .toISOString().split('T')[0];

    const callTool = async (name, params) => {
      const tool = tools.find(t => t.name === name);
      if (!tool) return null;
      try {
        return await tool.execute(params);
      } catch (err) {
        logger?.warn?.('morning_brief.pattern_detector.error', {
          stage: 'window_fetch',
          tool: name,
          error: err?.message,
        });
        return null;
      }
    };

    const [weightRes, nutritionRes, workoutsRes, complianceRes] = await Promise.all([
      callTool('query_historical_weight', { userId, from, to: today, aggregation: 'daily' }),
      callTool('query_historical_nutrition', { userId, from, to: today }),
      callTool('query_historical_workouts', { userId, from, to: today }),
      callTool('get_compliance_summary', { userId }),
    ]);

    const windows = {
      weight: Array.isArray(weightRes?.rows) ? weightRes.rows : [],
      nutrition: Array.isArray(nutritionRes?.days) ? nutritionRes.days : [],
      workouts: Array.isArray(workoutsRes?.workouts) ? workoutsRes.workouts : [],
      compliance: complianceRes && !complianceRes.error ? complianceRes : {},
    };

    const userGoals = goals?.goals?.nutrition || goals?.goals || {};

    logger?.info?.('morning_brief.pattern_detector.invoked', {
      userId,
      patternCount: playbookPatterns.length,
      windowDays: PATTERN_WINDOW_DAYS,
    });

    let detections;
    try {
      detections = patternDetector.detect({ windows, playbookPatterns, userGoals });
    } catch (err) {
      logger?.warn?.('morning_brief.pattern_detector.error', {
        stage: 'detect',
        error: err?.message,
      });
      return [];
    }

    if (!Array.isArray(detections) || detections.length === 0) {
      return [];
    }

    const surviving = [];
    for (const detection of detections) {
      const memKey = detection?.memoryKey || `pattern_${detection?.name}_last_flagged`;
      if (memory?.get?.(memKey)) {
        logger?.info?.('morning_brief.pattern.suppressed_by_memory', {
          name: detection?.name,
          severity: detection?.severity,
        });
        continue;
      }
      surviving.push(detection);
      memory?.set?.(memKey, new Date().toISOString(), { ttl: PATTERN_TTL_MS });
      logger?.info?.('morning_brief.pattern.detected', {
        name: detection?.name,
        severity: detection?.severity,
        confidence: detection?.confidence,
      });
    }

    return surviving;
  }

  /**
   * Detect compliance gaps that warrant a historical-precedent CTA.
   *
   * Logic (F2-C: playbook-driven, no hardcoded dimension names):
   *   1. Call get_compliance_summary. If the tool errors or is missing,
   *      return [] — never block the brief on this signal.
   *   2. Load the user's playbook (when a loader is wired). Each entry in
   *      `coaching_dimensions[]` declares its own type, thresholds, and
   *      cta_text. Without a playbook we can't fire CTAs (which thresholds
   *      would we use?) — return [].
   *   3. For each declared dimension, compare its trailing streak against
   *      the declared threshold for that type. If crossed AND the
   *      working-memory TTL key is not active, emit a CTA and stamp the
   *      memory key (7-day TTL).
   *
   *   Threshold conventions per type:
   *     - boolean → `thresholds.consecutive_misses_trigger` against
   *                 `currentMissStreak`
   *     - numeric → `thresholds.untracked_run_trigger` against
   *                 `currentUntrackedStreak`
   *     - text    → no thresholds (text dimensions are too noisy for v1)
   *
   * @returns {Promise<Array<{ dimension: string, message: string }>>}
   */
  async #detectComplianceCtas({ tools, userId, memory, personalContextLoader, logger }) {
    const tool = tools.find(t => t.name === 'get_compliance_summary');
    if (!tool) {
      return [];
    }

    let summary;
    try {
      summary = await tool.execute({ userId });
    } catch (err) {
      logger?.warn?.('morning_brief.compliance.error', { error: err?.message });
      return [];
    }

    if (!summary || summary.error || !summary.dimensions) {
      logger?.warn?.('morning_brief.compliance.error', {
        reason: summary?.error || 'no_dimensions',
      });
      return [];
    }

    logger?.info?.('morning_brief.compliance.queried', { userId });

    // Resolve the playbook's coaching_dimensions. Without it there's no
    // way to know which streaks matter or what to say — return [].
    let dimensionsSchema = null;
    if (personalContextLoader && typeof personalContextLoader.loadPlaybook === 'function') {
      try {
        const playbook = await personalContextLoader.loadPlaybook(userId);
        if (Array.isArray(playbook?.coaching_dimensions)) {
          dimensionsSchema = playbook.coaching_dimensions;
        }
      } catch (err) {
        logger?.warn?.('morning_brief.compliance.error', {
          stage: 'playbook_load',
          error: err?.message,
        });
      }
    }

    if (!dimensionsSchema || dimensionsSchema.length === 0) {
      logger?.debug?.('morning_brief.compliance.no_dimensions_schema', { userId });
      return [];
    }

    const ctas = [];
    const dims = summary.dimensions || {};

    for (const dim of dimensionsSchema) {
      if (!dim?.key || !dim?.type) continue;
      const summaryDim = dims[dim.key] || {};
      const thresholds = dim.thresholds || {};
      const ctaText = dim.cta_text;

      let crossed = false;
      let context = {};
      if (dim.type === 'boolean') {
        const trigger = thresholds.consecutive_misses_trigger;
        const streak = Number.isFinite(summaryDim.currentMissStreak)
          ? summaryDim.currentMissStreak
          : 0;
        if (Number.isFinite(trigger) && trigger > 0 && streak >= trigger) {
          crossed = true;
          context = { currentMissStreak: streak, threshold: trigger };
        }
      } else if (dim.type === 'numeric') {
        const trigger = thresholds.untracked_run_trigger;
        const streak = Number.isFinite(summaryDim.currentUntrackedStreak)
          ? summaryDim.currentUntrackedStreak
          : 0;
        if (Number.isFinite(trigger) && trigger > 0 && streak >= trigger) {
          crossed = true;
          context = { currentUntrackedStreak: streak, threshold: trigger };
        }
      } else if (dim.type === 'text') {
        // Text dimensions don't currently have streak math — skip CTAs.
        logger?.debug?.('morning_brief.compliance.text_dim_skipped', {
          dimension: dim.key,
        });
        continue;
      } else {
        logger?.debug?.('morning_brief.compliance.unsupported_type', {
          dimension: dim.key,
          type: dim.type,
        });
        continue;
      }

      if (!crossed) continue;
      if (!ctaText || typeof ctaText !== 'string' || ctaText.trim().length === 0) {
        logger?.debug?.('morning_brief.compliance.no_cta_text', { dimension: dim.key });
        continue;
      }

      const memKey = `compliance_${dim.key}_last_flagged`;
      if (memory?.get?.(memKey)) {
        logger?.info?.('morning_brief.compliance.suppressed_by_memory', {
          dimension: dim.key,
        });
        continue;
      }

      const message = ctaText.trim();
      ctas.push({ dimension: dim.key, message });
      memory?.set?.(memKey, new Date().toISOString(), { ttl: COMPLIANCE_TTL_MS });
      logger?.info?.('morning_brief.compliance.cta_triggered', {
        dimension: dim.key,
        ...context,
      });
    }

    return ctas;
  }

  /**
   * Inspect the last 7 days of nutrition history for a trailing over-plan
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
    return this.#streakQuery({ tools, userId, days, weight, goals, logger });
  }

  // Streaks and the signature read JUDGED days only: finished (before today —
  // this morning's partial row would zero a over-plan streak and fake a protein
  // shortfall) and, for budget rows, complete (an under-logged day is missing
  // data, not a light one).
  async #streakQuery({ tools, userId, days: allDays, weight, goals, logger }) {
    const evidence = assignmentEvidence({ nutritionHistory: { days: allDays } });
    // Keep ineligible dates in the walk: missing/incomplete dates break a streak.
    const history = evidence.days.filter(day => day.assessment.finished).sort((a, b) => a.date.localeCompare(b.date));
    const days = history.filter(day => day.assessment.availability === 'available' && day.assessment.trustworthy);
    if (days.length === 0) return null;
    const proteinMin = goals?.goals?.nutrition?.protein_min;
    const trailingStreak = predicate => {
      let count = 0;
      let nextDate = null;
      for (let i = history.length - 1; i >= 0; i--) {
        const day = history[i];
        if (nextDate && new Date(`${nextDate}T12:00:00Z`) - new Date(`${day.date}T12:00:00Z`) !== 86400000) break;
        if (!day.assessment.trustworthy || !predicate(day)) break;
        count += 1;
        nextDate = day.date;
      }
      return count;
    };
    const overPlanStreak = trailingStreak(day => day.assessment.planState === 'over');
    const energySurplusStreak = trailingStreak(day => day.assessment.energyState === 'surplus');
    const proteinShortfallStreak = typeof proteinMin === 'number'
      ? trailingStreak(day => day.assessment.proteinKnown && typeof day.protein === 'number' && day.protein < proteinMin) : 0;
    if (overPlanStreak < 3 && proteinShortfallStreak < 3) return null;

    const tool = tools.find(t => t.name === 'find_similar_period');
    if (!tool) {
      logger?.warn?.('morning_brief.similar_period.error', { reason: 'tool_not_registered' });
      return null;
    }

    // Build the signature from the same 7-day nutrition window plus the
    // weight history we already gathered. Missing dimensions are simply
    // omitted from the resulting object — the finder ignores them.
    const numericCalories = days.map(d => d?.calories).filter(v => typeof v === 'number');
    const numericProtein = days.filter(d => d.assessment.proteinKnown).map(d => d?.protein).filter(v => typeof v === 'number');
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
    if (days.length > 0) signature.tracking_rate = trackedDays / allDays.length;
    const weightAvg = avg(numericWeights);
    if (weightAvg !== null) signature.weight_avg_lbs = weightAvg;
    if (numericWeights.length >= 2) {
      signature.weight_delta_lbs = numericWeights[numericWeights.length - 1] - numericWeights[0];
    }

    logger?.info?.('morning_brief.similar_period.queried', {
      userId,
      overPlanStreak,
      energySurplusStreak,
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
    sections.push(`\n## User Goals\n${JSON.stringify(goalsWithRange(gathered.goals, gathered.todayNutrition), null, 2)}`);
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

    // Compliance — historical-precedent CTAs (F-003). When documented
    // daily-leverage actions (post-workout protein, daily strength micro)
    // have lapsed beyond the playbook threshold, surface explicit CTAs so
    // the coach grounds its message in the user's documented patterns
    // rather than generic admonitions.
    if (Array.isArray(gathered.complianceCtas) && gathered.complianceCtas.length > 0) {
      const lines = ['\n## Compliance — historical-precedent CTAs'];
      for (const cta of gathered.complianceCtas) {
        lines.push(`- ${cta.dimension}: ${cta.message}`);
      }
      sections.push(lines.join('\n'));
    }

    // Detected Patterns (F-004). Surface PatternDetector matches sorted by
    // severity (high → medium → low) so the coach reads the most-pressing
    // signal first. Each line includes the pattern name, severity, confidence,
    // a one-line recommendation, and an abridged comma-joined evidence map
    // — concrete numbers help the LLM speak in specifics rather than abstract
    // pattern names.
    if (Array.isArray(gathered.detectedPatterns) && gathered.detectedPatterns.length > 0) {
      const sorted = [...gathered.detectedPatterns].sort((a, b) => {
        const ra = SEVERITY_RANK[a?.severity] ?? 99;
        const rb = SEVERITY_RANK[b?.severity] ?? 99;
        return ra - rb;
      });
      const lines = ['\n## Detected Patterns'];
      for (const det of sorted) {
        const conf = typeof det.confidence === 'number' ? det.confidence.toFixed(2) : 'n/a';
        const evidenceStr = det.evidence && typeof det.evidence === 'object'
          ? Object.entries(det.evidence).map(([k, v]) => `${k}=${v}`).join(', ')
          : '';
        lines.push(
          `- **${det.name}** [${det.severity || 'medium'}] (confidence: ${conf}): ${det.recommendation || ''}`,
        );
        if (evidenceStr) {
          lines.push(`  Evidence: ${evidenceStr}`);
        }
      }
      sections.push(lines.join('\n'));
    }

    // DEXA Calibration — when the user's clinical anchor is stale (F-007),
    // surface a re-scan CTA. The suppression key in working memory keeps
    // this from firing daily once it's been seen. Without a recent DEXA,
    // the body-composition math is running on consumer-BIA without truth
    // anchoring; the coach should reflect that uncertainty.
    if (gathered.staleCalibration && gathered.staleCalibration.type === 'staleness') {
      const sc = gathered.staleCalibration;
      const lastDexa = sc.lastDexaDate ?? 'unknown';
      const days = Number.isFinite(sc.days) ? sc.days : '?';
      sections.push(
        `\n## DEXA Calibration\n` +
        `Last DEXA: ${lastDexa} (${days} days ago).\n` +
        `Recommend scheduling a re-scan — body composition math is currently ` +
        `running on consumer-BIA readings without recent DEXA anchoring.`
      );
    }

    const evidence = assignmentEvidence(gathered);
    const yesterday = evidence.days.at(-1);
    const incompleteDay = yesterday?.assessment.availability === 'available' && !yesterday.assessment.trustworthy;
    sections.push(`\n## Assessed Budget Evidence\n${JSON.stringify(evidence, null, 2)}`);
    sections.push(`\n## Instructions
Produce raw JSON matching coachingMessageSchema, including should_send and text.
${incompleteDay ? 'INCOMPLETE LOGGING DETECTED: yesterday has an incomplete log; ask only about meals not explicitly skipped.' : ''}
Use only eligible assessed observations for calorie-plan and protein verdicts. The food logging floor is not an intake target.
Plan comparisons use exercise-adjusted food boundaries; surplus requires exceeding estimated maintenance.
A complete log may still be live. Protein failures require a trustworthy finished day and known protein.
Calendar gaps break streaks. Period comparisons use matched eligible dates and disclose coverage and current configured goals.
No compensatory targets or calorie arithmetic from legacy goals. Reconciliation, playbook and calibration context remain available above.
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
    return canonicalCoachingResult(raw, gathered, 'morning-brief', logger);
  }

  /**
   * Act phase — record that the brief ran in working memory.
   * This assignment returns the validated payload without sending a message.
   */
  async act(validated, { memory, userId, logger }) {
    memory.set('last_morning_brief', new Date().toISOString(), { ttl: 24 * 60 * 60 * 1000 });

    logger?.info?.('act.complete', {
      userId,
      should_send: validated.should_send,
    });
  }
}
