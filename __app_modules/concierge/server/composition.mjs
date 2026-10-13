import { RegistryMediaPolicyCatalog } from "./adapters/RegistryMediaPolicyCatalog.mjs";
import { NodePromiseDeadline } from "#adapters/scheduling/NodePromiseDeadline.mjs";
import { WorkingMemoryRepository } from "../../../__capabilities/agent-runtime/server/application/framework/WorkingMemoryRepository.mjs";
import { AgentExecutionPolicy } from "../../../__capabilities/agent-runtime/server/application/framework/AgentExecutionPolicy.mjs";
import { AgentTranscriptFileStore, MastraAdapter, YamlWorkingMemoryAdapter } from "../../../__capabilities/agent-runtime/server/adapters/index.mjs";

export async function createConciergeServices(config) {
  const {
    configService,
    dataService,
    agentOrchestrator = null,
    workingMemory: sharedWorkingMemory = null,
    contentQueryService = null,
    contentRegistry = null,         // optional — used to look up Plex labels for media policy
    haGateway = null,
    devicesConfig = {},
    mediaLogsDir,
    logger = console,
    agentUsageRecorder = null,
  } = config;

  if (!configService) throw new Error('createConciergeServices: configService required');
  if (!dataService) throw new Error('createConciergeServices: dataService required');
  if (!mediaLogsDir) throw new Error('createConciergeServices: mediaLogsDir required');

  const { YamlSatelliteRegistry } = await import("./adapters/persistence/YamlSatelliteRegistry.mjs");
  const { ConciergePolicyEvaluator } = await import("./application/policy/ConciergePolicyEvaluator.mjs");
  const { MediaJudge } = await import("./application/services/MediaJudge.mjs");

  // Mastra reads OPENAI_API_KEY from process.env — bridge from ConfigService.
  const openaiKey = configService.getSecret?.('OPENAI_API_KEY');
  if (openaiKey && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = openaiKey;
  }

  // Shared workingMemory from createAgentsServices (preferred). Fall back to a
  // new instance only when called without the orchestrator (e.g., unit tests).
  const workingMemory = sharedWorkingMemory ?? new WorkingMemoryRepository({
    recordStore: new YamlWorkingMemoryAdapter({
      dataService,
      logger: logger.child({ component: 'working-memory' }),
    }),
  });

  const conciergeSatelliteRegistry = new YamlSatelliteRegistry({
    configService,
    logger: logger.child({ component: 'satellite-registry' }),
  });
  await conciergeSatelliteRegistry.load();

  // Read all concierge config from a single file with sections (satellites, media, …).
  // concierge.yml example:
  //   satellites: [...]
  //   media:
  //     judge_model: openai/gpt-4o-mini   # if absent → judge disabled, top-of-rank pick
  //     voice_sources: [plex]
  //     plex_library_ids: "5,10,11,16,18,19,21,22,23"
  //     prefix_aliases: {}
  // Reads data/household/agents/concierge.yml (falls back to the retiring
  // data/household/config/concierge.yml until the data move lands).
  const conciergeConfig = configService.reloadHouseholdAppConfig?.(null, 'concierge') ?? {};
  const mediaConfig = conciergeConfig?.media ?? {};

  const vocabularyConfig = conciergeConfig?.vocabulary ?? null;
  let conciergeVocabulary = null;
  if (vocabularyConfig) {
    const { AliasMap } = await import("#domains/common/AliasMap.mjs");
    try {
      conciergeVocabulary = new AliasMap(vocabularyConfig);
      logger.info?.('concierge.vocabulary.loaded', { entry_count: conciergeVocabulary.size });
    } catch (err) {
      logger.error?.('concierge.vocabulary.invalid_config', { error: err.message });
      throw err;
    }
  }

  const personalityText = conciergeConfig?.personality ?? null;
  if (personalityText && typeof personalityText === 'string' && personalityText.trim()) {
    logger.info?.('concierge.personality.loaded', { length: personalityText.length });
  }

  const householdPolicy = conciergeConfig?.policy ?? {};
  let conciergePolicy;
  try {
    conciergePolicy = new ConciergePolicyEvaluator({
      householdPolicy,
      logger: logger.child({ component: 'policy' }),
    });
    logger.info?.('concierge.policy.loaded', {
      household_allowed: householdPolicy.scopes_allowed?.length ?? 0,
      household_denied: householdPolicy.scopes_denied?.length ?? 0,
    });
  } catch (err) {
    // Boot-time fail-loud: malformed glob in concierge.yml.policy is a config bug.
    logger.error?.('concierge.policy.invalid_config', { error: err.message });
    throw err;
  }

  // Build ToolBundles (replaces old Skills). MemoryBundle is always included.
  const { MemoryBundle } = await import("./application/skills/MemoryBundle.mjs");
  const { HomeAutomationBundle } = await import("./application/skills/HomeAutomationBundle.mjs");
  const { MediaBundle } = await import("./application/skills/MediaBundle.mjs");

  const conciergeMediaDir = configService?.getMediaDir?.() || null;

  const toolBundles = [
    new MemoryBundle({ config: conciergeConfig?.memory ?? {} }),
  ];

  if (haGateway) {
    toolBundles.push(new HomeAutomationBundle({
      haGateway,
      logger: logger.child({ component: 'concierge.bundle.ha' }),
      config: conciergeConfig?.home_automation ?? {},
    }));
  }

  if (contentQueryService && haGateway) {
    const dsBaseUrl = devicesConfig?.daylightHostInternal || devicesConfig?.daylightHost;
    if (!dsBaseUrl) {
      logger.warn?.('concierge.media.bundle.skipped', {
        reason: 'no_daylight_host',
        message: 'devices.yml.daylightHostInternal (or daylightHost) is unset — '
               + 'MediaBundle not registered. Set daylightHostInternal to the LAN-routable URL '
               + 'where this server is reachable from HA and Voice PE devices.',
      });
    } else {
      // Judge is optional — only built when concierge.yml.media.judge_model is set.
      // No hardcoded fallback model: a quietly-different default in source has
      // bitten us before (10.0.0.5 default for ds_base_url). Fail loud here:
      // either the operator opts in by naming a model, or the use case runs
      // judge-less and picks top-of-rank.
      //
      // MediaJudge uses its OWN MastraAdapter (different model + maxToolCalls:1 +
      // tighter timeoutMs). This is not the shared agentRuntime — keeping it
      // separate is intentional (audit Q10).
      let mediaJudge = null;
      const judgeModel = mediaConfig?.judge_model;
      if (judgeModel) {
        const judgeLogger = logger.child({ component: 'judge-runtime' });
        const judgeTranscriptStore = conciergeMediaDir ? new AgentTranscriptFileStore({ mediaDir: conciergeMediaDir }) : null;
        const judgeRuntime = new MastraAdapter({
          model: judgeModel,
          logger: judgeLogger,
          usageRecorder: agentUsageRecorder,
          maxToolCalls: 1,
          timeoutMs: 8000,
          mediaDir: conciergeMediaDir,
          executionPolicy: new AgentExecutionPolicy({ maxToolCalls: 1, logger: judgeLogger, transcriptStore: judgeTranscriptStore }),
        });
        mediaJudge = new MediaJudge({
          agentRuntime: judgeRuntime,
          deadline: new NodePromiseDeadline(),
          clock: { epoch: () => Date.now() },
          logger: logger.child({ skill: 'media', component: 'judge' }),
        });
      } else {
        logger.warn?.('concierge.media.judge.disabled', {
          reason: 'no_judge_model_configured',
          message: 'concierge.yml.media.judge_model is unset — MediaBundle will pick the top '
                 + 'rank-sorted candidate without LLM disambiguation. Set judge_model '
                 + 'to enable (e.g. openai/gpt-4o-mini).',
        });
      }

      // Per-satellite media_policy gate (library / label / playlist
      // membership whitelist). The gate itself is vendor-agnostic; the
      // lookup callables composed here dispatch by item.source / by the
      // single configured voice source to the right adapter. This is the
      // only place in the concierge wiring that names specific content sources.
      const { MediaPolicyGate } = await import("./application/services/MediaPolicyGate.mjs");
      // For playlist membership we need to know the source the playlist
      // lives in. Today voice playback pins to a single source via
      // mediaConfig.voice_sources; use that.
      const primaryVoiceSource = Array.isArray(mediaConfig?.voice_sources) && mediaConfig.voice_sources.length === 1
        ? mediaConfig.voice_sources[0]
        : null;
      const mediaPolicyCatalog = new RegistryMediaPolicyCatalog({ contentRegistry, primaryVoiceSource });
      const mediaPolicyGate = new MediaPolicyGate({
        labelLookup: mediaPolicyCatalog.ancestorLabels,
        playlistMembershipLookup: mediaPolicyCatalog.playlistItemIds,
        logger: logger.child({ skill: 'media', component: 'policy-gate' }),
      });
      const { MediaPlaybackUrlPresenter } = await import("./adapters/MediaPlaybackUrlPresenter.mjs");

      toolBundles.push(new MediaBundle({
        contentQuery: contentQueryService,
        gateway: haGateway,
        logger: logger.child({ component: 'concierge.bundle.media' }),
        config: { ...mediaConfig, ds_base_url: dsBaseUrl },
        judge: mediaJudge,
        policyGate: mediaPolicyGate,
        resourcePresenter: new MediaPlaybackUrlPresenter({ baseUrl: dsBaseUrl }),
      }));
      logger.info?.('concierge.media.bundle.url', {
        ds_base_url: dsBaseUrl,
        source: devicesConfig?.daylightHostInternal ? 'daylightHostInternal' : 'daylightHost',
        judge_model: judgeModel ?? null,
      });
    }
  }

  // Register ConciergeAgent through the shared orchestrator so it uses the
  // shared MastraAdapter (agentRuntime) instead of a duplicate instance.
  // The agentRuntime is injected automatically by AgentOrchestrator.register().
  const { ConciergeAgent } = await import("./application/ConciergeAgent.mjs");
  if (agentOrchestrator) {
    agentOrchestrator.register(ConciergeAgent, {
      workingMemory,
      policy: conciergePolicy,
      toolBundles,
      vocabulary: conciergeVocabulary,
      personality: personalityText,
    });
  } else {
    // Fallback: no orchestrator provided (e.g., standalone test harness).
    // Log a warning — production should always pass agentOrchestrator.
    logger.warn?.('concierge.orchestrator.missing', {
      message: 'agentOrchestrator not provided — ConciergeAgent cannot be registered. '
             + 'Pass agentOrchestrator from createAgentsServices to enable the new path.',
    });
  }

  if (!agentOrchestrator) {
    throw new Error(
      'createConciergeServices: agentOrchestrator is required. '
      + 'Pass agentOrchestrator from createAgentsServices.'
    );
  }

  logger.info?.('concierge.services.ready', {
    bundles: toolBundles.map(b => b.name),
  });

  return {
    satelliteRegistry: conciergeSatelliteRegistry,
    advertisedModels: conciergeConfig?.advertised_models ?? ['daylight-house', 'gpt-4o-mini'],
  };
}
