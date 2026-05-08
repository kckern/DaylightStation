// backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { formatHealthAttachment } from './formatAttachment.mjs';
import { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
import { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
import { MessagingChannelToolFactory } from './tools/MessagingChannelToolFactory.mjs';
import { LongitudinalToolFactory } from './tools/LongitudinalToolFactory.mjs';
import { PeriodToolFactory } from './tools/PeriodToolFactory.mjs';
import { HealthQueryToolFactory } from './tools/HealthQueryToolFactory.mjs';
import { PlaybookToolFactory }    from './tools/PlaybookToolFactory.mjs';
import { PersonalBaselineToolFactory } from './tools/PersonalBaselineToolFactory.mjs';
import { DailyDashboard } from './assignments/DailyDashboard.mjs';
import { chatPrompt } from './prompts/chat.mjs';
import { dashboardPrompt } from './prompts/dashboard.mjs';
import { loadSeedIfEmpty } from './playbooks/seedLoader.mjs';
import { FitnessEventAdapter }    from './services/adapters/FitnessEventAdapter.mjs';
import { NutritionEventAdapter }  from './services/adapters/NutritionEventAdapter.mjs';
import { WeightEventAdapter }     from './services/adapters/WeightEventAdapter.mjs';
import { PersonalBaselineService } from './services/PersonalBaselineService.mjs';
import { UserModelService }        from './services/UserModelService.mjs';
import { loadAgentConfig } from '../framework/loadAgentConfig.mjs';
import { healthCoachWorkingMemoryTemplate } from './memory/workingMemoryTemplate.mjs';
import { buildObservationalMemory } from '../framework/buildObservationalMemory.mjs';
import { buildTimeWindowProcessor } from '../framework/buildTimeWindowProcessor.mjs';
import { FoodLogService } from '#domains/nutrition/services/FoodLogService.mjs';

export class HealthCoachAgent extends BaseAgent {
  static id = 'health-coach';
  static description = 'Health coaching and fitness dashboard agent';

  // ---------------------------------------------------------------------------
  // Infrastructure declarations (consumed by bootstrap in T4)
  // ---------------------------------------------------------------------------

  /**
   * Memory configuration for this agent.
   * @returns {{ lastMessages: number, workingMemory: object }}
   */
  static getMemoryConfig({ configService } = {}) {
    const yaml = loadAgentConfig({ configService, agentId: 'health-coach' });
    const m = yaml.memory;
    // Skip Memory entirely when all features are off — avoids @mastra/memory's
    // Zod v3/v4 schema-compat bug that crashes prepare-tools-step.
    const anyFeatureOn = (m.last_messages !== false && m.last_messages > 0)
                      || m.working_memory?.enabled
                      || m.semantic_recall?.enabled;
    if (!anyFeatureOn) return null;

    const out = { lastMessages: m.last_messages };
    if (m.working_memory?.enabled) {
      out.workingMemory = {
        enabled: true,
        scope: m.working_memory.scope || 'resource',
        template: healthCoachWorkingMemoryTemplate,
      };
    }
    return out;
  }

  /**
   * Build the domain adapters map from available infrastructure deps.
   * Each adapter is null when its required service is not available.
   *
   * Note: `foodLogStore` (not `foodLogService`) is accepted here — FoodLogService
   * is constructed inline so bootstrap does not need to build it separately.
   *
   * @param {{ sessionService?, foodLogStore?, healthService?, householdId?, defaultUserId? }} [deps]
   * @returns {{ workout, meal, weigh_in }}
   */
  static getDomainAdapters({ sessionService, foodLogStore, healthService, householdId, defaultUserId } = {}) {
    return {
      workout:  sessionService
        ? new FitnessEventAdapter({ sessionService, householdId })
        : null,
      meal:     foodLogStore
        ? new NutritionEventAdapter({
            foodLogService: new FoodLogService({ foodLogStore }),
            userId: defaultUserId,
          })
        : null,
      weigh_in: healthService
        ? new WeightEventAdapter({ healthService, userId: defaultUserId })
        : null,
    };
  }

  /**
   * Build a PersonalBaselineService from adapters + dataService.
   * Returns null when either required dep is absent.
   *
   * @param {{ adapters?, dataService? }} [deps]
   * @returns {PersonalBaselineService|null}
   */
  static getBaselineService({ adapters, dataService } = {}) {
    if (!dataService || !adapters) return null;
    return new PersonalBaselineService({ adapters, dataService });
  }

  /**
   * Build a UserModelService from personalConstantsService + baselineService.
   * Returns null when either required dep is absent.
   *
   * @param {{ personalConstantsService?, baselineService? }} [deps]
   * @returns {UserModelService|null}
   */
  static getUserModelService({ personalConstantsService, baselineService } = {}) {
    if (!personalConstantsService || !baselineService) return null;
    return new UserModelService({ personalConstantsService, baselineService });
  }

  /**
   * Build memory processors for this agent. Currently: ObservationalMemory for
   * auto-compaction of long threads. T5 will add the TimeWindow processor.
   *
   * ObservationalMemory is both an input processor (injects compressed history)
   * and an output processor (persists new observations). The same instance
   * belongs in both arrays — Mastra is designed for this.
   *
   * Storage note: ObservationalMemory requires the MemoryStorage domain store,
   * accessed via `memory.storage.stores?.memory` on a built Memory instance.
   *
   * @param {{ configService?, memory? }} [deps]
   * @returns {{ inputProcessors: Array, outputProcessors: Array }}
   */
  static getMemoryProcessors({ configService, memory } = {}) {
    const yaml = loadAgentConfig({ configService, agentId: 'health-coach' });
    const storage = memory?.storage?.stores?.memory ?? null;
    const obs = buildObservationalMemory(yaml.memory?.observational, { storage });
    const tw  = buildTimeWindowProcessor(yaml.memory);
    return {
      inputProcessors:  [tw, obs].filter(Boolean),
      outputProcessors: obs ? [obs] : [],
    };
  }

  // ---------------------------------------------------------------------------

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
    const sections = [base];

    // Existing personal-context bundle (playbooks, named periods, etc.)
    const loader = this.deps.personalContextLoader;
    if (loader && userId) {
      const bundle = await this.#getPersonalContextBundle(userId, loader);
      if (bundle) sections.push(bundle);
    }

    // User model (profile + baselines) — appended last so it is closest to
    // the conversation and easy for the model to reference.
    const userModelService = this.deps.userModelService;
    if (userModelService && userId) {
      try {
        const block = await userModelService.composeContext({ userId });
        if (block) sections.push(block);
      } catch (err) {
        this.deps.logger?.warn?.('health_coach.system_prompt.user_model_failed', {
          userId,
          error: err?.message || String(err),
        });
      }
    }

    return sections.join('\n\n');
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
      mediaProgressMemory,
      dataService,
      messagingGateway,
      conversationId,
      personalContextLoader,
      archiveScopeFactory,
      dataRoot,
      healthAnalyticsService,
    } = this.deps;

    this.addToolFactory(new FitnessContentToolFactory({ fitnessPlayableService, mediaProgressMemory, dataService }));
    this.addToolFactory(new DashboardToolFactory({ dataService, healthStore }));

    // Messaging channel delivery (only if gateway available)
    if (messagingGateway && conversationId) {
      this.addToolFactory(new MessagingChannelToolFactory({ messagingGateway, conversationId }));
    }

    // Longitudinal tools: query_named_period (F-103.4) and read_notes_file
    // (F-102). Always registered — individual tools surface structured
    // "dependency missing" errors when their optional deps are unwired.
    this.addToolFactory(new LongitudinalToolFactory({
      healthStore,
      healthService,
      personalContextLoader,
      archiveScopeFactory,
      dataRoot,
    }));

    // Period vocabulary: list_periods, deduce_period, remember_period,
    // forget_period. Requires healthAnalyticsService (same dep as the retired
    // HealthAnalyticsToolFactory that previously hosted them).
    if (healthAnalyticsService) {
      this.addToolFactory(new PeriodToolFactory({ healthAnalyticsService }));
    }

    // SQL-equivalent query engine + compute sandbox + playbook recipes
    // (Task 12/13). These replace the surface of the four retired factories.
    // Task 4: eventQueryService drives query_events / get_event_detail tools.
    const { healthQueryService, computeSandbox, personalConstantsService, eventQueryService } = this.deps;
    if (healthQueryService && computeSandbox && personalConstantsService && eventQueryService) {
      this.addToolFactory(new HealthQueryToolFactory({
        queryService:     healthQueryService,
        sandbox:          computeSandbox,
        constantsService: personalConstantsService,
        eventQueryService,
      }));
    }

    // PlaybookToolFactory has no required deps — always register.
    this.addToolFactory(new PlaybookToolFactory());

    // PersonalBaselineToolFactory: on-demand re-query of user baselines.
    // Only register when baselineService is wired in bootstrap.
    const { baselineService } = this.deps;
    if (baselineService) {
      this.addToolFactory(new PersonalBaselineToolFactory({ baselineService }));
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
