/**
 * NewsReporterService (3_applications — orchestration core).
 *
 * Runs one reporter pipeline:
 *   gather (N sources, parallel) → consolidate (LLM) → emit (M sinks) → record
 *
 * Pure orchestration: every side effect (config read, HTTP, LLM, print, history
 * write) is delegated to an injected dependency. The injectable `clock` keeps
 * date logic deterministic under test — never call `new Date()`/`Date.now()`
 * directly in asserted logic.
 *
 * Run outcomes:
 *   - 'ok'    : printed (≥1 sink succeeded).
 *   - 'empty' : all sources returned [], or the LLM returned no sections; no print.
 *   - 'error' : a source threw, consolidation failed, or every sink failed; no print.
 *
 * `overrides` ({} == exact scheduled behavior):
 *   date    — resolve {{yesterday}}/{{date}} against this calendar day.
 *   printer — override every printer sink's target.
 *   dryRun  — render but don't print; return sections + preview text.
 *   force   — bypass empty-skip (pair with dryRun to see rendered output).
 */

import { resolvePlaceholders } from '#apps/newsreporter/placeholders.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

const DEFAULT_TIMEZONE = 'America/Denver';

export class NewsReporterService {
  #configService;
  #sourceRegistry;
  #consolidator;
  #sinkRegistry;
  #history;
  #logger;
  #clock;

  /**
   * @param {{
   *   configService: { getHouseholdAppConfig: Function },
   *   sourceRegistry: { create: Function },
   *   consolidator: { consolidate: Function },
   *   sinkRegistry: { create: Function },
   *   history: { record: Function },
   *   logger?: object,
   *   clock?: { now: () => Date },
   * }} deps
   */
  constructor({ configService, sourceRegistry, consolidator, sinkRegistry, history, logger, clock } = {}) {
    if (!configService) throw new Error('NewsReporterService requires a configService');
    if (!sourceRegistry) throw new Error('NewsReporterService requires a sourceRegistry');
    if (!consolidator) throw new Error('NewsReporterService requires a consolidator');
    if (!sinkRegistry) throw new Error('NewsReporterService requires a sinkRegistry');
    if (!history) throw new Error('NewsReporterService requires a history store');
    this.#configService = configService;
    this.#sourceRegistry = sourceRegistry;
    this.#consolidator = consolidator;
    this.#sinkRegistry = sinkRegistry;
    this.#history = history;
    this.#logger = logger || console;
    this.#clock = clock || { now: () => new Date() };
  }

