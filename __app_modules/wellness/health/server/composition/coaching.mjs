import { createNutribotRuntimeConfig } from "../nutrition-config.mjs";
import { createHealthBudget } from "./budget.mjs";
import path from "path";
import { PersonalContextLoader } from "../application/health/PersonalContextLoader.mjs";
import { YamlPersonalPlaybookStore } from "../adapters/health/YamlPersonalPlaybookStore.mjs";
import { HealthArchiveScopeFactory } from "../application/health/archive/HealthArchiveScopeFactory.mjs";
import { FilesystemHealthArchiveAddressPolicyFactory } from "../adapters/health/FilesystemHealthArchiveAddressPolicyFactory.mjs";
import { ScopedHealthNotesArchive } from "../adapters/health/ScopedHealthNotesArchive.mjs";
import { SimilarPeriodFinder } from "../domain/health/services/SimilarPeriodFinder.mjs";
import { PatternDetector } from "../domain/health/services/PatternDetector.mjs";
import { YamlHealthScanDatastore } from "../adapters/persistence/yaml/YamlHealthScanDatastore.mjs";
import { CalibrationConstants } from "../application/health/analytics/CalibrationConstants.mjs";
import { PeriodResolver } from "../application/health/analytics/PeriodResolver.mjs";
import { HealthAnalyticsService } from "../application/health/analytics/HealthAnalyticsService.mjs";
import { HealthQueryService } from "../application/agents/health-coach/services/HealthQueryService.mjs";
import { ComputeSandboxAdapter } from "../adapters/agents/health-coach/ComputeSandboxAdapter.mjs";
import { DataServiceHealthCoachWorkspaceRepository } from "../adapters/agents/health-coach/DataServiceHealthCoachWorkspaceRepository.mjs";
import { PersonalConstantsService } from "../application/agents/health-coach/services/PersonalConstantsService.mjs";
import { MastraAdapter } from "../../../../../__capabilities/agent-runtime/server/adapters/index.mjs";
import { AgentExecutionPolicy } from "../../../../../__capabilities/agent-runtime/server/application/framework/AgentExecutionPolicy.mjs";
import { HealthCoachAgent } from "../application/agents/health-coach/index.mjs";
import { buildAgentMemory } from "../../../../../__capabilities/agent-runtime/server/application/framework/buildAgentMemory.mjs";
import { buildAgentEventQueryService } from "../application/agents/buildAgentEventQueryService.mjs";
import { buildAgentRuntime } from "../../../../../__capabilities/agent-runtime/server/application/framework/buildAgentRuntime.mjs";
import { CoachingCommentaryService } from "../application/coaching/index.mjs";
import { CoachingOrchestrator } from "../application/coaching/index.mjs";
import { MealCoachingTrigger } from "../application/coaching/index.mjs";

export function createHealthCoachingContext({ rawNutribotConfig, configService, dataService, healthStore, nutriListStore, logger }) {
  // The coaching orchestrator consumes the NutriBot runtime contract rather
  // than ConfigService. Keep this local to the agents composition root: this
  // function is also used independently of createNutribotServices.
  const nutribotConfig = createNutribotRuntimeConfig(
    rawNutribotConfig ?? configService?.getAppConfig?.('nutribot') ?? {},
  );

  // The health budget contract for the coach: range, zone, completeness.
  const healthBudget = createHealthBudget({ dataService, healthStore, nutriListStore, logger });
  const coachToday = () => new Date().toLocaleDateString('en-CA',
    { timeZone: configService?.getTimezone?.() || 'America/Los_Angeles' });

  return { nutribotConfig, healthBudget, coachToday };
}

