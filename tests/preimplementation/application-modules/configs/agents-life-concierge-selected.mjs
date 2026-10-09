/** Fixed retained oracles; candidate relocation uses reviewed flat move map. */
export const agentsLifeConciergeVitest = [
  "backend/src/1_adapters/agents/AgentTranscriptFileStore.test.mjs",
  "backend/src/1_adapters/agents/MediaPlaybackUrlPresenter.test.mjs",
  "backend/src/2_domains/lifeplan/services/LifeEventSignalDetector.test.mjs",
  "backend/src/3_applications/agents/framework/ToolBundle.test.mjs",
  "backend/src/3_applications/agents/framework/decorators/CallLimiter.test.mjs",
  "backend/src/3_applications/agents/framework/decorators/PolicyDecorator.test.mjs",
  "backend/src/3_applications/agents/framework/decorators/TranscriptRecorder.test.mjs",
  "backend/src/3_applications/agents/framework/decorators/UserIdInjector.test.mjs",
  "backend/src/3_applications/agents/framework/decorators/applyDecorators.test.mjs",
  "backend/src/3_applications/agents/framework/utils/safeClone.test.mjs",
  "backend/src/3_applications/lifeplan/services/LifeEventSuggester.test.mjs",
  "backend/src/4_api/v1/agents/middlewares/satelliteBearerAuth.test.mjs",
  "backend/src/4_api/v1/agents/wireFormats/native.test.mjs",
  "backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.test.mjs",
  "frontend/src/Apps/LifeApp.theme.test.js",
  "frontend/src/modules/Agent/AgentChatSurface.test.jsx",
  "frontend/src/modules/Agent/MarkdownText.test.jsx",
  "frontend/src/modules/Agent/ToolCallAttribution.test.jsx",
  "frontend/src/modules/Agent/runtime.test.js",
  "frontend/src/modules/Life/components/components.test.jsx",
  "frontend/src/modules/Life/hooks/useLifePlan.isEmpty.test.jsx",
  "frontend/src/modules/Life/lib/format.test.jsx",
  "frontend/src/modules/Life/theme/semantics.test.jsx",
  "frontend/src/modules/Life/views/log/LogWeekView.test.jsx",
  "frontend/src/modules/Life/views/log/shared/ActivityHeatmap.test.jsx",
  "frontend/src/modules/Life/views/now/PriorityList.test.jsx",
  "frontend/src/modules/Life/views/plan/CeremonyConfig.test.jsx",
  "frontend/src/modules/Life/views/plan/PurposeView.test.jsx",
  "frontend/src/modules/Life/views/plan/QualitiesView.test.jsx",
  "frontend/src/modules/Life/widgets/CadenceIndicator.test.jsx",
  "tests/isolated/adapters/agents/MastraAdapter.memory.test.mjs",
  "tests/isolated/adapters/agents/MastraAdapter.modern.test.mjs",
  "tests/isolated/adapters/agents/MastraAdapter.transcript.test.mjs",
  "tests/isolated/adapters/agents/MastraAdapter.usage.test.mjs",
  "tests/isolated/agents/AgentOrchestrator.userIdResolution.test.mjs",
  "tests/isolated/agents/concierge/ConciergeAgent.test.mjs",
  "tests/isolated/agents/concierge/MemoryBundle.test.mjs",
  "tests/isolated/agents/concierge/concierge-transcript-path.test.mjs",
  "tests/isolated/agents/conversation-store.test.mjs",
  "tests/isolated/agents/conversation_history/mastra_adapter.test.mjs",
  "tests/isolated/agents/conversation_history/orchestrator_thread.test.mjs",
  "tests/isolated/agents/conversation_history/wire_format.test.mjs",
  "tests/isolated/agents/echo/EchoAgent.baseAgent.test.mjs",
  "tests/isolated/agents/framework/AgentTranscript.test.mjs",
  "tests/isolated/agents/framework/BaseAgent.attachments.test.mjs",
  "tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs",
  "tests/isolated/agents/framework/BaseAgent.buildToolDecorators.test.mjs",
  "tests/isolated/agents/framework/BaseAgent.runStream.test.mjs",
  "tests/isolated/agents/framework/assignment-identity.test.mjs",
  "tests/isolated/agents/framework/buildAgentEventQueryService.test.mjs",
  "tests/isolated/agents/framework/buildAgentMemory.test.mjs",
  "tests/isolated/agents/framework/buildAgentRuntime.test.mjs",
  "tests/isolated/agents/framework/buildObservationalMemory.test.mjs",
  "tests/isolated/agents/framework/buildTimeWindowProcessor.test.mjs",
  "tests/isolated/agents/framework/loadAgentConfig.test.mjs",
  "tests/isolated/agents/framework/user-id-injector.test.mjs",
  "tests/isolated/agents/lifeplan-guide/agent.test.mjs",
  "tests/isolated/agents/lifeplan-guide/cadence-check.test.mjs",
  "tests/isolated/agents/lifeplan-guide/ceremony-tools.test.mjs",
  "tests/isolated/agents/lifeplan-guide/coaching-tools.test.mjs",
  "tests/isolated/agents/lifeplan-guide/guardrails.test.mjs",
  "tests/isolated/agents/lifeplan-guide/life-event-tools.test.mjs",
  "tests/isolated/agents/lifeplan-guide/lifelog-tools.test.mjs",
  "tests/isolated/agents/lifeplan-guide/notification-tool-dedupe.test.mjs",
  "tests/isolated/agents/lifeplan-guide/notification-tools.test.mjs",
  "tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs",
  "tests/isolated/agents/lifeplan-guide/tool-identity.test.mjs",
  "tests/isolated/agents/lifeplan-guide/writer-tools.test.mjs",
  "tests/isolated/agents/memory/thread_id_wire.test.mjs",
  "tests/isolated/agents/memory/working_memory_schema.test.mjs",
  "tests/isolated/composition/lifeplan-bootstrap.test.mjs",
  "tests/isolated/domain/lifeplan/belief-cascade.test.mjs",
  "tests/isolated/domain/lifeplan/cadence-timezone.test.mjs",
  "tests/isolated/domain/lifeplan/dependency-resolver.test.mjs",
  "tests/isolated/domain/lifeplan/goal-state-machine.test.mjs",
  "tests/isolated/domain/lifeplan/quality-rules.test.mjs",
  "tests/isolated/domain/lifeplan/yaml-stores.test.mjs",
  "tests/isolated/lifeplan/lifecycle/belief-dormancy-decay.test.mjs",
  "tests/isolated/lifeplan/lifecycle/goal-full-journey.test.mjs",
  "tests/isolated/lifeplan/lifecycle/life-event-cascade.test.mjs",
  "tests/isolated/lifeplan/lifecycle/paradigm-shift.test.mjs",
  "tests/isolated/lifeplan/lifecycle/value-reordering.test.mjs",
  "tests/isolated/lifeplan/services/alignment-anti-goal.test.mjs",
  "tests/isolated/lifeplan/services/alignment-drift-copy.test.mjs",
  "tests/isolated/lifeplan/services/alignment-stage-and-ceremony.test.mjs",
  "tests/isolated/lifeplan/services/ceremony-scheduler-dedupe.test.mjs",
  "tests/isolated/lifeplan/services/ceremony-scheduling.test.mjs",
  "tests/isolated/lifeplan/services/feedback-service.test.mjs",
  "tests/isolated/lifeplan/services/metrics-service.test.mjs",
  "tests/isolated/lifeplan/services/plan-authoring.test.mjs",
  "tests/isolated/lifeplan/signals/belief-signal-detector.test.mjs",
  "tests/unit/cli/commands/concierge.test.mjs",
  "tests/unit/cli/commands/memory.test.mjs"
];

