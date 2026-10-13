# AI Agents Context

## Purpose

Autonomous AI agents that use LLM reasoning for complex tasks. Unlike rule-based bots (journalist, nutribot), agents can reason, use tools, and make decisions dynamically.

For the current validated runtime, managed runs, cancellation, questions and SDK
versions, see [Shared agent runtime contracts](../reference/core/agent-runtime.md).
The [nutrition auditor](../reference/health/nutrition-cleanup.md) reads historical
evidence and applies guarded repairs to active 72-hour provisional captures through
Health (legacy rows retain a today/yesterday guard). Capture completion, bounded
estimates, verified corrections and silent deterministic finalization are separate.

## Key Concepts

| Term | Definition |
|------|------------|
| **Agent** | Autonomous LLM-powered service with tools and system prompt |
| **AgentOrchestrator** | Central registry for agent registration and invocation |
| **Tool** | Function an agent can call (JSON Schema parameters) |
| **IAgentRuntime** | Port interface for LLM execution (framework-agnostic) |
| **MastraAdapter** | Mastra SDK implementation of IAgentRuntime |
| **BaseAgent** | Common lifecycle base class (memory, tools, assignments) |
| **ToolFactory** | Grouped tool creation base class |
| **WorkingMemoryState** | In-memory key-value store with TTL-based expiry |
| **Assignment** | Structured multi-step workflow template method |
| **OutputValidator** | JSON Schema validation with LLM self-correction retry |
| **Scheduler** | In-process cron for triggering agent assignments |

## Architecture

```
__capabilities/agent-runtime/server/api/            → HTTP endpoints (mountAgentHttp)
__capabilities/agent-runtime/server/application/    → AgentOrchestrator + framework (capability)
__app_modules/wellness/health/server/application/agents/health-coach/  → individual agents (health-coach)
__capabilities/agent-runtime/server/adapters/       → MastraAdapter (Mastra SDK wrapper)
```

**Key principle:** Application layer has zero knowledge of Mastra. Could swap for LangChain by writing new adapter.

## File Locations

### Application Layer (`__capabilities/agent-runtime/server/application/`)
- `AgentOrchestrator.mjs` - Central registration and invocation
- `ports/IAgentRuntime.mjs` - Runtime interface
- `ports/ITool.mjs` - Tool interface with `createTool()` helper
- `echo/EchoAgent.mjs` - Demo agent with echo and time tools

### Health Coach Agent (`__app_modules/wellness/health/server/application/agents/health-coach/`)
- `HealthCoachAgent.mjs` - Main agent class (extends BaseAgent)
- `assignments/DailyDashboard.mjs` - Daily dashboard preparation assignment
- `assignments/MorningBrief.mjs` - Daily reconciliation-aware nutrition brief (scheduled 10am). Also drives F-003 compliance CTAs, F-004 pattern detection, F-005 similar-period grounding, F-007 DEXA staleness warning.
- `assignments/NoteReview.mjs` - Per-accept coaching review (event-triggered, default silent)
- `assignments/EndOfDayReport.mjs` - Daily report coaching commentary (event-triggered)
- `assignments/WeeklyDigest.mjs` - Weekly trend summary (scheduled Sunday 7pm)
- `assignments/ExerciseReaction.mjs` - Post-exercise context message (Strava webhook-triggered)
- `tools/FitnessContentToolFactory.mjs` - Plex content browsing, program state (3 tools)
- `tools/DashboardToolFactory.mjs` - Dashboard write, goals, coaching notes (3 tools)
- `tools/MessagingChannelToolFactory.mjs` - Channel message delivery (1 tool)
- `tools/LongitudinalToolFactory.mjs` - Historical archive queries: `query_historical_weight`/`_nutrition`/`_workouts`, `query_named_period`, `read_notes_file`, `find_similar_period` (6 tools, F-102/103/104)
- `schemas/dashboard.mjs` - Dashboard output JSON Schema
- `schemas/coachingMessage.mjs` - Output schema for coaching messages (should_send, text, parse_mode)
- `index.mjs` - Barrel exports

### Personalized Coaching Stack (F-100 → F-007)

The HealthCoachAgent assignments are augmented with per-user personalization sourced from a mirrored personal-health archive:

