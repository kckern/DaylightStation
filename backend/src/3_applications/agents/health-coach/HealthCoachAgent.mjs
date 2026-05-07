// backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { formatHealthAttachment } from './formatAttachment.mjs';
import { HealthToolFactory } from './tools/HealthToolFactory.mjs';
import { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
import { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
import { ReconciliationToolFactory } from './tools/ReconciliationToolFactory.mjs';
import { MessagingChannelToolFactory } from './tools/MessagingChannelToolFactory.mjs';
import { LongitudinalToolFactory } from './tools/LongitudinalToolFactory.mjs';
import { ComplianceToolFactory } from './tools/ComplianceToolFactory.mjs';
import { HealthAnalyticsToolFactory } from './tools/HealthAnalyticsToolFactory.mjs';
import { DailyDashboard } from './assignments/DailyDashboard.mjs';
import { chatPrompt } from './prompts/chat.mjs';
import { dashboardPrompt } from './prompts/dashboard.mjs';
import { loadSeedIfEmpty } from './playbooks/seedLoader.mjs';

export class HealthCoachAgent extends BaseAgent {
  static id = 'health-coach';
  static description = 'Health coaching and fitness dashboard agent';

  /**
   * Per-userId cache of rendered personal-context bundles. Populated lazily on
   * first `getSystemPrompt(context)` call. Bundles are stable for the lifetime
   * of the agent instance — restart picks up changes to the playbook YAML.
   */
  #personalContextCache = new Map();

  /**
   * The userId most recently resolved by the orchestrator. Set from context
   * in formatAttachments for cases where the context flows through that path.
   */
  #activeUserId = null;

  /**
   * Returns the agent's resolved system prompt. Always async.
   *
   * Mode selection: context.mode ('chat' default → chatPrompt with tool
   * cheatsheet; 'dashboard' → dashboardPrompt with JSON output instructions).
   *
   * Personal context bundle: when personalContextLoader is wired and a userId
   * is in scope, appends the per-user bundle (named periods, playbook, etc.).
   *
   * @param {{ userId?: string, mode?: 'chat'|'dashboard' }} [context]
   * @returns {Promise<string>}
   */
  async getSystemPrompt(context = {}) {
    const mode = context?.mode ?? 'chat';
    const base = mode === 'dashboard' ? dashboardPrompt : chatPrompt;

    const userId = context?.userId ?? this.#activeUserId ?? null;
    const loader = this.deps.personalContextLoader;
    if (!loader || !userId) return base;

    const bundle = await this.#getPersonalContextBundle(userId, loader);
    return bundle ? `${base}\n\n${bundle}` : base;
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

    let bundle = null;
    try {
      bundle = await loader.load(userId);
      this.deps.logger?.info?.('health_coach.system_prompt.cached', {
        userId,
        chars: bundle?.length ?? 0,
        empty: !bundle,
      });
    } catch (err) {
      this.deps.logger?.warn?.('health_coach.system_prompt.loader_failed', {
        userId,
        error: err?.message || String(err),
      });
      bundle = null;
    }

    this.#personalContextCache.set(userId, bundle);
    return bundle;
  }

  /**
   * Seed the playbook library on first turn. `loadSeedIfEmpty` is idempotent —
   * it writes the seed entries only when the memory has no playbooks yet, and
   * is a no-op on every subsequent call.
   *
   * @param {{ userId?: string, mode?: 'chat'|'dashboard' }} context
   * @param {import('../framework/WorkingMemory.mjs').WorkingMemoryState|null} memory
   * @returns {Promise<Array<string|null>>}
   */
  async buildPromptSections(context = {}, memory = null) {
    if (memory) {
      await loadSeedIfEmpty(memory);
    }
    return super.buildPromptSections(context, memory);
  }

  /**
   * Override formatAttachments to resolve period bounds inline and point the
   * model at the right tool for each attachment type.
   *
   * @param {Array<object>} attachments
   * @returns {Promise<string>}
   */
  async formatAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return '';
    const periodResolver = this.deps.periodResolver
      ?? this.deps.healthAnalyticsService?.aggregator?.periodResolver
      ?? null;
    const userId = this.#activeUserId ?? this.deps.configService?.getHeadOfHousehold?.() ?? null;
    const lines = [
      '## User Mentions',
      'The user\'s message refers to the following items. ' +
      'Use your tools to fetch data when relevant.',
      '',
    ];
    for (const a of attachments) {
      lines.push(`- ${await formatHealthAttachment(a, { userId, periodResolver })}`);
    }
    return lines.join('\n');
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
        const userId = opts.userId ?? opts.context?.userId ?? null;
        const today = new Date().toISOString().split('T')[0];
        await writeTool.execute({ userId, date: today, dashboard: result });
      }
    }

    return result;
  }
}
