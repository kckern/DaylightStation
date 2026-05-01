// backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs

import { Assignment } from '../../framework/Assignment.mjs';
import { OutputValidator } from '../../framework/OutputValidator.mjs';
import { coachingMessageSchema } from '../schemas/coachingMessage.mjs';

// F-003 default thresholds. Used when the user's playbook lacks a
// `coaching_thresholds` section (or omits an individual dimension). The
// defaults intentionally err on the side of NOT nagging — only fire a
// historical-precedent CTA after a multi-day documented lapse.
const DEFAULT_COMPLIANCE_THRESHOLDS = Object.freeze({
  post_workout_protein: {
    consecutive_misses_trigger: 3,
    cta_text: 'Multiple consecutive days without the post-workout protein. ' +
      'This is documented as a high-leverage daily action — worth re-anchoring tomorrow.',
  },
  daily_strength_micro: {
    untracked_run_trigger: 5,
    cta_text: 'Multiple days without the daily strength micro-drill. ' +
      'Daily-frequency exposure is the lever for this dimension, not session volume.',
  },
});

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
   * Logic:
   *   1. Call get_compliance_summary. If the tool errors or is missing,
   *      return [] — never block the brief on this signal.
   *   2. Load the user's playbook (when a loader is wired). The playbook
   *      may expose a `coaching_thresholds` section with per-dimension
   *      `consecutive_misses_trigger` / `untracked_run_trigger` thresholds
   *      and `cta_text`. Fall back to DEFAULT_COMPLIANCE_THRESHOLDS for
   *      any missing field.
   *   3. For each tracked dimension, compare the current trailing streak
   *      against its threshold. If crossed AND the working-memory TTL key
   *      is not active, emit a CTA and stamp the memory key (7-day TTL).
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

    // Resolve thresholds — playbook overrides defaults per-field.
    let playbookThresholds = null;
    if (personalContextLoader && typeof personalContextLoader.loadPlaybook === 'function') {
      try {
        const playbook = await personalContextLoader.loadPlaybook(userId);
        playbookThresholds = playbook?.coaching_thresholds || null;
      } catch (err) {
        // Loader failure is non-fatal — fall back to defaults silently.
        logger?.warn?.('morning_brief.compliance.error', {
          stage: 'playbook_load',
          error: err?.message,
        });
      }
    }

    const ctas = [];
    const dims = summary.dimensions;

    // Protein: trailing miss-streak. The playbook's protein CTA references
    // the documented "highest-leverage daily action" copy; the default
    // fallback uses generic but still actionable wording.
    const proteinDim = dims.post_workout_protein || {};
    const proteinCfg = {
      ...DEFAULT_COMPLIANCE_THRESHOLDS.post_workout_protein,
      ...(playbookThresholds?.post_workout_protein || {}),
    };
    const proteinStreak = Number.isFinite(proteinDim.currentMissStreak)
      ? proteinDim.currentMissStreak
      : 0;
    if (proteinStreak >= proteinCfg.consecutive_misses_trigger) {
      const memKey = 'compliance_post_workout_protein_last_flagged';
      if (memory?.get?.(memKey)) {
        logger?.info?.('morning_brief.compliance.suppressed_by_memory', {
          dimension: 'post_workout_protein',
        });
      } else {
        ctas.push({ dimension: 'post_workout_protein', message: proteinCfg.cta_text });
        memory?.set?.(memKey, new Date().toISOString(), { ttl: COMPLIANCE_TTL_MS });
        logger?.info?.('morning_brief.compliance.cta_triggered', {
          dimension: 'post_workout_protein',
          currentMissStreak: proteinStreak,
        });
      }
    }

    // Strength: trailing untracked-streak (no daily-drill log for N days).
    const strengthDim = dims.daily_strength_micro || {};
    const strengthCfg = {
      ...DEFAULT_COMPLIANCE_THRESHOLDS.daily_strength_micro,
      ...(playbookThresholds?.daily_strength_micro || {}),
    };
    const strengthStreak = Number.isFinite(strengthDim.currentUntrackedStreak)
      ? strengthDim.currentUntrackedStreak
      : 0;
    if (strengthStreak >= strengthCfg.untracked_run_trigger) {
      const memKey = 'compliance_daily_strength_micro_last_flagged';
      if (memory?.get?.(memKey)) {
        logger?.info?.('morning_brief.compliance.suppressed_by_memory', {
          dimension: 'daily_strength_micro',
        });
      } else {
        ctas.push({ dimension: 'daily_strength_micro', message: strengthCfg.cta_text });
        memory?.set?.(memKey, new Date().toISOString(), { ttl: COMPLIANCE_TTL_MS });
        logger?.info?.('morning_brief.compliance.cta_triggered', {
          dimension: 'daily_strength_micro',
          currentUntrackedStreak: strengthStreak,
        });
      }
    }

    return ctas;
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