export function registerHealthCoaching({ healthStore, healthService, configService, logger, workingMemory, dataService, mediaProgressMemory, sessionService, foodLogStore, nutriListStore, agentConfigProjection, dataPath, maxToolCalls, transcriptStore, memoryFactory, memoryProcessorFactory, agentOrchestrator, fitnessPlayableService, messagingGateway, conversationId, webNutribotAdapter, healthBudget, coachToday, nutribotConfig, agentUsageRecorder, scheduler }) {
  // Shared HealthAnalyticsService instance — assigned inside the health-coach
  // registration block below and exposed on the returned router so app.mjs
  // can wire it into the health-mentions router (listPeriods support).
  let sharedHealthAnalyticsService = null;

  // Register health coach agent (requires health services)
  if (healthStore && healthService) {
    // Personal-context loader: reads per-user playbook YAML at
    //   {dataDir}/users/{userId}/lifelog/archives/playbook/playbook.yml
    // and projects it into a markdown bundle that gets appended to the agent's
    // system prompt. The loader expects a `dataService` with a `readYaml(absPath)`
    // method; DataService doesn't expose one, so we use a tiny inline shim
    // that mirrors its sync `readYamlFile` semantics (return null on ENOENT or
    // any read/parse error — never throw, so agent boot can't be killed by a
    // bad playbook).
    const dataDir = configService?.getDataDir?.() || './data';
    const archiveRoot = path.resolve(dataDir, 'users');
    const personalContextLoader = new PersonalContextLoader({
      playbookStore: new YamlPersonalPlaybookStore({ usersRoot: archiveRoot, logger }),
      logger,
    });

    // F-102/103/104 longitudinal tool dependencies. The archiveScopeFactory
    // builds per-user scopes that respect each user's `archive.workout_sources`
    // playbook entry (F4-A). Falls back to DEFAULT_WORKOUT_SOURCES when a user
    // has no `archive:` block. Both roots must be absolute — HealthArchiveScope
    // hard-validates this at construction.
    const dataRoot = path.resolve(dataDir);
    const mediaDir = configService?.getMediaDir?.() || path.resolve(path.dirname(dataRoot), 'media');
    const mediaRoot = path.resolve(mediaDir);
    const archiveScopeFactory = new HealthArchiveScopeFactory({
      archiveAddressPolicy: new FilesystemHealthArchiveAddressPolicyFactory().create({ dataRoot, mediaRoot }),
      personalContextLoader,
      logger,
    });
    const notesArchive = new ScopedHealthNotesArchive({ dataRoot, archiveScopeFactory });
    const similarPeriodFinder = new SimilarPeriodFinder();
    // F-004 PatternDetector — pure domain service consumed by MorningBrief.
    // Stateless, no I/O; instantiated once and shared across requests.
    const patternDetector = new PatternDetector();

    // F-007 CalibrationConstants — body-comp calibration anchor service used
    // by MorningBrief to surface the DEXA staleness CTA. Instances hold
    // per-user state, but `load(userId)` is idempotent and called lazily by
    // consumers. We instantiate one shared instance here; per-user state is
    // re-loaded on each gather() invocation.
    const healthScanStore = new YamlHealthScanDatastore({ dataDir, logger });
    const calibrationConstants = new CalibrationConstants({
      healthScanStore,
      weightStore: healthStore,
      logger,
    });

    // Plan 1+4: HealthAnalyticsService composition root for Tier 2 analytical
    // primitives. Wires PeriodResolver + healthStore + healthService into a
    // single addressable service used by both the agent (via
    // HealthAnalyticsToolFactory) and the dscli health surface.
    // Plan 4: also wire playbookLoader + workingMemory so period-memory
    // + reflection methods light up.
    const periodResolver = new PeriodResolver();
    const healthAnalyticsService = new HealthAnalyticsService({
      healthStore,
      healthService,
      periodResolver,
      playbookLoader: personalContextLoader,    // ← Plan 4
      workingMemoryAdapter: workingMemory,      // ← Plan 4
    });
    sharedHealthAnalyticsService = healthAnalyticsService;

    // Task 12: construct new analytical query services for HealthQueryToolFactory
    // + PlaybookToolFactory. Added additively — old tools remain registered.
    const healthQueryService       = new HealthQueryService({ healthStore, healthService });
    const computeSandbox           = new ComputeSandboxAdapter();
    const workspaceRepository = new DataServiceHealthCoachWorkspaceRepository({
      dataService,
      profileService: configService,
      mediaProgressMemory,
    });
    const personalConstantsService = new PersonalConstantsService({ workspaceRepository, healthStore });

    // ── Per-agent infrastructure loop ───────────────────────────────────────────
    // Each agent class declares its infrastructure needs via static methods.
    // Bootstrap stays generic — no #apps/agents/<agent>/ imports for adapters
    // or services; each class's static methods handle their own wiring.
    //
    // Adding a new reflective agent: declare the four static methods on the class,
    // then append it to REFLECTIVE_AGENTS below. No other bootstrap changes needed.

    const householdId    = configService?.getDefaultHouseholdId?.() ?? 'default';
    const defaultUserId  = configService?.getHeadOfHousehold?.()    ?? householdId;

    const sharedAgentDeps = {
      // Domain services
      sessionService,
      foodLogStore,
      nutriListStore,
      healthService,
      healthStore,
      dataService,
      agentConfigProjection,
      workspaceRepository,
      personalConstantsService,
      // Coordinates
      householdId,
      defaultUserId,
      // Framework deps
      logger,
      mediaDir,
      dataPath,
      // Runtime class injected so the app-layer factory holds no adapter import
      AgentRuntime: MastraAdapter,
      maxToolCalls,
      executionPolicy: new AgentExecutionPolicy({ maxToolCalls, logger, transcriptStore }),
      memoryFactory,
      memoryProcessorFactory,
    };

    const REFLECTIVE_AGENTS = [HealthCoachAgent];

    for (const AgentClass of REFLECTIVE_AGENTS) {
      const agentId           = AgentClass.id ?? 'unknown';
      const memoryConfig      = AgentClass.getMemoryConfig?.(sharedAgentDeps)                        ?? null;
      const adapters          = AgentClass.getDomainAdapters?.(sharedAgentDeps)                      ?? null;
      const memory            = buildAgentMemory(memoryConfig, { ...sharedAgentDeps, agentId });
      const baselineService   = AgentClass.getBaselineService?.({ ...sharedAgentDeps, adapters })    ?? null;
      const eventQueryService = buildAgentEventQueryService(adapters, baselineService);
      const userModelService  = AgentClass.getUserModelService?.({ ...sharedAgentDeps, baselineService }) ?? null;
      // Per-agent memory processors (ObservationalMemory etc.)
      const processors        = AgentClass.getMemoryProcessors?.({ ...sharedAgentDeps, memory })     ?? null;
      const perAgentRuntime   = buildAgentRuntime(memory, sharedAgentDeps, processors);

      agentOrchestrator.register(AgentClass, {
        workingMemory,
        healthStore,
        healthService,
        fitnessPlayableService,
        sessionService,
        mediaProgressMemory,
        dataService,
        defaultUserId,
        workspaceRepository,
        messagingGateway,
        conversationId: conversationId ?? configService?.getNutribotConversationId?.() ?? null,
        personalContextLoader,
        notesArchive,
        similarPeriodFinder,
        patternDetector,
        calibrationConstants,
        healthAnalyticsService,
        healthQueryService,
        computeSandbox,
        personalConstantsService,
        // Per-agent infrastructure (each reflective agent gets its own Memory
        // + MastraAdapter so cross-agent memory isolation is preserved):
        agentRuntime: perAgentRuntime,
        eventQueryService,
        baselineService,
        userModelService,
        // NutritionActionToolFactory's log_food tool — same WebNutribotAdapter
        // instance the health router uses (see healthApi.mjs / app.mjs proxy).
        nutritionInput: webNutribotAdapter,
        // get_day_budget / get_budget_range (BudgetToolFactory).
        budgetService: healthBudget,
        nutriListStore,
        today: coachToday,
      });
    }
  }

  const coachingTimezone = configService?.getTimezone?.() || nutribotConfig.getUserTimezone?.() || 'America/Los_Angeles';

  // Create coaching orchestrator (new template-driven system)
  let coachingOrchestrator = null;
  if (healthStore && messagingGateway) {
    const commentaryService = new CoachingCommentaryService({
      runtime: new MastraAdapter({ model: 'openai/gpt-4o-mini', logger, usageRecorder: agentUsageRecorder, maxToolCalls: 1, timeoutMs: 30000,
        executionPolicy: new AgentExecutionPolicy({ maxToolCalls: 1, logger, transcriptStore }) }),
      logger,
    });

    coachingOrchestrator = new CoachingOrchestrator({
      commentaryService,
      messagingGateway,
      healthStore,
      nutriListStore,
      // The orchestrator needs the nutrition-goal contract, not the broad
      // ConfigService. This normalized config also supplies safe defaults.
      // Timezone is the ONE coaching timezone, shared with the meal trigger
      // and the exercise-reaction policy so "today" never disagrees.
      config: {
        getUserGoals: (userId) => nutribotConfig.getUserGoals(userId),
        getUserTimezone: () => coachingTimezone,
      },
      // The health budget: the ONE floor (completeness), top and counted food.
      budgetService: healthBudget,
      // household coaching/config.yml `logging_completeness.min_calories` —
      // the FALLBACK threshold, used only when the budget is unavailable.
      completeness: configService?.getHouseholdAppConfig?.(null, 'coaching')?.logging_completeness,
      logger,
    });
  }

  // Who is coached, where, and how — shared by the scheduled briefs and the
  // event-driven post-meal / exercise-reaction triggers.
  const coachingConversationId = conversationId ?? configService?.getNutribotConversationId?.() ?? null;
  const coachingUserId = configService?.getHeadOfHousehold?.() || 'default';
  const coachingCfg = configService?.getHouseholdAppConfig?.(null, 'coaching') || {};

  // Post-meal coaching: captures re-arm a quiet timer (coaching.yml `post_meal`).
  const mealCoachingTrigger = coachingOrchestrator && coachingConversationId
    ? new MealCoachingTrigger({
      getOrchestrator: () => coachingOrchestrator,
      userId: coachingUserId,
      conversationId: coachingConversationId,
      scheduler: { setTimeout, clearTimeout },
      config: coachingCfg.post_meal,
      today: () => new Date().toLocaleDateString('en-CA', { timeZone: coachingTimezone }),
      localTime: () => new Date().toLocaleTimeString('en-GB', { timeZone: coachingTimezone, hour: '2-digit', minute: '2-digit', hour12: false }),
      logger,
    })
    : null;

  // Register scheduler tasks for coaching orchestrator
  if (coachingOrchestrator && scheduler) {
    if (coachingConversationId) {
      // Cron cadence is configurable via household coaching/config.yml
      // (`morning_brief.schedule` / `weekly_digest.schedule`), mirroring the
      // journalist morning-debrief pattern; the historical expressions remain
      // the defaults when unconfigured.
      const morningBriefSchedule = coachingCfg?.morning_brief?.schedule || '0 10 * * *';
      const weeklyDigestSchedule = coachingCfg?.weekly_digest?.schedule || '0 19 * * 0';

      scheduler.registerTask('coaching:morning-brief', morningBriefSchedule, async () => {
        await coachingOrchestrator.sendMorningBrief({ userId: coachingUserId, conversationId: coachingConversationId });
      });

      scheduler.registerTask('coaching:weekly-digest', weeklyDigestSchedule, async () => {
        await coachingOrchestrator.sendWeeklyDigest({ userId: coachingUserId, conversationId: coachingConversationId });
      });
    }
  }

  return { sharedHealthAnalyticsService, coachingOrchestrator, mealCoachingTrigger, coachingTimezone, coachingConversationId, coachingUserId, coachingCfg };
}