- **Ingestion** (`__app_modules/wellness/health/cli/ingest-health-archive.cli.mjs` + `__app_modules/wellness/health/server/application/health/archive/HealthArchiveIngestion.mjs`) — `npm run ingest:health-archive --user <userId>` mirrors a whitelisted subset of an external archive into `data/users/<userId>/lifelog/archives/` and `media/archives/`. Privacy keyword exclusions block email/chat/finance/journal/calendar/social/banking. Path-traversal defense lives separately in `__app_modules/wellness/health/server/application/health/archive/HealthArchiveScope.mjs` (instance-based, requires absolute `dataRoot`/`mediaRoot`).
- **PersonalContext** (`__app_modules/wellness/health/server/application/health/PersonalContextLoader.mjs`) — loads `playbook.yml` and renders a markdown bundle (Profile / Calibration / Named Periods / Patterns) injected into the agent's system prompt by `HealthCoachAgent.getSystemPrompt(userId)`. Cached per-userId; pre-warmed in `runAssignment` and `run` so the framework's sync `getSystemPrompt()` call always lands on cache hit.
- **Pattern detection** (`__app_modules/wellness/health/server/domain/health/services/PatternDetector.mjs`) — pure function; consumes 30-day windows + the user's playbook patterns and emits structured detections (name, confidence, evidence, recommendation, severity, memoryKey). Wired into `MorningBrief.gather`. 7-day TTL working-memory keys (`pattern_<name>_last_flagged`) prevent daily re-nagging.
- **Similar-period grounding** (`__app_modules/wellness/health/server/domain/health/services/SimilarPeriodFinder.mjs`) — pure scoring service comparing a current 30-day signature against historical playbook periods. Used by `MorningBrief` and `WeeklyDigest` when notable signals fire.
- **Compliance tracking** (F-001/002/003) — `__app_modules/wellness/health/server/domain/health/entities/DailyCoachingEntry.mjs` validates the `coaching` field; `__app_modules/wellness/health/server/application/health/SetDailyCoachingUseCase.mjs` writes it; `__app_modules/wellness/health/browser/widgets/CoachingComplianceCard.jsx` is the one-tap entry UI; `get_compliance_summary` reads it back. `MorningBrief` surfaces protein-miss-streak and strength-untracked-streak CTAs with playbook-configurable thresholds.
- **DEXA calibration** (F-006/007) — `__app_modules/wellness/health/server/domain/health/entities/HealthScan.mjs` + `__app_modules/wellness/health/server/adapters/persistence/yaml/YamlHealthScanDatastore.mjs` persist scan records to `lifelog/archives/scans/`. `__app_modules/wellness/health/server/application/health/analytics/CalibrationConstants.mjs` computes consumer-BIA → DEXA offsets; `HealthAggregator.aggregateDayMetrics` applies them to `lean_lbs` and `fat_percent` so all downstream consumers see calibrated values. `MorningBrief` warns when calibration is older than 180 days (suppressed 14 days via `dexa_stale_warned`).
- **Known v1 limitation:** `CalibrationConstants` instances are shared across requests but hold per-user state internally. Concurrent multi-user `MorningBrief` runs could observe each other's offsets between awaits. Today only one user is active per process, so this is theoretical; if multi-user concurrency lands, switch to per-userId caching or per-request instantiation.

### Framework (`__capabilities/agent-runtime/server/application/framework/`)
- `BaseAgent.mjs` - Common lifecycle (memory, tools, assignments)
- `ToolFactory.mjs` - Grouped tool creation base class
- `WorkingMemory.mjs` - WorkingMemoryState with TTL-based expiry
- `Assignment.mjs` - Structured workflow template method
- `OutputValidator.mjs` - JSON Schema validation with LLM retry
- `__backend/src/0_system/scheduling/Scheduler.mjs` - Cron-based assignment triggering (system layer)

### Adapter Layer (`__capabilities/agent-runtime/server/adapters/`)
- `MastraAdapter.mjs` - Mastra SDK implementation
- `YamlWorkingMemoryAdapter.mjs` - YAML file persistence for working memory
- `index.mjs` - Exports

### API Layer (`__capabilities/agent-runtime/server/api/`)
- `mountAgentHttp.mjs`, `createAgentMetaRouter.mjs`, `createAgentMemoryRouter.mjs` - REST endpoints

### Composition (`__capabilities/agent-runtime/server/`)
- `composition.mjs` - agent runtime wiring

### Tests
- `tests/isolated/agents/` - Framework, echo, concierge, lifeplan-guide, memory and health-coach (assignments, tool factories, playbooks, event queries) tests
- `__backend/tests/unit/agents/` - Orchestrator, framework and agents-memory API unit tests
- `tests/live/agent/health-coach-assignment.test.mjs` - Integration tests for health coach assignments

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/agents` | List registered agents |
| POST | `/agents/:agentId/run` | Run agent synchronously |
| POST | `/agents/:agentId/run-background` | Run agent async (fire-and-forget) |
| GET | `/agents/:agentId/assignments` | List agent assignments |
| POST | `/agents/:agentId/assignments/:assignmentId/run` | Manually trigger assignment |
| GET | `/health-dashboard/:userId/:date` | Read agent-generated dashboard |
| GET | `/health-dashboard/:userId` | Read today's dashboard |

## Creating a New Agent

### 1. Create agent directory

```
<app module>/server/application/agents/
└── my-agent/
    ├── MyAgent.mjs
    ├── prompts/
    │   └── system.mjs
    └── index.mjs
```

### 2. Define agent class (extending BaseAgent)

```javascript
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { ToolFactory } from '../framework/ToolFactory.mjs';
import { createTool } from '../ports/ITool.mjs';

class MyToolFactory extends ToolFactory {
  static domain = 'my-domain';
  createTools() {
    return [
      createTool({
        name: 'my_tool',
        description: 'Does a thing',
        parameters: {
          type: 'object',
          properties: { param: { type: 'string' } },
          required: ['param']
        },
        execute: async ({ param }) => ({ result: `Processed: ${param}` })
      })
    ];
  }
}

export class MyAgent extends BaseAgent {
  static id = 'my-agent';
  static description = 'Does something useful';

  getSystemPrompt() { return 'You are a helpful agent.'; }

  registerTools() {
    this.addToolFactory(new MyToolFactory(this.deps));
  }
}
```

### 3. Register in bootstrap

```javascript
// In the app module's composition (see __capabilities/agent-runtime/server/composition.mjs)
import { MyAgent } from './agents/my-agent/index.mjs';

agentOrchestrator.register(MyAgent);
```

## Testing

```bash
# Unit tests
node --test __backend/tests/unit/agents/*.test.mjs

# Smoke test
curl http://localhost:3112/agents
curl -X POST http://localhost:3112/agents/echo/run \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello"}'
```

## Related Docs

- Design: `ops:docs/_wip/plans/2026-01-26-ai-agents-architecture-design.md`
- Agent Framework Design: `ops:docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md`
- Implementation Plan: `ops:docs/plans/2026-02-14-agent-framework.md`
- Health Coach Plan: `ops:docs/plans/2026-02-14-health-coach-agent.md`
- Smoke test: `__docs/runbooks/agents-smoke-test.md`