/** Same existing HTTP bodies/names/assertions over complete memory-wire JSON/SSE; no TCP lifecycle claim. */
export const agentsLifeHttpVitest = [
  "backend/src/4_api/v1/agents/createAgentMemoryRouter.test.mjs",
  "backend/src/4_api/v1/agents/createAgentMetaRouter.test.mjs",
  "backend/src/4_api/v1/agents/mountAgentHttp.openai.test.mjs",
  "backend/src/4_api/v1/agents/mountAgentHttp.test.mjs",
  "tests/isolated/agents/concierge/concierge-smoke.test.mjs"
];
export const agentsLifeHttpCases = [
  {
    "file": "backend/src/4_api/v1/agents/createAgentMemoryRouter.test.mjs",
    "names": [
      "GET /:agentId/memory/:userId returns the entries",
      "GET returns 404 when agent not registered",
      "DELETE /:agentId/memory/:userId clears all entries",
      "DELETE /:agentId/memory/:userId/:key removes one entry",
      "throws when memory administration is missing"
    ]
  },
  {
    "file": "backend/src/4_api/v1/agents/createAgentMetaRouter.test.mjs",
    "names": [
      "GET / lists registered agents",
      "GET /:agentId/assignments returns 404 when agent missing",
      "GET /:agentId/assignments enumerates assignments",
      "POST /:agentId/assignments/:assignmentId/run delegates to orchestrator",
      "throws when orchestrator is missing"
    ]
  },
  {
    "file": "backend/src/4_api/v1/agents/mountAgentHttp.openai.test.mjs",
    "names": [
      "POST /chat/completions returns chat.completion envelope (non-stream)",
      "POST /chat/completions with empty messages returns 400",
      "GET /models returns model list"
    ]
  },
  {
    "file": "backend/src/4_api/v1/agents/mountAgentHttp.test.mjs",
    "names": [
      "POST /run delegates to orchestrator.run and returns JSON envelope",
      "POST /run returns 400 when input missing",
      "POST /run-stream emits SSE in order ending with done",
      "POST /run-background returns 202 with taskId",
      "contextExtractor merges into context passed to orchestrator",
      "runs authMiddleware before the route handler"
    ]
  },
  {
    "file": "tests/isolated/agents/concierge/concierge-smoke.test.mjs",
    "names": [
      "returns a valid OpenAI chat.completion envelope",
      "calls the agent runtime (LLM stub was invoked)",
      "GET /v1/models returns advertised list",
      "returns a refusal without calling the LLM when request is denied",
      "ConciergeAgent.run() returns refusal output directly without hitting runtime"
    ]
  }
];
