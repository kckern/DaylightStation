// backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { HealthToolFactory } from './tools/HealthToolFactory.mjs';
import { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
import { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
import { ReconciliationToolFactory } from './tools/ReconciliationToolFactory.mjs';
import { MessagingChannelToolFactory } from './tools/MessagingChannelToolFactory.mjs';
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
    const { healthStore, healthService, fitnessPlayableService, sessionService, mediaProgressMemory, dataService, messagingGateway, conversationId } = this.deps;

    // Existing
    this.addToolFactory(new HealthToolFactory({ healthStore, healthService, sessionService }));
    this.addToolFactory(new FitnessContentToolFactory({ fitnessPlayableService, mediaProgressMemory, dataService }));
    this.addToolFactory(new DashboardToolFactory({ dataService, healthStore }));

    // New: reconciliation data access
    this.addToolFactory(new ReconciliationToolFactory({ healthStore }));

    // New: messaging channel delivery (only if gateway available)
    if (messagingGateway && conversationId) {
      this.addToolFactory(new MessagingChannelToolFactory({ messagingGateway, conversationId }));
    }

    // Existing assignment
    this.registerAssignment(new DailyDashboard());
  }

  async runAssignment(assignmentId, opts = {}) {
    if (!opts.userId) {
      opts.userId = this.deps.configService?.getHeadOfHousehold?.() || 'default';
    }

    // Pre-warm the personal-context cache so the framework's sync access
    // (`BaseAgent.runAssignment` calls `this.getSystemPrompt()` synchronously)
    // returns a string, not a Promise.
    this.#activeUserId = opts.userId;
    const loader = this.deps.personalContextLoader;
    if (loader) {
      await this.#getPersonalContextBundle(opts.userId, loader);
    }

    const result = await super.runAssignment(assignmentId, opts);

    if (assignmentId === 'daily-dashboard' && result) {
      const writeTool = this.getTools().find(t => t.name === 'write_dashboard');
      if (writeTool) {
        const today = new Date().toISOString().split('T')[0];
        await writeTool.execute({ userId: opts.userId, date: today, dashboard: result });
      }
    }

    return result;
  }
}
