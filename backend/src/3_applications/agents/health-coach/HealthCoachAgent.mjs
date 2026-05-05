// backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { HealthToolFactory } from './tools/HealthToolFactory.mjs';
import { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
import { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
import { ReconciliationToolFactory } from './tools/ReconciliationToolFactory.mjs';
import { MessagingChannelToolFactory } from './tools/MessagingChannelToolFactory.mjs';
import { LongitudinalToolFactory } from './tools/LongitudinalToolFactory.mjs';
import { ComplianceToolFactory } from './tools/ComplianceToolFactory.mjs';
import { HealthAnalyticsToolFactory } from './tools/HealthAnalyticsToolFactory.mjs';
import { DailyDashboard } from './assignments/DailyDashboard.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class HealthCoachAgent extends BaseAgent {
  static id = 'health-coach';
  static description = 'Health coaching and fitness dashboard agent';

  /**
   * Per-userId cache of rendered personal-context bundles. Populated lazily on
   * first `getSystemPrompt(userId)` call (or by `runAssignment()` before it
   * delegates to the framework's sync `getSystemPrompt()` path). Bundles are
   * stable for the lifetime of the agent instance — restart picks up changes
   * to the playbook YAML.
   */
  #personalContextCache = new Map();

  /**
   * The userId most recently primed via `runAssignment()`. Lets the framework's
   * sync `getSystemPrompt()` path (called inside `BaseAgent.runAssignment` /
   * `BaseAgent.run`) find the right cached bundle without changing the base
   * contract.
   */
  #activeUserId = null;

  /**
   * Returns the agent's system prompt with a per-user "Personal Context" bundle
   * appended when a `personalContextLoader` is wired and the user has a
   * playbook on disk.
   *
   * Dual-mode return: synchronous (a `string`) when no loader is wired, no
   * userId is in scope, or the bundle is already cached for `userId`.
   * Asynchronous (a `Promise<string>`) on a cache miss with a loader present.
   * Callers that always `await` the result work correctly in both modes.
   *
   * `runAssignment()` pre-warms the cache before delegating to the framework,
   * so the framework's sync call site (`BaseAgent.runAssignment` →
   * `assignment.execute({ systemPrompt: this.getSystemPrompt() })`) always
   * lands on the sync branch and gets a proper string.
   *
   * @param {string} [userId] - When omitted, falls back to the userId primed
   *   by `runAssignment`. If neither is available or no loader is wired,
   *   returns the static prompt unchanged.
   * @returns {string|Promise<string>}
   */
  getSystemPrompt(userId = null) {
    const loader = this.deps.personalContextLoader;
    const effectiveUserId = userId || this.#activeUserId;

    if (!loader || !effectiveUserId) {
      return systemPrompt;
    }

    // Cache hit — return synchronously so the framework's sync call site works.
    if (this.#personalContextCache.has(effectiveUserId)) {
      const bundle = this.#personalContextCache.get(effectiveUserId);
      return bundle ? `${systemPrompt}\n\n${bundle}` : systemPrompt;
    }

    // Cache miss — return a Promise. Sync callers (the framework) won't hit
    // this path because `runAssignment` pre-warms the cache.
    return this.#loadAndCombine(effectiveUserId, loader);
  }

  /**
   * Async helper used on cache miss. Loads the bundle, caches it, and returns
   * the combined prompt.
   * @private
   */
  async #loadAndCombine(userId, loader) {
    const bundle = await this.#getPersonalContextBundle(userId, loader);
    return bundle ? `${systemPrompt}\n\n${bundle}` : systemPrompt;
  }

  /**
   * Load (or hit cache) the personal-context markdown bundle for a userId.
   * Errors are swallowed and logged — we never block the system prompt on a
   * missing or malformed playbook. Returns '' when no bundle is available.
   * @private
   */
  async #getPersonalContextBundle(userId, loader) {
    if (this.#personalContextCache.has(userId)) {
      return this.#personalContextCache.get(userId);
    }

    let bundle = '';
    try {
      bundle = (await loader.load(userId)) || '';
      this.deps.logger?.info?.('health_coach.system_prompt.cached', {
        userId,
        chars: bundle.length,
        empty: bundle.length === 0,
      });
    } catch (err) {
      this.deps.logger?.warn?.('health_coach.system_prompt.loader_failed', {
        userId,
        error: err?.message || String(err),
      });
      bundle = '';
    }

    this.#personalContextCache.set(userId, bundle);
    return bundle;
  }

  registerTools() {
    const {
      healthStore,
      healthService,
      fitnessPlayableService,
      sessionService,
      mediaProgressMemory,
      dataService,
      messagingGateway,
      conversationId,
      personalContextLoader,
      archiveScopeFactory,
      similarPeriodFinder,
      dataRoot,
      healthAnalyticsService,           // ← new (Plan 1 / Task 10)
    } = this.deps;

    // Existing
    this.addToolFactory(new HealthToolFactory({ healthStore, healthService, sessionService }));
    this.addToolFactory(new FitnessContentToolFactory({ fitnessPlayableService, mediaProgressMemory, dataService }));
    this.addToolFactory(new DashboardToolFactory({ dataService, healthStore }));

    // Reconciliation data access
    this.addToolFactory(new ReconciliationToolFactory({ healthStore }));

    // Messaging channel delivery (only if gateway available)
    if (messagingGateway && conversationId) {
      this.addToolFactory(new MessagingChannelToolFactory({ messagingGateway, conversationId }));
    }

    // Longitudinal historical queries (F-102 read_notes_file, F-103 query_*,
    // F-104 find_similar_period). Always registered — individual tools surface
    // structured "dependency missing" errors when their optional deps are
    // unwired (e.g. personalContextLoader for query_named_period), so
    // partial wiring degrades gracefully without breaking the agent.
    this.addToolFactory(new LongitudinalToolFactory({
      healthStore,
      healthService,
      personalContextLoader,
      similarPeriodFinder,
      archiveScopeFactory,
      dataRoot,
    }));

    // Compliance summary tool (F-002 / F2-B). Dimensions are declared in the
    // user's playbook (`coaching_dimensions`) and resolved lazily via
    // personalContextLoader; the factory has no hardcoded dimension names.
    this.addToolFactory(new ComplianceToolFactory({
      healthStore,
      personalContextLoader,
      logger: this.deps.logger,
    }));

    // F-201 / Plan 1: Analytical primitives — aggregate / series /
    // distribution / percentile / snapshot. Pulled from the dedicated
    // domain service so the math lives in one testable place.
    if (healthAnalyticsService) {
      this.addToolFactory(new HealthAnalyticsToolFactory({ healthAnalyticsService }));
    }

    // Existing assignment
    this.registerAssignment(new DailyDashboard());
  }

  async runAssignment(assignmentId, opts = {}) {
    if (!opts.userId) {
      opts.userId = this.deps.configService?.getHeadOfHousehold?.() || 'default';
    }

    await this.#primePersonalContext(opts.userId);

    // Thread personalContextLoader + patternDetector + calibrationConstants
    // through the assignment context so assignments (e.g. MorningBrief
    // F-003 / F-004 / F-007) can read user-specific playbook config
    // (coaching_thresholds, patterns, named periods), run pattern detection,
    // and evaluate DEXA staleness without each one having to re-resolve
    // the deps from the agent.
    const mergedOpts = {
      ...opts,
      context: {
        ...(opts.context || {}),
        personalContextLoader: this.deps.personalContextLoader,
        patternDetector: this.deps.patternDetector,
        calibrationConstants: this.deps.calibrationConstants,
      },
    };

    const result = await super.runAssignment(assignmentId, mergedOpts);

    if (assignmentId === 'daily-dashboard' && result) {
      const writeTool = this.getTools().find(t => t.name === 'write_dashboard');
      if (writeTool) {
        const today = new Date().toISOString().split('T')[0];
        await writeTool.execute({ userId: opts.userId, date: today, dashboard: result });
      }
    }

    return result;
  }

  /**
   * Chat-style entry point. Mirror `runAssignment` and pre-warm the personal-
   * context cache before delegating to `BaseAgent.run` so the framework's sync
   * `getSystemPrompt()` call inside `#assemblePrompt` always lands on cache hit.
   * Without this, `POST /api/v1/agents/health-coach/run` would silently miss
   * personal context.
   */
  async run(input, opts = {}) {
    const userId = opts.userId || this.deps.configService?.getHeadOfHousehold?.() || null;
    if (userId) {
      await this.#primePersonalContext(userId);
    }
    return super.run(input, opts);
  }

  /**
   * Set `#activeUserId` and (when a loader is wired) populate the cache for
   * the user. Safe to call repeatedly; cache hits short-circuit.
   * @private
   */
  async #primePersonalContext(userId) {
    this.#activeUserId = userId;
    const loader = this.deps.personalContextLoader;
    if (loader) {
      await this.#getPersonalContextBundle(userId, loader);
    }
  }
}