  /**
   * Run one reporter.
   * @param {string} reporterId
   * @param {{ date?: string, printer?: string, dryRun?: boolean, force?: boolean }} [overrides]
   * @returns {Promise<{ status: string, sourceCounts?: object, sinkResults?: Array, sections?: Array, preview?: string, error?: string }>}
   * @throws {EntityNotFoundError} when the reporter is missing or disabled
   */
  async run(reporterId, overrides = {}) {
    // 1. Load reporter config.
    const reporters = this.#configService.getHouseholdAppConfig(null, 'newsreporter') || {};
    const cfg = reporters[reporterId];
    if (!cfg || cfg.enabled === false) {
      throw new EntityNotFoundError('newsreporter', reporterId);
    }

    // 2. Build run context.
    const referenceDate = overrides.date
      ? new Date(`${overrides.date}T12:00:00Z`)
      : this.#clock.now();
    const timezone = this.#resolveTimezone();
    const logger = this.#logger.child
      ? this.#logger.child({ reporterId })
      : this.#logger;
    const ctx = {
      reporterId,
      referenceDate,
      timezone,
      dryRun: !!overrides.dryRun,
      printerOverride: overrides.printer ?? null,
      logger,
    };

    // 3. Start.
    const startedAt = this.#clock.now().toISOString();
    const startMs = this.#clock.now().getTime();
    logger.info?.('newsreporter.run.start', { reporterId });

    // 4. Gather (parallel).
    let gatherResults;
    let sourceCounts = {};
    try {
      const sourceCfgs = (cfg.sources || []).map((s) => resolvePlaceholders(s, ctx));
      gatherResults = await Promise.all(
        sourceCfgs.map((sourceCfg) => {
          const source = this.#sourceRegistry.create(sourceCfg.type, sourceCfg);
          return source.gather({ ...ctx, config: sourceCfg });
        })
      );
      sourceCounts = this.#countItems(cfg.sources || [], gatherResults);
    } catch (err) {
      return this.#fail({ reporterId, startedAt, sourceCounts, error: err, logger });
    }

    // 5. Merge items; skip on empty unless forced.
    const items = gatherResults.flatMap((r) => r?.items || []);
    if (!overrides.force && items.length === 0) {
      logger.info?.('newsreporter.run.empty', { reporterId, reason: 'no-source-items' });
      await this.#record(reporterId, { startedAt, status: 'empty', sourceCounts, sinkResults: [], error: null });
      return { status: 'empty', sourceCounts };
    }

    // 6. Consolidate.
    let sections;
    try {
      ({ sections } = await this.#consolidator.consolidate({
        prompt: cfg.consolidate?.prompt,
        model: cfg.consolidate?.model,
        items,
        ctx,
      }));
    } catch (err) {
      return this.#fail({ reporterId, startedAt, sourceCounts, error: err, logger });
    }

    if ((sections?.length ?? 0) === 0 && !overrides.force) {
      logger.info?.('newsreporter.run.empty', { reporterId, reason: 'no-sections' });
      await this.#record(reporterId, { startedAt, status: 'empty', sourceCounts, sinkResults: [], error: null });
      return { status: 'empty', sourceCounts };
    }

    // 7. Emit (each sink independent).
    const sinkCfgs = (cfg.sinks || []).map((s) => resolvePlaceholders(s, ctx));
    const sinkResults = [];
    for (const sinkCfg of sinkCfgs) {
      try {
        const sink = this.#sinkRegistry.create(sinkCfg.type, sinkCfg);
        const result = await sink.emit(sections, sinkCfg, ctx);
        sinkResults.push(result || { status: 'error', error: 'sink returned no result' });
      } catch (err) {
        logger.warn?.('newsreporter.sink.error', { reporterId, type: sinkCfg.type, error: err?.message || String(err) });
        sinkResults.push({ status: 'error', error: err?.message || String(err) });
      }
    }

    // 8. Overall status.
    const status = sinkResults.some((r) => r.status === 'ok') ? 'ok' : 'error';

    // 9. Record + return.
    await this.#record(reporterId, { startedAt, status, sourceCounts, sinkResults, error: null });
    const durationMs = this.#clock.now().getTime() - startMs;
    logger.info?.('newsreporter.run.complete', { reporterId, status, durationMs });

    return {
      status,
      sourceCounts,
      sinkResults,
      sections: ctx.dryRun ? sections : undefined,
      preview: ctx.dryRun
        ? sinkResults.map((r) => r.detail?.preview).filter(Boolean).join('\n---\n')
        : undefined,
    };
  }

  /** Record an error outcome and return the error result. */
  async #fail({ reporterId, startedAt, sourceCounts, error, logger }) {
    const message = error?.message || String(error);
    logger.error?.('newsreporter.run.error', { reporterId, error: message });
    await this.#record(reporterId, { startedAt, status: 'error', sourceCounts, sinkResults: [], error: message });
    return { status: 'error', sourceCounts, error: message };
  }

  /** Persist run history; never throw into the run path. */
  async #record(reporterId, runResult) {
    try {
      await this.#history.record(reporterId, runResult);
    } catch (err) {
      this.#logger.warn?.('newsreporter.history.record_failed', {
        reporterId,
        error: err?.message || String(err),
      });
    }
  }

  /** Per-source item counts keyed by source id (or index fallback). */
  #countItems(sourceCfgs, gatherResults) {
    const counts = {};
    gatherResults.forEach((result, i) => {
      const id = sourceCfgs[i]?.id ?? `source_${i}`;
      counts[id] = (result?.items || []).length;
    });
    return counts;
  }

  /** Household timezone, fallback to America/Denver. */
  #resolveTimezone() {
    const household = this.#configService.getHouseholdAppConfig(null, 'household') || {};
    return household.timezone || household.tz || DEFAULT_TIMEZONE;
  }
}

export default NewsReporterService;
