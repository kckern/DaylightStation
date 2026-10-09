# Agent ownership partition

Source review at checkpoint `759be3aaf7`, for the milestone 3 inventory. This is a
file-placement decision, not a completed migration. Preserve installed agent IDs,
configuration keys, memory/transcript locations, scheduling, and tool behavior.

| Current source | Destination owner | Reason and boundary |
| --- | --- | --- |
| `3_applications/agents/AgentOrchestrator.mjs`, `AgentMemoryAdministrationService.mjs`, `ports/`, `scheduling/` | `capabilities/agent-runtime/server` | Registration, execution, memory administration, and scheduling contracts serve multiple products. Installed agent selection belongs to composition. |
| `3_applications/agents/framework/`, except `buildAgentEventQueryService.mjs` | `capabilities/agent-runtime/server` | Base agent, tools, assignments, memory, validation, execution policy, and decorators are reusable mechanisms. Public entries expose the required contracts; they must not export installed product agents. |
| `3_applications/agents/echo/` | Agent-runtime example/diagnostic implementation | Existing installed diagnostic agent; preserve its registration and ID. It does not require a new product owner. |
| `3_applications/agents/health-coach/` and `framework/buildAgentEventQueryService.mjs` | `modules/health/server` | Health coaching, workout/meal/weigh-in summaries, baselines, and intervention policy. The helper constructs the health-specific event query service. |
| `3_applications/agents/nutrition-auditor/` | `modules/health/server` | Nutrition auditing is health product policy. Keep its existing agent identity and configuration. |
| `3_applications/agents/card-ladder-tuner/` | `modules/school/server` | School card-ladder tuning; its existing composition consumer is `5_composition/modules/cardLadderTuning.mjs`. |
| `3_applications/agents/lifeplan-guide/` | Life/lifeplan product owner | Plans, cadence, ceremonies, coaching and lifelog policy follow the owner selected for the existing Life product. Do not duplicate its framework. |
| `3_applications/agents/paged-media-toc/` | Media/content owner, settled with that partition | Paged-media table-of-contents extraction and its ports follow the owner of the paged-media workflow. They are not generic agent infrastructure. |
| `3_applications/agents/concierge/` and `2_domains/concierge/` | Home/concierge product owner | Household assistant policy and tool bundles compose home automation and media capabilities. Settle final directory name with the Home partition, preserving the existing product. |
| `1_adapters/agents/health-coach/` | Health adapters | Implements the health-owned workspace and compute ports. |
| `1_adapters/agents/MediaPlaybackUrlPresenter*`, `RegistryMediaPolicyCatalog.mjs` | Concierge adapters | Concrete consumers are the concierge composition path, policy gate and media tools. Multiple underlying services do not make this concierge policy generic. |
| Other `1_adapters/agents/` files | Agent-runtime adapters | Mastra runtime/memory, schema conversion, conversation/working-memory persistence and transcript storage implement shared runtime contracts. Keep vendor implementation behind composition-facing exports. |
| `frontend/src/modules/Agent/` | `capabilities/agent-runtime/browser` | Shared chat, markdown, attribution and transport presentation. Product prompts/selection remain in product surfaces or installed composition. |

## Important source-backed exception

`framework/buildAgentEventQueryService.mjs` contains a comment calling its
dependency framework-level. The actual `health-coach/services/EventQueryService.mjs`
is explicitly health-specific: `SUPPORTED_KINDS` is workout/meal/weigh-in;
`KIND_MAP` interprets Strava activities; baseline selection names fitness,
nutrition and weight; `computeHrStats` implements heart-rate bands. Moving this
whole service into generic agent infrastructure would misclassify product policy.
Move the helper with Health and inject its result when installing HealthCoach.
Do not generalize its vocabulary during this structural migration.

## Composition and verification obligations

- Split the current agents barrel: it mixes generic framework exports with
  HealthCoach, NutritionAuditor and CardLadderTuner. Runtime must not import its
  product consumers through a replacement barrel.
- Preserve the installed registrations assembled by `createAgentsServices` and
  `createConciergeServices` in `5_composition/bootstrap.mjs`. Move product-specific
  factory bodies to their owner while the host supplies shared runtime objects.
- Preserve `agentUsageRecorder` attribution and all existing registration IDs;
  source ownership must not alter AI attribution, memory scope or persistence.
- Select existing framework, coach, auditor, tuner, concierge and browser tests
  by actual incoming references. No live model/API calls are needed for the
  ownership move; use existing injected synthetic adapters.
- Keep prompt templates, seed YAML, colocated tests and resource loaders with
  their owner, including production artifact inclusion for the seed YAML.

The final Life, Media/content and Home directory names depend on those wider
partitions. Their product ownership is established here; this document must not
be treated as evidence that the unresolved wider partitions are complete.
